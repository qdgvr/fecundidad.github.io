#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
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

const usage = `Usage:
  node normalize-natural-earth-context.mjs --source-root DIR --output-dir DIR [options]

Options:
  --manifest PATH  Pinned source manifest
                   (default: natural-earth-sources.json beside this script)
  --stats PATH     Stats destination (default: DIR/stats.json)
  --force          Replace an existing output directory
  --help           Show this help

Every input is checked against its pinned byte length and SHA-256 before any
feature is normalized. Output is deterministic NDJSON in source feature order.
`;

function parseArguments(values) {
  const parsed = {
    force: false,
    manifest: defaultManifestPath
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--force') parsed.force = true;
    else if (value === '--help' || value === '-h') parsed.help = true;
    else if (
      value === '--source-root' ||
      value === '--output-dir' ||
      value === '--manifest' ||
      value === '--stats'
    ) {
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

function cleanText(value) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  return text === '-99' ? '' : text;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerValue(value) {
  const number = finiteNumber(value);
  return number === null ? null : Math.round(number);
}

function zoomValue(value, fallback, minimum, maximum) {
  const number = finiteNumber(value);
  const candidate = number === null ? fallback : Math.ceil(number);
  return Math.max(minimum, Math.min(maximum, candidate));
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

async function verifySource(sourceRoot, source) {
  const sourcePath = path.join(sourceRoot, source.filename);
  const details = await stat(sourcePath);
  if (details.size !== source.bytes) {
    throw new Error(
      `${source.filename}: byte length mismatch; expected ${source.bytes}, got ${details.size}`
    );
  }
  const sha256 = await hashFile(sourcePath);
  if (sha256 !== source.sha256) {
    throw new Error(
      `${source.filename}: SHA-256 mismatch; expected ${source.sha256}, got ${sha256}`
    );
  }
  return {
    path: sourcePath,
    filename: source.filename,
    bytes: details.size,
    sha256
  };
}

function validateManifest(manifest) {
  if (!isObject(manifest)) throw new Error('Source manifest root must be an object');
  if (manifest.schema_version !== 1) {
    throw new Error(`Unsupported source manifest schema: ${manifest.schema_version}`);
  }
  if (manifest.dataset !== 'fecundidad-natural-earth-context') {
    throw new Error(`Unexpected dataset: ${manifest.dataset}`);
  }
  if (!Number.isInteger(manifest.tile_minzoom) || !Number.isInteger(manifest.tile_maxzoom)) {
    throw new Error('Source manifest must define integer tile_minzoom/tile_maxzoom');
  }
  if (manifest.tile_minzoom !== 0 || manifest.tile_maxzoom !== 8) {
    throw new Error('Natural Earth context contract must use zooms 0–8');
  }
  if (!sameJson(manifest.vector_layers, expectedLayers)) {
    throw new Error(`vector_layers must be exactly: ${expectedLayers.join(', ')}`);
  }
  if (!Array.isArray(manifest.sources) || manifest.sources.length !== expectedLayers.length) {
    throw new Error(`sources must contain exactly ${expectedLayers.length} records`);
  }
  if (!sameJson(manifest.sources.map(source => source.layer), expectedLayers)) {
    throw new Error(`Source order must be exactly: ${expectedLayers.join(', ')}`);
  }
  for (const source of manifest.sources) {
    if (
      !isObject(source) ||
      typeof source.filename !== 'string' ||
      typeof source.url !== 'string' ||
      !Number.isInteger(source.bytes) ||
      source.bytes <= 0 ||
      typeof source.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(source.sha256) ||
      !Number.isInteger(source.feature_count) ||
      source.feature_count < 0 ||
      !Array.isArray(source.geometry_types) ||
      !source.geometry_types.length
    ) {
      throw new Error(`Invalid pinned source record for ${source?.layer || 'unknown layer'}`);
    }
  }
}

function compactProperties(layer, properties) {
  const rank = integerValue(properties.scalerank ?? properties.SCALERANK);

  if (layer === 'base_land') {
    const name = cleanText(
      properties.NAME ?? properties.ADMIN ?? properties.NAME_EN ?? properties.NAME_ES
    );
    const nameEs = cleanText(properties.NAME_ES);
    const isoA2 = cleanText(properties.ISO_A2);
    const isoA3 = cleanText(properties.ADM0_A3 ?? properties.ISO_A3);
    const labelRank = integerValue(properties.LABELRANK);
    return {
      class: 'country',
      ...(name ? { name } : {}),
      ...(nameEs && nameEs !== name ? { name_es: nameEs } : {}),
      ...(isoA2 ? { iso_a2: isoA2 } : {}),
      ...(isoA3 ? { iso_a3: isoA3 } : {}),
      ...(labelRank !== null ? { rank: labelRank } : {})
    };
  }

  if (layer === 'base_boundary') {
    const country = cleanText(properties.ADM0_A3);
    return {
      class: 'admin1',
      ...(country ? { country } : {}),
      ...(rank !== null ? { rank } : {})
    };
  }

  if (layer === 'base_water') {
    const name = cleanText(properties.name_en ?? properties.name);
    return {
      class: 'lake',
      ...(name ? { name } : {}),
      ...(rank !== null ? { rank } : {})
    };
  }

  if (layer === 'base_waterway') {
    const name = cleanText(properties.name_en ?? properties.name);
    const weight = finiteNumber(properties.strokeweig);
    return {
      class: 'river',
      ...(name ? { name } : {}),
      ...(rank !== null ? { rank } : {}),
      ...(weight !== null ? { weight } : {})
    };
  }

  if (layer === 'base_urban') {
    return {
      class: 'urban',
      ...(rank !== null ? { rank } : {})
    };
  }

  throw new Error(`Unsupported output layer: ${layer}`);
}

function featureMinzoom(layer, properties, minimum, maximum) {
  if (layer === 'base_land') {
    return zoomValue(properties.MIN_ZOOM, minimum, minimum, maximum);
  }
  if (layer === 'base_boundary') {
    return zoomValue(properties.MIN_ZOOM, 4, 2, maximum);
  }
  if (layer === 'base_water') {
    return zoomValue(properties.min_zoom, 5, 1, maximum);
  }
  if (layer === 'base_waterway') {
    return zoomValue(properties.min_zoom, 5, 2, maximum);
  }
  return zoomValue(properties.min_zoom, 6, 3, maximum);
}

async function writeLine(writer, value) {
  if (!writer.write(`${JSON.stringify(value)}\n`)) {
    await once(writer, 'drain');
  }
}

async function normalizeSource({
  source,
  sourceRecord,
  outputDirectory,
  minimumZoom,
  maximumZoom
}) {
  const collection = JSON.parse(await readFile(sourceRecord.path, 'utf8'));
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error(`${source.filename}: expected a GeoJSON FeatureCollection`);
  }
  if (collection.features.length !== source.feature_count) {
    throw new Error(
      `${source.filename}: expected ${source.feature_count} features, got ${collection.features.length}`
    );
  }

  const layerStats = {
    source_filename: source.filename,
    input_records: collection.features.length,
    emitted_features: 0,
    skipped_records: 0,
    skipped: {},
    minzoom_counts: {}
  };
  const writer = createWriteStream(
    path.join(outputDirectory, `${source.layer}.ndjson`),
    { encoding: 'utf8', flags: 'wx' }
  );

  const skip = reason => {
    layerStats.skipped_records += 1;
    layerStats.skipped[reason] = (layerStats.skipped[reason] || 0) + 1;
  };

  try {
    for (const inputFeature of collection.features) {
      const geometry = inputFeature?.geometry;
      const properties = inputFeature?.properties;
      if (!geometry || !isObject(properties)) {
        skip(!geometry ? 'null_geometry' : 'invalid_properties');
        continue;
      }
      if (!source.geometry_types.includes(geometry.type)) {
        skip('unsupported_geometry');
        continue;
      }

      const minzoom = featureMinzoom(
        source.layer,
        properties,
        minimumZoom,
        maximumZoom
      );
      const outputFeature = {
        type: 'Feature',
        geometry,
        properties: compactProperties(source.layer, properties),
        tippecanoe: {
          layer: source.layer,
          minzoom,
          maxzoom: maximumZoom
        }
      };
      await writeLine(writer, outputFeature);
      layerStats.emitted_features += 1;
      layerStats.minzoom_counts[minzoom] =
        (layerStats.minzoom_counts[minzoom] || 0) + 1;
    }
  } finally {
    writer.end();
    await once(writer, 'finish');
  }

  return layerStats;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usage);
    return;
  }
  if (!args['source-root'] || !args['output-dir']) {
    console.error(usage);
    process.exitCode = 2;
    return;
  }

  const sourceRoot = args['source-root'];
  const outputDirectory = args['output-dir'];
  const statsPath = args.stats || path.join(outputDirectory, 'stats.json');
  const manifest = JSON.parse(await readFile(args.manifest, 'utf8'));
  validateManifest(manifest);

  const sourceRecords = new Map();
  for (const source of manifest.sources) {
    console.log(`Verifying ${source.filename}`);
    sourceRecords.set(source.layer, await verifySource(sourceRoot, source));
  }

  if (args.force) await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(path.dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory, { recursive: false });

  const stats = {
    schema_version: 1,
    dataset: manifest.dataset,
    snapshot: manifest.snapshot,
    input_records: 0,
    emitted_features: 0,
    skipped_records: 0,
    layers: {}
  };

  for (const source of manifest.sources) {
    const layerStats = await normalizeSource({
      source,
      sourceRecord: sourceRecords.get(source.layer),
      outputDirectory,
      minimumZoom: manifest.tile_minzoom,
      maximumZoom: manifest.tile_maxzoom
    });
    stats.layers[source.layer] = layerStats;
    stats.input_records += layerStats.input_records;
    stats.emitted_features += layerStats.emitted_features;
    stats.skipped_records += layerStats.skipped_records;
    console.log(
      `${source.layer}: ${layerStats.emitted_features.toLocaleString('en-US')} emitted, ` +
      `${layerStats.skipped_records.toLocaleString('en-US')} skipped`
    );
  }

  await writeFile(statsPath, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
  console.log(`Normalized ${stats.emitted_features.toLocaleString('en-US')} features`);
  console.log(`Stats ${statsPath}`);
}

await main();
