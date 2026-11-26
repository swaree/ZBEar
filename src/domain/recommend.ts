import type { RoutingEngine, TrafficDrive, TransitDuration } from "../routing/RoutingEngine";
import { distanceM } from "./geo";
import type { Baseline, Option, OptionReturnLeg, ParkingCandidate, Recommendation, TripRequest } from "./types";
import { isDriveIllegal, isInsideAnyZbe, type Zbe } from "./zbe";

/** The published datasets the Recommendation reads. */
export interface Datasets {
  zbes: Zbe[];
}

const MAX_OPTIONS = 5;

/** The Recommendation's tunable thresholds. */
export interface RecommendSettings {
  /**
   * The detour bound: a Parking Candidate is routed only when Origin → candidate → Destination
   * is at most this many times Origin → Destination, all straight-line.
   */
  maxDetourRatio: number;
  /**
   * At most this many Parking Candidates are routed, those with the smallest detours. Transitous
   * fair use allows 128 points per one-to-many call, and the Origin rides along in one of them.
   */
  maxRoutedCandidates: number;
  /**
   * How many Parking Candidates, the best by free-flow door-to-door time, get a drive with traffic.
   * Only those can have their drive checked against the ZBEs, so the rest are never offered.
   */
  trafficPassSize: number;
}

const DEFAULT_SETTINGS: RecommendSettings = {
  maxDetourRatio: 1.5,
  maxRoutedCandidates: 127,
  trafficPassSize: 20,
};

export async function recommend(
  trip: TripRequest,
  allCandidates: ParkingCandidate[],
  datasets: Datasets,
  engine: RoutingEngine,
  settings: Partial<RecommendSettings> = {},
): Promise<Recommendation> {
  const { maxDetourRatio, maxRoutedCandidates, trafficPassSize } = { ...DEFAULT_SETTINGS, ...settings };
  const directDistanceM = Math.max(distanceM(trip.origin, trip.destination), 1);
  const candidates = allCandidates
    .map((candidate) => ({
      candidate,
      detour: (distanceM(trip.origin, candidate.location) + distanceM(candidate.location, trip.destination)) / directDistanceM,
    }))
    // Parking Candidates should already be outside every ZBE; this is the safety net for Curated ones.
    .filter(({ candidate, detour }) => detour <= maxDetourRatio && !isInsideAnyZbe(candidate.location, datasets.zbes))
    .sort((a, b) => a.detour - b.detour)
    .slice(0, maxRoutedCandidates)
    .map(({ candidate }) => candidate);
  const locations = candidates.map((c) => c.location);
  const leaveDestinationAt = returnStartsAt(trip);
  // The Origin rides along in the candidates' transit calls: that gives the Baseline for free.
  const [transitWithOrigin, drive, returnTransitWithOrigin, returnDrive] = await Promise.all([
    engine.transitManyToOne([...locations, trip.origin], trip.destination, trip.arriveBy),
    engine.driveFreeFlowOneToMany(trip.origin, locations),
    leaveDestinationAt && engine.transitOneToMany(trip.destination, [...locations, trip.origin], leaveDestinationAt),
    leaveDestinationAt && engine.driveFreeFlowManyToOne(locations, trip.origin),
  ]);
  const transit = transitWithOrigin.slice(0, locations.length);
  const returnTransit = returnTransitWithOrigin && returnTransitWithOrigin.slice(0, locations.length);
  const baseline = baselineOf(
    trip,
    transitWithOrigin[locations.length] ?? null,
    leaveDestinationAt && { leaveDestinationAt, transit: returnTransitWithOrigin?.[locations.length] ?? null },
  );

  // First pass: free-flow drive times, for every routed candidate. With a return time, a candidate
  // must be reachable both ways.
  const firstPass = candidates
    .flatMap((candidate, i): FirstPassEntry[] => {
      const transitThere = transit[i];
      const driveThereS = drive[i];
      if (transitThere == null || driveThereS == null) return [];
      const outboundS = driveThereS + candidate.timeToFindSpaceS + transitThere.durationS;
      if (!returnTransit || !returnDrive) return [{ candidate, transitThere, outboundS, transitBack: null, scoreS: outboundS }];
      const transitBack = returnTransit[i];
      const driveBackS = returnDrive[i];
      if (transitBack == null || driveBackS == null) return [];
      return [{ candidate, transitThere, outboundS, transitBack, scoreS: outboundS + transitBack.durationS + driveBackS }];
    })
    .sort((a, b) => a.scoreS - b.scoreS)
    .slice(0, trafficPassSize);

  // Traffic pass: the drive from the Origin, departing when the free-flow drive says to, and the drive
  // back, departing when the return transit reaches the parking.
  const atArrival = trip.arriveBy.getTime();
  const trafficPass = await Promise.all(
    firstPass.map(async ({ candidate, transitThere, outboundS, transitBack }) => {
      const back =
        leaveDestinationAt && transitBack
          ? { transit: transitBack, departAt: new Date(leaveDestinationAt.getTime() + transitBack.durationS * 1000) }
          : null;
      const [driveThere, driveBack] = await Promise.all([
        engine.driveWithTraffic(trip.origin, candidate.location, new Date(atArrival - outboundS * 1000)),
        back && engine.driveWithTraffic(candidate.location, trip.origin, back.departAt),
      ]);
      return { candidate, transitThere, driveThere, back: back && { ...back, drive: driveBack } };
    }),
  );

  const label = trip.vehicleLabel ?? "none";
  const options: Option[] = [];
  for (const { candidate, transitThere, driveThere, back } of trafficPass) {
    if (!driveThere) continue;
    const outboundS = driveThere.durationS + candidate.timeToFindSpaceS + transitThere.durationS;
    const leaveOriginAt = atArrival - outboundS * 1000;
    if (isDriveIllegal(timed(driveThere, leaveOriginAt), datasets.zbes, label)) continue;
    let returnLeg: OptionReturnLeg | null = null;
    if (back) {
      if (!back.drive || isDriveIllegal(timed(back.drive, back.departAt.getTime()), datasets.zbes, label)) continue;
      returnLeg = {
        transitS: back.transit.durationS,
        transfers: back.transit.transfers,
        driveS: back.drive.durationS,
        driveFromParkingAt: back.departAt,
        arriveOriginAt: new Date(back.departAt.getTime() + back.drive.durationS * 1000),
      };
    }
    const doorToDoorS = outboundS + (returnLeg ? returnLeg.transitS + returnLeg.driveS : 0);
    options.push({
      candidate,
      driveS: driveThere.durationS,
      timeToFindSpaceS: candidate.timeToFindSpaceS,
      transitS: transitThere.durationS,
      transfers: transitThere.transfers,
      doorToDoorS,
      timeSavedS: baseline ? baseline.transitS + (baseline.returnLeg?.transitS ?? 0) - doorToDoorS : null,
      leaveOriginAt: new Date(leaveOriginAt),
      leaveParkingAt: new Date(atArrival - transitThere.durationS * 1000),
      returnLeg,
    });
  }

  options.sort((x, y) => x.doorToDoorS - y.doorToDoorS);
  return { options: options.slice(0, MAX_OPTIONS), baseline };
}

/** A Parking Candidate's free-flow door-to-door time, both ways when the Trip has a Return Leg. */
interface FirstPassEntry {
  candidate: ParkingCandidate;
  transitThere: TransitDuration;
  outboundS: number;
  /** Null when the Trip has no Return Leg. */
  transitBack: TransitDuration | null;
  scoreS: number;
}

/** When the Return Leg leaves the Destination: null when the Trip has no return time. */
export function returnStartsAt({ arriveBy, returnTime }: Pick<TripRequest, "arriveBy" | "returnTime">): Date | null {
  if (!returnTime) return null;
  return "at" in returnTime ? returnTime.at : new Date(arriveBy.getTime() + returnTime.stayS * 1000);
}

/** A drive's path with the clock time the car passes each point, given when the drive departs. */
function timed(drive: TrafficDrive, departAtMs: number) {
  return drive.path.map(({ lat, lng, atS }) => ({ lat, lng, at: departAtMs + atS * 1000 }));
}

/** The whole Trip by transit: null when transit can't make the Outbound Leg, or the Return Leg when there is one. */
function baselineOf(
  trip: TripRequest,
  outbound: TransitDuration | null,
  back: { leaveDestinationAt: Date; transit: TransitDuration | null } | null,
): Baseline | null {
  if (!outbound || (back && !back.transit)) return null;
  return {
    transitS: outbound.durationS,
    transfers: outbound.transfers,
    leaveOriginAt: new Date(trip.arriveBy.getTime() - outbound.durationS * 1000),
    returnLeg: back?.transit
      ? {
          transitS: back.transit.durationS,
          transfers: back.transit.transfers,
          arriveOriginAt: new Date(back.leaveDestinationAt.getTime() + back.transit.durationS * 1000),
        }
      : null,
  };
}
