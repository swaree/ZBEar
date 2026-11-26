import type { LatLng } from "../domain/types";

/**
 * A Google Maps transit directions link: a plain URL, not a Maps Platform API, so it needs no
 * key and uses no quota. Maps URLs can't carry an arrive-by time; Google opens at "Leave now".
 */
export function googleMapsTransitUrl(origin: LatLng, destination: LatLng): string {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", `${origin.lat},${origin.lng}`);
  url.searchParams.set("destination", `${destination.lat},${destination.lng}`);
  url.searchParams.set("travelmode", "transit");
  return url.toString();
}
