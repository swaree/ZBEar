import { describe, expect, it } from "vitest";
import { transitousEngine } from "./transitous";
import intermodalArriveBy from "./recorded/transitous-intermodal-arrive-by.json";
import intermodalWalkable from "./recorded/transitous-intermodal-walkable.json";
import intermodalShortWalk from "./recorded/transitous-intermodal-short-walk.json";
import carOneToMany from "./recorded/transitous-car-one-to-many.json";
import intermodalLeaveAt from "./recorded/transitous-intermodal-leave-at.json";
import carManyToOne from "./recorded/transitous-car-many-to-one.json";

/** Serves one recorded response and remembers the URL that was requested. */
function recordedFetch(body: unknown) {
  const calls: URL[] = [];
  const fetchFn = async (input: string | URL | Request) => {
    calls.push(new URL(String(input)));
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { fetchFn, calls };
}

const destination = { lat: 41.387, lng: 2.17 };
const stations = [
  { lat: 41.383003, lng: 2.04792 },
  { lat: 41.409897, lng: 2.020773 },
  { lat: 41.46302, lng: 2.272155 },
  { lat: 41.43537, lng: 2.002578 },
];

describe("Transitous adapter (recorded responses)", () => {
  it("asks for transit from many places to the Destination, arriving by the given time", async () => {
    const { fetchFn, calls } = recordedFetch(intermodalArriveBy);
    const engine = transitousEngine({ fetch: fetchFn });

    await engine.transitManyToOne(stations, destination, new Date("2026-12-01T09:00:00+01:00"));

    const url = calls[0]!;
    expect(url.pathname).toBe("/api/experimental/one-to-many-intermodal");
    expect(url.searchParams.get("one")).toBe("41.387;2.17");
    expect(url.searchParams.get("many")).toBe(
      "41.383003;2.04792,41.409897;2.020773,41.46302;2.272155,41.43537;2.002578",
    );
    expect(url.searchParams.get("arriveBy")).toBe("true");
    expect(url.searchParams.get("time")).toBe("2026-12-01T08:00:00.000Z");
  });

  it("allows up to 45 min of walking to the first stop and from the last one", async () => {
    // A home with poor transit links may be a long walk from any stop; the default is 15 min.
    const { fetchFn, calls } = recordedFetch(intermodalArriveBy);
    const engine = transitousEngine({ fetch: fetchFn });

    await engine.transitManyToOne(stations, destination, new Date("2026-12-01T09:00:00+01:00"));

    expect(calls[0]!.searchParams.get("maxPreTransitTime")).toBe("2700");
    expect(calls[0]!.searchParams.get("maxPostTransitTime")).toBe("2700");
  });

  it("takes the fastest connection from each place's set of transfer alternatives", async () => {
    const { fetchFn } = recordedFetch(intermodalArriveBy);
    const engine = transitousEngine({ fetch: fetchFn });

    const result = await engine.transitManyToOne(stations, destination, new Date("2026-12-01T09:00:00+01:00"));

    expect(result).toEqual([
      { durationS: 2880, transfers: 1 },
      { durationS: 3120, transfers: 2 },
      { durationS: 2880, transfers: 2 },
      { durationS: 5700, transfers: 1 },
    ]);
  });

  it("reads a single-connection response", async () => {
    const { fetchFn } = recordedFetch(intermodalWalkable);
    const engine = transitousEngine({ fetch: fetchFn });

    const result = await engine.transitManyToOne(
      [{ lat: 41.3905, lng: 2.174 }, stations[0]!],
      destination,
      new Date("2026-11-26T09:00:00+01:00"),
    );

    expect(result).toEqual([
      { durationS: 480, transfers: 0 },
      { durationS: 2220, transfers: 0 },
    ]);
  });

  it("counts walking straight to the Destination when it beats transit", async () => {
    const { fetchFn } = recordedFetch(intermodalShortWalk);
    const engine = transitousEngine({ fetch: fetchFn });

    const result = await engine.transitManyToOne(
      [
        { lat: 41.3876, lng: 2.1712 },
        { lat: 41.3905, lng: 2.174 },
      ],
      destination,
      new Date("2026-11-26T09:00:00+01:00"),
    );

    expect(result).toEqual([
      { durationS: 143, transfers: 0 },
      { durationS: 480, transfers: 0 },
    ]);
  });

  it("asks for free-flow car times from one place to many, and reports unreachable places as null", async () => {
    const { fetchFn, calls } = recordedFetch(carOneToMany);
    const engine = transitousEngine({ fetch: fetchFn });

    const result = await engine.driveFreeFlowOneToMany({ lat: 41.5, lng: 2.0 }, [
      ...stations,
      { lat: 40, lng: 0 },
    ]);

    const url = calls[0]!;
    expect(url.pathname).toBe("/api/v1/one-to-many");
    expect(url.searchParams.get("mode")).toBe("CAR");
    expect(url.searchParams.get("arriveBy")).toBe("false");
    expect(url.searchParams.get("one")).toBe("41.5;2");
    expect(result).toEqual([1181, 904, 1976, 691, null]);
  });

  it("asks for transit from the Destination to many places, leaving at the given time", async () => {
    const { fetchFn, calls } = recordedFetch(intermodalLeaveAt);
    const engine = transitousEngine({ fetch: fetchFn });

    const result = await engine.transitOneToMany(destination, stations, new Date("2026-11-27T18:00:00+01:00"));

    const url = calls[0]!;
    expect(url.pathname).toBe("/api/experimental/one-to-many-intermodal");
    expect(url.searchParams.get("one")).toBe("41.387;2.17");
    expect(url.searchParams.get("many")).toBe(
      "41.383003;2.04792,41.409897;2.020773,41.46302;2.272155,41.43537;2.002578",
    );
    expect(url.searchParams.get("arriveBy")).toBe("false");
    expect(url.searchParams.get("time")).toBe("2026-11-27T17:00:00.000Z");
    expect(url.searchParams.get("maxPreTransitTime")).toBe("2700");
    expect(url.searchParams.get("maxPostTransitTime")).toBe("2700");
    expect(result).toEqual([
      { durationS: 1680, transfers: 0 },
      { durationS: 2100, transfers: 0 },
      { durationS: 2100, transfers: 0 },
      { durationS: 2340, transfers: 0 },
    ]);
  });

  it("asks for free-flow car times from many places to one", async () => {
    const { fetchFn, calls } = recordedFetch(carManyToOne);
    const engine = transitousEngine({ fetch: fetchFn });

    const result = await engine.driveFreeFlowManyToOne([...stations, { lat: 40, lng: 0 }], { lat: 41.5, lng: 2.0 });

    const url = calls[0]!;
    expect(url.pathname).toBe("/api/v1/one-to-many");
    expect(url.searchParams.get("mode")).toBe("CAR");
    expect(url.searchParams.get("arriveBy")).toBe("true");
    expect(url.searchParams.get("one")).toBe("41.5;2");
    expect(result).toEqual([1651, 1302, 2110, 1177, 9713]);
  });

  it("reports a failed request as an error naming the provider", async () => {
    const engine = transitousEngine({
      fetch: async () => new Response("Too many requests", { status: 429 }),
    });

    await expect(engine.driveFreeFlowOneToMany(destination, stations)).rejects.toThrow(/Transitous.*429/);
  });
});
