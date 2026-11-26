import type { LatLng } from "../domain/types";
import type { RoutingEngine, TransitDuration } from "./RoutingEngine";

/**
 * Transitous (community MOTIS instance, https://transitous.org). Free, keyless, CORS-open.
 * Terms: open-source non-commercial use, attribution to Transitous sources and OSM.
 * Caveat: each operator's timetable only reaches as far ahead as its GTFS feed
 * (Renfe Rodalies is only a few days), so far-future Trips can silently miss modes.
 */
export function transitousEngine(
  opts: { fetch?: typeof fetch } = {},
): Pick<RoutingEngine, "transitManyToOne" | "transitOneToMany" | "driveFreeFlowOneToMany" | "driveFreeFlowManyToOne"> {
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

  return {
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
