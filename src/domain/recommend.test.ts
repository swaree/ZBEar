import { describe, expect, it } from "vitest";
import { recommend } from "./recommend";
import type { LatLng, ParkingCandidate } from "./types";
import type { Zbe } from "./zbe";
import { fakeRoutingEngine } from "../routing/fakeRoutingEngine";

const origin: LatLng = { lat: 41.6, lng: 1.9 };
const destination: LatLng = { lat: 41.387, lng: 2.17 };
const arriveBy = new Date("2026-12-01T09:00:00+01:00");

const min = (m: number) => m * 60;

const noZbes = { zbes: [] };

/** A synthetic ZBE made of axis-aligned squares, each given by its south-west corner and side in degrees. */
function squareZbe(id: string, ...squares: { lat: number; lng: number; side: number }[]): Zbe {
  return {
    id,
    name: `ZBE ${id}`,
    perimeter: {
      type: "MultiPolygon",
      coordinates: squares.map(({ lat, lng, side }) => [
        [
          [lng, lat],
          [lng + side, lat],
          [lng + side, lat + side],
          [lng, lat + side],
          [lng, lat],
        ],
      ]),
    },
    restrictionWindow: { weekdays: [1, 2, 3, 4, 5], start: "07:00", end: "20:00" },
    barredLabels: ["none"],
  };
}

function candidate(id: string, lat: number, timeToFindSpaceMin: number, lng = 2.0): ParkingCandidate {
  return {
    id,
    name: `Candidate ${id}`,
    location: { lat, lng },
    kind: "car-park",
    conditions: {},
    timeToFindSpaceS: min(timeToFindSpaceMin),
  };
}

/** A Parking Candidate on the straight line from the Origin to the Destination, a fraction `t` of the way. */
function candidateOnTheWay(id: string, t: number, timeToFindSpaceMin = 3): ParkingCandidate {
  return candidate(
    id,
    origin.lat + t * (destination.lat - origin.lat),
    timeToFindSpaceMin,
    origin.lng + t * (destination.lng - origin.lng),
  );
}

describe("recommend", () => {
  it("ranks Options by door-to-door time: drive + finding a space + transit", async () => {
    const a = candidate("a", 41.41, 3);
    const b = candidate("b", 41.42, 3);
    const c = candidate("c", 41.43, 10);
    const engine = fakeRoutingEngine({
      driveFromOrigin: [
        [a.location, min(20)],
        [b.location, min(10)],
        [c.location, min(30)],
      ],
      transitToDestination: [
        [a.location, { durationS: min(30), transfers: 1 }],
        [b.location, { durationS: min(50), transfers: 0 }],
        [c.location, { durationS: min(15), transfers: 0 }],
      ],
    });

    const recommendation = await recommend({ origin, destination, arriveBy }, [a, b, c], noZbes, engine);

    expect(recommendation.options.map((o) => [o.candidate.id, o.doorToDoorS / 60])).toEqual([
      ["a", 53],
      ["c", 55],
      ["b", 63],
    ]);
  });

  it("leaves out Parking Candidates that transit or driving cannot reach", async () => {
    const reachable = candidate("reachable", 41.41, 3);
    const noTransit = candidate("no-transit", 41.42, 3);
    const noDrive = candidate("no-drive", 41.43, 3);
    const engine = fakeRoutingEngine({
      driveFromOrigin: [
        [reachable.location, min(20)],
        [noTransit.location, min(10)],
      ],
      transitToDestination: [
        [reachable.location, { durationS: min(30), transfers: 0 }],
        [noDrive.location, { durationS: min(10), transfers: 0 }],
      ],
    });

    const recommendation = await recommend({ origin, destination, arriveBy }, [reachable, noTransit, noDrive], noZbes, engine);

    expect(recommendation.options.map((o) => o.candidate.id)).toEqual(["reachable"]);
  });

  it("returns at most the five fastest Options", async () => {
    const candidates = [1, 2, 3, 4, 5, 6, 7].map((n) => candidate(`c${n}`, 41.4 + n / 100, 3));
    const engine = fakeRoutingEngine({
      driveFromOrigin: candidates.map((c, i) => [c.location, min(10 + i)]),
      transitToDestination: candidates.map((c) => [c.location, { durationS: min(30), transfers: 0 }]),
    });

    const recommendation = await recommend({ origin, destination, arriveBy }, candidates.reverse(), noZbes, engine);

    expect(recommendation.options.map((o) => o.candidate.id)).toEqual(["c1", "c2", "c3", "c4", "c5"]);
  });

  it("works back from the arrive-by time to when to leave the Origin and the parking", async () => {
    const a = candidate("a", 41.41, 3);
    const engine = fakeRoutingEngine({
      driveFromOrigin: [[a.location, min(20)]],
      transitToDestination: [[a.location, { durationS: min(30), transfers: 0 }]],
    });

    const [option] = (await recommend({ origin, destination, arriveBy }, [a], noZbes, engine)).options;

    expect(option?.leaveOriginAt).toEqual(new Date("2026-12-01T08:07:00+01:00"));
    expect(option?.leaveParkingAt).toEqual(new Date("2026-12-01T08:30:00+01:00"));
  });

  it("never offers a Parking Candidate inside any ZBE", async () => {
    const zbes = [
      squareZbe("one", { lat: 41.4, lng: 2.0, side: 0.02 }),
      squareZbe("two", { lat: 41.5, lng: 2.0, side: 0.02 }, { lat: 41.6, lng: 2.0, side: 0.02 }),
    ];
    const insideOne = candidate("inside-one", 41.41, 3);
    const insideTwosSecondPolygon = candidate("inside-two-second-polygon", 41.61, 3);
    const outside = candidate("outside", 41.45, 3);
    const all = [insideOne, insideTwosSecondPolygon, outside];
    const engine = fakeRoutingEngine({
      driveFromOrigin: all.map((c) => [c.location, min(10)]),
      transitToDestination: all.map((c) => [c.location, { durationS: min(20), transfers: 0 }]),
    });

    const recommendation = await recommend({ origin, destination, arriveBy }, all, { zbes }, engine);

    expect(recommendation.options.map((o) => o.candidate.id)).toEqual(["outside"]);
  });

  it("treats a ZBE's disputed areas as inside it", async () => {
    const zbe: Zbe = {
      ...squareZbe("one", { lat: 41.4, lng: 2.0, side: 0.02 }),
      // Where OSM draws the ZBE ~1 km further north than DGT does.
      disputedAreas: squareZbe("disputed", { lat: 41.42, lng: 2.0, side: 0.01 }).perimeter,
    };
    const inDisputedArea = candidate("in-disputed-area", 41.425, 3);
    const outside = candidate("outside", 41.45, 3);
    const all = [inDisputedArea, outside];
    const engine = fakeRoutingEngine({
      driveFromOrigin: all.map((c) => [c.location, min(10)]),
      transitToDestination: all.map((c) => [c.location, { durationS: min(20), transfers: 0 }]),
    });

    const recommendation = await recommend({ origin, destination, arriveBy }, all, { zbes: [zbe] }, engine);

    expect(recommendation.options.map((o) => o.candidate.id)).toEqual(["outside"]);
  });

  it("compares each Option with the Baseline: the whole Trip by transit from the Origin", async () => {
    const fast = candidate("fast", 41.41, 3);
    const slow = candidate("slow", 41.42, 3);
    const engine = fakeRoutingEngine({
      driveFromOrigin: [
        [fast.location, min(20)],
        [slow.location, min(40)],
      ],
      transitToDestination: [
        [fast.location, { durationS: min(30), transfers: 0 }],
        [slow.location, { durationS: min(60), transfers: 1 }],
        [origin, { durationS: min(90), transfers: 2 }],
      ],
    });

    const recommendation = await recommend({ origin, destination, arriveBy }, [fast, slow], noZbes, engine);

    expect(recommendation.baseline).toEqual({
      transitS: min(90),
      transfers: 2,
      leaveOriginAt: new Date("2026-12-01T07:30:00+01:00"),
    });
    // fast: 20 + 3 + 30 = 53 min, 37 min saved; slow: 40 + 3 + 60 = 103 min, 13 min lost.
    expect(recommendation.options.map((o) => [o.candidate.id, o.timeSavedS])).toEqual([
      ["fast", min(37)],
      ["slow", -min(13)],
    ]);
  });

  it("gives the Baseline even when no Parking Candidate works", async () => {
    const unreachable = candidate("unreachable", 41.41, 3);
    const engine = fakeRoutingEngine({ transitToDestination: [[origin, { durationS: min(90), transfers: 2 }]] });

    const recommendation = await recommend({ origin, destination, arriveBy }, [unreachable], noZbes, engine);

    expect(recommendation.options).toEqual([]);
    expect(recommendation.baseline?.transitS).toBe(min(90));
  });

  it("has no Baseline, and no time saved, when transit can't reach the Destination from the Origin", async () => {
    const a = candidate("a", 41.41, 3);
    const engine = fakeRoutingEngine({
      driveFromOrigin: [[a.location, min(20)]],
      transitToDestination: [[a.location, { durationS: min(30), transfers: 0 }]],
    });

    const recommendation = await recommend({ origin, destination, arriveBy }, [a], noZbes, engine);

    expect(recommendation.baseline).toBeNull();
    expect(recommendation.options[0]?.timeSavedS).toBeNull();
  });

  it("leaves out a Parking Candidate far off the way from the Origin to the Destination, however fast", async () => {
    const onTheWay = candidateOnTheWay("on-the-way", 0.6);
    // Up the coast past Mataró: ~35 km out of the way of a 33 km Trip.
    const offTheWay = candidate("off-the-way", 41.55, 3, 2.45);
    const all = [onTheWay, offTheWay];
    const engine = fakeRoutingEngine({
      driveFromOrigin: [
        [onTheWay.location, min(25)],
        [offTheWay.location, min(5)],
      ],
      transitToDestination: all.map((c) => [c.location, { durationS: min(20), transfers: 0 }]),
    });

    const recommendation = await recommend({ origin, destination, arriveBy }, all, noZbes, engine);

    expect(recommendation.options.map((o) => o.candidate.id)).toEqual(["on-the-way"]);
  });

  it("takes the detour bound as a setting", async () => {
    const offTheWay = candidate("off-the-way", 41.55, 3, 2.45);
    const engine = fakeRoutingEngine({
      driveFromOrigin: [[offTheWay.location, min(5)]],
      transitToDestination: [[offTheWay.location, { durationS: min(20), transfers: 0 }]],
    });

    const recommendation = await recommend({ origin, destination, arriveBy }, [offTheWay], noZbes, engine, {
      maxDetourRatio: 3,
    });

    expect(recommendation.options.map((o) => o.candidate.id)).toEqual(["off-the-way"]);
  });

  it("stays within Transitous fair use by routing only the Parking Candidates with the smallest detours", async () => {
    // 127 on the straight line, plus 13 a few km beside it (still within the detour bound) that would be faster.
    const onTheWay = Array.from({ length: 127 }, (_, i) => candidateOnTheWay(`on-${i}`, 0.1 + (0.8 * i) / 127));
    const besideTheWay = Array.from({ length: 13 }, (_, i) => {
      const c = candidateOnTheWay(`beside-${i}`, 0.45 + i / 120);
      return { ...c, location: { lat: c.location.lat + 0.062, lng: c.location.lng + 0.0868 } };
    });
    const all = [...besideTheWay, ...onTheWay];
    const engine = fakeRoutingEngine({
      driveFromOrigin: all.map((c) => [c.location, c.id.startsWith("beside") ? min(5) : min(30)]),
      transitToDestination: [
        ...all.map((c): [LatLng, { durationS: number; transfers: number }] => [c.location, { durationS: min(20), transfers: 0 }]),
        [origin, { durationS: min(90), transfers: 1 }],
      ],
      maxPointsPerCall: 128,
    });

    const recommendation = await recommend({ origin, destination, arriveBy }, all, noZbes, engine);

    expect(recommendation.options).toHaveLength(5);
    expect(recommendation.options.every((o) => o.candidate.id.startsWith("on-"))).toBe(true);
    expect(recommendation.baseline?.transitS).toBe(min(90));
  });

  it("lets a Parking Candidate far from every ZBE edge beat one at the edge on door-to-door time", async () => {
    // A ZBE around the Destination; the Origin is ~33 km away.
    const zbe = squareZbe("barcelona", { lat: 41.36, lng: 2.12, side: 0.06 });
    const atTheEdge = candidate("at-the-edge", 41.355, 3, 2.15);
    // A Rodalies station a third of the way from the Origin, ~20 km from the ZBE's edge.
    const farOut = candidateOnTheWay("far-out", 0.33);
    const engine = fakeRoutingEngine({
      driveFromOrigin: [
        // The last kilometres into the city are slow.
        [atTheEdge.location, min(45)],
        [farOut.location, min(12)],
      ],
      transitToDestination: [
        [atTheEdge.location, { durationS: min(15), transfers: 0 }],
        [farOut.location, { durationS: min(28), transfers: 0 }],
      ],
    });

    const recommendation = await recommend({ origin, destination, arriveBy }, [atTheEdge, farOut], { zbes: [zbe] }, engine);

    // far-out: 12 + 3 + 28 = 43 min; at-the-edge: 45 + 3 + 15 = 63 min.
    expect(recommendation.options.map((o) => [o.candidate.id, o.doorToDoorS / 60])).toEqual([
      ["far-out", 43],
      ["at-the-edge", 63],
    ]);
  });
});
