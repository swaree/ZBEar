import { DEFAULT_TIME_TO_FIND_SPACE_S } from "../domain/parking";
import type { ParkingCandidate, ParkingCandidateDataset } from "../domain/types";

/** The Discovered Parking Candidates, built by `npm run data:candidates` and served next to the app. */
export async function loadDiscoveredParkingCandidates(): Promise<ParkingCandidate[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/parking-candidates.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const dataset = (await res.json()) as ParkingCandidateDataset;
  return dataset.candidates.map((c) => ({ ...c, timeToFindSpaceS: DEFAULT_TIME_TO_FIND_SPACE_S[c.kind] }));
}
