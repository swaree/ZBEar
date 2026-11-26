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
  /**
   * The centrelines of the roads that run within the perimeter but are legally outside the ZBE
   * (e.g. the Rondes, B-10/B-20, and their ramps that don't lead only into the ZBE). Driving along
   * one is not driving inside the ZBE. Absent when there are none.
   */
  exemptCorridors?: MultiLineString;
  restrictionWindow: RestrictionWindow;
  barredLabels: EnvironmentalLabel[];
}

/** A GeoJSON MultiLineString: lines of [lng, lat] positions. */
export interface MultiLineString {
  type: "MultiLineString";
  coordinates: [number, number][][];
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
 * How far a drive may run from an Exempt Corridor's centreline and still be on it, in m. It absorbs the
 * few metres by which the routing provider's road geometry sits off OSM's, while a Ronda lateral (a city
 * street ~15–25 m beside the main carriageway) mostly stays outside it.
 */
export const EXEMPT_CORRIDOR_TOLERANCE_M = 12;

/** Whether a point lies on one of the ZBE's Exempt Corridors, within the tolerance of its centreline. */
export function isOnExemptCorridor(point: LatLng, zbe: Zbe): boolean {
  return !!zbe.exemptCorridors && corridorIndexOf(zbe.exemptCorridors).covers(point.lng, point.lat);
}

/** Inside a ZBE, the drive is checked against its Exempt Corridors at points this far apart, in m. */
const CORRIDOR_SAMPLE_STEP_M = EXEMPT_CORRIDOR_TOLERANCE_M / 2;

/**
 * The spans of time the car is inside the ZBE (its perimeter or its disputed areas) and not on one of its
 * Exempt Corridors. Each path segment is split where it crosses a ZBE edge, so a segment that cuts a
 * corner counts even with both ends outside. Inside, a step counts as on a corridor when both its ends
 * are, so leaving a corridor for a street inside the ZBE counts from where the drive leaves it.
 */
function stretchesInside(path: TimedPosition[], zbe: Zbe): Stretch[] {
  const polygons = areasOf(zbe).map((rings) => ({
    rings,
    box: boxOf(rings.flat()),
  }));
  const zbeBox = boxOf(polygons.flatMap(({ box }) => [[box.minX, box.minY], [box.maxX, box.maxY]] as [number, number][]));
  const inside = (x: number, y: number) =>
    polygons.some((p) => inBox(p.box, x, y) && isInsidePolygon(x, y, p.rings));
  const corridors = zbe.exemptCorridors && corridorIndexOf(zbe.exemptCorridors);

  const stretches: Stretch[] = [];
  let open: Stretch | null = null;
  const piece = (isInside: boolean, from: number, to: number) => {
    if (!isInside) open = null;
    else if (open) open.to = to;
    else stretches.push((open = { from, to }));
  };

  if (path.length === 1) {
    const [only] = path as [TimedPosition];
    piece(inside(only.lng, only.lat) && !corridors?.covers(only.lng, only.lat), only.at, only.at);
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
    const x = (t: number) => p.lng + t * (q.lng - p.lng);
    const y = (t: number) => p.lat + t * (q.lat - p.lat);
    const at = (t: number) => p.at + t * (q.at - p.at);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const [t0, t1] = [cuts[k]!, cuts[k + 1]!];
      const mid = (t0 + t1) / 2;
      const isInside = inside(x(mid), y(mid));
      if (!isInside || !corridors || !corridors.isNear(segmentBox)) {
        piece(isInside, at(t0), at(t1));
        continue;
      }
      const steps = Math.max(1, Math.ceil(lengthM(x(t0), y(t0), x(t1), y(t1)) / CORRIDOR_SAMPLE_STEP_M));
      let from = t0;
      let wasOn = corridors.covers(x(from), y(from));
      for (let s = 1; s <= steps; s++) {
        const to = t0 + ((t1 - t0) * s) / steps;
        const isOn = corridors.covers(x(to), y(to));
        piece(!(wasOn && isOn), at(from), at(to));
        [from, wasOn] = [to, isOn];
      }
    }
  }
  return stretches;
}

const METRES_PER_DEGREE = 111_320;

/** Metres east and north of (x0, y0) to (x, y), flattened around y0's latitude: accurate at city scale. */
function offsetM(x0: number, y0: number, x: number, y: number): [number, number] {
  return [(x - x0) * METRES_PER_DEGREE * Math.cos((y0 * Math.PI) / 180), (y - y0) * METRES_PER_DEGREE];
}

const lengthM = (x0: number, y0: number, x1: number, y1: number) => Math.hypot(...offsetM(x0, y0, x1, y1));

/** Exempt Corridor segments bucketed in a grid, to find those near a point without scanning them all. */
interface CorridorIndex {
  /** Whether the point lies within the tolerance of some corridor. */
  covers(x: number, y: number): boolean;
  /** Whether any corridor comes within the tolerance of the box. */
  isNear(box: Box): boolean;
}

/** Grid cells of about 110 m by 80 m in Catalonia: a few cover a long motorway segment. */
const CELL_DEG = 0.001;
const corridorIndexes = new WeakMap<MultiLineString, CorridorIndex>();

function corridorIndexOf(corridors: MultiLineString): CorridorIndex {
  const known = corridorIndexes.get(corridors);
  if (known) return known;
  type Segment = [[number, number], [number, number]];
  const cells = new Map<string, Segment[]>();
  const cell = (col: number, row: number) => `${col}:${row}`;
  const all: [number, number][] = [];
  for (const line of corridors.coordinates) {
    for (let i = 0; i + 1 < line.length; i++) {
      const segment: Segment = [line[i]!, line[i + 1]!];
      const box = withMargin(boxOf(segment));
      all.push([box.minX, box.minY], [box.maxX, box.maxY]);
      for (let col = Math.floor(box.minX / CELL_DEG); col <= Math.floor(box.maxX / CELL_DEG); col++) {
        for (let row = Math.floor(box.minY / CELL_DEG); row <= Math.floor(box.maxY / CELL_DEG); row++) {
          const key = cell(col, row);
          const bucket = cells.get(key);
          if (bucket) bucket.push(segment);
          else cells.set(key, [segment]);
        }
      }
    }
  }
  const reach = all.length > 0 ? boxOf(all) : null;
  const index: CorridorIndex = {
    covers(x, y) {
      const bucket = cells.get(cell(Math.floor(x / CELL_DEG), Math.floor(y / CELL_DEG)));
      return !!bucket && bucket.some(([a, b]) => distanceToSegmentM(x, y, a, b) <= EXEMPT_CORRIDOR_TOLERANCE_M);
    },
    isNear: (box) => !!reach && boxesOverlap(reach, box),
  };
  corridorIndexes.set(corridors, index);
  return index;
}

/** The box grown by the tolerance on every side (generously in longitude, which is the shorter degree). */
function withMargin(box: Box): Box {
  const marginLat = EXEMPT_CORRIDOR_TOLERANCE_M / METRES_PER_DEGREE;
  const marginLng = marginLat / Math.cos((Math.max(Math.abs(box.minY), Math.abs(box.maxY)) * Math.PI) / 180);
  return { minX: box.minX - marginLng, minY: box.minY - marginLat, maxX: box.maxX + marginLng, maxY: box.maxY + marginLat };
}

function distanceToSegmentM(x: number, y: number, a: [number, number], b: [number, number]): number {
  const [ax, ay] = offsetM(x, y, a[0], a[1]);
  const [bx, by] = offsetM(x, y, b[0], b[1]);
  const [dx, dy] = [bx - ax, by - ay];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
  return Math.hypot(ax + t * dx, ay + t * dy);
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
