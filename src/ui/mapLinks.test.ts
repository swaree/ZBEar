import { describe, expect, it } from "vitest";
import { googleMapsDrivingUrl, wazeNavigationUrl } from "./mapLinks";

const parking = { lat: 41.45, lng: 2.05 };

describe("navigation links to the parking", () => {
  it("opens Google Maps driving directions to the parking, from wherever the phone is", () => {
    const url = new URL(googleMapsDrivingUrl(parking));

    expect(`${url.origin}${url.pathname}`).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("destination")).toBe("41.45,2.05");
    expect(url.searchParams.get("travelmode")).toBe("driving");
    // No origin: Google starts from the current location, as a sat-nav should.
    expect(url.searchParams.has("origin")).toBe(false);
  });

  it("opens Waze navigating to the parking", () => {
    // The format of Waze's deep links: https://developers.google.com/waze/deeplinks
    expect(wazeNavigationUrl(parking)).toBe("https://waze.com/ul?ll=41.45,2.05&navigate=yes");
  });
});
