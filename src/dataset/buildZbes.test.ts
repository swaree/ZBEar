import { describe, expect, it } from "vitest";
import { buildZbeDataset, type RestrictionTable, type Settlement } from "./buildZbes";
import granollers from "./fixtures/dgt/Granollers.xml?raw";
import mataro from "./fixtures/dgt/Mataro.xml?raw";
import alicante from "./fixtures/dgt/Alicante.xml?raw";
import sevillaCartuja from "./fixtures/dgt/SevillaCartuja.xml?raw";
import osmCastelldefels from "./fixtures/osm/Castelldefels.json";
import osmGranollers from "./fixtures/osm/Granollers.json";
import osmMataro from "./fixtures/osm/Mataro.json";
import { isInsideAnyZbe } from "../domain/zbe";

const MON_FRI = [1, 2, 3, 4, 5] as const;
const builtAt = new Date("2026-11-26T12:00:00Z");
/** INE province codes: Barcelona, Girona, Lleida, Tarragona. */
const CATALONIA = ["08", "17", "25", "43"];

/** Granollers' perimeter as written in its DGT file, [lng, lat]. */
const GRANOLLERS_RING: [number, number][] = [
  [2.2904458, 41.602875],
  [2.2907567, 41.61001],
  [2.2838738, 41.610798],
  [2.283485, 41.61056],
  [2.2828119, 41.602432],
  [2.2878351, 41.60322],
  [2.2904458, 41.602875],
];

describe("ZBE dataset build", () => {
  it("publishes a ZBE from the DGT feed with its perimeter, Restriction Window and barred Environmental Labels", () => {
    const restrictionTable: RestrictionTable = {
      "8096_Granollers": {
        name: "ZBE Granollers",
        restrictionWindow: { weekdays: [...MON_FRI], start: "07:00", end: "20:00" },
        barredLabels: ["none"],
      },
    };

    const { dataset } = buildZbeDataset({ dgtFiles: [granollers], restrictionTable, provinces: CATALONIA, builtAt });

    expect(dataset.builtAt).toBe("2026-11-26T12:00:00.000Z");
    expect(dataset.zbes).toEqual([
      {
        id: "8096_Granollers",
        name: "ZBE Granollers",
        perimeter: {
          type: "MultiPolygon",
          coordinates: [[GRANOLLERS_RING]],
        },
        restrictionWindow: { weekdays: [1, 2, 3, 4, 5], start: "07:00", end: "20:00" },
        barredLabels: ["none"],
      },
    ]);
  });

  it("takes Restriction Windows and barred Environmental Labels from the table, not from DGT", () => {
    // DGT says 07:00Z–20:00Z for Mataró, with no weekdays and only "Sin distintivo" listed.
    const restrictionTable: RestrictionTable = {
      "8121_ZBE Mataró": {
        name: "ZBE Mataró",
        restrictionWindow: { weekdays: [1, 2, 3, 4, 5, 6], start: "08:00", end: "19:00" },
        barredLabels: ["none", "B"],
      },
    };

    const { dataset } = buildZbeDataset({ dgtFiles: [mataro], restrictionTable, provinces: CATALONIA, builtAt });

    const zbe = dataset.zbes.find((z) => z.name === "ZBE Mataró");
    expect(zbe?.restrictionWindow).toEqual({ weekdays: [1, 2, 3, 4, 5, 6], start: "08:00", end: "19:00" });
    expect(zbe?.barredLabels).toEqual(["none", "B"]);
  });

  it("publishes a ZBE missing from the table with a worst-case Restriction Window, and warns", () => {
    const { dataset, warnings } = buildZbeDataset({ dgtFiles: [granollers], restrictionTable: {}, provinces: CATALONIA, builtAt });

    expect(dataset.zbes.map((z) => [z.id, z.restrictionWindow, z.barredLabels])).toEqual([
      [
        "8096_Granollers",
        { weekdays: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "24:00" },
        ["none", "B", "C", "ECO"],
      ],
    ]);
    expect(warnings).toEqual([expect.stringContaining("8096_Granollers")]);
  });

  it("leaves out ZBEs that DGT marks inactive", () => {
    // Alicante's file has the active "ZBE Alicante" and an inactive "Anillo 1 Casco Histórico".
    const { dataset } = buildZbeDataset({ dgtFiles: [alicante], restrictionTable: {}, provinces: ["03"], builtAt });

    expect(dataset.zbes.map((z) => z.id)).toEqual(["3014_ZBE Alicante"]);
  });

  it("keeps every polygon of a ZBE whose perimeter has several", () => {
    const { dataset } = buildZbeDataset({ dgtFiles: [sevillaCartuja], restrictionTable: {}, provinces: ["41"], builtAt });

    expect(dataset.zbes[0]?.perimeter.coordinates).toHaveLength(2);
  });

  it("closes a perimeter ring that DGT leaves open", () => {
    // Madrid's file has such a ring; here Granollers' closing corner is removed.
    const lastCorner = /<loc:openlrCoordinates>\s*<loc:latitude>41\.602875<\/loc:latitude>\s*<loc:longitude>2\.2904458<\/loc:longitude>\s*<\/loc:openlrCoordinates>\s*(?=<\/loc:openlrPolygonCorners>)/;
    expect(granollers).toMatch(lastCorner);
    const openRing = granollers.replace(lastCorner, "");

    const { dataset } = buildZbeDataset({ dgtFiles: [openRing], restrictionTable: {}, provinces: CATALONIA, builtAt });

    expect(dataset.zbes[0]?.perimeter.coordinates).toEqual([[GRANOLLERS_RING]]);
  });

  it("leaves out a ZBE whose perimeter is not in latitude and longitude, and warns", () => {
    // DGT has published projected (UTM) coordinates, e.g. Alicante's inactive Anillo 1.
    const projected = granollers.replace("<loc:latitude>41.61001</loc:latitude>", "<loc:latitude>4247009</loc:latitude>");

    const { dataset, warnings } = buildZbeDataset({ dgtFiles: [projected], restrictionTable: {}, provinces: CATALONIA, builtAt });

    expect(dataset.zbes).toEqual([]);
    expect(warnings).toEqual([expect.stringMatching(/8096_Granollers.*latitude and longitude/)]);
  });

  it("warns about a table entry that matches no ZBE in the DGT feed", () => {
    const restrictionTable: RestrictionTable = {
      "8096_Granollers": {
        name: "ZBE Granollers",
        restrictionWindow: { weekdays: [...MON_FRI], start: "07:00", end: "20:00" },
        barredLabels: ["none"],
      },
      "8096_ZBE Granollers": {
        name: "ZBE Granollers (renamed by DGT?)",
        restrictionWindow: { weekdays: [...MON_FRI], start: "07:00", end: "20:00" },
        barredLabels: ["none"],
      },
    };

    const { warnings } = buildZbeDataset({ dgtFiles: [granollers], restrictionTable, provinces: CATALONIA, builtAt });

    expect(warnings).toEqual([expect.stringContaining("8096_ZBE Granollers")]);
  });

  it("publishes only the ZBEs of the given provinces", () => {
    // DGT ids start with the INE municipality code: 8096 is Granollers (08, Barcelona), 3014 Alicante (03).
    const { dataset, warnings } = buildZbeDataset({
      dgtFiles: [granollers, alicante, sevillaCartuja],
      restrictionTable: {},
      provinces: CATALONIA,
      builtAt,
    });

    expect(dataset.zbes.map((z) => z.id)).toEqual(["8096_Granollers"]);
    expect(warnings).toEqual([expect.stringContaining("8096_Granollers")]);
  });

  it("publishes a ZBE whose province can't be told from its DGT id, and warns", () => {
    const unnumbered = granollers.replace('id="8096_Granollers"', 'id="Granollers"');

    const { dataset, warnings } = buildZbeDataset({
      dgtFiles: [unnumbered],
      restrictionTable: {},
      provinces: CATALONIA,
      builtAt,
    });

    expect(dataset.zbes.map((z) => z.id)).toEqual(["Granollers"]);
    expect(warnings).toContainEqual(expect.stringMatching(/Granollers.*province/));
  });
});

describe("ZBE dataset build, OSM gap-fill", () => {
  /** Inside Castelldefels' OSM perimeter, ~350 m from its edge; Castelldefels is not in the DGT feed. */
  const IN_CASTELLDEFELS = { lng: 1.97766, lat: 41.281933 };

  it("publishes a ZBE present only in OSM, with the worst-case Restriction Window, and warns", () => {
    const { dataset, warnings } = buildZbeDataset({
      dgtFiles: [granollers],
      osm: osmCastelldefels,
      restrictionTable: {},
      provinces: CATALONIA,
      builtAt,
    });

    const castelldefels = dataset.zbes.find((z) => z.id === "osm:relation/15052307");
    expect(castelldefels).toMatchObject({
      name: "ZBE Castelldefels",
      restrictionWindow: { weekdays: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "24:00" },
      barredLabels: ["none", "B", "C", "ECO"],
    });
    expect(isInsideAnyZbe(IN_CASTELLDEFELS, [castelldefels!])).toBe(true);
    expect(isInsideAnyZbe({ lng: 1.96, lat: 41.281933 }, [castelldefels!])).toBe(false);
    expect(warnings).toContainEqual(expect.stringMatching(/osm:relation\/15052307.*worst case/));
  });

  it("keeps DGT's perimeter for a ZBE that both DGT and OSM have", () => {
    const { dataset } = buildZbeDataset({
      dgtFiles: [granollers],
      osm: osmGranollers,
      restrictionTable: {},
      provinces: CATALONIA,
      builtAt,
    });

    expect(dataset.zbes.map((z) => [z.id, z.perimeter])).toEqual([
      ["8096_Granollers", { type: "MultiPolygon", coordinates: [[GRANOLLERS_RING]] }],
    ]);
  });

  it("publishes an OSM ZBE that only borders a DGT ZBE, as Gavà and Viladecans do", () => {
    // East of Granollers' east edge, overlapping it by ~15 m as neighbouring perimeters do.
    const neighbour = osmWay(1, { boundary: "low_emission_zone", short_name: "ZBE Neighbour" }, [
      [2.2902458, 41.602875],
      [2.295, 41.602875],
      [2.295, 41.61001],
      [2.2905567, 41.61001],
      [2.2902458, 41.602875],
    ]);

    const { dataset } = buildZbeDataset({ dgtFiles: [granollers], osm: neighbour, restrictionTable: {}, provinces: CATALONIA, builtAt });

    expect(dataset.zbes.map((z) => z.id)).toEqual(["8096_Granollers", "osm:way/1"]);
  });

  it("leaves out an OSM ZBE that DGT lists as inactive", () => {
    const inactive = granollers.replace("<conz:status>active</conz:status>", "<conz:status>inactive</conz:status>");

    const { dataset } = buildZbeDataset({ dgtFiles: [inactive], osm: osmGranollers, restrictionTable: {}, provinces: CATALONIA, builtAt });

    expect(dataset.zbes).toEqual([]);
  });

  it("leaves out an OSM ZBE that is not in force yet", () => {
    // OSM maps Badalona's ZBE ahead of its opening_date, 2027-01-01.
    const notYet = structuredClone(osmCastelldefels);
    notYet.elements[0]!.tags.start_date = "2027-01-01";

    const { dataset } = buildZbeDataset({ dgtFiles: [], osm: notYet, restrictionTable: {}, provinces: CATALONIA, builtAt });

    expect(dataset.zbes).toEqual([]);
  });

  it("leaves out an OSM ZBE whose ways don't close into a perimeter, and warns", () => {
    // The Catalan extract has a few such stray two-node ways.
    const stray = osmWay(1125257814, { boundary: "low_emission_zone" }, [
      [2.1, 41.4],
      [2.101, 41.401],
    ]);

    const { dataset, warnings } = buildZbeDataset({ dgtFiles: [], osm: stray, restrictionTable: {}, provinces: CATALONIA, builtAt });

    expect(dataset.zbes).toEqual([]);
    expect(warnings).toEqual([expect.stringMatching(/osm:way\/1125257814.*closed/)]);
  });
});

describe("ZBE dataset build, disputed areas", () => {
  /** In the ~2.2 ha that OSM's Mataró perimeter has and DGT's lacks, ~75 m from its edges. */
  const MATARO_OSM_ONLY = { lng: 2.441836, lat: 41.540119 };

  it("makes a DGT/OSM difference above the threshold a disputed area that counts as inside the ZBE", () => {
    const { dataset } = buildZbeDataset({ dgtFiles: [mataro], osm: osmMataro, restrictionTable: {}, provinces: CATALONIA, builtAt });

    const zbe = dataset.zbes.find((z) => z.id === "8121_ZBE Mataró")!;
    expect(zbe.disputedAreas?.coordinates).toHaveLength(1);
    expect(isInsideAnyZbe(MATARO_OSM_ONLY, dataset.zbes)).toBe(true);
  });

  it("leaves differences below the threshold undisputed", () => {
    // Granollers' perimeters disagree only in slivers of at most ~0.3 ha.
    const { dataset } = buildZbeDataset({ dgtFiles: [granollers], osm: osmGranollers, restrictionTable: {}, provinces: CATALONIA, builtAt });

    expect(dataset.zbes[0]?.disputedAreas).toBeUndefined();
  });

  it("leaves a long, thin difference undisputed however large its area", () => {
    // Granollers' perimeters disagree in strips 4–8 m wide; above 0.1 ha they pass on area alone.
    const { dataset } = buildZbeDataset({
      dgtFiles: [granollers],
      osm: osmGranollers,
      restrictionTable: {},
      provinces: CATALONIA,
      disputedAreaMinM2: 1_000,
      builtAt,
    });

    expect(dataset.zbes[0]?.disputedAreas).toBeUndefined();
  });

  it("makes a disputed area settled inside part of the ZBE's perimeter", () => {
    const settlements: Settlement[] = [
      { zbe: "8121_ZBE Mataró", point: [MATARO_OSM_ONLY.lng, MATARO_OSM_ONLY.lat], verdict: "inside", note: "test" },
    ];

    const { dataset } = buildZbeDataset({
      dgtFiles: [mataro],
      osm: osmMataro,
      settlements,
      restrictionTable: {},
      provinces: CATALONIA,
      builtAt,
    });

    const zbe = dataset.zbes[0]!;
    expect(zbe.disputedAreas).toBeUndefined();
    expect(isInsideAnyZbe(MATARO_OSM_ONLY, [zbe])).toBe(true);
  });

  it("leaves a disputed area settled outside out of the ZBE", () => {
    const settlements: Settlement[] = [
      { zbe: "8121_ZBE Mataró", point: [MATARO_OSM_ONLY.lng, MATARO_OSM_ONLY.lat], verdict: "outside", note: "test" },
    ];

    const { dataset } = buildZbeDataset({
      dgtFiles: [mataro],
      osm: osmMataro,
      settlements,
      restrictionTable: {},
      provinces: CATALONIA,
      builtAt,
    });

    expect(dataset.zbes[0]?.disputedAreas).toBeUndefined();
    expect(isInsideAnyZbe(MATARO_OSM_ONLY, dataset.zbes)).toBe(false);
  });

  it("cuts a disputed area that only DGT has out of the ZBE when it is settled outside", () => {
    // With the thresholds lowered, Granollers' ~0.13 ha, ~8 m wide sliver on its east edge, which only DGT includes, is disputed.
    const granollersDgtOnly = { lng: 2.290664, lat: 41.608863 };
    const granollersMiddle = { lng: 2.286784, lat: 41.605913 };
    const build = (settlements: Settlement[]) =>
      buildZbeDataset({
        dgtFiles: [granollers],
        osm: osmGranollers,
        settlements,
        restrictionTable: {},
        provinces: CATALONIA,
        disputedAreaMinM2: 1_000,
        disputedAreaMinWidthM: 0,
        builtAt,
      }).dataset.zbes;

    const unsettled = build([]);
    const settled = build([
      { zbe: "8096_Granollers", point: [granollersDgtOnly.lng, granollersDgtOnly.lat], verdict: "outside", note: "test" },
    ]);

    expect(isInsideAnyZbe(granollersDgtOnly, unsettled)).toBe(true);
    expect(isInsideAnyZbe(granollersDgtOnly, settled)).toBe(false);
    expect(isInsideAnyZbe(granollersMiddle, settled)).toBe(true);
  });

  it("warns about a settlement that matches no disputed area", () => {
    // Once OSM or DGT is corrected the disputed area goes away, and its settlement is stale.
    const { warnings } = buildZbeDataset({
      dgtFiles: [mataro],
      osm: osmMataro,
      settlements: [{ zbe: "8121_ZBE Mataró", point: [2.445963, 41.539941], verdict: "outside", note: "test" }],
      restrictionTable: {},
      provinces: CATALONIA,
      builtAt,
    });

    expect(warnings).toContainEqual(expect.stringMatching(/8121_ZBE Mataró.*2\.445963.*settlement/));
  });
});

/** An Overpass extract holding one closed way. */
function osmWay(id: number, tags: Record<string, string>, ring: [number, number][]) {
  return { elements: [{ type: "way", id, tags, geometry: ring.map(([lon, lat]) => ({ lat, lon })) }] };
}
