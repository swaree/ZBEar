import { isInsideAnyZbe, type Zbe } from "../domain/zbe";
import type { Position } from "./geometry";

/** A road whose main carriageways are exempt within a ZBE: an OSM `ref` and the `highway` classes it counts in. */
export interface ExemptRoad {
  /** One of the way's `ref` values, e.g. "B-20" (OSM separates several with ";"). */
  ref: string;
  /**
   * The OSM `highway` values of its main carriageways, e.g. ["motorway", "trunk"]. Leaving out a
   * class keeps out the city avenues that share the ref, as Gran Via does the C-31's.
   */
  highways: string[];
}

/** The hand-maintained exempt roads, keyed by the id of the ZBE they are exempt within. */
export type ExemptRoadTable = Record<string, ExemptRoad[]>;

/** A hand-made decision on one OSM way, which wins over the table and the ramp rule. */
export interface CorridorCorrection {
  /** The id of the ZBE it applies within. */
  zbe: string;
  /** The OSM way id. */
  way: number;
  /**
   * "exempt": the whole way is an Exempt Corridor, and counts as an exempt road for the ramp rule;
   * "not-exempt": no part of it is, and no ramp is exempt by way of it.
   */
  verdict: "exempt" | "not-exempt";
  /** Why, and where it was checked (e.g. the ordinance's map). */
  note: string;
}

/** One element of an Overpass `out geom` response: a way has its node ids and their positions, in step. */
export interface OverpassRoad {
  type: string;
  id: number;
  tags?: Record<string, string>;
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
}

interface Way {
  id: number;
  tags: Record<string, string>;
  nodes: number[];
  positions: Position[];
}

/** A ramp between two nodes, in a direction it can be driven. */
interface Edge {
  from: number;
  to: number;
  segment: [Position, Position];
}

/**
 * The Exempt Corridors part of the dataset build, from OSM road ways around the ZBEs that have
 * exempt roads. A ZBE's corridors are the main carriageways of its exempt roads plus the ramps
 * (`highway=*_link`) that connect them to other exempt roads or lead out of the ZBE. An exit that
 * leads only into the ZBE is not exempt: a stretch of ramp is exempt only when, driving it the way
 * its `oneway` allows, it can be reached from an exempt road or from outside the ZBE, and leads on
 * to one, along ramps alone: without turning back, and without passing a junction with the ZBE's
 * streets. Disputed areas count as inside. Corrections are applied over both.
 */
export function buildExemptCorridors(input: {
  /** The published ZBEs, with their final perimeters and disputed areas. */
  zbes: Zbe[];
  /**
   * OSM road ways with their geometry: the exempt roads, every ramp near them, every road that
   * shares a node with a ramp, and every corrected way.
   */
  osm: { elements: OverpassRoad[] };
  exemptRoads: ExemptRoadTable;
  corrections?: CorridorCorrection[];
}): { zbes: Zbe[]; warnings: string[] } {
  const warnings: string[] = [];
  const ways = input.osm.elements.flatMap((e): Way[] => {
    const nodes = e.nodes ?? [];
    const geometry = e.geometry ?? [];
    if (e.type !== "way" || nodes.length < 2 || nodes.length !== geometry.length) return [];
    return [{ id: e.id, tags: e.tags ?? {}, nodes, positions: geometry.map((g): Position => [g.lon, g.lat]) }];
  });
  const wayIds = new Set(ways.map((w) => w.id));
  const corrections = input.corrections ?? [];
  const published = new Set(input.zbes.map((z) => z.id));
  for (const id of Object.keys(input.exemptRoads)) {
    if (!published.has(id)) warnings.push(`${id}: in the exempt road table but not a published ZBE`);
  }
  for (const c of corrections) {
    if (!published.has(c.zbe)) warnings.push(`${c.zbe}, way ${c.way}: the corridor correction is for a ZBE that isn't published`);
    else if (!wayIds.has(c.way)) warnings.push(`${c.zbe}, way ${c.way}: the corridor correction matches no OSM way; check it`);
  }

  const zbes = input.zbes.map((zbe) => {
    const roads = input.exemptRoads[zbe.id] ?? [];
    const zbeCorrections = corrections.filter((c) => c.zbe === zbe.id);
    if (roads.length === 0 && zbeCorrections.length === 0) return zbe;
    const verdictOf = new Map(zbeCorrections.map((c) => [c.way, c.verdict]));
    const isExemptRoad = (way: Way) =>
      verdictOf.get(way.id) === "exempt" ||
      (verdictOf.get(way.id) !== "not-exempt" &&
        !isRamp(way) &&
        refsOf(way).some((ref) => roads.some((r) => r.ref === ref && r.highways.includes(way.tags.highway ?? ""))));
    const exemptWays = ways.filter(isExemptRoad);
    const ramps = ways.filter((w) => isRamp(w) && !exemptWays.includes(w) && verdictOf.get(w.id) !== "not-exempt");

    // Where a ramp may start or end: on an exempt road, or anywhere outside the ZBE.
    const outside = new Set<number>();
    for (const ramp of ramps) {
      ramp.nodes.forEach((node, i) => {
        const [lng, lat] = ramp.positions[i]!;
        if (!isInsideAnyZbe({ lng, lat }, [zbe])) outside.add(node);
      });
    }
    const ends = new Set([...exemptWays.flatMap((w) => w.nodes), ...outside]);
    // Where a ramp meets the ZBE's streets, the drive is on them: no ramp is exempt by way of such a junction.
    const junctions = new Set(
      ways.filter((w) => !isRamp(w) && !exemptWays.includes(w) && CAR_ROADS.has(w.tags.highway ?? "")).flatMap((w) => w.nodes),
    );
    const edges = ramps.flatMap(edgesOf);
    const fromAnEnd = drivable(edges, ends, junctions, "forward");
    const toAnEnd = drivable(edges, ends, junctions, "backward");
    // Outside the ZBE every ramp leads out; only the stretches that touch it are worth publishing,
    // and a two-way ramp's stretch only once.
    const published = new Set<string>();
    const exemptEdges = edges.filter((e) => {
      const stretch = [e.from, e.to].sort((a, b) => a - b).join("-");
      if (!fromAnEnd.has(e) || !toAnEnd.has(e) || (outside.has(e.from) && outside.has(e.to)) || published.has(stretch)) return false;
      published.add(stretch);
      return true;
    });

    const lines = [...exemptWays.map((w) => w.positions), ...exemptEdges.map((e) => e.segment)];
    if (lines.length === 0) {
      warnings.push(`${zbe.id}: none of its exempt roads is in the OSM extract; has the query broken?`);
      return zbe;
    }
    return { ...zbe, exemptCorridors: { type: "MultiLineString" as const, coordinates: lines } };
  });
  return { zbes, warnings };
}

/** Roads a car drives on, other than ramps: where a ramp shares a node with one, it meets the street network. */
const CAR_ROADS = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "road"]);

const isRamp = (way: Way) => /_link$/.test(way.tags.highway ?? "");

const refsOf = (way: Way) => (way.tags.ref ?? "").split(";").map((r) => r.trim());

/** The ramp's edges in every direction its `oneway` allows; a ramp with no `oneway` can be driven both ways. */
function edgesOf(way: Way): Edge[] {
  const oneway = way.tags.oneway;
  const forward = oneway !== "-1";
  const backward = !["yes", "true", "1"].includes(oneway ?? "");
  const edges: Edge[] = [];
  for (let i = 0; i + 1 < way.nodes.length; i++) {
    const [a, b] = [way.nodes[i]!, way.nodes[i + 1]!];
    const [p, q] = [way.positions[i]!, way.positions[i + 1]!];
    if (forward) edges.push({ from: a, to: b, segment: [p, q] });
    if (backward) edges.push({ from: b, to: a, segment: [q, p] });
  }
  return edges;
}

/**
 * "forward": the edges a car can reach along ramps alone, starting at an end. "backward": the edges
 * from which it can go on to an end. It never turns back along the edge it came by (so a two-way
 * dead end leads nowhere), and never passes through a junction with the ZBE's streets.
 */
function drivable(edges: Edge[], ends: Set<number>, junctions: Set<number>, direction: "forward" | "backward"): Set<Edge> {
  const [near, far] = direction === "forward" ? (["from", "to"] as const) : (["to", "from"] as const);
  const byNear = new Map<number, Edge[]>();
  for (const e of edges) byNear.set(e[near], [...(byNear.get(e[near]) ?? []), e]);
  const found = new Set(edges.filter((e) => ends.has(e[near])));
  const queue = [...found];
  while (queue.length > 0) {
    const e = queue.pop()!;
    const node = e[far];
    if (junctions.has(node) && !ends.has(node)) continue;
    for (const next of byNear.get(node) ?? []) {
      const turnsBack = next[far] === e[near];
      if (!turnsBack && !found.has(next)) {
        found.add(next);
        queue.push(next);
      }
    }
  }
  return found;
}
