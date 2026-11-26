import type { ParkingCandidate, ParkingCandidateDataset, ParkingKind } from "../domain/types";

/** The default time to find a space, until the user sets one: quick in a car park, slower on the street. */
const TIME_TO_FIND_SPACE_S: Record<ParkingKind, number> = {
  "car-park": 3 * 60,
  "park-and-ride": 3 * 60,
  street: 10 * 60,
};

/** The Discovered Parking Candidates, built by `npm run data:candidates` and served next to the app. */
export async function loadDiscoveredParkingCandidates(): Promise<ParkingCandidate[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/parking-candidates.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const dataset = (await res.json()) as ParkingCandidateDataset;
  return dataset.candidates.map((c) => ({ ...c, timeToFindSpaceS: TIME_TO_FIND_SPACE_S[c.kind] }));
}
