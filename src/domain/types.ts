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
}

/** One Parking Candidate evaluated for a specific Trip. */
export interface Option {
  candidate: ParkingCandidate;
  driveS: number;
  timeToFindSpaceS: number;
  /** Walk to the stop, waiting, riding, transfers and the walk to the Destination. */
  transitS: number;
  transfers: number;
  doorToDoorS: number;
  /** Against the Baseline: positive when this Option is faster; null when there is no Baseline. */
  timeSavedS: number | null;
  leaveOriginAt: Date;
  leaveParkingAt: Date;
}

/** The whole Trip by transit from the Origin, no car: what each Option is measured against. */
export interface Baseline {
  transitS: number;
  transfers: number;
  leaveOriginAt: Date;
}

export interface Recommendation {
  options: Option[];
  /** Null when transit can't reach the Destination from the Origin by that time. */
  baseline: Baseline | null;
}
