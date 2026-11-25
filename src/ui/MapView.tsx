import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
// MapLibre 6 loads its worker as an ES module relative to itself, which bundling breaks;
// let Vite bundle the worker and tell MapLibre where it ended up.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { LatLng, ParkingCandidate } from "../domain/types";

maplibregl.setWorkerUrl(workerUrl);

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const BARCELONA: [number, number] = [2.12, 41.41];

export function MapView(props: {
  origin: LatLng | null;
  destination: LatLng | null;
  candidates: ParkingCandidate[];
  selectedId: string | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!container.current) return;
    const m = new maplibregl.Map({ container: container.current, style: STYLE_URL, center: BARCELONA, zoom: 10 });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const mk of markers.current) mk.remove();
    markers.current = [];

    const add = (p: LatLng, className: string, title: string) => {
      const el = document.createElement("div");
      el.className = `marker ${className}`;
      el.title = title;
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(m));
    };

    for (const c of props.candidates) {
      add(c.location, c.id === props.selectedId ? "marker-candidate selected" : "marker-candidate", c.name);
    }
    if (props.origin) add(props.origin, "marker-origin", "Origin");
    if (props.destination) add(props.destination, "marker-destination", "Destination");

    const points = [props.origin, props.destination, ...props.candidates.map((c) => c.location)].filter(
      (p): p is LatLng => p != null,
    );
    if (points.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      for (const p of points) bounds.extend([p.lng, p.lat]);
      m.fitBounds(bounds, { padding: 40, maxZoom: 13, duration: 0 });
    }
  }, [props.origin?.lat, props.origin?.lng, props.destination?.lat, props.destination?.lng, props.candidates, props.selectedId]);

  return <div ref={container} className="map" role="region" aria-label="Map" />;
}
