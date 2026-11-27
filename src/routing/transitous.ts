import type { LatLng } from "../domain/types";
import type { RideMode, RoutingEngine, TransitDuration, TransitItinerary, TransitLeg } from "./RoutingEngine";

/**
 * Transitous (community MOTIS instance, https://transitous.org). Free, keyless, CORS-open.
 * Terms: open-source non-commercial use, attribution to Transitous sources and OSM.
 * Caveat: each operator's timetable only reaches as far ahead as its GTFS feed
 * (Renfe Rodalies is only a few days), so far-future Trips can silently miss modes.
 */
export function transitousEngine(
  opts: { fetch?: typeof fetch } = {},
): Pick<
  RoutingEngine,
  | "transitManyToOne"
  | "transitOneToMany"
  | "driveFreeFlowOneToMany"
  | "driveFreeFlowManyToOne"
  | "transitItineraryArrivingBy"
  | "transitItineraryLeavingAt"
> {
  const fetchFn = opts.fetch ?? ((...args) => fetch(...args));

  async function get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(path, BASE_URL);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetchFn(url.toString());
    if (!res.ok) throw new Error(`Transitous request failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  /** Transit between `one` and each of `many`: towards `one` arriving by `time`, or away from it leaving at `time`. */
  async function transit(one: LatLng, many: LatLng[], time: Date, arriveBy: boolean) {
    const body = await get<{ street_durations: { duration?: number }[]; transit_durations: ParetoEntry[][] }>(
      "/api/experimental/one-to-many-intermodal",
      {
        one: point(one),
        many: points(many),
        time: time.toISOString(),
        arriveBy: String(arriveBy),
        maxPreTransitTime: String(MAX_WALK_TO_TRANSIT_S),
        maxPostTransitTime: String(MAX_WALK_TO_TRANSIT_S),
      },
    );
    // Walking straight there (no transit) is reported separately and can be the fastest way.
    return body.transit_durations.map((paretoSet, i) => {
      const walk = body.street_durations[i]?.duration;
      return fastest(walk == null ? paretoSet : [...paretoSet, { duration: walk, transfers: 0 }]);
    });
  }

  /** Free-flow driving between `one` and each of `many`: away from `one`, or towards it when `arriveBy`. */
  async function drive(one: LatLng, many: LatLng[], arriveBy: boolean) {
    const body = await get<{ duration?: number }[]>("/api/v1/one-to-many", {
      one: point(one),
      many: points(many),
      mode: "CAR",
      max: String(3 * 3600),
      maxMatchingDistance: "250",
      arriveBy: String(arriveBy),
    });
    return body.map((d) => d.duration ?? null);
  }

  /** The transit itinerary from `from` to `to` (MOTIS plan endpoint): arriving by `time`, or leaving at it. */
  async function itinerary(from: LatLng, to: LatLng, time: Date, arriveBy: boolean) {
    const body = await get<PlanResponse>("/api/v6/plan", {
      fromPlace: place(from),
      toPlace: place(to),
      time: time.toISOString(),
      arriveBy: String(arriveBy),
      maxPreTransitTime: String(MAX_WALK_TO_TRANSIT_S),
      maxPostTransitTime: String(MAX_WALK_TO_TRANSIT_S),
    });
    // Walking straight there is reported apart from the transit itineraries, and can be the one to take.
    const all = [...body.direct, ...body.itineraries];
    const better = arriveBy ? leavesLater : arrivesSooner;
    const best = all.reduce<PlanItinerary | null>((a, b) => (!a || better(b, a) ? b : a), null);
    return best && transitItinerary(best);
  }

  return {
    transitItineraryArrivingBy: (from, to, arriveBy) => itinerary(from, to, arriveBy, true),
    transitItineraryLeavingAt: (from, to, leaveAt) => itinerary(from, to, leaveAt, false),
    transitManyToOne: (many, one, arriveBy) => transit(one, many, arriveBy, true),
    transitOneToMany: (one, many, leaveAt) => transit(one, many, leaveAt, false),
    driveFreeFlowOneToMany: (one, many) => drive(one, many, false),
    driveFreeFlowManyToOne: (many, one) => drive(one, many, true),
  };
}

const BASE_URL = "https://api.transitous.org";
/**
 * Walking allowed to the first stop and from the last one. MOTIS defaults to 15 min, which
 * leaves a home with poor transit links (and so the Baseline) with no connection at all.
 */
const MAX_WALK_TO_TRANSIT_S = 45 * 60;

/** One entry of a MOTIS Pareto set: the best duration achievable with this many transfers. */
interface ParetoEntry {
  duration: number;
  transfers: number;
}

const point = (p: LatLng) => `${p.lat};${p.lng}`;
/** The plan endpoint writes a coordinate with a comma, unlike the one-to-many ones. */
const place = (p: LatLng) => `${p.lat},${p.lng}`;

/** The parts of a MOTIS plan response that the adapter reads. */
interface PlanResponse {
  direct: PlanItinerary[];
  itineraries: PlanItinerary[];
}

interface PlanItinerary {
  startTime: string;
  endTime: string;
  transfers: number;
  legs: PlanLeg[];
}

interface PlanPlace {
  name: string;
  lat: number;
  lon: number;
  /** "NORMAL" for a coordinate given in the request, which MOTIS names START or END. */
  vertexType: string;
}

interface PlanLeg {
  mode: string;
  from: PlanPlace;
  to: PlanPlace;
  startTime: string;
  endTime: string;
  distance?: number;
  displayName?: string;
  routeShortName?: string;
  headsign?: string;
  routeColor?: string;
  agencyName?: string;
  intermediateStops?: unknown[];
  legGeometry: { points: string; precision: number };
}

/** Arriving by a time, `a` leaves later than `b`, or as late with fewer transfers. */
function leavesLater(a: PlanItinerary, b: PlanItinerary): boolean {
  const byStart = Date.parse(a.startTime) - Date.parse(b.startTime);
  return byStart > 0 || (byStart === 0 && a.transfers < b.transfers);
}

/** Leaving at a time, `a` arrives sooner than `b`, or as soon with fewer transfers. */
function arrivesSooner(a: PlanItinerary, b: PlanItinerary): boolean {
  const byEnd = Date.parse(a.endTime) - Date.parse(b.endTime);
  return byEnd < 0 || (byEnd === 0 && a.transfers < b.transfers);
}

function transitItinerary(itinerary: PlanItinerary): TransitItinerary {
  return {
    departAt: new Date(itinerary.startTime),
    arriveAt: new Date(itinerary.endTime),
    transfers: itinerary.transfers,
    legs: itinerary.legs.map(transitLeg),
  };
}

function transitLeg(leg: PlanLeg): TransitLeg {
  const common = {
    fromName: placeName(leg.from),
    toName: placeName(leg.to),
    departAt: new Date(leg.startTime),
    arriveAt: new Date(leg.endTime),
    path: decodePolyline(leg.legGeometry.points, leg.legGeometry.precision),
  };
  if (leg.mode === "WALK") return { mode: "walk", ...common, distanceM: leg.distance ?? 0 };
  return {
    mode: RIDE_MODES[leg.mode] ?? "other",
    ...common,
    line: leg.displayName || leg.routeShortName || "",
    headsign: leg.headsign || null,
    color: leg.routeColor ? `#${leg.routeColor}` : null,
    agency: leg.agencyName || null,
    stopsBetween: leg.intermediateStops?.length ?? 0,
  };
}

/** A stop's name; null for the coordinates the request gave, which MOTIS names START and END. */
const placeName = (p: PlanPlace) => (p.vertexType === "NORMAL" ? null : p.name);

const RIDE_MODES: Record<string, RideMode> = {
  BUS: "bus",
  COACH: "coach",
  TRAM: "tram",
  SUBWAY: "subway",
  METRO: "subway",
  RAIL: "rail",
  HIGHSPEED_RAIL: "rail",
  LONG_DISTANCE: "rail",
  NIGHT_RAIL: "rail",
  REGIONAL_RAIL: "rail",
  REGIONAL_FAST_RAIL: "rail",
  SUBURBAN: "rail",
  FERRY: "ferry",
  FUNICULAR: "funicular",
  AERIAL_LIFT: "aerial-lift",
  AREAL_LIFT: "aerial-lift",
};

/** Decodes a Google encoded polyline with `precision` decimal digits (MOTIS uses 6). */
function decodePolyline(encoded: string, precision: number): LatLng[] {
  const factor = 10 ** precision;
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    points.push({ lat: lat / factor, lng: lng / factor });
  }
  return points;
}
const points = (ps: LatLng[]) => ps.map(point).join(",");

function fastest(connections: ParetoEntry[]): TransitDuration | null {
  let best: TransitDuration | null = null;
  for (const connection of connections) {
    if (!best || connection.duration < best.durationS) {
      best = { durationS: connection.duration, transfers: connection.transfers };
    }
  }
  return best;
}
