#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultManifestPath = path.join(scriptDirectory, 'natural-earth-sources.json');
const expectedLayers = [
  'base_land',
  'base_boundary',
  'base_water',
  'base_waterway',
  'base_urban'
];
const propertyContracts = {
  base_land: {
    allowed: ['class', 'name', 'name_es', 'iso_a2', 'iso_a3', 'rank'],
    className: 'country',
    geometry: ['Polygon', 'MultiPolygon'],
    minimumZoom: 0
  },
  base_boundary: {
    allowed: ['class', 'country', 'rank'],
    className: 'admin1',
    geometry: ['LineString', 'MultiLineString'],
    minimumZoom: 2
  },
  base_water: {
    allowed: ['class', 'name', 'rank'],
    className: 'lake',
    geometry: ['Polygon', 'MultiPolygon'],
    minimumZoom: 1
  },
  base_waterway: {
    allowed: ['class', 'name', 'rank', 'weight'],
    className: 'river',
    geometry: ['LineString', 'MultiLineString'],
    minimumZoom: 2
  },
  base_urban: {
    allowed: ['class', 'rank'],
    className: 'urban',
    geometry: ['Polygon'],
    minimumZoom: 3
  }
};

const usage = `Usage:
  node validate-natural-earth-context.mjs --input-dir DIR --stats PATH [options]

Options:
  --manifest PATH  Pinned source manifest
                   (default: natural-earth-sources.json beside this script)
  --help           Show this help
`;

function parseArguments(values) {
  const parsed = { manifest: defaultManifestPath };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--help' || value === '-h') parsed.help = true;
    else if (value === '--input-dir' || value === '--stats' || value === '--manifest') {
      const next = values[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`Missing value for ${value}`);
      parsed[value.slice(2)] = path.resolve(next);
      index += 1;
    } else {
      throw new Error(`Unexpected argument: ${value}`);
    }
  }
  return parsed;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function increment(record, key) {
  record[key] = (record[key] || 0) + 1;
}

function validateProperties(layer, properties, lineNumber, failures) {
  const contract = propertyContracts[layer];
  if (!isObject(properties)) {
    failures.push(`${layer}:${lineNumber}: properties must be an object`);
    return;
  }
  const keys = Object.keys(properties);
  const unexpected = keys.filter(key => !contract.allowed.includes(key));
  if (unexpected.length) {
    failures.push(`${layer}:${lineNumber}: unexpected properties ${unexpected.join(', ')}`);
  }
  if (properties.class !== contract.className) {
    failures.push(`${layer}:${lineNumber}: class must be ${contract.className}`);
  }
  for (const [key, value] of Object.entries(properties)) {
    if (key === 'rank' || key === 'weight') {
      if (!Number.isFinite(value)) {
        failures.push(`${layer}:${lineNumber}: ${key} must be finite`);
      }
    } else if (typeof value !== 'string' || !value.trim()) {
      failures.push(`${layer}:${lineNumber}: ${key} must be a non-empty string`);
    }
  }
  if (layer === 'base_land' && typeof properties.name !== 'string') {
    failures.push(`${layer}:${lineNumber}: name is required`);
  }
}

async function validateLayer({
  layer,
  inputPath,
  maximumZoom,
  expectedStats,
  failures
}) {
  const contract = propertyContracts[layer];
  const observed = {
    emitted_features: 0,
    minzoom_counts: {}
  };
  const input = createReadStream(inputPath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    observed.emitted_features += 1;
    const lineNumber = observed.emitted_features;
    let feature;
    try {
      feature = JSON.parse(line);
    } catch (error) {
      failures.push(`${layer}:${lineNumber}: invalid JSON (${error.message})`);
      continue;
    }
    if (feature?.type !== 'Feature') {
      failures.push(`${layer}:${lineNumber}: type must be Feature`);
      continue;
    }
    if (!contract.geometry.includes(feature.geometry?.type)) {
      failures.push(
        `${layer}:${lineNumber}: unsupported geometry ${feature.geometry?.type || 'null'}`
      );
    }
    validateProperties(layer, feature.properties, lineNumber, failures);

    const directive = feature.tippecanoe;
    if (
      !isObject(directive) ||
      directive.layer !== layer ||
      !Number.isInteger(directive.minzoom) ||
      directive.minzoom < contract.minimumZoom ||
      directive.minzoom > maximumZoom ||
      directive.maxzoom !== maximumZoom ||
      !sameJson(Object.keys(directive), ['layer', 'minzoom', 'maxzoom'])
    ) {
      failures.push(`${layer}:${lineNumber}: invalid tippecanoe visibility contract`);
    } else {
      increment(observed.minzoom_counts, directive.minzoom);
    }
  }

  if (observed.emitted_features !== expectedStats?.emitted_features) {
    failures.push(
      `${layer}: line count ${observed.emitted_features} does not match stats ` +
      `${expectedStats?.emitted_features}`
    );
  }
  if (!sameJson(observed.minzoom_counts, expectedStats?.minzoom_counts)) {
    failures.push(`${layer}: observed minzoom counts do not match stats`);
  }
  return observed.emitted_features;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usage);
    return;
  }
  if (!args['input-dir'] || !args.stats) {
    console.error(usage);
    process.exitCode = 2;
    return;
  }

  const [manifest, stats] = await Promise.all([
    readFile(args.manifest, 'utf8').then(JSON.parse),
    readFile(args.stats, 'utf8').then(JSON.parse)
  ]);
  const failures = [];
  const sourceLayers = manifest.sources?.map(source => source.layer);
  if (
    manifest.schema_version !== 1 ||
    manifest.dataset !== 'fecundidad-natural-earth-context' ||
    !sameJson(manifest.vector_layers, expectedLayers) ||
    !sameJson(sourceLayers, expectedLayers) ||
    manifest.tile_minzoom !== 0 ||
    manifest.tile_maxzoom !== 8
  ) {
    failures.push('source manifest does not match the Natural Earth z0–8 contract');
  }
  if (
    stats.schema_version !== 1 ||
    stats.dataset !== manifest.dataset ||
    stats.snapshot !== manifest.snapshot ||
    !isObject(stats.layers) ||
    !sameJson(Object.keys(stats.layers), expectedLayers)
  ) {
    failures.push('normalizer stats do not match the source manifest/layer contract');
  }

  const filenames = (await readdir(args['input-dir']))
    .filter(filename => filename.endsWith('.ndjson'))
    .sort();
  const expectedFilenames = expectedLayers.map(layer => `${layer}.ndjson`).sort();
  if (!sameJson(filenames, expectedFilenames)) {
    failures.push(`NDJSON files must be exactly: ${expectedFilenames.join(', ')}`);
  }

  let observedTotal = 0;
  for (const [index, layer] of expectedLayers.entries()) {
    const layerStats = stats.layers?.[layer];
    const source = manifest.sources?.[index];
    if (
      !isObject(layerStats) ||
      layerStats.source_filename !== source?.filename ||
      layerStats.input_records !== source?.feature_count ||
      !Number.isInteger(layerStats.emitted_features) ||
      !Number.isInteger(layerStats.skipped_records) ||
      layerStats.input_records !==
        layerStats.emitted_features + layerStats.skipped_records
    ) {
      failures.push(`${layer}: stats record is inconsistent with the pinned source`);
    }
    observedTotal += await validateLayer({
      layer,
      inputPath: path.join(args['input-dir'], `${layer}.ndjson`),
      maximumZoom: manifest.tile_maxzoom,
      expectedStats: layerStats,
      failures
    });
  }

  const statsInputTotal = Object.values(stats.layers || {})
    .reduce((total, layer) => total + (layer.input_records || 0), 0);
  const statsEmittedTotal = Object.values(stats.layers || {})
    .reduce((total, layer) => total + (layer.emitted_features || 0), 0);
  const statsSkippedTotal = Object.values(stats.layers || {})
    .reduce((total, layer) => total + (layer.skipped_records || 0), 0);
  if (
    stats.input_records !== statsInputTotal ||
    stats.emitted_features !== statsEmittedTotal ||
    stats.skipped_records !== statsSkippedTotal ||
    observedTotal !== stats.emitted_features
  ) {
    failures.push('aggregate feature totals do not match layer stats/output');
  }

  if (failures.length) {
    throw new Error(`Natural Earth context validation failed:\n- ${failures.join('\n- ')}`);
  }
  console.log(
    `Validated ${observedTotal.toLocaleString('en-US')} features across ` +
    `${expectedLayers.length} exact layers`
  );
}

await main();
