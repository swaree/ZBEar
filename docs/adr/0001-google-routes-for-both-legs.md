---
status: superseded by ADR-0002
---

# Google Routes API for both drive and transit, combined in our own code, within the free tier

No routing engine offers what ZBEar needs out of the box. Google's Routes API has traffic-aware driving and transit that already merges every operator (TMB, AMB, FGC, Rodalies, TRAM, interurban coaches), but it has no park-and-ride mode. Self-hosted engines (OpenTripPlanner, MOTIS) do park-and-ride, but they have no traffic data and need a large server plus GTFS upkeep. We use Google for both legs: a traffic-aware driving matrix to the Parking Candidates and a transit matrix from them to the Destination. Our own code joins the two. Usage must stay inside Google's monthly free caps, so the number of candidates sent per query is bounded. The routing engine sits behind an interface, so a self-hosted transit engine can replace Google's transit half later without touching the rest.

## Considered Options

- **Self-hosted OpenTripPlanner (CAR_TO_PARK)**: rejected. It has no live traffic, which matters most on the Rondes at rush hour. It also needs 8–16 GB of RAM and requires tagging P+R lots in OSM (only 28 are tagged in the Barcelona area).
- **Hybrid (Google drive + self-hosted transit)**: deferred until usage outgrows the free tier.
