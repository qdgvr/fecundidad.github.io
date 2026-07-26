#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '../../..');
const defaultManifestPath = path.join(
  projectDirectory,
  'data',
  'grid-atlas',
  'osm-power-manifest.json'
);
const defaultAssetRoot = path.join(projectDirectory, 'data', 'grid-atlas', 'osm-power');
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
  node verify-pmtiles-manifest.mjs [options]

Options:
  --manifest PATH    Manifest to validate
                     (default: data/grid-atlas/osm-power-manifest.json)
  --asset-root PATH  Directory containing the six downloaded PMTiles assets
                     (default: data/grid-atlas/osm-power)
  --help             Show this help

This verifier is production-strict. It accepts only the complete six-region
manifest for release ${releaseTag}.
`;

function parseArguments(values) {
  const parsed = {
    manifest: defaultManifestPath,
    assetRoot: defaultAssetRoot
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--help' || value === '-h') {
      parsed.help = true;
    } else if (value === '--manifest' || value === '--asset-root') {
      const next = values[index + 1];
      if (!next || next.startsWith('--')) {
        throw new Error(`Missing value for ${value}`);
      }
      if (value === '--manifest') parsed.manifest = path.resolve(next);
      else parsed.assetRoot = path.resolve(next);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return parsed;
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

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const digest = createHash('sha256');
    const input = createReadStream(filePath);
    input.on('error', reject);
    input.on('data', chunk => digest.update(chunk));
    input.on('end', () => resolve(digest.digest('hex')));
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 ** 2)).toFixed(1)} MiB`;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usage);
    return;
  }

  let manifest;
  let config;
  try {
    [manifest, config] = await Promise.all([
      readFile(args.manifest, 'utf8').then(JSON.parse),
      readFile(regionsPath, 'utf8').then(JSON.parse)
    ]);
  } catch (error) {
    throw new Error(`Could not read manifest/config JSON: ${error.message}`);
  }

  const failures = [];
  const requireCondition = (condition, message) => {
    if (!condition) failures.push(message);
    return condition;
  };
  const configuredKeys = Object.keys(config.regions || {});

  requireCondition(isObject(manifest), 'manifest root must be an object');
  if (!isObject(manifest)) {
    throw new Error(failures.join('\n- '));
  }

  requireCondition(
    sameJson(configuredKeys, expectedRegionKeys),
    `regions.json must define exactly: ${expectedRegionKeys.join(', ')}`
  );
  requireCondition(
    Number.isInteger(config.tile_minzoom) &&
      Number.isInteger(config.tile_maxzoom) &&
      config.tile_minzoom >= 0 &&
      config.tile_maxzoom >= config.tile_minzoom,
    'regions.json must define a valid tile_minzoom/tile_maxzoom pair'
  );
  requireCondition(manifest.schema_version === 1, 'schema_version must be 1');
  requireCondition(manifest.dataset === 'fecundidad-osm-power', 'dataset must be fecundidad-osm-power');
  requireCondition(manifest.release_tag === releaseTag, `release_tag must be ${releaseTag}`);
  requireCondition(manifest.snapshot === config.snapshot, 'snapshot must match regions.json');
  requireCondition(manifest.complete === true, 'manifest must be complete');
  requireCondition(
    manifest.expected_archive_count === expectedRegionKeys.length,
    `expected_archive_count must be ${expectedRegionKeys.length}`
  );
  requireCondition(
    manifest.archive_count === expectedRegionKeys.length,
    `archive_count must be ${expectedRegionKeys.length}`
  );
  requireCondition(
    sameJson(manifest.region_order, expectedRegionKeys),
    'region_order must match the pinned six-region order'
  );
  requireCondition(
    Array.isArray(manifest.missing_regions) && manifest.missing_regions.length === 0,
    'missing_regions must be an empty array'
  );
  requireCondition(manifest.archive_root === archiveRoot, `archive_root must be ${archiveRoot}`);
  requireCondition(
    sameJson(manifest.licence, expectedLicence),
    'licence must match the OSM/ODbL attribution contract'
  );
  requireCondition(isObject(manifest.pipeline), 'pipeline must be an object');
  if (isObject(manifest.pipeline)) {
    requireCondition(manifest.pipeline.schema_version === 1, 'pipeline.schema_version must be 1');
    requireCondition(manifest.pipeline.format === 'PMTiles', 'pipeline.format must be PMTiles');
    requireCondition(
      manifest.pipeline.content === 'Mapbox Vector Tile',
      'pipeline.content must be Mapbox Vector Tile'
    );
    requireCondition(
      manifest.pipeline.source_database === 'OpenStreetMap',
      'pipeline.source_database must be OpenStreetMap'
    );
    requireCondition(
      manifest.pipeline.extract_provider === 'Geofabrik GmbH',
      'pipeline.extract_provider must be Geofabrik GmbH'
    );
    requireCondition(
      manifest.pipeline.minzoom === config.tile_minzoom,
      'pipeline.minzoom must match regions.json'
    );
    requireCondition(
      manifest.pipeline.maxzoom === config.tile_maxzoom,
      'pipeline.maxzoom must match regions.json'
    );
    requireCondition(
      sameJson(manifest.pipeline.vector_layers, layerNames),
      'pipeline.vector_layers must match the ten-layer runtime contract'
    );
  }
  requireCondition(Array.isArray(manifest.archives), 'archives must be an array');

  const archives = Array.isArray(manifest.archives) ? manifest.archives : [];
  requireCondition(
    archives.length === expectedRegionKeys.length,
    `archives must contain ${expectedRegionKeys.length} entries`
  );

  const archiveByRegion = new Map();
  for (const [index, archive] of archives.entries()) {
    if (!isObject(archive)) {
      failures.push(`archives[${index}] must be an object`);
      continue;
    }
    if (archiveByRegion.has(archive.region)) {
      failures.push(`duplicate archive region: ${archive.region}`);
    }
    archiveByRegion.set(archive.region, archive);
  }

  let manifestByteTotal = 0;
  let manifestFeatureTotal = 0;

  for (const regionKey of expectedRegionKeys) {
    const archive = archiveByRegion.get(regionKey);
    const region = config.regions?.[regionKey];
    if (!archive) {
      failures.push(`missing archive entry for ${regionKey}`);
      continue;
    }

    const expectedAsset = region.output_filename;
    const expectedPath = `${archiveRoot}/${expectedAsset}`;
    const expectedMetadataPath = `${expectedPath}.metadata.json`;
    const prefix = `${regionKey}:`;

    requireCondition(archive.label === region.label, `${prefix} label must be ${region.label}`);
    requireCondition(archive.asset === expectedAsset, `${prefix} asset must be ${expectedAsset}`);
    requireCondition(archive.path === expectedPath, `${prefix} path must be ${expectedPath}`);
    requireCondition(
      archive.metadata_path === expectedMetadataPath,
      `${prefix} metadata_path must be ${expectedMetadataPath}`
    );
    requireCondition(isInteger(archive.bytes, 1), `${prefix} bytes must be a positive integer`);
    requireCondition(isSha256(archive.sha256), `${prefix} sha256 must be lowercase SHA-256`);
    requireCondition(
      archive.minzoom === config.tile_minzoom,
      `${prefix} minzoom must be ${config.tile_minzoom}`
    );
    requireCondition(
      archive.maxzoom === config.tile_maxzoom,
      `${prefix} maxzoom must be ${config.tile_maxzoom}`
    );
    requireCondition(archive.tile_type === 'mvt', `${prefix} tile_type must be mvt`);
    requireCondition(archive.tile_compression === 'gzip', `${prefix} tile_compression must be gzip`);
    requireCondition(
      sameJson(archive.display_bounds, region.bounds),
      `${prefix} display_bounds must match regions.json`
    );
    requireCondition(
      Array.isArray(archive.bounds) &&
        archive.bounds.length === 4 &&
        archive.bounds.every(Number.isFinite),
      `${prefix} bounds must contain four finite numbers`
    );
    requireCondition(
      Array.isArray(archive.center) &&
        archive.center.length === 3 &&
        archive.center.every(Number.isFinite),
      `${prefix} center must contain three finite numbers`
    );

    requireCondition(isObject(archive.features), `${prefix} features must be an object`);
    if (isObject(archive.features)) {
      requireCondition(
        isInteger(archive.features.total),
        `${prefix} features.total must be a non-negative integer`
      );
      requireCondition(
        isInteger(archive.features.emitted),
        `${prefix} features.emitted must be a non-negative integer`
      );
      requireCondition(
        isInteger(archive.features.records),
        `${prefix} features.records must be a non-negative integer`
      );
      requireCondition(
        isInteger(archive.features.source_objects),
        `${prefix} features.source_objects must be a non-negative integer`
      );
      requireCondition(
        isInteger(archive.features.centroid_duplicates),
        `${prefix} features.centroid_duplicates must be a non-negative integer`
      );
      requireCondition(
        isInteger(archive.features.skipped),
        `${prefix} features.skipped must be a non-negative integer`
      );
      requireCondition(
        isInteger(archive.features.geometry_promotions),
        `${prefix} features.geometry_promotions must be a non-negative integer`
      );
      requireCondition(
        isInteger(archive.features.geometry_reductions),
        `${prefix} features.geometry_reductions must be a non-negative integer`
      );
      if (
        isInteger(archive.features.records) &&
        isInteger(archive.features.source_objects) &&
        isInteger(archive.features.skipped)
      ) {
        requireCondition(
          archive.features.records ===
            archive.features.source_objects + archive.features.skipped,
          `${prefix} features.records must equal features.source_objects + features.skipped`
        );
      }
      if (
        isInteger(archive.features.emitted) &&
        isInteger(archive.features.source_objects) &&
        isInteger(archive.features.centroid_duplicates)
      ) {
        requireCondition(
          archive.features.emitted ===
            archive.features.source_objects + archive.features.centroid_duplicates,
          `${prefix} features.emitted must equal features.source_objects + features.centroid_duplicates`
        );
      }
      if (
        isInteger(archive.features.geometry_promotions) &&
        isInteger(archive.features.source_objects)
      ) {
        requireCondition(
          archive.features.geometry_promotions <= archive.features.source_objects,
          `${prefix} features.geometry_promotions cannot exceed features.source_objects`
        );
      }
      if (
        isInteger(archive.features.geometry_reductions) &&
        isInteger(archive.features.source_objects)
      ) {
        requireCondition(
          archive.features.geometry_reductions <= archive.features.source_objects,
          `${prefix} features.geometry_reductions cannot exceed features.source_objects`
        );
      }
      requireCondition(isObject(archive.features.layers), `${prefix} features.layers must be an object`);
      if (isObject(archive.features.layers)) {
        const layerTotal = layerNames.reduce((total, layerName) => {
          const count = archive.features.layers[layerName];
          requireCondition(
            isInteger(count),
            `${prefix} features.layers.${layerName} must be a non-negative integer`
          );
          return total + (isInteger(count) ? count : 0);
        }, 0);
        requireCondition(
          layerTotal === archive.features.total,
          `${prefix} features.total must equal the layer total (${layerTotal})`
        );
        requireCondition(
          layerTotal === archive.features.emitted,
          `${prefix} features.emitted must equal the layer total (${layerTotal})`
        );
        const areaTotal = [
          'power_plant',
          'power_generator_area',
          'power_substation'
        ].reduce((total, layerName) => total + archive.features.layers[layerName], 0);
        requireCondition(
          areaTotal === archive.features.centroid_duplicates,
          `${prefix} features.centroid_duplicates must equal the area-feature total (${areaTotal})`
        );
        const unexpectedLayers = Object.keys(archive.features.layers)
          .filter(layerName => !layerNames.includes(layerName));
        requireCondition(
          unexpectedLayers.length === 0,
          `${prefix} unexpected layers: ${unexpectedLayers.join(', ')}`
        );
      }
    }

    requireCondition(
      isObject(archive.reference_integrity),
      `${prefix} reference_integrity must be an object`
    );
    if (isObject(archive.reference_integrity)) {
      for (const key of referenceIntegrityKeys) {
        requireCondition(
          isInteger(archive.reference_integrity[key]),
          `${prefix} reference_integrity.${key} must be a non-negative integer`
        );
      }
      const unexpectedKeys = Object.keys(archive.reference_integrity)
        .filter(key => !referenceIntegrityKeys.includes(key));
      requireCondition(
        unexpectedKeys.length === 0,
        `${prefix} unexpected reference_integrity keys: ${unexpectedKeys.join(', ')}`
      );
      requireCondition(
        archive.reference_integrity.nodes_in_ways_missing === 0,
        `${prefix} reference_integrity.nodes_in_ways_missing must be zero`
      );
    }

    requireCondition(isObject(archive.source), `${prefix} source must be an object`);
    if (isObject(archive.source)) {
      requireCondition(
        archive.source.provider === 'Geofabrik GmbH',
        `${prefix} source.provider must be Geofabrik GmbH`
      );
      requireCondition(
        archive.source.database === 'OpenStreetMap',
        `${prefix} source.database must be OpenStreetMap`
      );
      requireCondition(
        archive.source.url === region.source_url,
        `${prefix} source.url does not match regions.json`
      );
      requireCondition(
        archive.source.filename === region.raw_filename,
        `${prefix} source.filename does not match regions.json`
      );
      requireCondition(
        isInteger(archive.source.bytes, 1),
        `${prefix} source.bytes must be a positive integer`
      );
      requireCondition(
        isSha256(archive.source.sha256),
        `${prefix} source.sha256 must be lowercase SHA-256`
      );
      requireCondition(
        isMd5(archive.source.md5),
        `${prefix} source.md5 must be a lowercase MD5`
      );
      requireCondition(
        isMd5(archive.source.official_md5),
        `${prefix} source.official_md5 must be a verified lowercase MD5`
      );
      requireCondition(
        archive.source.official_md5_verified === true,
        `${prefix} source.official_md5_verified must be true`
      );
      if (isMd5(archive.source.md5) && isMd5(archive.source.official_md5)) {
        requireCondition(
          archive.source.md5 === archive.source.official_md5,
          `${prefix} source.md5 must equal source.official_md5`
        );
      }
    }

    requireCondition(isObject(archive.tools), `${prefix} tools must be an object`);
    for (const tool of ['node', 'osmium', 'tippecanoe', 'pmtiles']) {
      requireCondition(
        typeof archive.tools?.[tool] === 'string' && archive.tools[tool].trim().length > 0,
        `${prefix} tools.${tool} must be a non-empty string`
      );
    }

    if (isInteger(archive.bytes, 1)) manifestByteTotal += archive.bytes;
    if (isInteger(archive.features?.total)) manifestFeatureTotal += archive.features.total;

    const assetPath = path.join(args.assetRoot, expectedAsset);
    try {
      const details = await stat(assetPath);
      requireCondition(details.isFile(), `${prefix} asset is not a regular file: ${assetPath}`);
      requireCondition(
        details.size === archive.bytes,
        `${prefix} byte mismatch: manifest ${archive.bytes}, file ${details.size}`
      );
      const actualSha256 = await hashFile(assetPath);
      requireCondition(
        actualSha256 === archive.sha256,
        `${prefix} SHA-256 mismatch: manifest ${archive.sha256}, file ${actualSha256}`
      );
    } catch (error) {
      failures.push(`${prefix} could not verify ${assetPath}: ${error.message}`);
    }
  }

  const unexpectedRegions = [...archiveByRegion.keys()]
    .filter(regionKey => !expectedRegionKeys.includes(regionKey));
  requireCondition(
    unexpectedRegions.length === 0,
    `unexpected archive regions: ${unexpectedRegions.join(', ')}`
  );
  requireCondition(isObject(manifest.totals), 'totals must be an object');
  requireCondition(
    manifest.totals?.bytes === manifestByteTotal,
    `totals.bytes must equal ${manifestByteTotal}`
  );
  requireCondition(
    manifest.totals?.features === manifestFeatureTotal,
    `totals.features must equal ${manifestFeatureTotal}`
  );

  if (failures.length) {
    throw new Error(`Verification failed:\n- ${failures.join('\n- ')}`);
  }

  console.log(
    `Verified ${expectedRegionKeys.length} PMTiles assets (${formatBytes(manifestByteTotal)}) ` +
    `for ${releaseTag}.`
  );
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
