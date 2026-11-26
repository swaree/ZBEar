import { useEffect, useLayoutEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
// MapLibre 6 loads its worker as an ES module relative to itself, which bundling breaks;
// let Vite bundle the worker and tell MapLibre where it ended up.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { LatLng, ParkingCandidate } from "../domain/types";

maplibregl.setWorkerUrl(workerUrl);

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const BARCELONA: [number, number] = [2.12, 41.41];

export interface MapViewProps {
  origin: LatLng | null;
  destination: LatLng | null;
  candidates: ParkingCandidate[];
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
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      originMarker.current = null;
      destinationMarker.current = null;
      candidateMarkers.current = [];
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const mk of candidateMarkers.current) mk.remove();
    candidateMarkers.current = props.candidates.map((c) => {
      const el = markerElement(c.id === props.selectedId ? "marker-candidate selected" : "marker-candidate", c.name);
      return new maplibregl.Marker({ element: el }).setLngLat(toLngLat(c.location)).addTo(m);
    });
  }, [props.candidates, props.selectedId]);

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
