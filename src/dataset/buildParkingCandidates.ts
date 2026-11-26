import type { DiscoveredParkingCandidate, LatLng, ParkingCandidateDataset, ParkingConditions, ParkingKind } from "../domain/types";
import { isInsideAnyZbe, type Zbe } from "../domain/zbe";
import { NearbyIndex } from "./nearbyIndex";

/** One element of an Overpass `out center` response: a node has a position, a way or relation a center. */
export interface OverpassPlace {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** A car park must be within this straight-line distance of a transit stop, in m. */
const MAX_STOP_DISTANCE_M = 500;
/** Car parks within this distance of each other merge into one Parking Candidate, in m. */
const MERGE_DISTANCE_M = 150;

/**
 * OSM `access` values that bar a member of the public. Resident-only (`residents`) is not
 * among them: it's a Parking Condition, and such a car park is still worth listing.
 */
const PRIVATE_ACCESS = new Set(["private", "customers", "permit", "no", "delivery", "employees"]);

/**
 * Where a bus, tram, metro or train picks passengers up, however OSM tags it: any of these
 * values of any of these keys. The build script's Overpass query asks for exactly these.
 */
export const TRANSIT_STOP_TAGS: Record<string, string[]> = {
  highway: ["bus_stop"],
  amenity: ["bus_station"],
  public_transport: ["platform", "stop_position", "station"],
  railway: ["station", "halt", "tram_stop", "platform", "subway_entrance"],
};

/**
 * The Discovered Parking Candidates part of the dataset build, from OSM car parks
 * (`amenity=parking`) and transit stops of any mode. Distance to a ZBE edge doesn't matter: a
 * car park at a fast rail station far out can beat one at the edge, and each query picks the
 * ones worth routing.
 */
export function buildParkingCandidates(input: {
  /** OSM car parks and transit stops, in one Overpass `out center` response. */
  osm: { elements: OverpassPlace[] };
  /** The published ZBEs: no candidate may lie inside one, or in its disputed areas. */
  zbes: Zbe[];
  /** A car park must be within this straight-line distance of a transit stop, in m (default ~500). */
  maxStopDistanceM?: number;
  /** Car parks within this distance of each other merge into one Parking Candidate, in m (default ~150). */
  mergeDistanceM?: number;
  builtAt: Date;
}): { dataset: ParkingCandidateDataset } {
  const places = input.osm.elements.flatMap((element) => {
    const location = locationOf(element);
    return location ? [{ element, tags: element.tags ?? {}, location }] : [];
  });
  const stops = new NearbyIndex(
    places.filter((p) => isTransitStop(p.tags)),
    input.maxStopDistanceM ?? MAX_STOP_DISTANCE_M,
  );
  const carParks = places.filter(
    ({ tags, location }) =>
      tags.amenity === "parking" &&
      !PRIVATE_ACCESS.has(tags.access ?? "") &&
      !isInsideAnyZbe(location, input.zbes) &&
      stops.within(location).length > 0,
  );
  const candidates = mergeNeighbours(carParks, input.mergeDistanceM ?? MERGE_DISTANCE_M).map(
    ({ element, tags, location }): DiscoveredParkingCandidate => ({
      id: idOf(element),
      name: tags.name ?? nameNear(stops.within(location)),
      location,
      kind: kindOf(tags),
      conditions: conditionsOf(tags),
    }),
  );
  return { dataset: { builtAt: input.builtAt.toISOString(), candidates } };
}

/**
 * A name for an unnamed car park, from the nearest transit stop that has one. A rail
 * platform's name is usually its track number ("Via 1"), which says nothing about the place.
 */
function nameNear(stopsNearestFirst: Place[]): string {
  const stop = stopsNearestFirst.find((s) => s.tags.name && s.tags.railway !== "platform");
  return stop ? `Car park near ${stop.tags.name}` : "Car park";
}

interface Place {
  element: OverpassPlace;
  tags: Record<string, string>;
  location: LatLng;
}

/**
 * Merges car parks within `distanceM` of each other into one, which takes the place (name,
 * location, kind, Parking Conditions and ID) of the first of them: a P+R, else the lowest OSM
 * ID. New OSM elements get higher IDs, so mapping another car park nearby, or editing one,
 * leaves the candidate's ID alone unless the newcomer is a P+R. Each car park joins the first
 * one near it rather than chaining through neighbours, so a row of car parks along a street
 * doesn't become one candidate a kilometre long. The result is in OSM ID order, whatever the
 * input order.
 */
function mergeNeighbours(carParks: Place[], distanceM: number): Place[] {
  const isParkAndRide = (p: Place) => Number(kindOf(p.tags) === "park-and-ride");
  const byPriority = [...carParks].sort((a, b) => isParkAndRide(b) - isParkAndRide(a) || compareIds(a.element, b.element));
  const index = new NearbyIndex(byPriority, distanceM);
  const merged = new Set<Place>();
  const kept: Place[] = [];
  for (const carPark of byPriority) {
    if (merged.has(carPark)) continue;
    kept.push(carPark);
    for (const neighbour of index.within(carPark.location)) merged.add(neighbour);
  }
  return kept.sort((a, b) => compareIds(a.element, b.element));
}

const idOf = (element: OverpassPlace) => `osm:${element.type}/${element.id}`;

function compareIds(a: OverpassPlace, b: OverpassPlace): number {
  return a.type < b.type ? -1 : a.type > b.type ? 1 : a.id - b.id;
}

function locationOf(element: OverpassPlace): LatLng | null {
  if (element.center) return { lat: element.center.lat, lng: element.center.lon };
  if (element.lat != null && element.lon != null) return { lat: element.lat, lng: element.lon };
  return null;
}

function isTransitStop(tags: Record<string, string>): boolean {
  return Object.entries(TRANSIT_STOP_TAGS).some(([key, values]) => values.includes(tags[key] ?? ""));
}

/** OSM `parking` values for parking on or beside the carriageway rather than in a car park. */
const STREET_PARKING = new Set(["street_side", "lane", "on_kerb", "half_on_kerb", "shoulder"]);

function kindOf(tags: Record<string, string>): ParkingKind {
  if (tags.park_ride && tags.park_ride !== "no") return "park-and-ride";
  if (STREET_PARKING.has(tags.parking ?? "")) return "street";
  return "car-park";
}

function conditionsOf(tags: Record<string, string>): ParkingConditions {
  const conditions: ParkingConditions = {};
  if (tags.fee) conditions.fee = tags.fee;
  if (tags.charge) conditions.charge = tags.charge;
  if (tags.maxstay) conditions.maxStay = tags.maxstay;
  if (tags["maxstay:conditional"]) conditions.maxStayConditional = tags["maxstay:conditional"];
  if (tags.opening_hours) conditions.openingHours = tags.opening_hours;
  // Kept even when anyone may park: a missing access is unknown, not open.
  if (tags.access) conditions.access = tags.access;
  return conditions;
}
