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

`build-context-region.mjs` uses the same dated Geofabrik PBFs to build a
separate, compact orientation map. It keeps only:

- OSM motorway, trunk and primary roads, including their link classes;
- named countries, states/provinces, cities and towns.

The output contract is exactly `base_road` and `base_place` at zooms 2–9.
MapLibre overzooms zoom 9 at closer views. This keeps the roads as sharp vector
lines while avoiding a street-navigation payload that would exceed the Pages
site budget. Water, land, urban areas and boundaries come from the separate
global Natural Earth archive documented in `NATURAL_EARTH_CONTEXT.md`.

```sh
node scripts/grid-atlas/osm-self-hosted/build-context-region.mjs \
  --region taiwan \
  --raw /absolute/downloads/taiwan-latest.osm.pbf \
  --work /absolute/work/context/taiwan \
  --output data/grid-atlas/osm-basemap/taiwan.pmtiles \
  --force
```

The builder requires the official Geofabrik MD5 sidecar, verifies way-node
references, enforces a 300,000-byte tile ceiling, runs the streaming normalizer
and validator, verifies the PMTiles archive, and writes an adjacent metadata
sidecar with all source, configuration, intermediate and output hashes.

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
site directory, downloads exactly those six assets from the pinned release,
runs the same verifier, and deploys the verified directory. A partial manifest
can be generated only for isolated local tests by combining
`--allow-incomplete` with an explicit `--output`; the deployment verifier
never accepts a partial manifest.

The self-hosted geographic context is released separately as
`osm-basemap-2026-07-25-schema1`: one `world.pmtiles` archive and the six
regional archives. Generate and validate its strict seven-archive manifest
after all sidecars exist:

```sh
node scripts/grid-atlas/osm-self-hosted/generate-osm-basemap-manifest.mjs
node scripts/grid-atlas/osm-self-hosted/verify-osm-basemap-manifest.mjs \
  --asset-root data/grid-atlas/osm-basemap
```

The generator refuses a context payload over 190,000,000 bytes so the combined
power and geographic archives retain headroom below the Pages published-site
limit.
