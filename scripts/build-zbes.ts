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
import { buildZbeDataset } from "../src/dataset/buildZbes";
import type { OverpassResponse } from "../src/dataset/osm";
import { restrictionTable } from "../src/dataset/restrictionTable";
import { settlements } from "../src/dataset/settlements";

/** The NAP lists one DATEX II resource per ZBE file; this page links them all. */
const NAP_DATASET_PAGE = "https://nap.dgt.es/en/dataset/zonas-de-bajas-emisiones";
const OUTPUT = new URL("../public/data/zbes.json", import.meta.url);
const HEADERS = { "user-agent": "dataset-build" };
/** ZBEar covers Catalonia: the INE province codes of Barcelona, Girona, Lleida and Tarragona. */
const CATALONIA = ["08", "17", "25", "43"];
const OVERPASS = "https://overpass-api.de/api/interpreter";
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

  const osmRes = await fetch(OVERPASS, { method: "POST", headers: HEADERS, body: new URLSearchParams({ data: OSM_QUERY }) });
  if (!osmRes.ok) throw new Error(`${OVERPASS}: HTTP ${osmRes.status}`);
  const osm = (await osmRes.json()) as OverpassResponse & { remark?: string };
  // Overpass reports a timeout or memory limit as a remark beside a partial (or empty) result.
  if (osm.remark) throw new Error(`${OVERPASS}: ${osm.remark}`);
  if (osm.elements.length === 0) throw new Error(`${OVERPASS}: no low emission zones in Catalonia: has the query broken?`);

  const { dataset, warnings } = buildZbeDataset({
    dgtFiles,
    osm,
    restrictionTable,
    settlements,
    provinces: CATALONIA,
    builtAt: new Date(),
  });
  for (const w of warnings) console.warn(`warning: ${w}`);

  await mkdir(new URL(".", OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(dataset));
  const disputed = dataset.zbes.reduce((n, z) => n + (z.disputedAreas?.coordinates.length ?? 0), 0);
  console.log(
    `${dataset.zbes.length} ZBEs (${dataset.zbes.filter((z) => z.id.startsWith("osm:")).length} only in OSM), ` +
      `${disputed} disputed areas, from ${urls.length} DGT files → ${OUTPUT.pathname}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
