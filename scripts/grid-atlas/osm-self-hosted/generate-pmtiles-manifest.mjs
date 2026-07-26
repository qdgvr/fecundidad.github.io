#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '../../..');
const defaultMetadataRoot = path.join(projectDirectory, 'data', 'grid-atlas', 'osm-power');
const defaultOutputPath = path.join(
  projectDirectory,
  'data',
  'grid-atlas',
  'osm-power-manifest.json'
);
const regionsPath = path.join(scriptDirectory, 'regions.json');
const releaseTag = 'osm-power-2026-07-25-schema1';
const archiveRoot = 'data/grid-atlas/osm-power';
const expectedRegionKeys = [
  'europa',
  'estados-unidos',
  'china',
  'japon',
  'corea-del-sur',
  'taiwan'
];
const layerNames = [
  'power_line',
  'power_plant',
  'power_generator_area',
  'power_substation',
  'power_plant_point',
  'power_generator',
  'power_substation_point',
  'power_transformer',
  'power_switch',
  'power_compensator'
];
const referenceIntegrityKeys = [
  'nodes_in_ways_missing',
  'nodes_in_relations_missing',
  'ways_in_relations_missing',
  'relations_in_relations_missing'
];
const expectedLicence = {
  database: 'Open Database License 1.0',
  attribution: '© OpenStreetMap contributors',
  url: 'https://www.openstreetmap.org/copyright'
};

const usage = `Usage:
  node generate-pmtiles-manifest.mjs [options]

Options:
  --metadata-root PATH  Directory containing *.pmtiles.metadata.json sidecars
                        (default: data/grid-atlas/osm-power)
  --output PATH         Manifest destination
                        (default: data/grid-atlas/osm-power-manifest.json)
  --allow-incomplete    Permit a partial manifest for local testing only.
                        Requires an explicit --output path.
  --help                Show this help

The production manifest is strict: all six region sidecars must exist and
must match regions.json and release ${releaseTag}.
`;

function parseArguments(values) {
  const parsed = {
    allowIncomplete: false,
    metadataRoot: defaultMetadataRoot,
    output: defaultOutputPath,
    outputExplicit: false
  };

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--allow-incomplete') {
      parsed.allowIncomplete = true;
    } else if (value === '--help' || value === '-h') {
      parsed.help = true;
    } else if (value === '--metadata-root' || value === '--output') {
      const next = values[index + 1];
      if (!next || next.startsWith('--')) {
        throw new Error(`Missing value for ${value}`);
      }
      if (value === '--metadata-root') parsed.metadataRoot = path.resolve(next);
      else {
        parsed.output = path.resolve(next);
        parsed.outputExplicit = true;
      }
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (parsed.allowIncomplete && !parsed.outputExplicit) {
    throw new Error('--allow-incomplete requires an explicit --output path');
  }
  return parsed;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isInteger(value, minimum = 0) {
  return Number.isInteger(value) && value >= minimum;
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isMd5(value) {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isFiniteNumberArray(value, length) {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

function sortedRecord(record = {}) {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
  );
}

function assertMetadata(metadata, regionKey, region, config, metadataPath) {
  const errors = [];
  const expectedAsset = region.output_filename;
  const expectedPath = `${archiveRoot}/${expectedAsset}`;
  const context = path.relative(projectDirectory, metadataPath);
  const requireCondition = (condition, message) => {
    if (!condition) errors.push(`${context}: ${message}`);
  };

  requireCondition(isObject(metadata), 'root must be an object');
  if (!isObject(metadata)) return errors;

  requireCondition(metadata.schema_version === 1, 'schema_version must be 1');
  requireCondition(metadata.region === regionKey, `region must be ${regionKey}`);
  requireCondition(metadata.label === region.label, `label must be ${region.label}`);
  requireCondition(metadata.snapshot === config.snapshot, `snapshot must be ${config.snapshot}`);
  requireCondition(
    typeof metadata.generated_at === 'string' &&
      Number.isFinite(Date.parse(metadata.generated_at)),
    'generated_at must be an ISO-compatible timestamp'
  );
  requireCondition(
    sameJson(metadata.bounds, region.bounds),
    'bounds must match the configured display bounds'
  );

  requireCondition(isObject(metadata.source), 'source must be an object');
  if (isObject(metadata.source)) {
    requireCondition(metadata.source.url === region.source_url, 'source.url does not match regions.json');
    requireCondition(
      metadata.source.filename === region.raw_filename,
      'source.filename does not match regions.json'
    );
    requireCondition(isInteger(metadata.source.bytes, 1), 'source.bytes must be a positive integer');
    requireCondition(isSha256(metadata.source.sha256), 'source.sha256 must be lowercase SHA-256');
    requireCondition(isMd5(metadata.source.md5), 'source.md5 must be a lowercase MD5');
    requireCondition(
      isMd5(metadata.source.official_md5),
      'source.official_md5 must be a verified lowercase MD5'
    );
    requireCondition(
      metadata.source.official_md5_verified === true,
      'source.official_md5_verified must be true'
    );
    if (isMd5(metadata.source.md5) && isMd5(metadata.source.official_md5)) {
      requireCondition(
        metadata.source.md5 === metadata.source.official_md5,
        'source.md5 must equal source.official_md5'
      );
    }
  }

  requireCondition(
    isObject(metadata.reference_integrity),
    'reference_integrity must be an object'
  );
  if (isObject(metadata.reference_integrity)) {
    for (const key of referenceIntegrityKeys) {
      requireCondition(
        isInteger(metadata.reference_integrity[key]),
        `reference_integrity.${key} must be a non-negative integer`
      );
    }
    const unexpectedKeys = Object.keys(metadata.reference_integrity)
      .filter(key => !referenceIntegrityKeys.includes(key));
    requireCondition(
      unexpectedKeys.length === 0,
      `reference_integrity contains unexpected keys: ${unexpectedKeys.join(', ')}`
    );
    requireCondition(
      metadata.reference_integrity.nodes_in_ways_missing === 0,
      'reference_integrity.nodes_in_ways_missing must be zero'
    );
  }

  requireCondition(isObject(metadata.output), 'output must be an object');
  if (isObject(metadata.output)) {
    requireCondition(metadata.output.filename === expectedAsset, `output.filename must be ${expectedAsset}`);
    requireCondition(metadata.output.path === expectedPath, `output.path must be ${expectedPath}`);
    requireCondition(isInteger(metadata.output.bytes, 1), 'output.bytes must be a positive integer');
    requireCondition(isSha256(metadata.output.sha256), 'output.sha256 must be lowercase SHA-256');
    requireCondition(
      metadata.output.minzoom === config.tile_minzoom,
      `output.minzoom must be ${config.tile_minzoom}`
    );
    requireCondition(
      metadata.output.maxzoom === config.tile_maxzoom,
      `output.maxzoom must be ${config.tile_maxzoom}`
    );
    requireCondition(metadata.output.tile_type === 'mvt', 'output.tile_type must be mvt');
    requireCondition(metadata.output.tile_compression === 'gzip', 'output.tile_compression must be gzip');
    requireCondition(
      isFiniteNumberArray(metadata.output.bounds, 4),
      'output.bounds must contain four finite values'
    );
    requireCondition(
      isFiniteNumberArray(metadata.output.center, 3),
      'output.center must contain three finite values'
    );
  }

  requireCondition(isObject(metadata.features), 'features must be an object');
  if (isObject(metadata.features)) {
    requireCondition(isInteger(metadata.features.records), 'features.records must be a non-negative integer');
    requireCondition(isInteger(metadata.features.emitted), 'features.emitted must be a non-negative integer');
    requireCondition(
      isInteger(metadata.features.source_objects),
      'features.source_objects must be a non-negative integer'
    );
    requireCondition(
      isInteger(metadata.features.centroid_duplicates),
      'features.centroid_duplicates must be a non-negative integer'
    );
    requireCondition(isInteger(metadata.features.skipped), 'features.skipped must be a non-negative integer');
    requireCondition(
      isInteger(metadata.features.geometry_promotions),
      'features.geometry_promotions must be a non-negative integer'
    );
    requireCondition(
      isInteger(metadata.features.geometry_reductions),
      'features.geometry_reductions must be a non-negative integer'
    );
    if (
      isInteger(metadata.features.records) &&
      isInteger(metadata.features.source_objects) &&
      isInteger(metadata.features.skipped)
    ) {
      requireCondition(
        metadata.features.records ===
          metadata.features.source_objects + metadata.features.skipped,
        'features.records must equal features.source_objects + features.skipped'
      );
    }
    if (
      isInteger(metadata.features.emitted) &&
      isInteger(metadata.features.source_objects) &&
      isInteger(metadata.features.centroid_duplicates)
    ) {
      requireCondition(
        metadata.features.emitted ===
          metadata.features.source_objects + metadata.features.centroid_duplicates,
        'features.emitted must equal features.source_objects + features.centroid_duplicates'
      );
    }
    if (
      isInteger(metadata.features.geometry_promotions) &&
      isInteger(metadata.features.source_objects)
    ) {
      requireCondition(
        metadata.features.geometry_promotions <= metadata.features.source_objects,
        'features.geometry_promotions cannot exceed features.source_objects'
      );
    }
    if (
      isInteger(metadata.features.geometry_reductions) &&
      isInteger(metadata.features.source_objects)
    ) {
      requireCondition(
        metadata.features.geometry_reductions <= metadata.features.source_objects,
        'features.geometry_reductions cannot exceed features.source_objects'
      );
    }
    requireCondition(isObject(metadata.features.layers), 'features.layers must be an object');
    if (isObject(metadata.features.layers)) {
      const layerTotal = layerNames.reduce((total, layerName) => {
        const count = metadata.features.layers[layerName];
        requireCondition(isInteger(count), `features.layers.${layerName} must be a non-negative integer`);
        return total + (isInteger(count) ? count : 0);
      }, 0);
      requireCondition(
        layerTotal === metadata.features.emitted,
        `features.emitted (${metadata.features.emitted}) must equal the layer total (${layerTotal})`
      );
      const areaTotal = [
        'power_plant',
        'power_generator_area',
        'power_substation'
      ].reduce((total, layerName) => total + metadata.features.layers[layerName], 0);
      requireCondition(
        areaTotal === metadata.features.centroid_duplicates,
        `features.centroid_duplicates (${metadata.features.centroid_duplicates}) ` +
          `must equal the area-feature total (${areaTotal})`
      );
      const unexpectedLayers = Object.keys(metadata.features.layers)
        .filter(layerName => !layerNames.includes(layerName));
      requireCondition(
        unexpectedLayers.length === 0,
        `features.layers contains unexpected keys: ${unexpectedLayers.join(', ')}`
      );
    }
  }

  requireCondition(
    Array.isArray(metadata.vector_layers),
    'vector_layers must be an array'
  );
  if (Array.isArray(metadata.vector_layers)) {
    const vectorLayerIds = metadata.vector_layers.map(layer => layer?.id);
    requireCondition(
      sameJson(vectorLayerIds, layerNames),
      `vector_layers must advertise exactly these IDs in order: ${layerNames.join(', ')}`
    );
  }

  requireCondition(isObject(metadata.tools), 'tools must be an object');
  for (const tool of ['node', 'osmium', 'tippecanoe', 'pmtiles']) {
    requireCondition(
      typeof metadata.tools?.[tool] === 'string' && metadata.tools[tool].trim().length > 0,
      `tools.${tool} must be a non-empty string`
    );
  }
  requireCondition(
    sameJson(metadata.licence, expectedLicence),
    'licence must match the OSM/ODbL attribution contract'
  );

  return errors;
}

function makeArchive(metadata, regionKey) {
  const layers = Object.fromEntries(
    layerNames.map(layerName => [layerName, metadata.features.layers[layerName]])
  );
  const layerTotal = Object.values(layers).reduce((total, count) => total + count, 0);
  const asset = metadata.output.filename;

  return {
    region: regionKey,
    label: metadata.label,
    asset,
    path: metadata.output.path,
    metadata_path: `${archiveRoot}/${asset}.metadata.json`,
    built_at: metadata.generated_at,
    bytes: metadata.output.bytes,
    sha256: metadata.output.sha256,
    minzoom: metadata.output.minzoom,
    maxzoom: metadata.output.maxzoom,
    display_bounds: metadata.bounds,
    bounds: metadata.output.bounds,
    center: metadata.output.center,
    tile_type: metadata.output.tile_type,
    tile_compression: metadata.output.tile_compression,
    features: {
      total: layerTotal,
      emitted: metadata.features.emitted,
      records: metadata.features.records,
      source_objects: metadata.features.source_objects,
      centroid_duplicates: metadata.features.centroid_duplicates,
      skipped: metadata.features.skipped,
      geometry_promotions: metadata.features.geometry_promotions,
      geometry_reductions: metadata.features.geometry_reductions,
      skip_reasons: sortedRecord(metadata.features.skip_reasons),
      statuses: sortedRecord(metadata.features.statuses),
      layers
    },
    reference_integrity: Object.fromEntries(
      referenceIntegrityKeys.map(key => [key, metadata.reference_integrity[key]])
    ),
    source: {
      provider: 'Geofabrik GmbH',
      database: 'OpenStreetMap',
      url: metadata.source.url,
      filename: metadata.source.filename,
      bytes: metadata.source.bytes,
      sha256: metadata.source.sha256,
      md5: metadata.source.md5,
      official_md5: metadata.source.official_md5,
      official_md5_verified: metadata.source.official_md5_verified
    },
    tools: {
      node: metadata.tools.node,
      osmium: metadata.tools.osmium,
      tippecanoe: metadata.tools.tippecanoe,
      pmtiles: metadata.tools.pmtiles
    }
  };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usage);
    return;
  }

  const config = JSON.parse(await readFile(regionsPath, 'utf8'));
  const configuredKeys = Object.keys(config.regions || {});
  if (!sameJson(configuredKeys, expectedRegionKeys)) {
    throw new Error(
      `regions.json must define exactly these regions in order: ${expectedRegionKeys.join(', ')}`
    );
  }
  if (typeof config.snapshot !== 'string' || !config.snapshot.length) {
    throw new Error('regions.json must define a non-empty snapshot');
  }
  if (
    !Number.isInteger(config.tile_minzoom) ||
    !Number.isInteger(config.tile_maxzoom) ||
    config.tile_minzoom < 0 ||
    config.tile_maxzoom < config.tile_minzoom
  ) {
    throw new Error('regions.json must define a valid tile_minzoom/tile_maxzoom pair');
  }

  const metadataByRegion = new Map();
  const missingRegions = [];
  const metadataErrors = [];

  for (const regionKey of expectedRegionKeys) {
    const region = config.regions[regionKey];
    const metadataPath = path.join(
      args.metadataRoot,
      `${region.output_filename}.metadata.json`
    );
    if (!(await exists(metadataPath))) {
      missingRegions.push(regionKey);
      continue;
    }

    let metadata;
    try {
      metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    } catch (error) {
      metadataErrors.push(`${metadataPath}: invalid JSON (${error.message})`);
      continue;
    }
    metadataErrors.push(
      ...assertMetadata(metadata, regionKey, region, config, metadataPath)
    );
    metadataByRegion.set(regionKey, metadata);
  }

  if (metadataErrors.length) {
    throw new Error(`Metadata validation failed:\n- ${metadataErrors.join('\n- ')}`);
  }
  if (missingRegions.length && !args.allowIncomplete) {
    throw new Error(
      `Missing PMTiles metadata for ${missingRegions.length} of ${expectedRegionKeys.length} required regions: ` +
      `${missingRegions.join(', ')}. Production generation is strict. ` +
      'Use --allow-incomplete with an explicit --output only for local testing.'
    );
  }

  const archives = expectedRegionKeys
    .filter(regionKey => metadataByRegion.has(regionKey))
    .map(regionKey => makeArchive(metadataByRegion.get(regionKey), regionKey));
  const manifest = {
    schema_version: 1,
    dataset: 'fecundidad-osm-power',
    release_tag: releaseTag,
    snapshot: config.snapshot,
    complete: missingRegions.length === 0,
    expected_archive_count: expectedRegionKeys.length,
    archive_count: archives.length,
    region_order: expectedRegionKeys,
    missing_regions: missingRegions,
    archive_root: archiveRoot,
    pipeline: {
      schema_version: 1,
      format: 'PMTiles',
      content: 'Mapbox Vector Tile',
      source_database: 'OpenStreetMap',
      extract_provider: 'Geofabrik GmbH',
      minzoom: config.tile_minzoom,
      maxzoom: config.tile_maxzoom,
      vector_layers: layerNames,
      regions_config: 'scripts/grid-atlas/osm-self-hosted/regions.json',
      build_script: 'scripts/grid-atlas/osm-self-hosted/build-region.mjs',
      normalizer: 'scripts/grid-atlas/osm-self-hosted/normalize-osm-power.mjs',
      validator: 'scripts/grid-atlas/osm-self-hosted/validate-osm-power.mjs'
    },
    licence: expectedLicence,
    totals: {
      bytes: archives.reduce((total, archive) => total + archive.bytes, 0),
      features: archives.reduce((total, archive) => total + archive.features.total, 0)
    },
    archives
  };

  await mkdir(path.dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const qualifier = manifest.complete ? 'complete' : 'incomplete test';
  console.log(
    `Wrote ${qualifier} manifest for ${archives.length}/${expectedRegionKeys.length} archives: ` +
    `${args.output}`
  );
}

main().catch(error => {
  console.error(`Manifest generation failed: ${error.message}`);
  process.exitCode = 1;
});
