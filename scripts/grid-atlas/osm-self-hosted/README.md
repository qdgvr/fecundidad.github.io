# Self-hosted OSM atlas pipelines

This directory turns `osmium export` GeoJSONSeq into the ten vector-tile
source layers consumed by the grid atlas. It uses only Node.js built-ins and
keeps memory bounded by processing one record at a time.

```sh
osmium export filtered.osm.pbf \
  -f geojsonseq \
  -a type,id,version,timestamp \
  -u type_id \
  -o power.geojsonseq

node normalize-osm-power.mjs \
  --input power.geojsonseq \
  --output-dir output/region \
  --region region-key \
  --force

node validate-osm-power.mjs --input-dir output/region
node --test test/normalizer.test.mjs
```

The normalizer also accepts repeated `--input` arguments, plus
`--lines`, `--polygons`, and `--points` aliases for build-orchestrator
compatibility. Input records may begin with the RFC 8142 record-separator
character. Output is newline-delimited GeoJSON without record separators:

- `power_line.ndjson`
- `power_plant.ndjson`
- `power_generator_area.ndjson`
- `power_substation.ndjson`
- `power_plant_point.ndjson`
- `power_generator.ndjson`
- `power_substation_point.ndjson`
- `power_transformer.ndjson`
- `power_switch.ndjson`
- `power_compensator.ndjson`
- `stats.json`

Voltages are numeric kV, frequency is numeric Hz, and electrical output is
numeric MW. Unitless raw voltage follows OSM convention and is treated as
volts. Unitless raw electrical output is treated as watts. Support objects
such as towers and poles, along with untagged reference nodes, are omitted.
Osmium emits a closed facility way both as its original line record and as an
area record; the normalizer records and discards that duplicate line
representation, then keeps the polygon once under the original OSM object ID.

Every output feature includes `osm_type`, an OSM identifier (the MVT feature
ID for nodes/ways and `osm_id` for relations), normalized lifecycle flags,
relevant popup tags, and a Tippecanoe `minzoom`. Power-line minzoom follows the
atlas voltage/DC visibility gates; other layers use their fixed visibility
thresholds. Plant, generator and substation areas also emit centroid companions
through z11. The runtime reads those point layers through a second source capped
at z11, so MapLibre overzooms their markers while the primary source switches to
the full area geometry at z12. This preserves high-zoom selection without
duplicating every centroid in the largest tile level. Source timestamps,
input/output hashes, and tool versions live in the archive sidecars and
aggregate manifest rather than being duplicated on every tile feature.

Production archives use zooms 2–12 from `regions.json`. MapLibre overzooms the
maximum vector tile for closer inspection, so objects and links remain
available without duplicating the full geometry pyramid through zoom 14.

## Regional geographic context

`build-context-region.mjs` uses the same dated Geofabrik PBF and official MD5
sidecar as the power build. Context schema 2 replaces the former z9
motorway/place orientation layer with ten OSM vector layers through z15:

- `base_landcover`: woods, scrub, heath, grass, wetlands, ice, sand and rock;
- `base_landuse`: urban, agricultural, industrial, civic and leisure polygons;
- `base_water`: inland water, reservoirs, basins and riverbanks;
- `base_waterway`: rivers, canals, streams, ditches and drains;
- `base_coastline`: high-zoom OSM coastline ways;
- `base_building`: building footprints from z13;
- `base_road`: the practical hierarchy from motorway through service streets,
  tracks, cycleways, footways, paths and steps;
- `base_boundary`: administrative levels 2–11;
- `base_rail`: heavy rail, narrow gauge, metro, light rail, tram, monorail and
  funicular alignments;
- `base_place`: country, region, city, town, village and local labels.

Feature-specific minimum zooms keep continental views legible. Polygon area
controls the first zoom for water, landcover and landuse; buildings start at
z13; the most local paths and neighbourhood labels start at z14. Tippecanoe
simplifies only below the maximum zoom, detects shared polygon borders and
uses size-based dropping/coalescing only when a tile would exceed 750,000
bytes. The z15 tile retains unsimplified input geometry unless that safety
ceiling is reached.

```sh
node scripts/grid-atlas/osm-self-hosted/build-context-region.mjs \
  --region taiwan \
  --raw /absolute/downloads/taiwan-latest.osm.pbf \
  --work /absolute/work/context/taiwan \
  --output data/grid-atlas/osm-basemap/taiwan.pmtiles \
  --force
```

The builder requires the official Geofabrik MD5 sidecar, verifies way-node
references, runs the streaming normalizer and ten-layer validator, verifies the
PMTiles archive, and writes an adjacent metadata sidecar with all source,
configuration, intermediate and output hashes. Every normalized context
feature retains its OSM object type and ID. Embedded and sidecar metadata carry
the ODbL attribution and schema contract.

Schema 2 is deliberately a build contract, not a promise that all six z15
archives fit inside one GitHub Pages artifact. Buildings and local streets make
full-detail regional extracts orders of magnitude larger than schema 1. Publish
them from a Range-capable object store or as region-on-demand release assets;
do not add all six archives to the Pages deployment without first measuring
the assembled artifact. The Natural Earth archive documented in
`NATURAL_EARTH_CONTEXT.md` remains the compact world/failure fallback.

## Regional build integrity and export reuse

`build-region.mjs` hashes the raw PBF with SHA-256 and MD5 in one read. Keep the
Geofabrik checksum beside the download as `<raw-file>.md5`; if it exists, the
build stops before modifying generated outputs when that official checksum does
not match. The archive sidecar records the computed `sha256` and `md5`, plus
`official_md5_verified`.

A normal build writes
`<work>/<region>-export-provenance.json` automatically. The provenance binds:

- the raw PBF filename, bytes, SHA-256 and MD5;
- the hashes of `regions.json`, `power-tags.filter` and
  `power-points.filter`;
- the hashes of the filtered/clipped PBF and both exported GeoJSON sequences.

`--reuse-export` never trusts unbound intermediates. For legacy intermediates
that predate this file, review their origin and explicitly adopt them once:

```sh
node scripts/grid-atlas/osm-self-hosted/build-region.mjs \
  --region japon \
  --raw /absolute/downloads/japan-latest.osm.pbf \
  --work /absolute/work/japon \
  --output /absolute/output/japon.pmtiles \
  --reuse-export \
  --adopt-reuse-export
```

Later runs use `--reuse-export` alone and recompute every bound hash. The
one-time adoption flag is rejected once provenance exists. `--force` may
replace downstream generated files, but does not bypass reuse provenance
validation.

After conversion, the builder uses `pmtiles edit` to make the TileJSON
`vector_layers` metadata advertise all ten source-layer IDs. Regions with an
empty individual layer therefore keep the same public style contract; the
archive is verified again after the metadata edit.

## Release manifest and GitHub Pages

The six production archives are distributed as assets of the pinned GitHub
release `osm-power-2026-07-25-schema1`. Once all region builds and their
metadata sidecars exist, generate the deterministic deployment manifest:

```sh
node scripts/grid-atlas/osm-self-hosted/generate-pmtiles-manifest.mjs
```

Before publishing or deploying, verify the archive bytes and SHA-256 values
against that manifest:

```sh
node scripts/grid-atlas/osm-self-hosted/verify-pmtiles-manifest.mjs \
  --asset-root data/grid-atlas/osm-power
```

`.github/workflows/deploy-pages.yml` exports the tracked revision into a clean
site directory, downloads exactly those six power assets from the pinned
release, runs the same verifier, rejects any packaged background PMTiles,
enforces the 1,000,000,000-byte Pages budget, and deploys the verified
directory. A partial manifest can be generated only for isolated local tests
by combining `--allow-incomplete` with an explicit `--output`; the deployment
verifier never accepts a partial manifest.

The currently pinned compact geographic release is
`osm-basemap-2026-07-25-schema1`: one `world.pmtiles` archive and the six
schema-1 regional archives. The atlas no longer downloads these archives into
the Pages artifact because OpenInfraMap supplies the active geographic
background. The release and its strict seven-archive manifest remain the
documented recovery path and are reproducible with:

```sh
node scripts/grid-atlas/osm-self-hosted/generate-osm-basemap-manifest.mjs
node scripts/grid-atlas/osm-self-hosted/verify-osm-basemap-manifest.mjs \
  --asset-root data/grid-atlas/osm-basemap
```

The schema-1 generator refuses a context payload over 190,000,000 bytes so the
archived compact set remains measurable. The validated Taiwan schema-2 archive
and its exact build contract are preserved outside the repository under
`../atlas-archives/osm-context-v2/taiwan-2026-07-25/`. Any future runtime use of
schema-2 archives needs on-demand delivery and Range-capable hosting rather
than the aggregate Pages budget.
