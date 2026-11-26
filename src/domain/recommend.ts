import type { RoutingEngine } from "../routing/RoutingEngine";
import { distanceM } from "./geo";
import type { Option, ParkingCandidate, Recommendation, TripRequest } from "./types";
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
  // The Origin rides along in the candidates' transit call: that gives the Baseline for free.
  const [transitWithOrigin, drive] = await Promise.all([
    engine.transitManyToOne([...locations, trip.origin], trip.destination, trip.arriveBy),
    engine.driveFreeFlowOneToMany(trip.origin, locations),
  ]);
  const transit = transitWithOrigin.slice(0, locations.length);
  const fromOrigin = transitWithOrigin[locations.length] ?? null;
  const baseline = fromOrigin && {
    transitS: fromOrigin.durationS,
    transfers: fromOrigin.transfers,
    leaveOriginAt: new Date(trip.arriveBy.getTime() - fromOrigin.durationS * 1000),
  };

  // First pass: free-flow drive times, for every routed candidate.
  const firstPass = candidates
    .flatMap((candidate, i) => {
      const t = transit[i];
      const d = drive[i];
      return t == null || d == null ? [] : [{ candidate, transit: t, freeFlowDriveS: d }];
    })
    .map((c) => ({ ...c, scoreS: c.freeFlowDriveS + c.candidate.timeToFindSpaceS + c.transit.durationS }))
    .sort((a, b) => a.scoreS - b.scoreS)
    .slice(0, trafficPassSize);

  // Traffic pass: the drive from the Origin, departing when the free-flow drive says to.
  const atArrival = trip.arriveBy.getTime();
  const trafficPass = await Promise.all(
    firstPass.map(async ({ candidate, transit, scoreS }) => {
      const departAt = new Date(atArrival - scoreS * 1000);
      return { candidate, transit, traffic: await engine.driveWithTraffic(trip.origin, candidate.location, departAt) };
    }),
  );

  const options: Option[] = [];
  for (const { candidate, transit: t, traffic } of trafficPass) {
    if (!traffic) continue;
    const doorToDoorS = traffic.durationS + candidate.timeToFindSpaceS + t.durationS;
    const leaveOriginAt = atArrival - doorToDoorS * 1000;
    const path = traffic.path.map(({ lat, lng, atS }) => ({ lat, lng, at: leaveOriginAt + atS * 1000 }));
    if (isDriveIllegal(path, datasets.zbes, trip.vehicleLabel ?? "none")) continue;
    options.push({
      candidate,
      driveS: traffic.durationS,
      timeToFindSpaceS: candidate.timeToFindSpaceS,
      transitS: t.durationS,
      transfers: t.transfers,
      doorToDoorS,
      timeSavedS: baseline ? baseline.transitS - doorToDoorS : null,
      leaveOriginAt: new Date(leaveOriginAt),
      leaveParkingAt: new Date(atArrival - t.durationS * 1000),
    });
  }

  options.sort((x, y) => x.doorToDoorS - y.doorToDoorS);
  return { options: options.slice(0, MAX_OPTIONS), baseline };
}
