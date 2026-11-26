import { difference, union, type Polygon, type Position } from "./geometry";

/** An Overpass API JSON response to a `boundary=low_emission_zone` query with `out geom`. */
export interface OverpassResponse {
  elements: OverpassElement[];
}

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  /** Ways only: the way's nodes. */
  geometry?: OverpassNode[];
  /** Relations only, each member way with its nodes. */
  members?: { type: string; ref: number; role: string; geometry?: OverpassNode[] }[];
}

interface OverpassNode {
  lat: number;
  lon: number;
}

/** One ZBE mapped in OSM as a closed way or a boundary relation (OSM's `boundary=low_emission_zone`). */
export interface OsmZbe {
  /** "osm:relation/<id>" or "osm:way/<id>": stable across rebuilds. */
  id: string;
  name: string;
  /** OSM's `start_date` or `opening_date`: "YYYY", "YYYY-MM" or "YYYY-MM-DD". */
  startDate?: string;
  perimeter: Polygon[];
}

/**
 * The ZBEs of an Overpass extract. A way counts as a ZBE of its own only when no relation in
 * the extract uses it; a ZBE whose ways don't join into closed rings is left out, with a problem.
 */
export function parseOsmZbes(response: OverpassResponse): { zbes: OsmZbe[]; problems: string[] } {
  const zbes: OsmZbe[] = [];
  const problems: string[] = [];
  const relations = response.elements.filter((e) => e.type === "relation");
  const memberWays = new Set(relations.flatMap((r) => (r.members ?? []).filter((m) => m.type === "way").map((m) => m.ref)));
  for (const element of response.elements) {
    if (element.type === "way" && memberWays.has(element.id)) continue;
    if (element.type !== "way" && element.type !== "relation") continue;
    const id = `osm:${element.type}/${element.id}`;
    const ways =
      element.type === "way"
        ? [{ role: "outer", line: toPositions(element.geometry ?? []) }]
        : (element.members ?? [])
            .filter((m) => m.type === "way")
            .map((m) => ({ role: m.role === "inner" ? "inner" : "outer", line: toPositions(m.geometry ?? []) }));
    const outer = joinRings(ways.filter((w) => w.role === "outer").map((w) => w.line));
    const inner = joinRings(ways.filter((w) => w.role === "inner").map((w) => w.line));
    if (!outer || !inner || outer.length === 0) {
      problems.push(`${id}: its ways don't join into closed rings; left out`);
      continue;
    }
    const tags = element.tags ?? {};
    const polygons = (rings: Position[][]) => union(...rings.map((ring) => [[ring]]));
    zbes.push({
      id,
      name: tags.short_name ?? tags.name ?? id,
      startDate: tags.start_date ?? tags.opening_date,
      perimeter: difference(polygons(outer), polygons(inner)),
    });
  }
  return { zbes, problems };
}

const toPositions = (nodes: OverpassNode[]): Position[] => nodes.map((n) => [n.lon, n.lat]);

const samePosition = (a: Position | undefined, b: Position | undefined) => !!a && !!b && a[0] === b[0] && a[1] === b[1];
const isClosed = (line: Position[]) => line.length >= 4 && samePosition(line[0], line[line.length - 1]);

/** Joins ways that share end nodes into closed rings, or null if some ring never closes. */
function joinRings(lines: Position[][]): Position[][] | null {
  const pending = lines.filter((l) => l.length > 0);
  const rings: Position[][] = [];
  while (pending.length > 0) {
    let ring = pending.shift()!;
    while (!isClosed(ring)) {
      const end = ring[ring.length - 1];
      const next = pending.findIndex((l) => samePosition(l[0], end) || samePosition(l[l.length - 1], end));
      if (next < 0) return null;
      const [line] = pending.splice(next, 1) as [Position[]];
      ring = ring.concat(samePosition(line[0], end) ? line.slice(1) : line.slice(0, -1).reverse());
    }
    rings.push(ring);
  }
  return rings;
}
