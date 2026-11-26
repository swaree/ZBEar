import type { ZbeDataset } from "../domain/zbe";

/** The published ZBE dataset, built by `npm run data:zbes` and served next to the app. */
export async function loadZbeDataset(): Promise<ZbeDataset> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/zbes.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ZbeDataset;
}
