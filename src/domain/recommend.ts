import type { RoutingEngine, TrafficDrive, TransitDuration } from "../routing/RoutingEngine";
import { distanceM } from "./geo";
import { DEFAULT_TIME_TO_FIND_SPACE_S, judgeParking } from "./parking";
import type { Baseline, DirectDrive, Option, OptionReturnLeg, ParkingCandidate, Recommendation, Remark, TripRequest } from "./types";
import { isDriveIllegal, isInsideAnyZbe, nextRestriction, zbesDrivenThrough, type Zbe } from "./zbe";

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
   * fair use allows 128 points per one-to-many call, and the Origin (in the transit calls) or the
   * Destination (in the free-flow drive from the Origin) rides along.
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
    .map(({ candidate }): RoutedCandidate => ({
      ...candidate,
      timeToFindSpaceS: candidate.timeToFindSpaceS ?? DEFAULT_TIME_TO_FIND_SPACE_S[candidate.kind],
    }));
  const locations = candidates.map((c) => c.location);
  const leaveDestinationAt = returnStartsAt(trip);
  // The Origin rides along in the candidates' transit calls: that gives the Baseline for free.
  // And the Destination rides along in the free-flow drives, for Direct Drive.
  const [transitWithOrigin, driveWithDestination, returnTransitWithOrigin, returnDrive] = await Promise.all([
    engine.transitManyToOne([...locations, trip.origin], trip.destination, trip.arriveBy),
    engine.driveFreeFlowOneToMany(trip.origin, [...locations, trip.destination]),
    leaveDestinationAt && engine.transitOneToMany(trip.destination, [...locations, trip.origin], leaveDestinationAt),
    leaveDestinationAt && engine.driveFreeFlowManyToOne(locations, trip.origin),
  ]);
  const transit = transitWithOrigin.slice(0, locations.length);
  const drive = driveWithDestination.slice(0, locations.length);
  const directDriveFreeFlowS = driveWithDestination[locations.length] ?? null;
  const returnTransit = returnTransitWithOrigin && returnTransitWithOrigin.slice(0, locations.length);
  const baseline = baselineOf(
    trip,
    transitWithOrigin[locations.length] ?? null,
    leaveDestinationAt && { leaveDestinationAt, transit: returnTransitWithOrigin?.[locations.length] ?? null },
  );

  // First pass: free-flow drive times, for every routed candidate. With a return, a candidate
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

  const atArrival = trip.arriveBy.getTime();
  // Direct Drive's drives with traffic run alongside the traffic pass: there, departing when the free-flow
  // drive says to, and back, departing when the traveller leaves the Destination.
  const directDrives: Promise<[TrafficDrive | null, TrafficDrive | null]> =
    directDriveFreeFlowS == null
      ? Promise.resolve([null, null])
      : Promise.all([
          engine.driveWithTraffic(
            trip.origin,
            trip.destination,
            new Date(atArrival - (directDriveFreeFlowS + DIRECT_DRIVE_TIME_TO_FIND_SPACE_S) * 1000),
          ),
          leaveDestinationAt ? engine.driveWithTraffic(trip.destination, trip.origin, leaveDestinationAt) : null,
        ]);
  // Traffic pass: the drive from the Origin, departing when the free-flow drive says to, and the drive
  // back, departing when the return transit reaches the parking.
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
    const arriveParkingAt = leaveOriginAt + driveThere.durationS * 1000;
    // With no return, the car stays at least until the traveller reaches the Destination.
    const driveAwayAt = returnLeg ? returnLeg.driveFromParkingAt.getTime() : atArrival;
    const parking = judgeParking(candidate, { from: arriveParkingAt, until: driveAwayAt, openEnded: !returnLeg });
    options.push({
      candidate,
      driveS: driveThere.durationS,
      drivePath: driveThere.path.map(({ lat, lng }) => ({ lat, lng })),
      timeToFindSpaceS: candidate.timeToFindSpaceS,
      transitS: transitThere.durationS,
      transfers: transitThere.transfers,
      doorToDoorS,
      timeSavedS: timeSavedAgainst(baseline, doorToDoorS),
      leaveOriginAt: new Date(leaveOriginAt),
      leaveParkingAt: new Date(atArrival - transitThere.durationS * 1000),
      returnLeg,
      parkingConflicts: parking.conflicts,
      remarks: parking.remarks,
    });
  }

  // Two tiers: Options whose Parking Conditions conflict with the stay go below all the others.
  options.sort((x, y) => tierOf(x) - tierOf(y) || x.doorToDoorS - y.doorToDoorS);
  const [directDriveThere, directDriveBack] = await directDrives;
  const directDrive = directDriveOf(
    trip,
    directDriveThere,
    leaveDestinationAt && { departAt: leaveDestinationAt, drive: directDriveBack },
    datasets.zbes,
    baseline,
  );
  return { options: options.slice(0, MAX_OPTIONS), directDrive, baseline };
}

const tierOf = (option: Option) => (option.parkingConflicts.length > 0 ? 1 : 0);

/** Parking at the Destination is unknown, so Direct Drive takes as long to find a space as on the street. */
const DIRECT_DRIVE_TIME_TO_FIND_SPACE_S = DEFAULT_TIME_TO_FIND_SPACE_S.street;

/**
 * Direct Drive from its drives with traffic, there and (when the Trip has a return) back: null unless
 * every drive was routed and is legal.
 */
function directDriveOf(
  trip: TripRequest,
  driveThere: TrafficDrive | null,
  back: { departAt: Date; drive: TrafficDrive | null } | null,
  zbes: Zbe[],
  baseline: Baseline | null,
): DirectDrive | null {
  if (!driveThere) return null;
  const label = trip.vehicleLabel ?? "none";
  const outboundS = driveThere.durationS + DIRECT_DRIVE_TIME_TO_FIND_SPACE_S;
  const leaveOriginAt = trip.arriveBy.getTime() - outboundS * 1000;
  // Finding a space is driving too: around the Destination, until the arrive-by time.
  const there = [...timed(driveThere, leaveOriginAt), { ...trip.destination, at: trip.arriveBy.getTime() }];
  if (isDriveIllegal(there, zbes, label)) return null;
  if (back && (!back.drive || isDriveIllegal(timed(back.drive, back.departAt.getTime()), zbes, label))) return null;
  const returnLeg = back?.drive
    ? {
        driveS: back.drive.durationS,
        leaveDestinationAt: back.departAt,
        arriveOriginAt: new Date(back.departAt.getTime() + back.drive.durationS * 1000),
      }
    : null;
  const doorToDoorS = outboundS + (returnLeg?.driveS ?? 0);
  const remarks: Remark[] = [];
  if (!back) {
    // The way back is unknown, so it is taken to pass through the ZBEs the way there does.
    const drivenThrough = zbesDrivenThrough(there, zbes, label);
    const restriction = drivenThrough.length > 0 ? nextRestriction(drivenThrough, trip.arriveBy.getTime()) : null;
    if (restriction) {
      remarks.push({
        kind: "leave-outside-restriction",
        zbeNames: drivenThrough.map((zbe) => zbe.name),
        restrictedFrom: new Date(restriction.from),
        restrictedUntil: restriction.until == null ? null : new Date(restriction.until),
      });
    }
  }
  return {
    driveS: driveThere.durationS,
    timeToFindSpaceS: DIRECT_DRIVE_TIME_TO_FIND_SPACE_S,
    doorToDoorS,
    timeSavedS: timeSavedAgainst(baseline, doorToDoorS),
    leaveOriginAt: new Date(leaveOriginAt),
    returnLeg,
    remarks,
  };
}

/** Positive when faster than the Baseline, both ways when it has a return; null when there is no Baseline. */
function timeSavedAgainst(baseline: Baseline | null, doorToDoorS: number): number | null {
  return baseline ? baseline.transitS + (baseline.returnLeg?.transitS ?? 0) - doorToDoorS : null;
}

/** A Parking Candidate being routed, with its time to find a space settled. */
type RoutedCandidate = ParkingCandidate & { timeToFindSpaceS: number };

/** A Parking Candidate's free-flow door-to-door time, both ways when the Trip has a Return Leg. */
interface FirstPassEntry {
  candidate: RoutedCandidate;
  transitThere: TransitDuration;
  outboundS: number;
  /** Null when the Trip has no Return Leg. */
  transitBack: TransitDuration | null;
  scoreS: number;
}

/** When the Return Leg leaves the Destination: null when the Trip has no return. */
export function returnStartsAt(trip: Pick<TripRequest, "arriveBy" | "return">): Date | null {
  const back = trip.return;
  if (!back) return null;
  return "getBackAt" in back ? back.getBackAt : new Date(trip.arriveBy.getTime() + back.stayForS * 1000);
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
