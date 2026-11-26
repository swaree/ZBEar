import { distanceM } from "../domain/geo";
import type { LatLng } from "../domain/types";
import type { RoutingEngine, TrafficDrive, TransitDuration } from "./RoutingEngine";

/** A drive with traffic as a fixed answer, or as an answer that depends on the departure time. */
export type FakeTrafficDrive = TrafficDrive | ((departAt: Date) => TrafficDrive | null);

/**
 * In-memory RoutingEngine for tests: lookup tables keyed by location. Missing entries mean "no route".
 * Like Transitous under its fair-use terms, it refuses a call with more than `maxPointsPerCall` points.
 *
 * It knows the Trip it serves, and throws when asked about any other Origin, Destination or time, so a
 * Recommendation that routes the wrong places or times fails its tests rather than passing by accident.
 * With no `leaveDestinationAt`, the Trip has no Return Leg and any return routing throws.
 *
 * A drive with traffic defaults to the free-flow drive along a straight line, so only tests about traffic
 * or about the drive's path need to give one.
 */
export function fakeRoutingEngine(tables: {
  origin: LatLng;
  destination: LatLng;
  /** When the Outbound Leg's transit must arrive at the Destination. */
  arriveBy: Date;
  /** When the Return Leg's transit leaves the Destination. */
  leaveDestinationAt?: Date;
  driveFromOrigin?: [LatLng, number][];
  transitToDestination?: [LatLng, TransitDuration][];
  trafficDriveFromOrigin?: [LatLng, FakeTrafficDrive | null][];
  transitFromDestination?: [LatLng, TransitDuration][];
  driveToOrigin?: [LatLng, number][];
  trafficDriveToOrigin?: [LatLng, FakeTrafficDrive | null][];
  maxPointsPerCall?: number;
}): RoutingEngine {
  const limit = tables.maxPointsPerCall ?? Infinity;
  const checkFairUse = (many: LatLng[]) => {
    if (many.length > limit) throw new Error(`${many.length} points in one call; fair use allows ${limit}`);
  };
  const key = (p: LatLng) => `${p.lat},${p.lng}`;
  const same = (a: LatLng, b: LatLng) => key(a) === key(b);
  const expectPoint = (what: string, actual: LatLng, expected: LatLng) => {
    if (!same(actual, expected)) throw new Error(`${what} should be ${key(expected)}, was ${key(actual)}`);
  };
  const expectTime = (what: string, actual: Date, expected: Date | undefined) => {
    if (!expected) throw new Error(`${what}: this Trip has no Return Leg`);
    if (actual.getTime() !== expected.getTime()) {
      throw new Error(`${what} should be ${expected.toISOString()}, was ${actual.toISOString()}`);
    }
  };
  const table = <T>(entries: [LatLng, T][] | undefined) => new Map((entries ?? []).map(([p, v]) => [key(p), v]));
  const transitTo = table(tables.transitToDestination);
  const transitFrom = table(tables.transitFromDestination);
  const driveFrom = table(tables.driveFromOrigin);
  const driveTo = table(tables.driveToOrigin);
  const trafficFrom = table(tables.trafficDriveFromOrigin);
  const trafficTo = table(tables.trafficDriveToOrigin);

  /** A drive between the Origin and a Parking Candidate, looked up by the candidate in that direction's tables. */
  function traffic(
    given: Map<string, FakeTrafficDrive | null>,
    freeFlow: Map<string, number>,
    candidate: LatLng,
    from: LatLng,
    to: LatLng,
    departAt: Date,
  ): TrafficDrive | null {
    if (given.has(key(candidate))) {
      const drive = given.get(key(candidate)) ?? null;
      return typeof drive === "function" ? drive(departAt) : drive;
    }
    const freeFlowS = freeFlow.get(key(candidate));
    if (freeFlowS == null) return null;
    return {
      durationS: freeFlowS,
      distanceM: distanceM(from, to),
      path: [
        { ...from, atS: 0 },
        { ...to, atS: freeFlowS },
      ],
    };
  }

  return {
    async transitManyToOne(many, one, arriveBy) {
      checkFairUse(many);
      expectPoint("Outbound transit's Destination", one, tables.destination);
      expectTime("Outbound transit's arrive-by time", arriveBy, tables.arriveBy);
      return many.map((p) => transitTo.get(key(p)) ?? null);
    },
    async transitOneToMany(one, many, leaveAt) {
      checkFairUse(many);
      expectPoint("Return transit's start", one, tables.destination);
      expectTime("Return transit's leave-at time", leaveAt, tables.leaveDestinationAt);
      return many.map((p) => transitFrom.get(key(p)) ?? null);
    },
    async driveFreeFlowOneToMany(one, many) {
      checkFairUse(many);
      expectPoint("Outbound free-flow drive's start", one, tables.origin);
      return many.map((p) => driveFrom.get(key(p)) ?? null);
    },
    async driveFreeFlowManyToOne(many, one) {
      checkFairUse(many);
      expectPoint("Return free-flow drive's end", one, tables.origin);
      if (!tables.leaveDestinationAt) throw new Error("Return free-flow drive: this Trip has no Return Leg");
      return many.map((p) => driveTo.get(key(p)) ?? null);
    },
    async driveWithTraffic(from, to, departAt) {
      if (same(from, tables.origin)) return traffic(trafficFrom, driveFrom, to, from, to, departAt);
      if (same(to, tables.origin)) {
        if (!tables.leaveDestinationAt) throw new Error("Return drive with traffic: this Trip has no Return Leg");
        return traffic(trafficTo, driveTo, from, from, to, departAt);
      }
      throw new Error(`A drive with traffic should start or end at the Origin, not ${key(from)} → ${key(to)}`);
    },
  };
}
