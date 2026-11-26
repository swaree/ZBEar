import type { ParkingKind } from "./types";

/** The default time to find a space, until the user sets one: quick in a car park, slower on the street. */
export const DEFAULT_TIME_TO_FIND_SPACE_S: Record<ParkingKind, number> = {
  "car-park": 3 * 60,
  "park-and-ride": 3 * 60,
  street: 10 * 60,
};
