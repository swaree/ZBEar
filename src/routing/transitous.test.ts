import { describe, expect, it } from "vitest";
import type { LatLng } from "../domain/types";
import { transitousEngine } from "./transitous";
import intermodalArriveBy from "./recorded/transitous-intermodal-arrive-by.json";
import intermodalWalkable from "./recorded/transitous-intermodal-walkable.json";
import intermodalShortWalk from "./recorded/transitous-intermodal-short-walk.json";
import carOneToMany from "./recorded/transitous-car-one-to-many.json";
import intermodalLeaveAt from "./recorded/transitous-intermodal-leave-at.json";
import carManyToOne from "./recorded/transitous-car-many-to-one.json";
import planArriveBy from "./recorded/transitous-plan-arrive-by.json";
import planWalk from "./recorded/transitous-plan-walk.json";
import planNone from "./recorded/transitous-plan-none.json";
import planLeaveAt from "./recorded/transitous-plan-leave-at.json";
import planCar from "./recorded/transitous-plan-car.json";
import planCarNone from "./recorded/transitous-plan-car-none.json";

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

/** Within `tolerance` degrees of latitude and of longitude. */
function expectNear(actual: LatLng, expected: LatLng, tolerance: number) {
  expect(Math.abs(actual.lat - expected.lat), `lat ${actual.lat} vs ${expected.lat}`).toBeLessThan(tolerance);
  expect(Math.abs(actual.lng - expected.lng), `lng ${actual.lng} vs ${expected.lng}`).toBeLessThan(tolerance);
}

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

  describe("itineraries for the Options shown", () => {
    const parking = stations[0]!;

    it("asks for an itinerary from the parking to the Destination, arriving by the given time", async () => {
      const { fetchFn, calls } = recordedFetch(planArriveBy);
      const engine = transitousEngine({ fetch: fetchFn });

      await engine.transitItineraryArrivingBy(parking, destination, new Date("2026-12-01T09:00:00+01:00"));

      const url = calls[0]!;
      expect(url.pathname).toBe("/api/v6/plan");
      expect(url.searchParams.get("fromPlace")).toBe("41.383003,2.04792");
      expect(url.searchParams.get("toPlace")).toBe("41.387,2.17");
      expect(url.searchParams.get("arriveBy")).toBe("true");
      expect(url.searchParams.get("time")).toBe("2026-12-01T08:00:00.000Z");
      // The same walking allowance as the one-to-many durations the Option was ranked by.
      expect(url.searchParams.get("maxPreTransitTime")).toBe("2700");
      expect(url.searchParams.get("maxPostTransitTime")).toBe("2700");
    });

    it("takes the itinerary that leaves latest and lists its walks and rides", async () => {
      // The recording offers five itineraries; the 08:13 one (local time) leaves last and still arrives by 09:00.
      const { fetchFn } = recordedFetch(planArriveBy);
      const engine = transitousEngine({ fetch: fetchFn });

      const itinerary = await engine.transitItineraryArrivingBy(parking, destination, new Date("2026-12-01T09:00:00+01:00"));

      expect(itinerary).toMatchObject({
        departAt: new Date("2026-12-01T07:13:00Z"),
        arriveAt: new Date("2026-12-01T07:56:00Z"),
        transfers: 2,
      });
      expect(itinerary!.legs.map(({ path, ...leg }) => leg)).toEqual([
        {
          mode: "walk",
          fromName: null,
          toName: "Pl. Estació",
          departAt: new Date("2026-12-01T07:13:00Z"),
          arriveAt: new Date("2026-12-01T07:15:00Z"),
          distanceM: 58,
        },
        {
          mode: "bus",
          line: "SF1",
          headsign: "Circular",
          color: "#ffaa00",
          agency: "Soler i Sauret",
          fromName: "Pl. Estació",
          toName: "Can Bertrand",
          departAt: new Date("2026-12-01T07:15:00Z"),
          arriveAt: new Date("2026-12-01T07:17:00Z"),
          stopsBetween: 0,
        },
        {
          mode: "walk",
          fromName: "Can Bertrand",
          toName: "Major - Onze de Setembre",
          departAt: new Date("2026-12-01T07:17:00Z"),
          arriveAt: new Date("2026-12-01T07:24:00Z"),
          distanceM: 777,
        },
        {
          mode: "bus",
          line: "X43",
          headsign: "Barcelona",
          color: "#ffaa00",
          agency: "Monbus i Julià",
          fromName: "Major - Onze de Setembre",
          toName: "Pl Reina Maria Cristina",
          departAt: new Date("2026-12-01T07:25:00Z"),
          arriveAt: new Date("2026-12-01T07:36:00Z"),
          stopsBetween: 5,
        },
        {
          mode: "walk",
          fromName: "Pl Reina Maria Cristina",
          toName: "av. Diagonal (Maria Cristina carril central)",
          departAt: new Date("2026-12-01T07:36:00Z"),
          arriveAt: new Date("2026-12-01T07:38:00Z"),
          distanceM: 2,
        },
        {
          mode: "bus",
          line: "L1792",
          headsign: "Gran Via, 618 - c. Balmes (marq. urbana)",
          color: null,
          agency: "La Hispano Igualadina, SL",
          fromName: "av. Diagonal (Maria Cristina carril central)",
          toName: "Gran Via, 618 - c. Balmes (marq. urbana)",
          departAt: new Date("2026-12-01T07:39:00Z"),
          arriveAt: new Date("2026-12-01T07:50:00Z"),
          stopsBetween: 2,
        },
        {
          mode: "walk",
          fromName: "Gran Via, 618 - c. Balmes (marq. urbana)",
          toName: null,
          departAt: new Date("2026-12-01T07:50:00Z"),
          arriveAt: new Date("2026-12-01T07:56:00Z"),
          distanceM: 408,
        },
      ]);
    });

    it("draws each leg from where it starts to where it ends", async () => {
      const { fetchFn } = recordedFetch(planArriveBy);
      const engine = transitousEngine({ fetch: fetchFn });

      const itinerary = await engine.transitItineraryArrivingBy(parking, destination, new Date("2026-12-01T09:00:00+01:00"));

      const legs = itinerary!.legs;
      // The recorded geometry has 5, 9, 107, 82, 2, 66 and 50 points.
      expect(legs.map((leg) => leg.path.length)).toEqual([5, 9, 107, 82, 2, 66, 50]);
      // The first walk starts by the parking, the last ends by the Destination (snapped to the street).
      expectNear(legs[0]!.path[0]!, parking, 5e-4);
      expectNear(legs.at(-1)!.path.at(-1)!, destination, 5e-4);
      // The X43 leaves from Major - Onze de Setembre, where the recording places that stop.
      expectNear(legs[3]!.path[0]!, { lat: 41.374443, lng: 2.046264 }, 1e-4);
    });

    it("gives a walk straight to the Destination when no transit beats it", async () => {
      const { fetchFn } = recordedFetch(planWalk);
      const engine = transitousEngine({ fetch: fetchFn });

      const itinerary = await engine.transitItineraryArrivingBy(
        { lat: 41.3876, lng: 2.1712 },
        destination,
        new Date("2026-12-01T09:00:00+01:00"),
      );

      expect(itinerary).toMatchObject({ transfers: 0, departAt: new Date("2026-12-01T07:57:00Z") });
      expect(itinerary!.legs).toHaveLength(1);
      expect(itinerary!.legs[0]).toMatchObject({ mode: "walk", fromName: null, toName: null, distanceM: 159 });
      expect(itinerary!.legs[0]!.path).toHaveLength(34);
    });

    it("reports no itinerary as null", async () => {
      const { fetchFn } = recordedFetch(planNone);
      const engine = transitousEngine({ fetch: fetchFn });

      // Out at sea: neither transit nor walking reaches the Destination.
      const itinerary = await engine.transitItineraryArrivingBy(
        { lat: 40.5, lng: 5.0 },
        destination,
        new Date("2026-12-01T09:00:00+01:00"),
      );

      expect(itinerary).toBeNull();
    });

    it("asks for an itinerary from the Destination back to the parking leaving at the given time, and takes the one that arrives first", async () => {
      const { fetchFn, calls } = recordedFetch(planLeaveAt);
      const engine = transitousEngine({ fetch: fetchFn });

      const itinerary = await engine.transitItineraryLeavingAt(destination, parking, new Date("2026-12-01T18:00:00+01:00"));

      const url = calls[0]!;
      expect(url.searchParams.get("fromPlace")).toBe("41.387,2.17");
      expect(url.searchParams.get("toPlace")).toBe("41.383003,2.04792");
      expect(url.searchParams.get("arriveBy")).toBe("false");
      expect(url.searchParams.get("time")).toBe("2026-12-01T17:00:00.000Z");
      // Of the eight recorded itineraries, the first to leave also arrives first, at 18:44 local time.
      expect(itinerary).toMatchObject({
        departAt: new Date("2026-12-01T17:00:00Z"),
        arriveAt: new Date("2026-12-01T17:44:00Z"),
        transfers: 2,
      });
      expect(itinerary!.legs.map((leg) => (leg.mode === "walk" ? "walk" : `${leg.mode} ${leg.line}`))).toEqual([
        "walk",
        "subway L3",
        "walk",
        "bus L0101",
        "walk",
        "bus L0077",
        "walk",
      ]);
      expect(itinerary!.legs[1]).toMatchObject({ color: "#1eb53a", agency: "TMB", headsign: "Trinitat Nova" });
    });

    it("asks for the free-flow drive to the parking alone, no transit, and gives its road path", async () => {
      const { fetchFn, calls } = recordedFetch(planCar);
      const engine = transitousEngine({ fetch: fetchFn });
      const origin = { lat: 41.5, lng: 2.0 };

      const path = await engine.drivePath(origin, parking);

      const url = calls[0]!;
      expect(url.pathname).toBe("/api/v6/plan");
      expect(url.searchParams.get("fromPlace")).toBe("41.5,2");
      expect(url.searchParams.get("toPlace")).toBe("41.383003,2.04792");
      expect(url.searchParams.get("directModes")).toBe("CAR");
      expect(url.searchParams.get("transitModes")).toBe("");
      // As long a drive as the free-flow one-to-many allows: the default 30 min would cut off longer ones.
      expect(url.searchParams.get("maxDirectTime")).toBe("10800");
      // The recorded 20.8 km drive has 1041 points, from near the Origin to near the parking.
      expect(path).toHaveLength(1041);
      // This Origin lies in fields: the drive starts on the nearest road, about 440 m away.
      expectNear(path![0]!, origin, 1e-2);
      expectNear(path!.at(-1)!, parking, 5e-4);
    });

    it("reports no drive as null", async () => {
      const { fetchFn } = recordedFetch(planCarNone);
      const engine = transitousEngine({ fetch: fetchFn });

      expect(await engine.drivePath({ lat: 40.5, lng: 5.0 }, parking)).toBeNull();
    });
  });

  it("reports a failed request as an error naming the provider", async () => {
    const engine = transitousEngine({
      fetch: async () => new Response("Too many requests", { status: 429 }),
    });

    await expect(engine.driveFreeFlowOneToMany(destination, stations)).rejects.toThrow(/Transitous.*429/);
  });
});
