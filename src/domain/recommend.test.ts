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

function candidate(id: string, lat: number, timeToFindSpaceMin: number): ParkingCandidate {
  return {
    id,
    name: `Candidate ${id}`,
    location: { lat, lng: 2.0 },
    timeToFindSpaceS: min(timeToFindSpaceMin),
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
});
