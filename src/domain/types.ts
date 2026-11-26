export interface LatLng {
  lat: number;
  lng: number;
}

/** A place outside every ZBE where the car can be left for the length of a Trip. */
export interface ParkingCandidate {
  id: string;
  name: string;
  location: LatLng;
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
