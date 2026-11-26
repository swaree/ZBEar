import { describe, expect, it } from "vitest";
import { buildExemptCorridors, type CorridorCorrection, type ExemptRoadTable, type OverpassRoad } from "./buildExemptCorridors";
import { isOnExemptCorridor, type Zbe } from "../domain/zbe";

/**
 * A ZBE of ~1.7 km by 2.2 km (lng 2.10–2.12, lat 41.40–41.42), with a Ronda running east to west
 * right across it along latitude 41.41, from outside to outside.
 */
const zbe: Zbe = {
  id: "rondes",
  name: "ZBE Rondes",
  perimeter: {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [2.1, 41.4],
          [2.12, 41.4],
          [2.12, 41.42],
          [2.1, 41.42],
          [2.1, 41.4],
        ],
      ],
    ],
  },
  restrictionWindow: { weekdays: [1, 2, 3, 4, 5], start: "07:00", end: "20:00" },
  barredLabels: ["none"],
};

const exemptRoads: ExemptRoadTable = {
  rondes: [
    { ref: "B-20", highways: ["motorway", "trunk"] },
    { ref: "C-31", highways: ["motorway"] },
  ],
};

/** An OSM road way through the given nodes, each [node id, lng, lat]. */
function road(id: number, tags: Record<string, string>, ...nodes: [id: number, lng: number, lat: number][]): OverpassRoad {
  return {
    type: "way",
    id,
    tags,
    nodes: nodes.map(([n]) => n),
    geometry: nodes.map(([, lon, lat]) => ({ lat, lon })),
  };
}

/** The Ronda's main carriageway, eastbound, with a node at every place a ramp leaves or joins it. */
const ronda = road(
  1,
  { highway: "trunk", ref: "B-20", name: "Ronda de Dalt", oneway: "yes" },
  [1, 2.09, 41.41],
  [2, 2.105, 41.41],
  [3, 2.11, 41.41],
  [4, 2.115, 41.41],
  [5, 2.13, 41.41],
);

const on = (lng: number, lat: number, zbes: Zbe[]) => isOnExemptCorridor({ lng, lat }, zbes[0]!);

describe("Exempt Corridors build", () => {
  it("makes the main carriageways of the listed roads Exempt Corridors, but not a road with the same ref of another class", () => {
    // OSM tags Gran Via de les Corts Catalanes, a city avenue, C-31 too.
    const granVia = road(2, { highway: "primary", ref: "C-31", name: "Gran Via de les Corts Catalanes" }, [6, 2.09, 41.405], [7, 2.13, 41.405]);
    const autovia = road(3, { highway: "motorway", ref: "C-31;E-90", oneway: "yes" }, [8, 2.09, 41.415], [9, 2.13, 41.415]);

    const { zbes } = buildExemptCorridors({ zbes: [zbe], osm: { elements: [ronda, granVia, autovia] }, exemptRoads });

    expect(on(2.11, 41.41, zbes)).toBe(true);
    expect(on(2.11, 41.415, zbes)).toBe(true);
    expect(on(2.11, 41.405, zbes)).toBe(false);
  });

  it("exempts an exit that leads out of the ZBE, but not its branch that leads only into the ZBE", () => {
    // Leaves the Ronda at node 4 and runs north; at node 31 it forks, out over the north edge or into a city street.
    const exit = road(10, { highway: "trunk_link", oneway: "yes" }, [4, 2.115, 41.41], [30, 2.116, 41.413], [31, 2.116, 41.416]);
    const outOfTheZbe = road(11, { highway: "trunk_link", oneway: "yes" }, [31, 2.116, 41.416], [32, 2.116, 41.425]);
    const intoTheZbe = road(12, { highway: "trunk_link", oneway: "yes" }, [31, 2.116, 41.416], [33, 2.113, 41.417]);

    const { zbes } = buildExemptCorridors({ zbes: [zbe], osm: { elements: [ronda, exit, outOfTheZbe, intoTheZbe] }, exemptRoads });

    expect(on(2.1155, 41.4115, zbes)).toBe(true);
    expect(on(2.116, 41.419, zbes)).toBe(true);
    expect(on(2.1145, 41.4165, zbes)).toBe(false);
  });

  it("exempts an interchange ramp between two exempt roads, but not an exit that leads only into the ZBE", () => {
    // A second exempt road, the C-31 autovia, running north to south across the ZBE along longitude 2.103.
    const autovia = road(2, { highway: "motorway", ref: "C-31", oneway: "yes" }, [40, 2.103, 41.425], [41, 2.103, 41.413], [42, 2.103, 41.395]);
    const interchange = road(13, { highway: "motorway_link", oneway: "yes" }, [3, 2.11, 41.41], [43, 2.107, 41.412], [41, 2.103, 41.413]);
    // Ends at a city street inside the ZBE, ~350 m south of the Ronda.
    const exit = road(14, { highway: "trunk_link", oneway: "yes" }, [2, 2.105, 41.41], [44, 2.106, 41.407], [45, 2.106, 41.4065]);

    const { zbes } = buildExemptCorridors({ zbes: [zbe], osm: { elements: [ronda, autovia, interchange, exit] }, exemptRoads });

    expect(on(2.105, 41.4125, zbes)).toBe(true);
    expect(on(2.106, 41.40675, zbes)).toBe(false);
  });

  it("does not exempt an entry ramp that comes only from the ZBE's streets", () => {
    // From a city street ~650 m north of the Ronda, joining it at node 3.
    const entry = road(15, { highway: "trunk_link", oneway: "yes" }, [50, 2.109, 41.416], [51, 2.1095, 41.413], [3, 2.11, 41.41]);

    const { zbes } = buildExemptCorridors({ zbes: [zbe], osm: { elements: [ronda, entry] }, exemptRoads });

    expect(on(2.10925, 41.4145, zbes)).toBe(false);
  });

  it("does not exempt a two-way exit that leads only into the ZBE", () => {
    // A trunk_link carries no implied oneway: this one is a dead end ~350 m south of the Ronda.
    const exit = road(16, { highway: "trunk_link" }, [2, 2.105, 41.41], [44, 2.106, 41.407], [45, 2.106, 41.4065]);

    const { zbes } = buildExemptCorridors({ zbes: [zbe], osm: { elements: [ronda, exit] }, exemptRoads });

    expect(on(2.106, 41.40675, zbes)).toBe(false);
  });

  it("does not exempt an exit that leads into the ZBE's streets where an entry ramp leaves them", () => {
    // At a city junction (node 46) the exit ends and an entry back onto the Ronda starts.
    const exit = road(17, { highway: "trunk_link", oneway: "yes" }, [2, 2.105, 41.41], [44, 2.106, 41.407], [46, 2.107, 41.406]);
    const entry = road(18, { highway: "trunk_link", oneway: "yes" }, [46, 2.107, 41.406], [47, 2.109, 41.407], [3, 2.11, 41.41]);
    const street = road(19, { highway: "residential", name: "Carrer del Mig" }, [48, 2.1, 41.406], [46, 2.107, 41.406], [49, 2.12, 41.406]);

    const { zbes } = buildExemptCorridors({ zbes: [zbe], osm: { elements: [ronda, exit, entry, street] }, exemptRoads });

    expect(on(2.1065, 41.4065, zbes)).toBe(false);
    expect(on(2.108, 41.4065, zbes)).toBe(false);
  });

  it("does not exempt an exit that leads into a disputed area, which counts as inside", () => {
    // OSM draws the ZBE a few hundred metres further north than DGT; the exit ends there.
    const disputed: Zbe = {
      ...zbe,
      disputedAreas: { type: "MultiPolygon", coordinates: [[[[2.1, 41.42], [2.12, 41.42], [2.12, 41.43], [2.1, 41.43], [2.1, 41.42]]]] },
    };
    const exit = road(10, { highway: "trunk_link", oneway: "yes" }, [4, 2.115, 41.41], [30, 2.116, 41.413], [31, 2.116, 41.425]);

    const { zbes } = buildExemptCorridors({ zbes: [disputed], osm: { elements: [ronda, exit] }, exemptRoads });

    expect(on(2.116, 41.419, zbes)).toBe(false);
  });

  it("applies hand-maintained corridor corrections over the table and the ramp rule", () => {
    // A city avenue that the ordinance exempts, and a ramp from the Ronda onto it.
    const avenue = road(20, { highway: "primary", name: "Avinguda Exempta" }, [60, 2.09, 41.405], [62, 2.104, 41.405], [61, 2.13, 41.405]);
    const ramp = road(21, { highway: "trunk_link", oneway: "yes" }, [2, 2.105, 41.41], [62, 2.104, 41.405]);
    // A Ronda carriageway the ordinance doesn't exempt after all.
    const notExempt = road(22, { highway: "trunk", ref: "B-20", oneway: "yes" }, [70, 2.09, 41.415], [71, 2.13, 41.415]);
    const corrections: CorridorCorrection[] = [
      { zbe: "rondes", way: 20, verdict: "exempt", note: "test" },
      { zbe: "rondes", way: 22, verdict: "not-exempt", note: "test" },
    ];

    const { zbes } = buildExemptCorridors({ zbes: [zbe], osm: { elements: [ronda, avenue, ramp, notExempt] }, exemptRoads, corrections });

    expect(on(2.11, 41.405, zbes)).toBe(true);
    expect(on(2.1045, 41.4075, zbes)).toBe(true);
    expect(on(2.11, 41.415, zbes)).toBe(false);
  });

  it("warns about a corridor correction whose way is not in the OSM extract, or whose ZBE is not published", () => {
    const corrections: CorridorCorrection[] = [
      { zbe: "rondes", way: 999, verdict: "exempt", note: "test" },
      { zbe: "gone", way: 1, verdict: "not-exempt", note: "test" },
    ];

    const { warnings } = buildExemptCorridors({ zbes: [zbe], osm: { elements: [ronda] }, exemptRoads, corrections });

    expect(warnings).toEqual([expect.stringMatching(/rondes.*999.*no OSM way/), expect.stringMatching(/gone.*way 1.*isn't published/)]);
  });

  it("warns about an exempt road table entry for a ZBE that is not published, or whose roads are not in the OSM extract", () => {
    const { zbes, warnings } = buildExemptCorridors({
      zbes: [zbe],
      osm: { elements: [] },
      exemptRoads: { ...exemptRoads, gone: [{ ref: "B-10", highways: ["trunk"] }] },
    });

    expect(zbes[0]?.exemptCorridors).toBeUndefined();
    expect(warnings).toEqual([expect.stringMatching(/gone.*not a published ZBE/), expect.stringMatching(/rondes.*none of its exempt roads/)]);
  });
});
