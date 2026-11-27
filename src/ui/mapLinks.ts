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

/**
 * Google Maps driving directions to a place, from wherever the phone is: like the transit link, a plain
 * URL with no key or quota. On a phone it opens the Maps app.
 */
export function googleMapsDrivingUrl(destination: LatLng): string {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", `${destination.lat},${destination.lng}`);
  url.searchParams.set("travelmode", "driving");
  return url.toString();
}

/** A Waze deep link that starts navigating to a place; on a phone without Waze it opens the web map. */
export function wazeNavigationUrl(destination: LatLng): string {
  return `https://waze.com/ul?ll=${destination.lat},${destination.lng}&navigate=yes`;
}
