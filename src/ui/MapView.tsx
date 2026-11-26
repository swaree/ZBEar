import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
// MapLibre 6 loads its worker as an ES module relative to itself, which bundling breaks;
// let Vite bundle the worker and tell MapLibre where it ended up.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { LatLng, ParkingCandidate } from "../domain/types";
import type { FeatureCollection } from "geojson";
import type { Zbe } from "../domain/zbe";

maplibregl.setWorkerUrl(workerUrl);

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const BARCELONA: [number, number] = [2.12, 41.41];
const ZBE_SOURCE = "zbes";
const DISPUTED_SOURCE = "zbe-disputed-areas";
/** Fixed rather than themed: the base map is light in both colour schemes. */
const ZBE_COLOR = "#c2410c";
/** Disputed areas count as inside, so they share the ZBE's hue, darker, hatched and dashed to stand out. */
const DISPUTED_RGB: [number, number, number] = [124, 45, 18];
const DISPUTED_COLOR = `rgb(${DISPUTED_RGB.join(" ")})`;
const DISPUTED_HATCH = "zbe-disputed-hatch";
const CANDIDATE_SOURCE = "parking-candidates";
/** Matches the light-scheme --candidate in styles.css: the base map is light in both schemes. */
const CANDIDATE_COLOR = "#0f766e";

/** A tile of diagonal stripes in the given colour, for a hatched fill. */
function hatch([r, g, b]: [number, number, number]): { width: number; height: number; data: Uint8Array } {
  const size = 8;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const onStripe = (x + y) % size < 2;
      data.set(onStripe ? [r, g, b, 170] : [r, g, b, 25], (y * size + x) * 4);
    }
  }
  return { width: size, height: size, data };
}

export interface MapViewProps {
  origin: LatLng | null;
  destination: LatLng | null;
  /** Every Parking Candidate, drawn as small dots: there are thousands. */
  candidates: ParkingCandidate[];
  /** The Options' Parking Candidates, drawn as markers. */
  optionCandidates: ParkingCandidate[];
  zbes: Zbe[];
  selectedId: string | null;
  /** The map fits these points whenever this array changes identity (e.g. after planning a Trip). */
  fitTo: LatLng[] | null;
  onTap: (point: LatLng) => void;
  onOriginMoved: (point: LatLng) => void;
  onDestinationMoved: (point: LatLng) => void;
}

export function MapView(props: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const candidateMarkers = useRef<maplibregl.Marker[]>([]);
  const originMarker = useRef<maplibregl.Marker | null>(null);
  const destinationMarker = useRef<maplibregl.Marker | null>(null);
  // Map and marker listeners are bound once; they read the latest callbacks through this ref.
  const callbacks = useRef(props);
  useLayoutEffect(() => {
    callbacks.current = props;
  });

  useEffect(() => {
    if (!container.current) return;
    const m = new maplibregl.Map({ container: container.current, style: STYLE_URL, center: BARCELONA, zoom: 10 });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("click", (e) => {
      // MapLibre also reports taps on markers as map clicks; those must not move the Origin or Destination.
      if (e.originalEvent.target instanceof Element && e.originalEvent.target.closest(".marker")) return;
      callbacks.current.onTap(fromLngLat(e.lngLat));
    });
    m.on("load", () => setStyleReady(true));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      setStyleReady(false);
      originMarker.current = null;
      destinationMarker.current = null;
      candidateMarkers.current = [];
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const mk of candidateMarkers.current) mk.remove();
    candidateMarkers.current = props.optionCandidates.map((c) => {
      const el = markerElement(c.id === props.selectedId ? "marker-candidate selected" : "marker-candidate", c.name);
      return new maplibregl.Marker({ element: el }).setLngLat(toLngLat(c.location)).addTo(m);
    });
  }, [props.optionCandidates, props.selectedId]);

  useEffect(() => {
    const m = map.current;
    if (!m || !styleReady) return;
    showCandidates(m, props.candidates);
  }, [props.candidates, styleReady]);

  useEffect(() => {
    const m = map.current;
    if (!m || !styleReady) return;
    showZbes(m, props.zbes);
  }, [props.zbes, styleReady]);

  // Effects depend on the coordinates, not the LatLng object, so re-renders with an equal point do nothing.
  useEffect(() => {
    syncPointMarker(map.current, originMarker, props.origin, "marker-origin", "Origin", (p) =>
      callbacks.current.onOriginMoved(p),
    );
  }, [props.origin?.lat, props.origin?.lng]);

  useEffect(() => {
    syncPointMarker(map.current, destinationMarker, props.destination, "marker-destination", "Destination", (p) =>
      callbacks.current.onDestinationMoved(p),
    );
  }, [props.destination?.lat, props.destination?.lng]);

  useEffect(() => {
    const m = map.current;
    if (!m || !props.fitTo || props.fitTo.length < 2) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const p of props.fitTo) bounds.extend(toLngLat(p));
    m.fitBounds(bounds, { padding: 40, maxZoom: 13, duration: 0 });
  }, [props.fitTo]);

  return <div ref={container} className="map" role="region" aria-label="Map" />;
}

/**
 * Draws every ZBE perimeter, and over it each disputed area (DGT and OSM disagree there, so it
 * counts as inside), beneath the base map's labels so place names stay readable.
 */
function showZbes(m: maplibregl.Map, zbes: Zbe[]) {
  const perimeters: FeatureCollection = {
    type: "FeatureCollection",
    features: zbes.map((z) => ({ type: "Feature", properties: { name: z.name }, geometry: z.perimeter })),
  };
  const disputed: FeatureCollection = {
    type: "FeatureCollection",
    features: zbes.flatMap((z) =>
      z.disputedAreas ? [{ type: "Feature" as const, properties: { name: z.name }, geometry: z.disputedAreas }] : [],
    ),
  };
  const source = m.getSource<maplibregl.GeoJSONSource>(ZBE_SOURCE);
  if (source) {
    source.setData(perimeters);
    m.getSource<maplibregl.GeoJSONSource>(DISPUTED_SOURCE)?.setData(disputed);
    return;
  }
  m.addSource(ZBE_SOURCE, { type: "geojson", data: perimeters });
  m.addSource(DISPUTED_SOURCE, { type: "geojson", data: disputed });
  // Beneath the Parking Candidates' dots if those loaded first, else beneath the labels.
  const beneath = m.getLayer(CANDIDATE_SOURCE)
    ? CANDIDATE_SOURCE
    : m.getStyle().layers.find((l) => l.type === "symbol")?.id;
  m.addLayer(
    { id: "zbe-fill", type: "fill", source: ZBE_SOURCE, paint: { "fill-color": ZBE_COLOR, "fill-opacity": 0.12 } },
    beneath,
  );
  m.addLayer(
    {
      id: "zbe-outline",
      type: "line",
      source: ZBE_SOURCE,
      paint: { "line-color": ZBE_COLOR, "line-width": 1.5, "line-opacity": 0.8 },
    },
    beneath,
  );
  m.addImage(DISPUTED_HATCH, hatch(DISPUTED_RGB));
  m.addLayer(
    {
      id: "zbe-disputed-fill",
      type: "fill",
      source: DISPUTED_SOURCE,
      paint: { "fill-pattern": DISPUTED_HATCH },
    },
    beneath,
  );
  m.addLayer(
    {
      id: "zbe-disputed-outline",
      type: "line",
      source: DISPUTED_SOURCE,
      paint: { "line-color": DISPUTED_COLOR, "line-width": 1.5, "line-dasharray": [2, 1.5] },
    },
    beneath,
  );
}

/** Draws every Parking Candidate as a small dot, above the ZBEs and beneath the base map's labels. */
function showCandidates(m: maplibregl.Map, candidates: ParkingCandidate[]) {
  const data: FeatureCollection = {
    type: "FeatureCollection",
    features: candidates.map((c) => ({
      type: "Feature",
      properties: { name: c.name },
      geometry: { type: "Point", coordinates: toLngLat(c.location) },
    })),
  };
  const source = m.getSource<maplibregl.GeoJSONSource>(CANDIDATE_SOURCE);
  if (source) {
    source.setData(data);
    return;
  }
  m.addSource(CANDIDATE_SOURCE, { type: "geojson", data });
  m.addLayer(
    {
      id: CANDIDATE_SOURCE,
      type: "circle",
      source: CANDIDATE_SOURCE,
      paint: {
        "circle-color": CANDIDATE_COLOR,
        "circle-opacity": 0.45,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 1.5, 14, 4],
      },
    },
    m.getStyle().layers.find((l) => l.type === "symbol")?.id,
  );
}

/** Keeps one draggable marker in step with a point: creates, moves or removes it. */
function syncPointMarker(
  m: maplibregl.Map | null,
  marker: { current: maplibregl.Marker | null },
  point: LatLng | null,
  className: string,
  title: string,
  onMoved: (p: LatLng) => void,
) {
  if (!m) return;
  if (!point) {
    marker.current?.remove();
    marker.current = null;
    return;
  }
  if (!marker.current) {
    const mk = new maplibregl.Marker({ element: markerElement(`${className} marker-draggable`, title), draggable: true });
    mk.on("dragend", () => onMoved(fromLngLat(mk.getLngLat())));
    marker.current = mk.setLngLat(toLngLat(point)).addTo(m);
  } else {
    marker.current.setLngLat(toLngLat(point));
  }
  // A typed point may lie outside the current view: bring it into sight.
  if (!m.getBounds().contains(toLngLat(point))) m.easeTo({ center: toLngLat(point) });
}

function markerElement(className: string, title: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `marker ${className}`;
  el.title = title;
  return el;
}

const toLngLat = (p: LatLng): [number, number] => [p.lng, p.lat];
const fromLngLat = (ll: maplibregl.LngLat): LatLng => ({ lat: ll.lat, lng: ll.lng });
