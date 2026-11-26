import { XMLParser } from "fast-xml-parser";

/** One controlledZone of a DGT NAP DATEX II v3 ControlledZoneTablePublication, as DGT gives it. */
export interface DgtZbe {
  id: string;
  name: string;
  status: string;
  /** One closed ring of [lng, lat] per DGT polygon; DGT polygons have no holes. */
  polygons: [number, number][][];
}

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  isArray: (name) => ["controlledZoneTable", "controlledZone", "openlrPolygonCorners", "openlrCoordinates", "value"].includes(name),
});

type XmlNode = Record<string, unknown>;

export function parseDgtZbes(xml: string): DgtZbe[] {
  const doc = parser.parse(xml) as XmlNode;
  // Some files split their zones over several tables.
  const tables = ((doc.payload as XmlNode | undefined)?.controlledZoneTable ?? []) as XmlNode[];
  const zones = tables.flatMap((t) => (t.controlledZone ?? []) as XmlNode[]);
  return zones.map((zone) => ({
    id: String(zone["@id"]),
    name: firstValue(zone.name),
    status: String(zone.status ?? ""),
    polygons: findAll(zone, "openlrPolygonCorners").map((corners) =>
      ((corners.openlrCoordinates ?? []) as XmlNode[]).map((c): [number, number] => [
        Number(c.longitude),
        Number(c.latitude),
      ]),
    ),
  }));
}

function firstValue(multilingual: unknown): string {
  const values = ((multilingual as XmlNode | undefined)?.values as XmlNode | undefined)?.value as unknown[] | undefined;
  const first = values?.[0];
  return typeof first === "object" && first != null ? String((first as XmlNode)["#text"] ?? "") : String(first ?? "");
}

/** Every element called `name` anywhere below `node`, in document order. */
function findAll(node: unknown, name: string): XmlNode[] {
  if (Array.isArray(node)) return node.flatMap((n) => findAll(n, name));
  if (typeof node !== "object" || node == null) return [];
  return Object.entries(node).flatMap(([key, child]) =>
    key === name ? (Array.isArray(child) ? (child as XmlNode[]) : [child as XmlNode]) : findAll(child, name),
  );
}
