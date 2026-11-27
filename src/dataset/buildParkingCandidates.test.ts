import { describe, expect, it } from "vitest";
import { buildParkingCandidates, type OverpassPlace } from "./buildParkingCandidates";
import type { Zbe } from "../domain/zbe";

const builtAt = new Date("2026-11-26T12:00:00Z");

/** Degrees of latitude per metre, near enough for placing things a few hundred metres apart. */
const M = 1 / 111_320;

/** Sant Feliu de Llobregat station, far outside the Barcelona ZBE's perimeter in these tests. */
const STATION = { lat: 41.383, lon: 2.0479 };

const busStop = (id: number, lat: number, lon: number, name = `Stop ${id}`): OverpassPlace => ({
  type: "node",
  id,
  lat,
  lon,
  tags: { highway: "bus_stop", name },
});

const carParkWay = (id: number, lat: number, lon: number, tags: Record<string, string> = {}): OverpassPlace => ({
  type: "way",
  id,
  center: { lat, lon },
  tags: { amenity: "parking", ...tags },
});

/** An underground or multi-storey car park's way in, which OSM sometimes maps instead of the car park itself. */
const parkingEntrance = (id: number, lat: number, lon: number, tags: Record<string, string> = {}): OverpassPlace => ({
  type: "node",
  id,
  lat,
  lon,
  tags: { amenity: "parking_entrance", parking: "underground", ...tags },
});

describe("Discovered Parking Candidates build", () => {
  it("publishes a public car park near a transit stop as a Discovered Parking Candidate", () => {
    const osm = {
      elements: [
        busStop(1, STATION.lat, STATION.lon),
        carParkWay(123, STATION.lat + 200 * M, STATION.lon, { name: "Aparcament Estació", fee: "yes", maxstay: "4 hours" }),
      ],
    };

    const { dataset } = buildParkingCandidates({ osm, zbes: [], builtAt });

    expect(dataset).toEqual({
      builtAt: "2026-11-26T12:00:00.000Z",
      candidates: [
        {
          id: "osm:way/123",
          name: "Aparcament Estació",
          location: { lat: STATION.lat + 200 * M, lng: STATION.lon },
          kind: "car-park",
          conditions: { fee: "yes", maxStay: "4 hours" },
        },
      ],
    });
  });

  it("leaves out a car park inside a ZBE, and one in a ZBE's disputed area", () => {
    // A ZBE square of ~1 km a side, with a disputed strip along its north edge.
    const south = STATION.lat;
    const west = STATION.lon;
    const side = 0.01;
    const zbe = squareZbe("zbe", south, west, side, { disputed: { south: south + side, height: 0.002 } });
    const osm = {
      elements: [
        busStop(1, south + side / 2, west + side / 2),
        busStop(2, south + side + 0.001, west + side / 2),
        busStop(3, south - 0.002, west + side / 2),
        carParkWay(10, south + side / 2, west + side / 2, { name: "Inside" }),
        carParkWay(11, south + side + 0.001, west + side / 2, { name: "In the disputed area" }),
        carParkWay(12, south - 0.002, west + side / 2, { name: "Outside" }),
      ],
    };

    const { dataset } = buildParkingCandidates({ osm, zbes: [zbe], builtAt });

    expect(dataset.candidates.map((c) => c.name)).toEqual(["Outside"]);
  });

  it("leaves out a car park more than ~500 m from any transit stop", () => {
    const osm = {
      elements: [
        busStop(1, STATION.lat, STATION.lon),
        carParkWay(10, STATION.lat + 450 * M, STATION.lon, { name: "450 m from the stop" }),
        carParkWay(11, STATION.lat - 650 * M, STATION.lon, { name: "650 m from the stop" }),
      ],
    };

    const { dataset } = buildParkingCandidates({ osm, zbes: [], builtAt });

    expect(dataset.candidates.map((c) => c.name)).toEqual(["450 m from the stop"]);
  });

  it("takes the distance to a transit stop as a build parameter", () => {
    const osm = {
      elements: [busStop(1, STATION.lat, STATION.lon), carParkWay(10, STATION.lat + 450 * M, STATION.lon)],
    };

    const { dataset } = buildParkingCandidates({ osm, zbes: [], builtAt, maxStopDistanceM: 300 });

    expect(dataset.candidates).toEqual([]);
  });

  it("counts any mode's stop as a transit stop: rail, metro, tram and bus", () => {
    const stops: OverpassPlace[] = [
      { type: "node", id: 1, lat: STATION.lat, lon: STATION.lon, tags: { railway: "station", name: "Rodalies" } },
      { type: "node", id: 2, lat: STATION.lat + 0.02, lon: STATION.lon, tags: { railway: "tram_stop", name: "TRAM" } },
      { type: "node", id: 3, lat: STATION.lat + 0.04, lon: STATION.lon, tags: { public_transport: "platform", name: "Bus" } },
      { type: "way", id: 4, center: { lat: STATION.lat + 0.06, lon: STATION.lon }, tags: { railway: "platform", name: "FGC" } },
      // Not a transit stop: a car park needs one nearby of its own.
      { type: "node", id: 5, lat: STATION.lat + 0.08, lon: STATION.lon, tags: { amenity: "fuel" } },
    ];
    const carParks = [0, 0.02, 0.04, 0.06, 0.08].map((dLat, i) =>
      carParkWay(10 + i, STATION.lat + dLat + 100 * M, STATION.lon, { name: `Car park ${i}` }),
    );

    const { dataset } = buildParkingCandidates({ osm: { elements: [...stops, ...carParks] }, zbes: [], builtAt });

    expect(dataset.candidates.map((c) => c.name)).toEqual(["Car park 0", "Car park 1", "Car park 2", "Car park 3"]);
  });

  it("leaves out private car parks: private, customers only, permit holders only, no access", () => {
    const access = ["private", "customers", "permit", "no", "yes", "public"];
    const osm = {
      elements: [
        busStop(1, STATION.lat, STATION.lon),
        // A kilometre apart, so none merges with another.
        ...access.map((value, i) => carParkWay(10 + i, STATION.lat, STATION.lon + i * 0.012, { name: value, access: value })),
        ...access.map((_, i) => busStop(20 + i, STATION.lat, STATION.lon + i * 0.012)),
      ],
    };

    const { dataset } = buildParkingCandidates({ osm, zbes: [], builtAt });

    expect(dataset.candidates.map((c) => c.name)).toEqual(["yes", "public"]);
  });

  it("keeps a resident-only car park, with resident-only as a Parking Condition", () => {
    const osm = {
      elements: [busStop(1, STATION.lat, STATION.lon), carParkWay(10, STATION.lat, STATION.lon, { access: "residents" })],
    };

    const { dataset } = buildParkingCandidates({ osm, zbes: [], builtAt });

    expect(dataset.candidates.map((c) => c.conditions)).toEqual([{ access: "residents" }]);
  });

  it("keeps open access as a known Parking Condition, so it isn't mistaken for unknown", () => {
    const osm = {
      elements: [busStop(1, STATION.lat, STATION.lon), carParkWay(10, STATION.lat, STATION.lon, { access: "yes" })],
    };

    const { dataset } = buildParkingCandidates({ osm, zbes: [], builtAt });

    expect(dataset.candidates.map((c) => c.conditions)).toEqual([{ access: "yes" }]);
  });

  it("keeps a maximum stay that applies only at some hours, beside the one at all hours", () => {
    const osm = {
      elements: [
        busStop(1, STATION.lat, STATION.lon),
        carParkWay(10, STATION.lat, STATION.lon, { maxstay: "4 hours", "maxstay:conditional": "2 hours @ (Mo-Fr 08:00-20:00)" }),
      ],
    };

    const { dataset } = buildParkingCandidates({ osm, zbes: [], builtAt });

    expect(dataset.candidates.map((c) => c.conditions)).toEqual([
      { maxStay: "4 hours", maxStayConditional: "2 hours @ (Mo-Fr 08:00-20:00)" },
    ]);
  });

  it("tells P+R and street parking from other car parks", () => {
    const tagSets: Record<string, string>[] = [
      { park_ride: "yes" },
      { park_ride: "train" },
      { park_ride: "no" },
      { parking: "street_side" },
      { parking: "lane" },
      { parking: "underground" },
      {},
    ];
    const osm = {
      elements: tagSets.flatMap((tags, i) => [
        busStop(1 + i, STATION.lat, STATION.lon + i * 0.012),
        carParkWay(10 + i, STATION.lat, STATION.lon + i * 0.012, tags),
      ]),
    };

    const { dataset } = buildParkingCandidates({ osm, zbes: [], builtAt });

    expect(dataset.candidates.map((c) => c.kind)).toEqual([
      "park-and-ride",
      "park-and-ride",
      "car-park",
      "street",
      "street",
      "car-park",
      "car-park",
    ]);
  });

  it("merges car parks within ~150 m of each other into one Parking Candidate, named after the P+R", () => {
    const osm = {
      elements: [
        busStop(1, STATION.lat, STATION.lon),
        carParkWay(10, STATION.lat, STATION.lon, { name: "Supermarket overflow", capacity: "300" }),
        carParkWay(11, STATION.lat + 100 * M, STATION.lon, { name: "P+R Estació", park_ride: "yes", capacity: "80" }),
        { type: "node", id: 12, lat: STATION.lat - 50 * M, lon: STATION.lon, tags: { amenity: "parking" } },
        // ~300 m from the P+R: a candidate of its own.
        carParkWay(13, STATION.lat + 400 * M, STATION.lon, { name: "Carrer Major" }),
      ],
    };

    const { dataset } = buildParkingCandidates({ osm, zbes: [], builtAt });

    expect(dataset.candidates.map((c) => [c.id, c.name, c.kind])).toEqual([
      ["osm:way/11", "P+R Estació", "park-and-ride"],
      ["osm:way/13", "Carrer Major", "car-park"],
    ]);
  });

  it("keeps a Parking Candidate's ID when a larger car park is mapped beside it, or its capacity changes", () => {
    const before = {
      elements: [
        busStop(1, STATION.lat, STATION.lon),
        carParkWay(10, STATION.lat, STATION.lon, { name: "Estació", capacity: "20" }),
      ],
    };
    // A later OSM edit: a new, larger car park 100 m away, and the old one's capacity corrected.
    const after = {
      elements: [
        busStop(1, STATION.lat, STATION.lon),
        carParkWay(10, STATION.lat, STATION.lon, { name: "Estació", capacity: "120" }),
        carParkWay(5_000_000, STATION.lat + 100 * M, STATION.lon, { name: "Nou aparcament", capacity: "400" }),
      ],
    };

    const first = buildParkingCandidates({ osm: before, zbes: [], builtAt });
    const second = buildParkingCandidates({ osm: after, zbes: [], builtAt });

    expect(second.dataset.candidates.map((c) => c.id)).toEqual(["osm:way/10"]);
    expect(first.dataset.candidates.map((c) => c.id)).toEqual(["osm:way/10"]);
  });

  it("doesn't chain a row of car parks ~100 m apart into one long Parking Candidate", () => {
    // Five car parks along a street, 100 m apart: 400 m from end to end.
    const osm = {
      elements: [
        busStop(1, STATION.lat + 200 * M, STATION.lon),
        ...[0, 1, 2, 3, 4].map((i) => carParkWay(10 + i, STATION.lat + i * 100 * M, STATION.lon)),
      ],
    };

    const { dataset } = buildParkingCandidates({ osm, zbes: [], builtAt });

    expect(dataset.candidates.length).toBeGreaterThan(1);
  });

  it("takes the merging distance as a build parameter", () => {
    const osm = {
      elements: [
        busStop(1, STATION.lat, STATION.lon),
        carParkWay(10, STATION.lat, STATION.lon),
        carParkWay(11, STATION.lat + 100 * M, STATION.lon),
      ],
    };

    const { dataset } = buildParkingCandidates({ osm, zbes: [], builtAt, mergeDistanceM: 50 });

    expect(dataset.candidates).toHaveLength(2);
  });

  it("gives the same Parking Candidate IDs in two builds from the same input", () => {
    // Overpass returns elements in no promised order, so the second build gets them reversed.
    const elements: OverpassPlace[] = [
      busStop(1, STATION.lat, STATION.lon),
      busStop(2, STATION.lat + 0.01, STATION.lon),
      carParkWay(10, STATION.lat, STATION.lon),
      carParkWay(11, STATION.lat + 100 * M, STATION.lon),
      { type: "node", id: 10, lat: STATION.lat - 100 * M, lon: STATION.lon, tags: { amenity: "parking" } },
      carParkWay(20, STATION.lat + 0.01, STATION.lon),
      { type: "relation", id: 21, center: { lat: STATION.lat + 0.01 + 50 * M, lon: STATION.lon }, tags: { amenity: "parking" } },
    ];

    const first = buildParkingCandidates({ osm: { elements }, zbes: [], builtAt });
    const second = buildParkingCandidates({ osm: { elements: [...elements].reverse() }, zbes: [], builtAt: new Date() });

    expect(second.dataset.candidates.map((c) => c.id)).toEqual(first.dataset.candidates.map((c) => c.id));
    // node/10 takes in way/10 (100 m away) but not way/11 (200 m); relation/21 takes in way/20.
    expect(first.dataset.candidates.map((c) => c.id)).toEqual(
      ["node/10", "relation/21", "way/11"].map((id) => `osm:${id}`),
    );
  });

  it("counts an underground car park that OSM maps only by its entrance, located at the way in", () => {
    // Like Sabadell Nord's P+R: an entrance node, and no amenity=parking area.
    const osm = {
      elements: [
        { type: "node", id: 2, lat: STATION.lat + 80 * M, lon: STATION.lon, tags: { railway: "station", name: "Sabadell Nord" } },
        parkingEntrance(10, STATION.lat, STATION.lon, { access: "yes", fee: "yes" }),
      ],
    };

    const { dataset } = buildParkingCandidates({ osm, zbes: [], builtAt });

    expect(dataset.candidates).toEqual([
      {
        id: "osm:node/10",
        name: "Car park near Sabadell Nord",
        location: { lat: STATION.lat, lng: STATION.lon },
        kind: "car-park",
        conditions: { access: "yes", fee: "yes" },
      },
    ]);
  });

  it("merges an entrance into the car park it leads to, which keeps its name, Parking Conditions and ID", () => {
    // The entrance node's ID sorts before the way's, but the car park itself is the better record.
    const osm = {
      elements: [
        busStop(1, STATION.lat, STATION.lon),
        carParkWay(500, STATION.lat + 60 * M, STATION.lon, { name: "Aparcament Estació", fee: "no" }),
        parkingEntrance(10, STATION.lat + 20 * M, STATION.lon, { fee: "yes" }),
      ],
    };

    const { dataset } = buildParkingCandidates({ osm, zbes: [], builtAt });

    expect(dataset.candidates.map(({ id, name, conditions }) => ({ id, name, conditions }))).toEqual([
      { id: "osm:way/500", name: "Aparcament Estació", conditions: { fee: "no" } },
    ]);
  });

  it("names an unnamed car park after its nearest transit stop", () => {
    const osm = {
      elements: [
        busStop(1, STATION.lat + 300 * M, STATION.lon, "Rambla"),
        busStop(2, STATION.lat - 100 * M, STATION.lon, "Sant Feliu de Llobregat"),
        { type: "node", id: 3, lat: STATION.lat, lon: STATION.lon + 50 * M, tags: { highway: "bus_stop" } },
        carParkWay(10, STATION.lat, STATION.lon),
      ],
    };

    const { dataset } = buildParkingCandidates({ osm, zbes: [], builtAt });

    expect(dataset.candidates.map((c) => c.name)).toEqual(["Car park near Sant Feliu de Llobregat"]);
  });

  it("names an unnamed car park after a stop, not after a rail platform's track number", () => {
    const osm = {
      elements: [
        { type: "way", id: 1, center: { lat: STATION.lat, lon: STATION.lon }, tags: { railway: "platform", name: "Via 1" } },
        { type: "node", id: 2, lat: STATION.lat + 200 * M, lon: STATION.lon, tags: { railway: "station", name: "Martorell Central" } },
        carParkWay(10, STATION.lat + 20 * M, STATION.lon),
      ],
    };

    const { dataset } = buildParkingCandidates({ osm, zbes: [], builtAt });

    expect(dataset.candidates.map((c) => c.name)).toEqual(["Car park near Martorell Central"]);
  });

  it("keeps a car park far from any ZBE edge", () => {
    // A ZBE around central Barcelona, and Martorell's Rodalies station ~25 km away.
    const zbe = squareZbe("barcelona", 41.37, 2.13, 0.05);
    const martorell = { lat: 41.4752, lon: 1.9302 };
    const osm = {
      elements: [
        busStop(1, martorell.lat, martorell.lon),
        carParkWay(10, martorell.lat + 100 * M, martorell.lon, { name: "Aparcament Estació de Martorell" }),
      ],
    };

    const { dataset } = buildParkingCandidates({ osm, zbes: [zbe], builtAt });

    expect(dataset.candidates.map((c) => c.name)).toEqual(["Aparcament Estació de Martorell"]);
  });
});

/** A synthetic square ZBE given by its south-west corner and side in degrees, optionally with a disputed strip. */
function squareZbe(
  id: string,
  south: number,
  west: number,
  side: number,
  opts: { disputed?: { south: number; height: number } } = {},
): Zbe {
  const box = (s: number, w: number, height: number, width: number): [number, number][][] => [
    [
      [w, s],
      [w + width, s],
      [w + width, s + height],
      [w, s + height],
      [w, s],
    ],
  ];
  return {
    id,
    name: `ZBE ${id}`,
    perimeter: { type: "MultiPolygon", coordinates: [box(south, west, side, side)] },
    ...(opts.disputed && {
      disputedAreas: { type: "MultiPolygon", coordinates: [box(opts.disputed.south, west, opts.disputed.height, side)] },
    }),
    restrictionWindow: { weekdays: [1, 2, 3, 4, 5], start: "07:00", end: "20:00" },
    barredLabels: ["none"],
  };
}
