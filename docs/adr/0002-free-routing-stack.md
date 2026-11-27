---
status: accepted
---

# Free routing stack: Transitous for transit, two-pass driving with Mapbox traffic

Zero cost is a hard requirement, and every transit stop, buses included, can host a Parking Candidate. At that candidate count Google's free caps last only about a dozen queries a month. Transit times come from **Transitous** (a community-run MOTIS instance), whose one-to-many endpoint returns times from one place to up to 128 others and covers TMB, AMB, TRAM, FGC, Rodalies and the Generalitat interurban coaches. Driving is done in two passes. The first gets free-flow times for every candidate (Transitous car routing). The second gets traffic-aware times only for the best ~20 by first-pass score (**Mapbox** driving-traffic directions with a departure time, with **TomTom** Routing as the backup). Our own code joins the drive and transit legs, because Transitous's own park-and-ride mode knows nothing about ZBEs. Engines sit behind one interface. If Transitous ever withdraws access, a self-hosted MOTIS on Oracle's free tier can take over.

## Consequences

- Transitous requires an open-source, non-commercial project with attribution, so the code is public and personal data must never be committed.
- An Option that the free-flow pass ranks too low never gets a traffic check, which is why the second pass is wide (top ~20), not narrow.
- Mapbox's Product Terms (October 2026) allow drawing its drives on our MapLibre/OpenFreeMap map: only Boundaries, Weather Layers, Studio styles and POI search results are tied to a Mapbox Map, not the Navigation APIs. They do forbid exporting, caching or storing Navigation API results (§2.10.1), so a drive lives only as long as its query. They also ask for the Mapbox logo wherever a Service Offering is used (§1.4.1), and a separate licence for apps "primarily intended for use within vehicles" (§1.2.2); ZBEar is planned before driving and hands navigation to Google Maps or Waze.
- Accounts are opened without a payment method wherever possible, so going over a free cap fails requests instead of billing.

## Considered Options

- **Google Routes for both legs** (ADR-0001): too few free queries at this candidate count.
- **Self-hosted OpenTripPlanner/MOTIS as the primary engine**: no traffic data, plus server upkeep. Kept only as the fallback.
