import type { RoutingEngine } from "../routing/RoutingEngine";
import type { Option, ParkingCandidate, Recommendation, TripRequest } from "./types";

const MAX_OPTIONS = 5;

export async function recommend(
  trip: TripRequest,
  candidates: ParkingCandidate[],
  engine: RoutingEngine,
): Promise<Recommendation> {
  const locations = candidates.map((c) => c.location);
  const [transit, drive] = await Promise.all([
    engine.transitManyToOne(locations, trip.destination, trip.arriveBy),
    engine.driveFreeFlowOneToMany(trip.origin, locations),
  ]);

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
      leaveOriginAt: new Date(trip.arriveBy.getTime() - doorToDoorS * 1000),
      leaveParkingAt: new Date(trip.arriveBy.getTime() - t.durationS * 1000),
    });
  });

  options.sort((x, y) => x.doorToDoorS - y.doorToDoorS);
  return { options: options.slice(0, MAX_OPTIONS) };
}
