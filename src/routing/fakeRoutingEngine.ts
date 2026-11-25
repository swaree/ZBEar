import type { LatLng } from "../domain/types";
import type { RoutingEngine, TransitDuration } from "./RoutingEngine";

/** In-memory RoutingEngine for tests: lookup tables keyed by location. Missing entries mean "no route". */
export function fakeRoutingEngine(tables: {
  driveFromOrigin?: [LatLng, number][];
  transitToDestination?: [LatLng, TransitDuration][];
}): RoutingEngine {
  const key = (p: LatLng) => `${p.lat},${p.lng}`;
  const drive = new Map((tables.driveFromOrigin ?? []).map(([p, s]) => [key(p), s]));
  const transit = new Map((tables.transitToDestination ?? []).map(([p, d]) => [key(p), d]));
  return {
    async transitManyToOne(many) {
      return many.map((p) => transit.get(key(p)) ?? null);
    },
    async driveFreeFlowOneToMany(_one, many) {
      return many.map((p) => drive.get(key(p)) ?? null);
    },
  };
}
