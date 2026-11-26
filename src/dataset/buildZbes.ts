import {
  ENVIRONMENTAL_LABELS,
  isInsidePolygon,
  type EnvironmentalLabel,
  type RestrictionWindow,
  type Zbe,
  type ZbeDataset,
} from "../domain/zbe";
import { parseDgtZbes } from "./dgt";
import { areaM2, difference, intersection, toMultiPolygon, union, widestM, type Polygon, type Position } from "./geometry";
import { parseOsmZbes, type OverpassResponse } from "./osm";

export interface RestrictionTableEntry {
  name: string;
  restrictionWindow: RestrictionWindow;
  barredLabels: EnvironmentalLabel[];
}

/** The hand-maintained Restriction Windows and barred Environmental Labels, keyed by DGT ZBE id (or OSM id for a ZBE only OSM has). */
export type RestrictionTable = Record<string, RestrictionTableEntry>;

/** A hand-made decision on one disputed area, applied after everything else. */
export interface Settlement {
  /** The id of the ZBE the disputed area belongs to. */
  zbe: string;
  /** [lng, lat] of any point inside the disputed area: it survives the small shifts of each rebuild. */
  point: Position;
  verdict: "inside" | "outside";
  /** Why, and where it was checked (e.g. the ordinance's map). */
  note: string;
}

/**
 * The ZBE part of the dataset build: every active ZBE of the given provinces in the DGT NAP
 * DATEX II feed (the source of truth for perimeters), with its Restriction Window and barred Environmental Labels taken
 * from the hand-maintained table. DGT's own times and label lists are ignored: the times are
 * mislabelled UTC with no weekdays, and the label lists mean "barred" in some files and
 * "allowed" in others.
 */
export function buildZbeDataset(input: {
  dgtFiles: string[];
  /** OSM `boundary=low_emission_zone` within the published area, which fills in ZBEs missing from DGT. */
  osm?: OverpassResponse;
  restrictionTable: RestrictionTable;
  /** Hand-made decisions on disputed areas. */
  settlements?: Settlement[];
  /** Two-digit INE province codes whose ZBEs are published, e.g. Catalonia's "08", "17", "25", "43". */
  provinces: string[];
  /** A DGT/OSM difference becomes a disputed area when larger than this, in m²… */
  disputedAreaMinM2?: number;
  /** …and wide enough somewhere to hold a circle this wide, in m. */
  disputedAreaMinWidthM?: number;
  builtAt: Date;
}): { dataset: ZbeDataset; warnings: string[] } {
  const zbes: Zbe[] = [];
  const warnings: string[] = [];
  /** ZBEs DGT lists as inactive: OSM may still draw them, but must not bring them back. */
  const inactiveInDgt: Polygon[][] = [];
  for (const file of input.dgtFiles) {
    for (const dgt of parseDgtZbes(file)) {
      if (dgt.status !== "active") {
        if (dgt.polygons.every((ring) => ring.every(isLngLat))) inactiveInDgt.push(dgt.polygons.map((ring) => [closed(ring)]));
        continue;
      }
      const province = provinceOf(dgt.id);
      if (province == null) {
        warnings.push(`${dgt.id}: no INE code to tell its province; published to be safe`);
      } else if (!input.provinces.includes(province)) {
        continue;
      }
      if (!dgt.polygons.every((ring) => ring.every(isLngLat))) {
        warnings.push(`${dgt.id}: perimeter is not in latitude and longitude; left out`);
        continue;
      }
      zbes.push(withRestrictions(dgt.id, dgt.name, { type: "MultiPolygon", coordinates: dgt.polygons.map((ring) => [closed(ring)]) }));
    }
  }
  const osm = parseOsmZbes(input.osm ?? { elements: [] });
  warnings.push(...osm.problems);
  const fromDgt = [...zbes];
  /** For each DGT ZBE that OSM also has, OSM's perimeters of it. */
  const osmDrawings = new Map<Zbe, Polygon[][]>();
  for (const { id, name, startDate, perimeter } of osm.zbes) {
    const sameAs = fromDgt.filter((zbe) => isSameZbe(zbe.perimeter.coordinates, perimeter));
    if (sameAs.length === 0) {
      if (!isInForce(startDate, input.builtAt) || inactiveInDgt.some((p) => isSameZbe(p, perimeter))) continue;
      zbes.push(withRestrictions(id, name, toMultiPolygon(perimeter)));
      continue;
    }
    // DGT is the source of truth for every ZBE it has; OSM's perimeter only raises disputes.
    for (const zbe of sameAs) osmDrawings.set(zbe, [...(osmDrawings.get(zbe) ?? []), perimeter]);
  }
  const minArea = input.disputedAreaMinM2 ?? DISPUTED_AREA_MIN_M2;
  const minWidth = input.disputedAreaMinWidthM ?? DISPUTED_AREA_MIN_WIDTH_M;
  const unusedSettlements = new Set(input.settlements);
  for (const [zbe, drawings] of osmDrawings) {
    const dgtPerimeter = zbe.perimeter.coordinates;
    const osmPerimeter = union(...drawings);
    const isLarge = (piece: Polygon) => areaM2([piece]) > minArea && widestM(piece) >= minWidth;
    const pieces = [
      ...difference(osmPerimeter, dgtPerimeter).filter(isLarge).map((piece) => ({ piece, onlyIn: "osm" })),
      ...difference(dgtPerimeter, osmPerimeter).filter(isLarge).map((piece) => ({ piece, onlyIn: "dgt" })),
    ];
    let perimeter = dgtPerimeter;
    const disputed: Polygon[] = [];
    for (const { piece, onlyIn } of pieces) {
      const settlement = (input.settlements ?? []).find(
        (s) => s.zbe === zbe.id && isInsidePolygon(s.point[0], s.point[1], piece),
      );
      if (!settlement) {
        disputed.push(piece);
        continue;
      }
      unusedSettlements.delete(settlement);
      // Settlements win over DGT too: a checked ordinance can correct either source.
      if (settlement.verdict === "inside" && onlyIn === "osm") perimeter = union(perimeter, [piece]);
      if (settlement.verdict === "outside" && onlyIn === "dgt") perimeter = difference(perimeter, [piece]);
    }
    zbe.perimeter = toMultiPolygon(perimeter);
    if (disputed.length > 0) zbe.disputedAreas = toMultiPolygon(disputed);
  }
  for (const s of unusedSettlements) {
    warnings.push(`${s.zbe} at ${s.point.join(", ")}: the settlement matches no disputed area; remove it`);
  }
  const published = new Set(zbes.map((z) => z.id));
  for (const id of Object.keys(input.restrictionTable)) {
    if (!published.has(id)) warnings.push(`${id}: in the Restriction Window table but not a published ZBE`);
  }
  return { dataset: { builtAt: input.builtAt.toISOString(), zbes }, warnings };

  function withRestrictions(id: string, sourceName: string, perimeter: Zbe["perimeter"]): Zbe {
    let entry = input.restrictionTable[id];
    if (!entry) {
      warnings.push(`${id}: not in the Restriction Window table; published with the worst case`);
      entry = { name: sourceName, ...WORST_CASE };
    }
    return { id, name: entry.name, perimeter, restrictionWindow: entry.restrictionWindow, barredLabels: entry.barredLabels };
  }
}

/**
 * DGT and OSM perimeters typically disagree by 5–30 m along their edges, in strips that can
 * add up to hectares. A disputed area must be over half a hectare and, somewhere, at least
 * 30 m across: that leaves out the strips but keeps whole blocks drawn on one side only.
 */
const DISPUTED_AREA_MIN_M2 = 5_000;
const DISPUTED_AREA_MIN_WIDTH_M = 30;

/**
 * For a ZBE nobody has reviewed yet: barred all day, every day, for every label but zero
 * emissions. A wrong "restricted" costs an unneeded park-and-ride; a wrong "unrestricted"
 * costs a fine (the same trade-off as ADR-0003).
 */
const WORST_CASE: Omit<RestrictionTableEntry, "name"> = {
  restrictionWindow: { weekdays: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "24:00" },
  barredLabels: ENVIRONMENTAL_LABELS.filter((l) => l !== "0"),
};

/**
 * Whether two perimeters are the same ZBE drawn twice: they overlap by at least half of the
 * smaller one. Neighbouring ZBEs that only share a border (Gavà and Viladecans) are not.
 */
function isSameZbe(a: Polygon[], b: Polygon[]): boolean {
  return areaM2(intersection(a, b)) >= 0.5 * Math.min(areaM2(a), areaM2(b));
}

/** Whether an OSM start date ("YYYY", "YYYY-MM" or "YYYY-MM-DD") has come; an unreadable one counts as in force. */
function isInForce(startDate: string | undefined, at: Date): boolean {
  if (!startDate || !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(startDate)) return true;
  return startDate <= at.toISOString().slice(0, startDate.length);
}

/** DGT ids start with the INE municipality code, whose first two digits are the province ("8019_…" is 08019). */
function provinceOf(dgtId: string): string | null {
  const ine = /^(\d{4,5})_/.exec(dgtId)?.[1];
  return ine ? ine.padStart(5, "0").slice(0, 2) : null;
}

const isLngLat = ([lng, lat]: [number, number]) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

function closed(ring: [number, number][]): [number, number][] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first && last && (first[0] !== last[0] || first[1] !== last[1]) ? [...ring, first] : ring;
}
