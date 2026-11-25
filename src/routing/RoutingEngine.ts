import type { LatLng } from "../domain/types";

export interface TransitDuration {
  /**
   * Seconds from the latest departure at the origin point until the requested
   * arrival time, so any slack before arrival is included.
   */
  durationS: number;
  transfers: number;
}

/**
 * The routing port the Recommendation depends on (ADR-0002). Results line up
 * with the order of `many`; `null` means no route was found.
 */
export interface RoutingEngine {
  /** Transit (walk + any mode) from each of `many` to `one`, arriving by `arriveBy`. */
  transitManyToOne(many: LatLng[], one: LatLng, arriveBy: Date): Promise<(TransitDuration | null)[]>;

  /** Free-flow driving time in seconds from `one` to each of `many`, with no traffic. */
  driveFreeFlowOneToMany(one: LatLng, many: LatLng[]): Promise<(number | null)[]>;
}
