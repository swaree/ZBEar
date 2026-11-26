# ZBEar

Find where to park outside every low emission zone (ZBE) and continue by public transport, for the least door-to-door time. Personal, non-commercial, open source.

- Domain language: [GLOSSARY.md](GLOSSARY.md). Decisions: [docs/adr/](docs/adr/). Spec and tickets: [issue #1](https://github.com/swaree/ZBEar/issues/1).

## Run locally

```sh
npm install
npm run dev      # http://localhost:5173 (add `-- --host` to open it from a phone on the same Wi-Fi)
npm test
npm run build    # typechecks the app and the Pages Functions, then builds to dist/
```

Drives with traffic come from Mapbox, which needs a token. Put it in a gitignored `.env` at the repo root:

```sh
VITE_MAPBOX_TOKEN=pk.…
```

Open the Mapbox account without a payment method, so going over the free cap fails requests instead of billing. Without a token the app still loads, but every Trip fails, because no drive can be checked against the ZBEs.

## Datasets

The app reads published datasets from `public/data/`, rebuilt from their sources and committed:

```sh
npm run data:zbes   # every Catalan ZBE in the DGT NAP DATEX II feed and OSM → public/data/zbes.json
```

DGT is the source of truth for every ZBE it lists. OSM `boundary=low_emission_zone` (queried from Overpass, bounded to Catalonia) fills in ZBEs DGT lacks, once their `start_date`/`opening_date` has come. Where DGT and OSM draw the same ZBE differently, by more than 5,000 m² and somewhere at least 30 m across, the difference becomes a **Disputed Area**: it counts as inside the ZBE and is hatched on the map until a Settlement in [src/dataset/settlements.ts](src/dataset/settlements.ts) decides it inside or outside.

Restriction Windows and barred Environmental Labels come from the hand-maintained table in [src/dataset/restrictionTable.ts](src/dataset/restrictionTable.ts), not from DGT. A ZBE missing from the table is published with the worst case (all day, every day), and the build warns about it.

```sh
npm run data:candidates   # OSM car parks in Catalonia → public/data/parking-candidates.json (reads zbes.json, so run data:zbes first)
```

**Discovered Parking Candidates** are OSM `amenity=parking` outside every ZBE (disputed areas count as inside), within 500 m straight-line of a transit stop of any mode, and not `access=private|customers|permit|no|delivery|employees`. Distance to a ZBE edge doesn't matter: a car park at a fast rail station far out can beat one at the edge. Car parks within 150 m merge into one candidate that takes the name, location, kind, Parking Conditions and OSM ID of the first of them: a P+R, else the lowest OSM ID. New OSM elements get higher IDs, so a candidate's ID survives rebuilds even as car parks are mapped or edited nearby (unless a new P+R appears), while the other car parks' Parking Conditions are not kept. Unnamed car parks are named after the nearest named transit stop. The kind (car park, P+R, street) and the `fee`, `charge`, `maxstay`, `access` and `opening_hours` tags are carried over as they are; missing ones stay unknown.

Each query then picks the candidates worth routing: those whose straight-line detour (Origin → candidate → Destination against Origin → Destination) is at most 1.5, and no more than the 127 with the smallest detours, so every Transitous one-to-many call stays within its 128-point fair use. The best 20 of those by free-flow door-to-door time get a drive with traffic from Mapbox, departing when the free-flow times say to leave. Each drive's timed path is checked against every ZBE, and an Option is discarded if the car would be inside a ZBE that bars its Environmental Label at any moment of that ZBE's Restriction Window (Europe/Madrid time). The rest are never offered, because their drives aren't checked. Mapbox results are used only within the query and never stored, as its terms require. Exempt Corridors aren't modelled yet, so a drive along the Rondes currently counts as driving inside the ZBE.

Pages Functions (`functions/`) run only on Cloudflare; running them locally needs Wrangler, which needs Node 22.

## Deploy

Cloudflare Pages builds every push to `main` (Git integration, Node from `.node-version`), with `VITE_MAPBOX_TOKEN` set as a build environment variable. The site sits behind Cloudflare Access, and personal data lives only in the `ZBEAR_KV` key-value store, never in this repo ([ADR-0004](docs/adr/0004-public-code-private-data.md)).

First-time setup of the Cloudflare side is a guided script:

```sh
./scripts/setup-cloudflare.sh
```

## Data and attribution

ZBE perimeters from the [DGT National Access Point](https://nap.dgt.es/en/dataset/zonas-de-bajas-emisiones) (CC BY 4.0) and [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL). Transit and free-flow driving times by [Transitous](https://transitous.org/sources/) and its data sources. Driving times with traffic by [© Mapbox](https://www.mapbox.com/about/maps). Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, tiles by [OpenFreeMap](https://openfreemap.org).
