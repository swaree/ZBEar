const OVERPASS = "https://overpass-api.de/api/interpreter";

/**
 * Runs an Overpass query and returns its elements. Throws on any failure, including the
 * timeouts and memory limits Overpass reports as a remark beside a partial (or empty) result,
 * and on an empty result, which `what` names (e.g. "low emission zones in Catalonia").
 */
export async function queryOverpass<T>(query: string, what: string): Promise<T[]> {
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: { "user-agent": "dataset-build" },
    body: new URLSearchParams({ data: query }),
  });
  if (!res.ok) throw new Error(`${OVERPASS}: HTTP ${res.status}`);
  const body = (await res.json()) as { elements: T[]; remark?: string };
  if (body.remark) throw new Error(`${OVERPASS}: ${body.remark}`);
  if (body.elements.length === 0) throw new Error(`${OVERPASS}: no ${what}: has the query broken?`);
  return body.elements;
}
