# Natural Earth world context tiles

`world.pmtiles` is the small, global geographic-context archive beneath the
regional OpenStreetMap roads and power data. It is built from five Natural
Earth 1:10m GeoJSON sources and contains exactly these source layers:

1. `base_land`
2. `base_boundary`
3. `base_water`
4. `base_waterway`
5. `base_urban`

The source files, byte lengths, SHA-256 values, source URLs, feature counts,
licence, layer order and zoom contract are pinned in
`natural-earth-sources.json`. A changed upstream `master` file is never
silently accepted: the normalizer and builder both verify all pinned bytes
before normalization.

## Build

The builder requires Node.js, Tippecanoe and the PMTiles CLI:

```sh
node scripts/grid-atlas/osm-self-hosted/build-world-context.mjs \
  --source-root /absolute/path/to/natural-earth \
  --work /absolute/path/to/work/world-context \
  --output data/grid-atlas/osm-basemap/world.pmtiles \
  --force
```

It performs the complete pipeline:

- verifies all five input byte lengths and SHA-256 values;
- writes compact, source-ordered NDJSON;
- validates feature schemas, geometry families, layer IDs and zoom gates;
- builds zooms 0–8 with Tippecanoe, simplification 2, a 300,000-byte tile
  ceiling, and density/coalescing safeguards;
- converts to PMTiles;
- replaces Tippecanoe's path-bearing metadata with a deterministic metadata
  contract;
- runs `pmtiles verify`;
- writes `world.pmtiles.metadata.json` beside the archive.

The sidecar's `generated_at` is deliberately the pinned
`natural-earth-sources.json#pinned_at` value, not the wall-clock build time.
Together with path-independent archive metadata, this makes repeated builds
with the same inputs and tool versions byte-for-byte comparable. Actual build
time belongs in CI/release logs.

The production archive path is
`data/grid-atlas/osm-basemap/world.pmtiles`. The large binary is release-hosted
and ignored by Git; its small metadata sidecar and aggregate basemap manifest
are tracked.

## Isolated normalization and validation

```sh
node scripts/grid-atlas/osm-self-hosted/normalize-natural-earth-context.mjs \
  --source-root /absolute/path/to/natural-earth \
  --output-dir /absolute/path/to/normalized \
  --stats /absolute/path/to/world-feature-counts.json \
  --force

node scripts/grid-atlas/osm-self-hosted/validate-natural-earth-context.mjs \
  --input-dir /absolute/path/to/normalized \
  --stats /absolute/path/to/world-feature-counts.json
```

Natural Earth data are public domain. The archive preserves the reader-facing
credit `Made with Natural Earth` and links to Natural Earth's official terms in
its source manifest and metadata sidecar.
