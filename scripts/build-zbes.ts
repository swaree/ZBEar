/**
 * Dataset build, ZBE part: fetches every ZBE file of the DGT NAP DATEX II feed and OSM's
 * Catalan low emission zones, keeps the Catalan ZBEs, fills in the ones DGT lacks from OSM,
 * marks where the two disagree as disputed, applies the hand-maintained Restriction Window
 * table and settlements, and writes the published dataset.
 *
 *   npm run data:zbes
 *
 * Any fetch failure aborts the build, so the previously published dataset stays in place
 * rather than one silently missing a ZBE.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { buildExemptCorridors, type OverpassRoad } from "../src/dataset/buildExemptCorridors";
import { buildZbeDataset } from "../src/dataset/buildZbes";
import { corridorCorrections, exemptRoads } from "../src/dataset/exemptRoads";
import { distanceM } from "../src/domain/geo";
import type { Zbe } from "../src/domain/zbe";
import type { OverpassResponse } from "../src/dataset/osm";
import { queryOverpass } from "./overpass";
import { restrictionTable } from "../src/dataset/restrictionTable";
import { settlements } from "../src/dataset/settlements";

/** The NAP lists one DATEX II resource per ZBE file; this page links them all. */
const NAP_DATASET_PAGE = "https://nap.dgt.es/en/dataset/zonas-de-bajas-emisiones";
const OUTPUT = new URL("../public/data/zbes.json", import.meta.url);
const HEADERS = { "user-agent": "dataset-build" };
/** ZBEar covers Catalonia: the INE province codes of Barcelona, Girona, Lleida and Tarragona. */
const CATALONIA = ["08", "17", "25", "43"];
/** Every low emission zone mapped in Catalonia, with the geometry of each way and relation member. */
const OSM_QUERY = `[out:json][timeout:120];
area["ISO3166-2"="ES-CT"]["admin_level"="4"]->.catalonia;
(way["boundary"="low_emission_zone"](area.catalonia); relation["boundary"="low_emission_zone"](area.catalonia););
out geom;`;

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const page = await fetchText(NAP_DATASET_PAGE);
  const urls = [...new Set(page.match(/https:\/\/[^"'\s<>]+\/ControledZonePublication\/[^"'\s<>]+\.xml/g) ?? [])];
  if (urls.length === 0) throw new Error(`No ZBE files linked from ${NAP_DATASET_PAGE}: has the page changed?`);

  const dgtFiles: string[] = [];
  for (const url of urls) dgtFiles.push(await fetchText(url)); // one at a time, to be gentle with the NAP

  const osm: OverpassResponse = {
    elements: await queryOverpass<OverpassResponse["elements"][number]>(OSM_QUERY, "low emission zones in Catalonia"),
  };

  const { dataset, warnings } = buildZbeDataset({
    dgtFiles,
    osm,
    restrictionTable,
    settlements,
    provinces: CATALONIA,
    builtAt: new Date(),
  });
  const corridors = buildExemptCorridors({
    zbes: dataset.zbes,
    osm: { elements: await fetchRoads(dataset.zbes) },
    exemptRoads,
    corrections: corridorCorrections,
  });
  dataset.zbes = corridors.zbes;
  for (const w of [...warnings, ...corridors.warnings]) console.warn(`warning: ${w}`);

  await mkdir(new URL(".", OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(dataset));
  const disputed = dataset.zbes.reduce((n, z) => n + (z.disputedAreas?.coordinates.length ?? 0), 0);
  const corridorKm = dataset.zbes.reduce((km, z) => km + lengthKm(z.exemptCorridors?.coordinates ?? []), 0);
  console.log(
    `${dataset.zbes.length} ZBEs (${dataset.zbes.filter((z) => z.id.startsWith("osm:")).length} only in OSM), ` +
      `${disputed} disputed areas, ${corridorKm.toFixed(1)} km of Exempt Corridors, from ${urls.length} DGT files → ${OUTPUT.pathname}`,
  );
}

/**
 * The OSM road ways the Exempt Corridors are built from, within the bounding box of the ZBEs
 * that have exempt roads or corrections: ways with an exempt ref (the build checks the class),
 * every ramp, every road that meets a ramp, and every corrected way. `out geom` gives each way's node ids with their positions.
 */
async function fetchRoads(zbes: Zbe[]): Promise<OverpassRoad[]> {
  const ids = new Set([...Object.keys(exemptRoads), ...corridorCorrections.map((c) => c.zbe)]);
  const corners = zbes.filter((z) => ids.has(z.id)).flatMap((z) => z.perimeter.coordinates.flat(2));
  if (corners.length === 0) return [];
  const lngs = corners.map(([lng]) => lng);
  const lats = corners.map(([, lat]) => lat);
  const bbox = [Math.min(...lats), Math.min(...lngs), Math.max(...lats), Math.max(...lngs)].join(",");
  const refs = [...new Set(Object.values(exemptRoads).flatMap((roads) => roads.map((r) => escapeRegExp(r.ref))))];
  const wayIds = corridorCorrections.map((c) => c.way);
  const query = `[out:json][timeout:300];
(
  way["highway"]["ref"~"(^|; ?)(${refs.join("|")})($|;)"](${bbox});
  way["highway"~"_link$"](${bbox});
${wayIds.length > 0 ? `  way(id:${wayIds.join(",")});\n` : ""})->.roads;
way.roads["highway"~"_link$"]->.ramps;
node(w.ramps)->.rampNodes;
(.roads; way(bn.rampNodes)["highway"];);
out geom;`;
  return queryOverpass<OverpassRoad>(query, "exempt roads or ramps");
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function lengthKm(lines: [number, number][][]): number {
  let m = 0;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [[lng1, lat1], [lng2, lat2]] = [line[i]!, line[i + 1]!];
      m += distanceM({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 });
    }
  }
  return m / 1000;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
