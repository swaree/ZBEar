import type { LatLng } from "./types";

/** The DGT classification of a vehicle that a ZBE uses to decide who is barred. */
export type EnvironmentalLabel = "none" | "B" | "C" | "ECO" | "0";

export const ENVIRONMENTAL_LABELS: readonly EnvironmentalLabel[] = ["none", "B", "C", "ECO", "0"];

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * The recurring time span during which a ZBE bars a vehicle, in local Europe/Madrid time.
 * It applies on every weekday listed, holidays and suspensions included (ADR-0003).
 */
export interface RestrictionWindow {
  weekdays: Weekday[];
  /** "HH:MM", inclusive. */
  start: string;
  /** "HH:MM", exclusive; "24:00" means until midnight. */
  end: string;
}

/** A GeoJSON MultiPolygon: polygons of rings of [lng, lat] positions; each ring is closed. */
export interface MultiPolygon {
  type: "MultiPolygon";
  coordinates: [number, number][][][];
}

/** A low emission zone. */
export interface Zbe {
  id: string;
  name: string;
  perimeter: MultiPolygon;
  restrictionWindow: RestrictionWindow;
  barredLabels: EnvironmentalLabel[];
}

/** The published ZBE dataset. */
export interface ZbeDataset {
  /** ISO timestamp of the dataset build. */
  builtAt: string;
  zbes: Zbe[];
}

/** Whether a point lies inside any ZBE's perimeter (on the boundary counts as either). */
export function isInsideAnyZbe(point: LatLng, zbes: Zbe[]): boolean {
  return zbes.some((zbe) => zbe.perimeter.coordinates.some((polygon) => isInsidePolygon(point.lng, point.lat, polygon)));
}

/** Even-odd ray casting in plain lng/lat, which is accurate enough at the scale of a city. */
function isInsidePolygon(x: number, y: number, rings: [number, number][][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
