import type { EnvironmentalLabel } from "./zbe";

export interface LatLng {
  lat: number;
  lng: number;
}

/** What sort of place a Parking Candidate is. */
export type ParkingKind = "car-park" | "park-and-ride" | "street";

/**
 * The rules for leaving a car at a Parking Candidate, as the source states them (OSM tag
 * values, uninterpreted). A missing field is unknown, not "no rule".
 */
export interface ParkingConditions {
  /** OSM `fee`, e.g. "yes", "no", or a conditional such as "yes @ (Mo-Fr 08:00-20:00)". */
  fee?: string;
  /** OSM `charge`, e.g. "2.50 EUR/hour". */
  charge?: string;
  /** OSM `maxstay`, e.g. "2 hours". */
  maxStay?: string;
  /** OSM `access` when it restricts who may park, e.g. "residents". */
  access?: string;
  /** OSM `opening_hours`. */
  openingHours?: string;
}

/** A Parking Candidate found automatically from map data, as published by the dataset build. */
export interface DiscoveredParkingCandidate {
  /** "osm:<type>/<id>" of the car park it was built from: stable across rebuilds. */
  id: string;
  name: string;
  location: LatLng;
  kind: ParkingKind;
  conditions: ParkingConditions;
}

/** The published Discovered Parking Candidates. */
export interface ParkingCandidateDataset {
  /** ISO timestamp of the dataset build. */
  builtAt: string;
  candidates: DiscoveredParkingCandidate[];
}

/** A place outside every ZBE where the car can be left for the length of a Trip. */
export interface ParkingCandidate {
  id: string;
  name: string;
  location: LatLng;
  kind: ParkingKind;
  conditions: ParkingConditions;
  timeToFindSpaceS: number;
}

export interface TripRequest {
  origin: LatLng;
  destination: LatLng;
  /** The traveller must be at the Destination by this time. */
  arriveBy: Date;
  /** The vehicle's Environmental Label, which decides the ZBEs that bar it. Defaults to none. */
  vehicleLabel?: EnvironmentalLabel;
  /** When the traveller leaves the Destination again. Without it the Trip has no Return Leg to plan. */
  returnTime?: ReturnTime;
}

/**
 * When the Return Leg starts from the Destination: at a given time, or after a stay there counted from
 * the arrive-by time.
 */
export type ReturnTime = { at: Date } | { stayS: number };

/** One Parking Candidate evaluated for a specific Trip. */
export interface Option {
  candidate: ParkingCandidate;
  driveS: number;
  timeToFindSpaceS: number;
  /** Walk to the stop, waiting, riding, transfers and the walk to the Destination. */
  transitS: number;
  transfers: number;
  /** The Outbound Leg's door-to-door time, plus the Return Leg's when there is one. */
  doorToDoorS: number;
  /** Against the Baseline: positive when this Option is faster; null when there is no Baseline. */
  timeSavedS: number | null;
  leaveOriginAt: Date;
  /** When to leave the parking for the transit to the Destination. */
  leaveParkingAt: Date;
  /** Null when the Trip has no return time. */
  returnLeg: OptionReturnLeg | null;
}

/** An Option's way back: transit from the Destination to the parking, then the drive to the Origin. */
export interface OptionReturnLeg {
  /** The walk to the stop, waiting, riding, transfers and the walk to the parking. */
  transitS: number;
  transfers: number;
  driveS: number;
  /** When the drive back starts from the parking. */
  driveFromParkingAt: Date;
  arriveOriginAt: Date;
}

/** The whole Trip by transit from the Origin, no car: what each Option is measured against. */
export interface Baseline {
  transitS: number;
  transfers: number;
  leaveOriginAt: Date;
  /** Transit from the Destination back to the Origin, leaving at the return time; null with no return time. */
  returnLeg: { transitS: number; transfers: number; arriveOriginAt: Date } | null;
}

export interface Recommendation {
  options: Option[];
  /** Null when transit can't reach the Destination from the Origin by that time, or can't bring the traveller back. */
  baseline: Baseline | null;
}
