import * as clip from "polyclip-ts";
import polylabel from "polylabel";
import type { MultiPolygon } from "../domain/zbe";

/** [lng, lat]. */
export type Position = [number, number];
/** A polygon: its outer ring, then any holes; each ring closed. */
export type Polygon = Position[][];

export const union = (...polygons: Polygon[][]): Polygon[] =>
  polygons.length === 0 ? [] : (clip.union(polygons[0]!, ...polygons.slice(1)) as Polygon[]);
export const difference = (a: Polygon[], b: Polygon[]): Polygon[] =>
  b.length === 0 ? a : (clip.difference(a, b) as Polygon[]);
export const intersection = (a: Polygon[], b: Polygon[]): Polygon[] =>
  a.length === 0 || b.length === 0 ? [] : (clip.intersection(a, b) as Polygon[]);

export const toMultiPolygon = (polygons: Polygon[]): MultiPolygon => ({ type: "MultiPolygon", coordinates: polygons });

const METRES_PER_DEGREE = 111_320;

/** Area in square metres: accurate enough at city scale. */
export function areaM2(polygons: Polygon[]): number {
  return polygons.reduce((total, polygon) => {
    const [outer, ...holes] = inMetres(polygon);
    return total + ringArea(outer ?? []) - holes.reduce((h, ring) => h + ringArea(ring), 0);
  }, 0);
}

/** The diameter in metres of the widest circle that fits inside the polygon: a thin strip, however long, stays narrow. */
export function widestM(polygon: Polygon): number {
  return 2 * polylabel(inMetres(polygon), 0.5).distance;
}

/** The polygon in metres east and north of its first corner, flattened around that corner's latitude. */
function inMetres(polygon: Polygon): Polygon {
  const [x0, y0] = polygon[0]?.[0] ?? [0, 0];
  const metresPerDegreeLng = METRES_PER_DEGREE * Math.cos((y0 * Math.PI) / 180);
  return polygon.map((ring) => ring.map(([x, y]): Position => [(x - x0) * metresPerDegreeLng, (y - y0) * METRES_PER_DEGREE]));
}

function ringArea(ring: Position[]): number {
  let doubledArea = 0;
  for (let i = 0; i + 1 < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    doubledArea += x1 * y2 - x2 * y1;
  }
  return Math.abs(doubledArea) / 2;
}
