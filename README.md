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

## Datasets

The app reads published datasets from `public/data/`, rebuilt from their sources and committed:

```sh
npm run data:zbes   # every Catalan ZBE in the DGT NAP DATEX II feed → public/data/zbes.json
```

Restriction Windows and barred Environmental Labels come from the hand-maintained table in [src/dataset/restrictionTable.ts](src/dataset/restrictionTable.ts), not from DGT. A ZBE missing from the table is published with the worst case (all day, every day), and the build warns about it.

Pages Functions (`functions/`) run only on Cloudflare; running them locally needs Wrangler, which needs Node 22.

## Deploy

Cloudflare Pages builds every push to `main` (Git integration, Node from `.node-version`). The site sits behind Cloudflare Access, and personal data lives only in the `ZBEAR_KV` key-value store, never in this repo ([ADR-0004](docs/adr/0004-public-code-private-data.md)).

First-time setup of the Cloudflare side is a guided script:

```sh
./scripts/setup-cloudflare.sh
```

## Data and attribution

ZBE perimeters from the [DGT National Access Point](https://nap.dgt.es/en/dataset/zonas-de-bajas-emisiones) (CC BY 4.0). Transit and free-flow driving times by [Transitous](https://transitous.org/sources/) and its data sources. Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, tiles by [OpenFreeMap](https://openfreemap.org).
