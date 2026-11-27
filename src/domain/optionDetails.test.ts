import { describe, expect, it } from "vitest";
import { detailOption } from "./optionDetails";
import type { LatLng, ParkingCandidate } from "./types";
import { fakeRoutingEngine } from "../routing/fakeRoutingEngine";
import type { TransitItinerary } from "../routing/RoutingEngine";

const origin: LatLng = { lat: 41.6, lng: 1.9 };
const destination: LatLng = { lat: 41.387, lng: 2.17 };
const arriveBy = new Date("2026-12-01T09:00:00+01:00");
const parking: ParkingCandidate = {
  id: "p",
  name: "Parking P",
  location: { lat: 41.45, lng: 2.05 },
  kind: "park-and-ride",
  conditions: {},
};

/** A hand-made itinerary: one ride between two named stops, with no walking. */
function ride(line: string, departAt: string, arriveAt: string): TransitItinerary {
  return {
    departAt: new Date(departAt),
    arriveAt: new Date(arriveAt),
    transfers: 0,
    legs: [
      {
        mode: "rail",
        line,
        headsign: null,
        color: null,
        agency: null,
        stopsBetween: 3,
        fromName: "Here",
        toName: "There",
        departAt: new Date(departAt),
        arriveAt: new Date(arriveAt),
        path: [],
      },
    ],
  };
}

describe("detailOption", () => {
  it("gives an Option's transit steps to the Destination", async () => {
    const steps = ride("R4", "2026-12-01T08:20:00+01:00", "2026-12-01T08:50:00+01:00");
    // The fake engine throws when asked about any other place or time.
    const engine = fakeRoutingEngine({
      origin,
      destination,
      arriveBy,
      itineraryToDestination: [[parking.location, steps]],
    });

    const details = await detailOption({ origin, destination, arriveBy }, { candidate: parking }, engine);

    expect(details).toEqual({ transitThere: steps, transitBack: null });
  });

  it("with a return, also gives the transit steps back to the parking, leaving when the stay ends", async () => {
    const there = ride("R4", "2026-12-01T08:20:00+01:00", "2026-12-01T08:50:00+01:00");
    const back = ride("R4", "2026-12-01T11:35:00+01:00", "2026-12-01T12:05:00+01:00");
    const engine = fakeRoutingEngine({
      origin,
      destination,
      arriveBy,
      // Staying 2h30 from the 09:00 arrival.
      leaveDestinationAt: new Date("2026-12-01T11:30:00+01:00"),
      itineraryToDestination: [[parking.location, there]],
      itineraryFromDestination: [[parking.location, back]],
    });

    const details = await detailOption(
      { origin, destination, arriveBy, return: { stayForS: 2.5 * 3600 } },
      { candidate: parking },
      engine,
    );

    expect(details).toEqual({ transitThere: there, transitBack: back });
  });
});
