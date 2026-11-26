import { describe, expect, it } from "vitest";
import { buildZbeDataset, type RestrictionTable } from "./buildZbes";
import granollers from "./fixtures/dgt/Granollers.xml?raw";
import mataro from "./fixtures/dgt/Mataro.xml?raw";
import alicante from "./fixtures/dgt/Alicante.xml?raw";
import sevillaCartuja from "./fixtures/dgt/SevillaCartuja.xml?raw";

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
