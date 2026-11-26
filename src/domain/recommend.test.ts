import { describe, expect, it } from "vitest";
import { recommend } from "./recommend";
import type { LatLng, ParkingCandidate } from "./types";
import type { EnvironmentalLabel, Zbe } from "./zbe";
import { fakeRoutingEngine } from "../routing/fakeRoutingEngine";
import type { TrafficDrive } from "../routing/RoutingEngine";

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

/**
 * A hand-made drive with traffic from the Origin, through `via` (each a point and the minute the car
 * passes it), to `to`, which it reaches at `totalMin`.
 */
function trafficDrive(to: LatLng, totalMin: number, ...via: [lat: number, lng: number, atMin: number][]): TrafficDrive {
  return {
    durationS: min(totalMin),
    distanceM: 30_000,
    path: [
      { ...origin, atS: 0 },
      ...via.map(([lat, lng, atMin]) => ({ lat, lng, atS: min(atMin) })),
      { ...to, atS: min(totalMin) },
    ],
  };
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
      // Down the coast road, south of the ZBE, to the parking at its edge.
      trafficDriveFromOrigin: [[atTheEdge.location, trafficDrive(atTheEdge.location, 45, [41.35, 1.95, 30])]],
    });

    const recommendation = await recommend({ origin, destination, arriveBy }, [atTheEdge, farOut], { zbes: [zbe] }, engine);

    // far-out: 12 + 3 + 28 = 43 min; at-the-edge: 45 + 3 + 15 = 63 min.
    expect(recommendation.options.map((o) => [o.candidate.id, o.doorToDoorS / 60])).toEqual([
      ["far-out", 43],
      ["at-the-edge", 63],
    ]);
  });
});

describe("recommend: traffic pass", () => {
  it("ranks Options by their drive time with traffic, not free-flow", async () => {
    const jammed = candidate("jammed", 41.41, 3);
    const clear = candidate("clear", 41.42, 3);
    const engine = fakeRoutingEngine({
      driveFromOrigin: [
        [jammed.location, min(15)],
        [clear.location, min(20)],
      ],
      transitToDestination: [
        [jammed.location, { durationS: min(30), transfers: 0 }],
        [clear.location, { durationS: min(30), transfers: 0 }],
      ],
      trafficDriveFromOrigin: [
        [jammed.location, trafficDrive(jammed.location, 40)],
        [clear.location, trafficDrive(clear.location, 22)],
      ],
    });

    const recommendation = await recommend({ origin, destination, arriveBy }, [jammed, clear], noZbes, engine);

    // clear: 22 + 3 + 30 = 55 min; jammed: 40 + 3 + 30 = 73 min.
    expect(recommendation.options.map((o) => [o.candidate.id, o.driveS / 60, o.doorToDoorS / 60])).toEqual([
      ["clear", 22, 55],
      ["jammed", 40, 73],
    ]);
    expect(recommendation.options[0]?.leaveOriginAt).toEqual(new Date("2026-12-01T08:05:00+01:00"));
  });

  it("checks traffic only for the best Parking Candidates by free-flow time, as many as the traffic pass size", async () => {
    const first = candidate("first", 41.41, 3);
    const second = candidate("second", 41.42, 3);
    // Third on free-flow time, though traffic would make it the fastest: it never gets a traffic check.
    const third = candidate("third", 41.43, 3);
    const all = [first, second, third];
    const engine = fakeRoutingEngine({
      driveFromOrigin: [
        [first.location, min(10)],
        [second.location, min(12)],
        [third.location, min(14)],
      ],
      transitToDestination: all.map((c) => [c.location, { durationS: min(30), transfers: 0 }]),
      trafficDriveFromOrigin: [
        [first.location, trafficDrive(first.location, 25)],
        [second.location, trafficDrive(second.location, 25)],
        [third.location, trafficDrive(third.location, 5)],
      ],
    });

    const recommendation = await recommend({ origin, destination, arriveBy }, all, noZbes, engine, { trafficPassSize: 2 });

    expect(recommendation.options.map((o) => o.candidate.id)).toEqual(["first", "second"]);
  });

  it("checks traffic for the best 20 Parking Candidates unless told otherwise", async () => {
    const all = Array.from({ length: 22 }, (_, i) => candidate(`c${i + 1}`, 41.4 + i / 200, 3));
    const engine = fakeRoutingEngine({
      driveFromOrigin: all.map((c, i) => [c.location, min(10 + i)]),
      transitToDestination: all.map((c) => [c.location, { durationS: min(30), transfers: 0 }]),
      // The two slowest on free-flow time would be the fastest with traffic.
      trafficDriveFromOrigin: all.map((c, i) => [c.location, trafficDrive(c.location, i >= 20 ? 5 : 40 + i)]),
    });

    const recommendation = await recommend({ origin, destination, arriveBy }, all, noZbes, engine);

    expect(recommendation.options.map((o) => o.candidate.id)).toEqual(["c1", "c2", "c3", "c4", "c5"]);
  });

  it("asks for the traffic when the driver would leave: the arrive-by time less transit, finding a space and the free-flow drive", async () => {
    const a = candidate("a", 41.41, 3);
    const engine = fakeRoutingEngine({
      driveFromOrigin: [[a.location, min(20)]],
      transitToDestination: [[a.location, { durationS: min(30), transfers: 0 }]],
      // Rush hour builds up after 08:07: leaving then is a 26 min drive, any later is far slower.
      trafficDriveFromOrigin: [
        [
          a.location,
          (departAt) =>
            trafficDrive(a.location, departAt.getTime() === new Date("2026-12-01T08:07:00+01:00").getTime() ? 26 : 60),
        ],
      ],
    });

    const [option] = (await recommend({ origin, destination, arriveBy }, [a], noZbes, engine)).options;

    expect(option?.driveS).toBe(min(26));
    expect(option?.leaveOriginAt).toEqual(new Date("2026-12-01T08:01:00+01:00"));
  });

  it("leaves out a Parking Candidate the drive with traffic cannot reach", async () => {
    const reachable = candidate("reachable", 41.41, 3);
    const closedRoad = candidate("closed-road", 41.42, 3);
    const all = [reachable, closedRoad];
    const engine = fakeRoutingEngine({
      driveFromOrigin: all.map((c) => [c.location, min(10)]),
      transitToDestination: all.map((c) => [c.location, { durationS: min(30), transfers: 0 }]),
      trafficDriveFromOrigin: [[closedRoad.location, null]],
    });

    const recommendation = await recommend({ origin, destination, arriveBy }, all, noZbes, engine);

    expect(recommendation.options.map((o) => o.candidate.id)).toEqual(["reachable"]);
  });
});

describe("recommend: drives through ZBEs", () => {
  /** West of the Origin, away from every straight drive to the candidates (which all lie east of it). */
  const westZbe = squareZbe("west", { lat: 41.5, lng: 1.8, side: 0.02 });

  it("discards an Option whose drive cuts through a ZBE during its Restriction Window", async () => {
    const around = candidate("around", 41.45, 3);
    const through = candidate("through", 41.46, 3);
    const engine = fakeRoutingEngine({
      driveFromOrigin: [
        [around.location, min(25)],
        [through.location, min(20)],
      ],
      transitToDestination: [
        [around.location, { durationS: min(30), transfers: 0 }],
        [through.location, { durationS: min(30), transfers: 0 }],
      ],
      trafficDriveFromOrigin: [
        // Leaves at 08:07 and crosses the ZBE from north to south around 08:13, on a Tuesday.
        [through.location, trafficDrive(through.location, 20, [41.53, 1.81, 4], [41.49, 1.81, 8])],
      ],
    });

    const recommendation = await recommend({ origin, destination, arriveBy }, [around, through], { zbes: [westZbe] }, engine);

    expect(recommendation.options.map((o) => o.candidate.id)).toEqual(["around"]);
  });

  it("judges the Restriction Window on the time the car is inside the ZBE, not when it leaves the Origin", async () => {
    // Both drives take 27 min and spend about 16 min inside the ZBE (07:00–20:00 on weekdays).
    const throughWest = (to: LatLng) => trafficDrive(to, 27, [41.521, 1.81, 4], [41.519, 1.81, 5], [41.505, 1.81, 20], [41.49, 1.81, 22]);
    const late = candidate("late", 41.45, 3);
    const early = candidate("early", 41.46, 3);
    const engine = fakeRoutingEngine({
      driveFromOrigin: [
        [late.location, min(27)],
        [early.location, min(27)],
      ],
      transitToDestination: [
        [late.location, { durationS: min(30), transfers: 0 }],
        [early.location, { durationS: min(50), transfers: 0 }],
      ],
      trafficDriveFromOrigin: [
        // Leaves at 06:50, enters the ZBE at 06:55 and is still inside at 07:10.
        [late.location, throughWest(late.location)],
        // Leaves at 06:30 and is out of the ZBE again by 06:51.
        [early.location, throughWest(early.location)],
      ],
    });

    const recommendation = await recommend(
      { origin, destination, arriveBy: new Date("2026-12-01T07:50:00+01:00") },
      [late, early],
      { zbes: [westZbe] },
      engine,
    );

    expect(recommendation.options.map((o) => [o.candidate.id, o.leaveOriginAt])).toEqual([
      ["early", new Date("2026-12-01T06:30:00+01:00")],
    ]);
  });

  /** A Parking Candidate whose 20 min drive crosses the west ZBE in its first 10 min. */
  function throughWestEngine(c: ParkingCandidate) {
    return fakeRoutingEngine({
      driveFromOrigin: [[c.location, min(20)]],
      transitToDestination: [[c.location, { durationS: min(30), transfers: 0 }]],
      trafficDriveFromOrigin: [[c.location, trafficDrive(c.location, 20, [41.53, 1.81, 2], [41.49, 1.81, 10])]],
    });
  }

  it("judges the Restriction Window in local Catalan time (Europe/Madrid), not UTC", async () => {
    const through = candidate("through", 41.46, 3);

    // In the ZBE from about 06:10 to 06:20 UTC, which is 07:10 to 07:20 in Barcelona in winter.
    const recommendation = await recommend(
      { origin, destination, arriveBy: new Date("2026-12-01T07:00:00Z") },
      [through],
      { zbes: [westZbe] },
      throughWestEngine(through),
    );

    expect(recommendation.options).toEqual([]);
  });

  it("lets a drive through a ZBE on a day outside its Restriction Window", async () => {
    const through = candidate("through", 41.46, 3);

    // Saturday morning; the window is Monday to Friday.
    const recommendation = await recommend(
      { origin, destination, arriveBy: new Date("2026-12-05T09:00:00+01:00") },
      [through],
      { zbes: [westZbe] },
      throughWestEngine(through),
    );

    expect(recommendation.options.map((o) => o.candidate.id)).toEqual(["through"]);
  });

  it("counts driving through a ZBE's Disputed Areas as driving inside it", async () => {
    const through = candidate("through", 41.46, 3);
    // OSM draws a ZBE much further west than DGT does, across the drive.
    const zbe: Zbe = { ...squareZbe("one", { lat: 41.5, lng: 1.7, side: 0.02 }), disputedAreas: westZbe.perimeter };

    const recommendation = await recommend({ origin, destination, arriveBy }, [through], { zbes: [zbe] }, throughWestEngine(through));

    expect(recommendation.options).toEqual([]);
  });

  it("bars the vehicle only from the ZBEs that bar its Environmental Label", async () => {
    // Bars vehicles with no label, as the west ZBE does, but also B, C and ECO.
    const strictZbe: Zbe = { ...squareZbe("strict", { lat: 41.55, lng: 1.8, side: 0.02 }), barredLabels: ["none", "B", "C", "ECO"] };
    const throughWest = candidate("through-west", 41.45, 3);
    const throughStrict = candidate("through-strict", 41.46, 3);
    const all = [throughWest, throughStrict];
    const engine = fakeRoutingEngine({
      driveFromOrigin: all.map((c) => [c.location, min(20)]),
      transitToDestination: all.map((c) => [c.location, { durationS: min(30), transfers: 0 }]),
      trafficDriveFromOrigin: [
        [throughWest.location, trafficDrive(throughWest.location, 20, [41.53, 1.81, 2], [41.49, 1.81, 10])],
        [throughStrict.location, trafficDrive(throughStrict.location, 20, [41.58, 1.81, 2], [41.54, 1.81, 10])],
      ],
    });
    const plan = (vehicleLabel?: EnvironmentalLabel) =>
      recommend({ origin, destination, arriveBy, vehicleLabel }, all, { zbes: [westZbe, strictZbe] }, engine).then((r) =>
        r.options.map((o) => o.candidate.id).sort(),
      );

    expect(await plan()).toEqual([]);
    expect(await plan("none")).toEqual([]);
    expect(await plan("B")).toEqual(["through-west"]);
    expect(await plan("0")).toEqual(["through-strict", "through-west"]);
  });
});
