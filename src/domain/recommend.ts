import type { RoutingEngine } from "../routing/RoutingEngine";
import type { Option, ParkingCandidate, Recommendation, TripRequest } from "./types";
import { isInsideAnyZbe, type Zbe } from "./zbe";

/** The published datasets the Recommendation reads. */
export interface Datasets {
  zbes: Zbe[];
}

const MAX_OPTIONS = 5;

export async function recommend(
  trip: TripRequest,
  allCandidates: ParkingCandidate[],
  datasets: Datasets,
  engine: RoutingEngine,
): Promise<Recommendation> {
  // Parking Candidates should already be outside every ZBE; this is the safety net for Curated ones.
  const candidates = allCandidates.filter((c) => !isInsideAnyZbe(c.location, datasets.zbes));
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

  const options: Option[] = [];
  candidates.forEach((candidate, i) => {
    const t = transit[i];
    const d = drive[i];
    if (t == null || d == null) return;
    const doorToDoorS = d + candidate.timeToFindSpaceS + t.durationS;
    options.push({
      candidate,
      driveS: d,
      timeToFindSpaceS: candidate.timeToFindSpaceS,
      transitS: t.durationS,
      transfers: t.transfers,
      doorToDoorS,
      timeSavedS: baseline ? baseline.transitS - doorToDoorS : null,
      leaveOriginAt: new Date(trip.arriveBy.getTime() - doorToDoorS * 1000),
      leaveParkingAt: new Date(trip.arriveBy.getTime() - t.durationS * 1000),
    });
  });

  options.sort((x, y) => x.doorToDoorS - y.doorToDoorS);
  return { options: options.slice(0, MAX_OPTIONS), baseline };
}
