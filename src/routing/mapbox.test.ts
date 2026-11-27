import { describe, expect, it } from "vitest";
import { mapboxEngine } from "./mapbox";
import drivingTraffic from "./recorded/mapbox-driving-traffic.json";
import invalidToken from "./recorded/mapbox-invalid-token.json";
import noRoute from "./recorded/mapbox-no-route.json";
import tollRoad from "./recorded/mapbox-toll-road.json";

/** Serves one recorded response and remembers what was requested. */
function recordedFetch(body: unknown, status = 200) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init });
    return new Response(JSON.stringify(body), { status });
  };
  return { fetchFn, calls };
}

// A Rodalies station west of Barcelona to the city centre, as recorded.
const station = { lat: 41.383003, lng: 2.04792 };
const destination = { lat: 41.387, lng: 2.17 };
const departAt = new Date("2026-11-27T08:00:00+01:00");
const before = () => new Date("2026-11-26T18:00:00+01:00");

describe("Mapbox adapter (recorded responses)", () => {
  it("asks for a drive with traffic departing at the given time, avoiding tolls, with the timed full path, never cached", async () => {
    const { fetchFn, calls } = recordedFetch(drivingTraffic);
    const engine = mapboxEngine({ token: "pk.test", fetch: fetchFn, now: before });

    await engine.driveWithTraffic(station, destination, departAt);

    const { url, init } = calls[0]!;
    expect(url.origin + url.pathname).toBe(
      "https://api.mapbox.com/directions/v5/mapbox/driving-traffic/2.04792,41.383003;2.17,41.387",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      access_token: "pk.test",
      alternatives: "false",
      overview: "full",
      geometries: "geojson",
      annotations: "duration",
      exclude: "toll",
      depart_at: "2026-11-27T07:00:00Z",
    });
    expect(init?.cache).toBe("no-store");
  });

  it("asks for the traffic now when the departure time has already passed", async () => {
    const { fetchFn, calls } = recordedFetch(drivingTraffic);
    const engine = mapboxEngine({ token: "pk.test", fetch: fetchFn, now: () => new Date("2026-11-27T08:30:00+01:00") });

    await engine.driveWithTraffic(station, destination, departAt);

    expect(calls[0]!.url.searchParams.has("depart_at")).toBe(false);
  });

  it("reads the drive's duration, distance and path timed segment by segment", async () => {
    const { fetchFn } = recordedFetch(drivingTraffic);
    const engine = mapboxEngine({ token: "pk.test", fetch: fetchFn, now: before });

    const drive = await engine.driveWithTraffic(station, destination, departAt);

    expect(drive?.durationS).toBeCloseTo(2295.9, 1);
    expect(drive?.distanceM).toBeCloseTo(11945.3, 1);
    const path = drive!.path;
    expect(path).toHaveLength(576);
    expect(path[0]).toEqual({ lat: 41.383153, lng: 2.048138, atS: 0 });
    expect(path.at(-1)).toMatchObject({ lat: 41.387256, lng: 2.169749 });
    expect(path.at(-1)!.atS).toBeCloseTo(2295.9, 1);
    expect(path.every((p, i) => i === 0 || p.atS >= path[i - 1]!.atS)).toBe(true);
  });

  it("reports no route when the drive still uses a toll road", async () => {
    // Recorded without exclude=toll: Plaça Catalunya to Sant Cugat through the Vallvidrera toll tunnels,
    // which Mapbox flags with a toll alert. Exclusions are best-effort, so a drive could come back like this.
    const { fetchFn } = recordedFetch(tollRoad);
    const engine = mapboxEngine({ token: "pk.test", fetch: fetchFn, now: before });

    expect(await engine.driveWithTraffic(destination, { lat: 41.473, lng: 2.084 }, departAt)).toBeNull();
  });

  it("reports no route when Mapbox says it couldn't avoid the tolls", async () => {
    // The violation notification as Mapbox documents it, on an otherwise toll-free recorded drive.
    const [route] = drivingTraffic.routes;
    const violation = {
      type: "violation",
      subtype: "toll",
      refresh_type: "static",
      geometry_index_start: 2,
      geometry_index_end: 3,
      details: { message: "Toll avoidance not possible - the route uses a toll road." },
    };
    const body = { ...drivingTraffic, routes: [{ ...route, legs: route!.legs.map((leg) => ({ ...leg, notifications: [violation] })) }] };
    const { fetchFn } = recordedFetch(body);
    const engine = mapboxEngine({ token: "pk.test", fetch: fetchFn, now: before });

    expect(await engine.driveWithTraffic(station, destination, departAt)).toBeNull();
  });

  it("reports no route when Mapbox finds none", async () => {
    const { fetchFn } = recordedFetch(noRoute.body, noRoute.status);
    const engine = mapboxEngine({ token: "pk.test", fetch: fetchFn, now: before });

    expect(await engine.driveWithTraffic(destination, { lat: 37.74, lng: -25.67 }, departAt)).toBeNull();
  });

  it("fails with Mapbox's reason when it refuses the request", async () => {
    const { fetchFn } = recordedFetch(invalidToken.body, invalidToken.status);
    const engine = mapboxEngine({ token: "pk.invalid", fetch: fetchFn, now: before });

    await expect(engine.driveWithTraffic(station, destination, departAt)).rejects.toThrow(
      "Mapbox request failed: 401 Not Authorized - Invalid Token",
    );
  });

  it("fails without calling Mapbox when no token is configured", async () => {
    const { fetchFn, calls } = recordedFetch(drivingTraffic);
    const engine = mapboxEngine({ token: undefined, fetch: fetchFn });

    await expect(engine.driveWithTraffic(station, destination, departAt)).rejects.toThrow("VITE_MAPBOX_TOKEN");
    expect(calls).toHaveLength(0);
  });
});
