/**
 * Dataset build, ZBE part: fetches every ZBE file of the DGT NAP DATEX II feed, keeps the
 * Catalan ZBEs, applies the hand-maintained Restriction Window table and writes the
 * published dataset.
 *
 *   npm run data:zbes
 *
 * Any fetch failure aborts the build, so the previously published dataset stays in place
 * rather than one silently missing a ZBE.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { buildZbeDataset } from "../src/dataset/buildZbes";
import { restrictionTable } from "../src/dataset/restrictionTable";

/** The NAP lists one DATEX II resource per ZBE file; this page links them all. */
const NAP_DATASET_PAGE = "https://nap.dgt.es/en/dataset/zonas-de-bajas-emisiones";
const OUTPUT = new URL("../public/data/zbes.json", import.meta.url);
const HEADERS = { "user-agent": "dataset-build" };
/** ZBEar covers Catalonia: the INE province codes of Barcelona, Girona, Lleida and Tarragona. */
const CATALONIA = ["08", "17", "25", "43"];

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

  const { dataset, warnings } = buildZbeDataset({
    dgtFiles,
    restrictionTable,
    provinces: CATALONIA,
    builtAt: new Date(),
  });
  for (const w of warnings) console.warn(`warning: ${w}`);

  await mkdir(new URL(".", OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(dataset));
  console.log(`${dataset.zbes.length} ZBEs from ${urls.length} DGT files → ${OUTPUT.pathname}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
