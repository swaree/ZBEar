import type { LatLng } from "../domain/types";
import type { RoutingEngine, TimedPoint, TrafficDrive } from "./RoutingEngine";

/**
 * Mapbox Directions, `driving-traffic` profile: drives in the traffic expected at a departure time.
 * Terms: results may not be cached or stored, so they live only within the query (and the browser is
 * told not to cache them either), and "© Mapbox" with the logo must be shown wherever they are used.
 * Without a payment method the account is on demo access, so going over the free cap fails requests.
 */
export function mapboxEngine(opts: {
  token: string | undefined;
  fetch?: typeof fetch;
  now?: () => Date;
}): Pick<RoutingEngine, "driveWithTraffic"> {
  const fetchFn = opts.fetch ?? ((...args) => fetch(...args));
  const now = opts.now ?? (() => new Date());

  return {
    async driveWithTraffic(from, to, departAt) {
      if (!opts.token) throw new Error("no Mapbox token is configured (VITE_MAPBOX_TOKEN), so drives can't be checked for ZBEs");
      const url = new URL(`/directions/v5/mapbox/driving-traffic/${point(from)};${point(to)}`, BASE_URL);
      url.searchParams.set("access_token", opts.token);
      url.searchParams.set("alternatives", "false");
      url.searchParams.set("overview", "full");
      url.searchParams.set("geometries", "geojson");
      url.searchParams.set("annotations", "duration");
      // Mapbox only predicts traffic ahead; a departure already past means "now", its default.
      if (departAt > now()) url.searchParams.set("depart_at", departAt.toISOString().slice(0, 19) + "Z");

      const res = await fetchFn(url.toString(), { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as MapboxResponse;
      if (body.code === "NoRoute" || body.code === "NoSegment") return null;
      if (!res.ok || body.code !== "Ok") {
        throw new Error(`Mapbox request failed: ${res.status} ${body.message ?? body.code ?? ""}`.trim());
      }
      const route = body.routes?.[0];
      return route ? trafficDrive(route) : null;
    },
  };
}

const BASE_URL = "https://api.mapbox.com";

const point = (p: LatLng) => `${p.lng},${p.lat}`;

interface MapboxResponse {
  code?: string;
  message?: string;
  routes?: MapboxRoute[];
}

interface MapboxRoute {
  duration: number;
  distance: number;
  geometry: { coordinates: [number, number][] };
  legs: { annotation?: { duration?: number[] } }[];
}

/** Times the route's geometry with its per-segment durations: one per pair of consecutive coordinates. */
function trafficDrive(route: MapboxRoute): TrafficDrive {
  const coordinates = route.geometry.coordinates;
  const segmentDurations = route.legs.flatMap((leg) => leg.annotation?.duration ?? []);
  if (coordinates.length === 0 || segmentDurations.length !== coordinates.length - 1) {
    throw new Error(
      `Mapbox response format changed: ${coordinates.length} coordinates but ${segmentDurations.length} segment durations`,
    );
  }
  let atS = 0;
  const path: TimedPoint[] = coordinates.map(([lng, lat], i) => {
    if (i > 0) atS += segmentDurations[i - 1]!;
    return { lat, lng, atS };
  });
  return { durationS: route.duration, distanceM: route.distance, path };
}
