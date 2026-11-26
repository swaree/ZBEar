/**
 * Dataset build, Discovered Parking Candidates part: fetches every OSM car park and transit
 * stop in Catalonia, keeps the car parks outside every published ZBE, near a stop and open to
 * the public, merges neighbours, and writes the published dataset.
 *
 *   npm run data:candidates   (after npm run data:zbes, whose ZBEs it reads)
 *
 * Any fetch failure aborts the build, so the previously published dataset stays in place.
 */
import { readFile, writeFile } from "node:fs/promises";
import { buildParkingCandidates, TRANSIT_STOP_TAGS, type OverpassPlace } from "../src/dataset/buildParkingCandidates";
import type { ZbeDataset } from "../src/domain/zbe";
import { queryOverpass } from "./overpass";

const ZBES = new URL("../public/data/zbes.json", import.meta.url);
const OUTPUT = new URL("../public/data/parking-candidates.json", import.meta.url);
/**
 * Every car park and every transit stop (any mode) in Catalonia. Nodes come with their
 * position, ways and relations with their center: the build needs no more geometry than that.
 */
const OSM_QUERY = `[out:json][timeout:300];
area["ISO3166-2"="ES-CT"]["admin_level"="4"]->.catalonia;
(
  nwr["amenity"="parking"](area.catalonia);
${Object.entries(TRANSIT_STOP_TAGS)
  .map(([key, values]) => `  nwr["${key}"~"^(${values.join("|")})$"](area.catalonia);`)
  .join("\n")}
)->.all;
node.all;
out qt;
(way.all; relation.all;);
out tags center qt;`;

async function main() {
  const zbes = JSON.parse(await readFile(ZBES, "utf8")) as ZbeDataset;
  if (zbes.zbes.length === 0) throw new Error(`${ZBES.pathname} has no ZBEs: run npm run data:zbes first`);

  const osm = { elements: await queryOverpass<OverpassPlace>(OSM_QUERY, "car parks or transit stops in Catalonia") };
  const carParks = osm.elements.filter((e) => e.tags?.amenity === "parking").length;
  if (carParks === 0) throw new Error("Overpass returned no car parks in Catalonia: has the query broken?");

  const { dataset } = buildParkingCandidates({ osm, zbes: zbes.zbes, builtAt: new Date() });

  await writeFile(OUTPUT, JSON.stringify(dataset));
  const perKind = new Map<string, number>();
  for (const c of dataset.candidates) perKind.set(c.kind, (perKind.get(c.kind) ?? 0) + 1);
  const kinds = [...perKind].map(([kind, n]) => `${n} ${kind}`);
  console.log(
    `${dataset.candidates.length} Discovered Parking Candidates (${kinds.join(", ")}) ` +
      `from ${carParks} car parks and ${osm.elements.length - carParks} transit stops → ${OUTPUT.pathname}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
