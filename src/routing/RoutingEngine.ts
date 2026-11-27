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

/** How a transit itinerary's leg is made: on foot, or riding a line of this kind. */
export type TransitMode = "walk" | RideMode;
/** The kinds of transit line a ride can be on: Rodalies and FGC are "rail", the Barcelona metro "subway". */
export type RideMode = "bus" | "coach" | "tram" | "subway" | "rail" | "ferry" | "funicular" | "aerial-lift" | "other";

interface TransitLegBase {
  /** Where the leg starts and ends: a stop's name, or null at the itinerary's own ends. */
  fromName: string | null;
  toName: string | null;
  departAt: Date;
  arriveAt: Date;
  /** The way the leg goes, from its start to its end. */
  path: LatLng[];
}

/** A walk: to the first stop, between stops when changing, or from the last stop. */
export interface WalkLeg extends TransitLegBase {
  mode: "walk";
  distanceM: number;
}

/** A ride on one transit line, from boarding to alighting. */
export interface RideLeg extends TransitLegBase {
  mode: RideMode;
  /** The line's name as signed, e.g. "L3" or "X43". */
  line: string;
  /** Where the vehicle is heading, as signed. */
  headsign: string | null;
  /** The line's colour as "#rrggbb", when the operator gives one. */
  color: string | null;
  agency: string | null;
  /** Stops passed between boarding and alighting. */
  stopsBetween: number;
}

/** One step of a transit itinerary. */
export type TransitLeg = WalkLeg | RideLeg;

/** One way to go by transit from one place to another, step by step. */
export interface TransitItinerary {
  departAt: Date;
  arriveAt: Date;
  transfers: number;
  legs: TransitLeg[];
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

  /**
   * The transit itinerary from `from` to `to` that arrives by `arriveBy` and leaves latest, the way
   * `transitManyToOne` measures it. Null when there is none.
   */
  transitItineraryArrivingBy(from: LatLng, to: LatLng, arriveBy: Date): Promise<TransitItinerary | null>;

  /**
   * The transit itinerary from `from` to `to` that leaves at `leaveAt` or later and arrives first, the
   * way `transitOneToMany` measures it. Null when there is none.
   */
  transitItineraryLeavingAt(from: LatLng, to: LatLng, leaveAt: Date): Promise<TransitItinerary | null>;

  /** The road path of the free-flow drive from `from` to `to`; null when there is no route. */
  drivePath(from: LatLng, to: LatLng): Promise<LatLng[] | null>;
}
