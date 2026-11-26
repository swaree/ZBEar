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
  return?: TripReturn;
}

/**
 * When the Return Leg leaves the Destination: Get back at a given time, or Stay for a while there,
 * counted from the arrive-by time.
 */
export type TripReturn = { getBackAt: Date } | { stayForS: number };

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
  /** Null when the Trip has no return. */
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
  /** Transit from the Destination back to the Origin, leaving when the Return Leg does; null with no return. */
  returnLeg: { transitS: number; transfers: number; arriveOriginAt: Date } | null;
}

/** Driving straight to the Destination and parking there, offered only when no part of the Trip drives inside a ZBE during its Restriction Window. */
export interface DirectDrive {
  /** The drive from the Origin to the Destination, with traffic. */
  driveS: number;
  /** Parking at the Destination is unknown, so it takes as long as on the street. */
  timeToFindSpaceS: number;
  /** The Outbound Leg's drive and finding a space, plus the drive back when the Trip has a return. */
  doorToDoorS: number;
  /** Against the Baseline: positive when Direct Drive is faster; null when there is no Baseline. */
  timeSavedS: number | null;
  leaveOriginAt: Date;
  /** The drive back from the Destination to the Origin; null when the Trip has no return. */
  returnLeg: { driveS: number; leaveDestinationAt: Date; arriveOriginAt: Date } | null;
  remarks: Remark[];
}

/** A notable fact about an Option that the score leaves out. */
export type Remark = LeaveOutsideRestrictionRemark;

/**
 * With no return given, Direct Drive is valid only if the car leaves the Destination outside the next
 * Restriction Window of the ZBEs its drive passes through: out of them before it starts, or after it ends.
 */
export interface LeaveOutsideRestrictionRemark {
  kind: "leave-outside-restriction";
  zbeNames: string[];
  /** When the next Restriction Window starts, or the arrival when it already applies then. */
  restrictedFrom: Date;
  /** When it ends; null when it doesn't end within eight days (a week, plus a day of slack). */
  restrictedUntil: Date | null;
}

export interface Recommendation {
  options: Option[];
  /** Null when driving straight to the Destination, or back, would be inside a ZBE during its Restriction Window, or can't be routed. */
  directDrive: DirectDrive | null;
  /** Null when transit can't reach the Destination from the Origin by that time, or can't bring the traveller back. */
  baseline: Baseline | null;
}
