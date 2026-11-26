import { ENVIRONMENTAL_LABELS, type EnvironmentalLabel, type RestrictionWindow, type Zbe, type ZbeDataset } from "../domain/zbe";
import { parseDgtZbes } from "./dgt";

export interface RestrictionTableEntry {
  name: string;
  restrictionWindow: RestrictionWindow;
  barredLabels: EnvironmentalLabel[];
}

/** The hand-maintained Restriction Windows and barred Environmental Labels, keyed by DGT ZBE id. */
export type RestrictionTable = Record<string, RestrictionTableEntry>;

/**
 * The ZBE part of the dataset build: every active ZBE of the given provinces in the DGT NAP
 * DATEX II feed (the source of truth for perimeters), with its Restriction Window and barred Environmental Labels taken
 * from the hand-maintained table. DGT's own times and label lists are ignored: the times are
 * mislabelled UTC with no weekdays, and the label lists mean "barred" in some files and
 * "allowed" in others.
 */
export function buildZbeDataset(input: {
  dgtFiles: string[];
  restrictionTable: RestrictionTable;
  /** Two-digit INE province codes whose ZBEs are published, e.g. Catalonia's "08", "17", "25", "43". */
  provinces: string[];
  builtAt: Date;
}): { dataset: ZbeDataset; warnings: string[] } {
  const zbes: Zbe[] = [];
  const warnings: string[] = [];
  for (const file of input.dgtFiles) {
    for (const dgt of parseDgtZbes(file)) {
      if (dgt.status !== "active") continue;
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
      let entry = input.restrictionTable[dgt.id];
      if (!entry) {
        warnings.push(`${dgt.id}: not in the Restriction Window table; published with the worst case`);
        entry = { name: dgt.name, ...WORST_CASE };
      }
      zbes.push({
        id: dgt.id,
        name: entry.name,
        perimeter: { type: "MultiPolygon", coordinates: dgt.polygons.map((ring) => [closed(ring)]) },
        restrictionWindow: entry.restrictionWindow,
        barredLabels: entry.barredLabels,
      });
    }
  }
  const published = new Set(zbes.map((z) => z.id));
  for (const id of Object.keys(input.restrictionTable)) {
    if (!published.has(id)) warnings.push(`${id}: in the Restriction Window table but not an active ZBE in the DGT feed`);
  }
  return { dataset: { builtAt: input.builtAt.toISOString(), zbes }, warnings };
}

/**
 * For a ZBE nobody has reviewed yet: barred all day, every day, for every label but zero
 * emissions. A wrong "restricted" costs an unneeded park-and-ride; a wrong "unrestricted"
 * costs a fine (the same trade-off as ADR-0003).
 */
const WORST_CASE: Omit<RestrictionTableEntry, "name"> = {
  restrictionWindow: { weekdays: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "24:00" },
  barredLabels: ENVIRONMENTAL_LABELS.filter((l) => l !== "0"),
};

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
