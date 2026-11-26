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
  /**
   * Where the DGT and OSM perimeters disagree and no settlement has decided yet. They count as
   * inside the ZBE, so doubt resolves on the safe side. Absent when there are none.
   */
  disputedAreas?: MultiPolygon;
  restrictionWindow: RestrictionWindow;
  barredLabels: EnvironmentalLabel[];
}

/** The published ZBE dataset. */
export interface ZbeDataset {
  /** ISO timestamp of the dataset build. */
  builtAt: string;
  zbes: Zbe[];
}

/** Whether a point lies inside any ZBE's perimeter or disputed areas (on the boundary counts as either). */
export function isInsideAnyZbe(point: LatLng, zbes: Zbe[]): boolean {
  return zbes.some((zbe) => areasOf(zbe).some((polygon) => isInsidePolygon(point.lng, point.lat, polygon)));
}

/** The polygons that count as inside a ZBE: its perimeter's and its disputed areas'. */
function areasOf(zbe: Zbe): [number, number][][][] {
  return [...zbe.perimeter.coordinates, ...(zbe.disputedAreas?.coordinates ?? [])];
}

/** Even-odd ray casting in plain lng/lat, which is accurate enough at the scale of a city. */
export function isInsidePolygon(x: number, y: number, rings: [number, number][][]): boolean {
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

/** A point on a drive and when the car passes it, in milliseconds since the epoch. */
export interface TimedPosition extends LatLng {
  at: number;
}

/**
 * Whether a drive along `path` would be inside a ZBE during its Restriction Window while that ZBE bars
 * the vehicle's Environmental Label. It is judged on the time the car is actually inside, not when it
 * departs: entering at 06:55 and still being inside at 07:10 is illegal under a 07:00 window.
 */
export function isDriveIllegal(path: TimedPosition[], zbes: Zbe[], label: EnvironmentalLabel): boolean {
  return zbes.some(
    (zbe) =>
      zbe.barredLabels.includes(label) &&
      stretchesInside(path, zbe).some((stretch) => overlapsRestrictionWindow(stretch, zbe.restrictionWindow)),
  );
}

interface Stretch {
  from: number;
  to: number;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The spans of time the car is inside the ZBE (its perimeter or its disputed areas). Each path segment is
 * split where it crosses a ZBE edge, so a segment that cuts a corner counts even with both ends outside.
 */
function stretchesInside(path: TimedPosition[], zbe: Zbe): Stretch[] {
  const polygons = areasOf(zbe).map((rings) => ({
    rings,
    box: boxOf(rings.flat()),
  }));
  const zbeBox = boxOf(polygons.flatMap(({ box }) => [[box.minX, box.minY], [box.maxX, box.maxY]] as [number, number][]));
  const inside = (x: number, y: number) =>
    polygons.some((p) => inBox(p.box, x, y) && isInsidePolygon(x, y, p.rings));

  const stretches: Stretch[] = [];
  let open: Stretch | null = null;
  const piece = (isInside: boolean, from: number, to: number) => {
    if (!isInside) open = null;
    else if (open) open.to = to;
    else stretches.push((open = { from, to }));
  };

  if (path.length === 1) {
    const [only] = path as [TimedPosition];
    piece(inside(only.lng, only.lat), only.at, only.at);
  }
  for (let i = 0; i + 1 < path.length; i++) {
    const p = path[i]!;
    const q = path[i + 1]!;
    const segmentBox = boxOf([
      [p.lng, p.lat],
      [q.lng, q.lat],
    ]);
    if (!boxesOverlap(segmentBox, zbeBox)) {
      piece(false, p.at, q.at);
      continue;
    }
    const cuts = [0, 1];
    for (const polygon of polygons) {
      if (!boxesOverlap(segmentBox, polygon.box)) continue;
      for (const ring of polygon.rings) {
        for (let j = 0; j + 1 < ring.length; j++) {
          const t = crossing(p, q, ring[j]!, ring[j + 1]!);
          if (t != null) cuts.push(t);
        }
      }
    }
    cuts.sort((a, b) => a - b);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const [t0, t1] = [cuts[k]!, cuts[k + 1]!];
      const mid = (t0 + t1) / 2;
      piece(
        inside(p.lng + mid * (q.lng - p.lng), p.lat + mid * (q.lat - p.lat)),
        p.at + t0 * (q.at - p.at),
        p.at + t1 * (q.at - p.at),
      );
    }
  }
  return stretches;
}

/** Where along p→q (0..1) it crosses the edge a→b, if it does. */
function crossing(p: LatLng, q: LatLng, [ax, ay]: [number, number], [bx, by]: [number, number]): number | null {
  const dx = q.lng - p.lng;
  const dy = q.lat - p.lat;
  const ex = bx - ax;
  const ey = by - ay;
  const denominator = dx * ey - dy * ex;
  if (denominator === 0) return null;
  const t = ((ax - p.lng) * ey - (ay - p.lat) * ex) / denominator;
  const u = ((ax - p.lng) * dy - (ay - p.lat) * dx) / denominator;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : null;
}

function boxOf(positions: [number, number][]): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of positions) {
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
  }
  return box;
}

const inBox = (b: Box, x: number, y: number) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
const boxesOverlap = (a: Box, b: Box) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

const MINUTE_MS = 60_000;

/**
 * Restriction Windows start and end on whole minutes of local time, and Europe/Madrid is a whole number of
 * hours off UTC, so a stretch overlaps a window exactly when the window holds its start or one of the
 * whole minutes within it.
 */
function overlapsRestrictionWindow({ from, to }: Stretch, window: RestrictionWindow): boolean {
  if (isInRestrictionWindow(from, window)) return true;
  for (let at = Math.ceil(from / MINUTE_MS) * MINUTE_MS; at <= to; at += MINUTE_MS) {
    if (isInRestrictionWindow(at, window)) return true;
  }
  return false;
}

const MADRID_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const WEEKDAYS: Record<string, Weekday> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function isInRestrictionWindow(at: number, { weekdays, start, end }: RestrictionWindow): boolean {
  const parts = Object.fromEntries(MADRID_TIME.formatToParts(at).map((p) => [p.type, p.value]));
  const weekday = WEEKDAYS[parts.weekday ?? ""];
  const time = `${parts.hour}:${parts.minute}`;
  return weekday != null && weekdays.includes(weekday) && start <= time && time < end;
}
