import type { RoutingEngine, TransitItinerary } from "../routing/RoutingEngine";
import { returnStartsAt } from "./recommend";
import type { Option, TripRequest } from "./types";

/** What an Option shown to the traveller adds to its times: the transit steps, each null when none was found. */
export interface OptionDetails {
  /** From the parking to the Destination, arriving by the arrive-by time. */
  transitThere: TransitItinerary | null;
  /** Null when the Trip has no return. */
  transitBack: TransitItinerary | null;
}

/**
 * Fetches an Option's details. Each takes full itineraries, far heavier than the durations it was
 * ranked by, so this is only for the Options shown.
 */
export async function detailOption(
  trip: TripRequest,
  option: Pick<Option, "candidate">,
  engine: RoutingEngine,
): Promise<OptionDetails> {
  const parking = option.candidate.location;
  const leaveDestinationAt = returnStartsAt(trip);
  const [transitThere, transitBack] = await Promise.all([
    engine.transitItineraryArrivingBy(parking, trip.destination, trip.arriveBy),
    leaveDestinationAt && engine.transitItineraryLeavingAt(trip.destination, parking, leaveDestinationAt),
  ]);
  return { transitThere, transitBack };
}
