import { distanceM } from "../domain/geo";
import type { LatLng } from "../domain/types";
import type { RoutingEngine, TrafficDrive, TransitDuration } from "./RoutingEngine";

/** A drive with traffic as a fixed answer, or as an answer that depends on the departure time. */
export type FakeTrafficDrive = TrafficDrive | ((departAt: Date) => TrafficDrive | null);

/**
 * In-memory RoutingEngine for tests: lookup tables keyed by location. Missing entries mean "no route".
 * Like Transitous under its fair-use terms, it refuses a call with more than `maxPointsPerCall` points.
 *
 * A drive with traffic from the Origin defaults to the free-flow drive along a straight line, so only
 * tests about traffic or about the drive's path need to give one.
 */
export function fakeRoutingEngine(tables: {
  driveFromOrigin?: [LatLng, number][];
  transitToDestination?: [LatLng, TransitDuration][];
  trafficDriveFromOrigin?: [LatLng, FakeTrafficDrive | null][];
  maxPointsPerCall?: number;
}): RoutingEngine {
  const limit = tables.maxPointsPerCall ?? Infinity;
  const checkFairUse = (many: LatLng[]) => {
    if (many.length > limit) throw new Error(`${many.length} points in one call; fair use allows ${limit}`);
  };
  const key = (p: LatLng) => `${p.lat},${p.lng}`;
  const drive = new Map((tables.driveFromOrigin ?? []).map(([p, s]) => [key(p), s]));
  const transit = new Map((tables.transitToDestination ?? []).map(([p, d]) => [key(p), d]));
  const traffic = new Map((tables.trafficDriveFromOrigin ?? []).map(([p, d]) => [key(p), d]));
  return {
    async transitManyToOne(many) {
      checkFairUse(many);
      return many.map((p) => transit.get(key(p)) ?? null);
    },
    async driveFreeFlowOneToMany(_one, many) {
      checkFairUse(many);
      return many.map((p) => drive.get(key(p)) ?? null);
    },
    async driveWithTraffic(from, to, departAt) {
      if (traffic.has(key(to))) {
        const given = traffic.get(key(to)) ?? null;
        return typeof given === "function" ? given(departAt) : given;
      }
      const freeFlowS = drive.get(key(to));
      if (freeFlowS == null) return null;
      return {
        durationS: freeFlowS,
        distanceM: distanceM(from, to),
        path: [
          { ...from, atS: 0 },
          { ...to, atS: freeFlowS },
        ],
      };
    },
  };
}
