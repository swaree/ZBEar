import type { ParkingCandidate } from "../domain/types";

const STREET_PARKING_S = 10 * 60;

/**
 * Temporary hand-seeded Parking Candidates: Rodalies stations outside every ZBE,
 * located at the station stop. Replaced by Discovered Parking Candidates
 * built from OSM in a later ticket.
 */
export const seedCandidates: ParkingCandidate[] = [
  { id: "seed-sant-feliu", name: "Sant Feliu de Llobregat station", location: { lat: 41.383003, lng: 2.04792 }, timeToFindSpaceS: STREET_PARKING_S },
  { id: "seed-molins-de-rei", name: "Molins de Rei station", location: { lat: 41.409897, lng: 2.020773 }, timeToFindSpaceS: STREET_PARKING_S },
  { id: "seed-el-papiol", name: "El Papiol station", location: { lat: 41.43537, lng: 2.002578 }, timeToFindSpaceS: STREET_PARKING_S },
  { id: "seed-montgat", name: "Montgat station", location: { lat: 41.46302, lng: 2.272155 }, timeToFindSpaceS: STREET_PARKING_S },
];
