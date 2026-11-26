import type { LatLng } from "../domain/types";

export interface TransitDuration {
  /**
   * Arriving by a time: seconds from the latest departure at the origin point until the requested
   * arrival time, so any slack before arrival is included. Leaving at a time: seconds from that time
   * until the arrival at each point, so any wait for the first departure is included.
   */
  durationS: number;
  transfers: number;
}

/** A point on a drive and when the car passes it, in seconds after the drive departs. */
export interface TimedPoint extends LatLng {
  atS: number;
}

/** A drive with the traffic expected at its departure time. */
export interface TrafficDrive {
  durationS: number;
  distanceM: number;
  /** The road path from start to end, timed: the first point is at 0 s, the last at the end of the drive. */
  path: TimedPoint[];
}

/**
 * The routing port the Recommendation depends on (ADR-0002). Results line up
 * with the order of `many`; `null` means no route was found.
 */
export interface RoutingEngine {
  /** Transit (walk + any mode) from each of `many` to `one`, arriving by `arriveBy`. */
  transitManyToOne(many: LatLng[], one: LatLng, arriveBy: Date): Promise<(TransitDuration | null)[]>;

  /** Transit (walk + any mode) from `one` to each of `many`, leaving at `leaveAt`. */
  transitOneToMany(one: LatLng, many: LatLng[], leaveAt: Date): Promise<(TransitDuration | null)[]>;

  /** Free-flow driving time in seconds from `one` to each of `many`, with no traffic. */
  driveFreeFlowOneToMany(one: LatLng, many: LatLng[]): Promise<(number | null)[]>;

  /** Free-flow driving time in seconds from each of `many` to `one`, with no traffic. */
  driveFreeFlowManyToOne(many: LatLng[], one: LatLng): Promise<(number | null)[]>;

  /** Driving from `from` to `to` in the traffic expected when departing at `departAt`. */
  driveWithTraffic(from: LatLng, to: LatLng, departAt: Date): Promise<TrafficDrive | null>;
}
