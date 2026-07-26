#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '../../..');
const regionsPath = path.join(scriptDirectory, 'regions.json');
const defaultAssetRoot = path.join(
  projectDirectory,
  'data',
  'grid-atlas',
  'osm-basemap'
);
const defaultOutputPath = path.join(
  projectDirectory,
  'data',
  'grid-atlas',
  'osm-basemap-manifest.json'
);
const releaseTag = 'osm-basemap-2026-07-25-schema1';
const archiveRoot = 'data/grid-atlas/osm-basemap';
const maximumTotalBytes = 190_000_000;
const regionOrder = [
  'europa',
  'estados-unidos',
  'china',
  'japon',
  'corea-del-sur',
  'taiwan'
];
const worldLayers = [
  'base_land',
  'base_boundary',
  'base_water',
  'base_waterway',
  'base_urban'
];
const regionLayers = ['base_road', 'base_place'];

const usage = `Usage:
  node generate-osm-basemap-manifest.mjs [options]

Options:
  --asset-root PATH  Directory containing world.pmtiles and six regional PMTiles
                     plus their adjacent *.metadata.json sidecars
                     (default: data/grid-atlas/osm-basemap)
  --output PATH      Manifest destination
                     (default: data/grid-atlas/osm-basemap-manifest.json)
  --help             Show this help

The production manifest is strict and refuses a context payload larger than
${maximumTotalBytes.toLocaleString('en-US')} bytes.
`;

function parseArguments(values) {
  const parsed = {
    assetRoot: defaultAssetRoot,
    output: defaultOutputPath
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--help' || value === '-h') {
      parsed.help = true;
    } else if (value === '--asset-root' || value === '--output') {
      const next = values[index + 1];
      if (!next || next.startsWith('--')) {
        throw new Error(`Missing value for ${value}`);
      }
      if (value === '--asset-root') parsed.assetRoot = path.resolve(next);
      else parsed.output = path.resolve(next);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
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

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const digest = createHash('sha256');
    const input = createReadStream(filePath);
    input.on('error', reject);
    input.on('data', chunk => digest.update(chunk));
    input.on('end', () => resolve(digest.digest('hex')));
  });
}

async function fileRecord(filePath) {
  const details = await stat(filePath);
  return {
    bytes: details.size,
    sha256: await hashFile(filePath)
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function vectorLayerIds(metadata) {
  return Array.isArray(metadata?.vector_layers)
    ? metadata.vector_layers.map(layer => layer?.id)
    : [];
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function readArchive({
  key,
  kind,
  label,
  filename,
  expectedLayers,
  expectedMinzoom,
  expectedMaxzoom,
  assetRoot
}) {
  const assetPath = path.join(assetRoot, filename);
  const metadataPath = `${assetPath}.metadata.json`;
  requireCondition(await exists(assetPath), `Missing basemap archive: ${assetPath}`);
  requireCondition(await exists(metadataPath), `Missing basemap sidecar: ${metadataPath}`);

  const [metadata, archiveRecord, metadataRecord] = await Promise.all([
    readFile(metadataPath, 'utf8').then(JSON.parse),
    fileRecord(assetPath),
    fileRecord(metadataPath)
  ]);
  const output = metadata?.output;
  requireCondition(isObject(metadata), `${filename}: metadata root must be an object`);
  requireCondition(metadata.schema_version === 1, `${filename}: schema_version must be 1`);
  requireCondition(isObject(output), `${filename}: metadata.output must be an object`);
  requireCondition(output.filename === filename, `${filename}: output.filename mismatch`);
  requireCondition(
    output.path === `${archiveRoot}/${filename}`,
    `${filename}: output.path must be ${archiveRoot}/${filename}`
  );
  requireCondition(output.bytes === archiveRecord.bytes, `${filename}: byte count mismatch`);
  requireCondition(output.sha256 === archiveRecord.sha256, `${filename}: SHA-256 mismatch`);
  requireCondition(output.minzoom === expectedMinzoom, `${filename}: minzoom must be ${expectedMinzoom}`);
  requireCondition(output.maxzoom === expectedMaxzoom, `${filename}: maxzoom must be ${expectedMaxzoom}`);
  requireCondition(output.tile_type === 'mvt', `${filename}: tile_type must be mvt`);
  requireCondition(output.tile_compression === 'gzip', `${filename}: tile_compression must be gzip`);

  const layerIds = vectorLayerIds(metadata);
  requireCondition(
    sameJson(layerIds, expectedLayers),
    `${filename}: vector layer contract must be ${expectedLayers.join(', ')}; got ${layerIds.join(', ')}`
  );
  if (kind === 'region') {
    requireCondition(metadata.region === key, `${filename}: metadata.region must be ${key}`);
    requireCondition(metadata.snapshot, `${filename}: metadata.snapshot is required`);
    requireCondition(
      metadata.licence?.attribution === '© OpenStreetMap contributors',
      `${filename}: OSM attribution contract is missing`
    );
  } else {
    requireCondition(
      metadata.licence?.attribution === 'Made with Natural Earth',
      `${filename}: Natural Earth attribution contract is missing`
    );
  }

  return {
    key,
    kind,
    label,
    asset: filename,
    path: `${archiveRoot}/${filename}`,
    metadata_path: `${archiveRoot}/${path.basename(metadataPath)}`,
    bytes: archiveRecord.bytes,
    sha256: archiveRecord.sha256,
    metadata_bytes: metadataRecord.bytes,
    metadata_sha256: metadataRecord.sha256,
    minzoom: output.minzoom,
    maxzoom: output.maxzoom,
    bounds: output.bounds,
    center: output.center,
    vector_layers: expectedLayers
  };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usage);
    return;
  }
  const config = JSON.parse(await readFile(regionsPath, 'utf8'));
  requireCondition(
    sameJson(Object.keys(config.regions || {}), regionOrder),
    `regions.json must define exactly: ${regionOrder.join(', ')}`
  );

  const archives = [];
  archives.push(await readArchive({
    key: 'world',
    kind: 'world',
    label: 'World geographic context',
    filename: 'world.pmtiles',
    expectedLayers: worldLayers,
    expectedMinzoom: 0,
    expectedMaxzoom: 8,
    assetRoot: args.assetRoot
  }));
  for (const regionKey of regionOrder) {
    const region = config.regions[regionKey];
    archives.push(await readArchive({
      key: regionKey,
      kind: 'region',
      label: region.label,
      filename: region.output_filename,
      expectedLayers: regionLayers,
      expectedMinzoom: 2,
      expectedMaxzoom: 9,
      assetRoot: args.assetRoot
    }));
  }

  const totalBytes = archives.reduce((sum, archive) => sum + archive.bytes, 0);
  requireCondition(
    totalBytes <= maximumTotalBytes,
    `Basemap payload is ${totalBytes.toLocaleString('en-US')} bytes; production cap is ${maximumTotalBytes.toLocaleString('en-US')}`
  );
  const manifest = {
    schema_version: 1,
    dataset: 'fecundidad-self-hosted-basemap',
    release_tag: releaseTag,
    generated_at: new Date().toISOString(),
    snapshot: config.snapshot,
    archive_root: archiveRoot,
    complete: true,
    expected_archive_count: 7,
    archive_count: archives.length,
    archive_order: ['world', ...regionOrder],
    maximum_total_bytes: maximumTotalBytes,
    total_bytes: totalBytes,
    contracts: {
      world: {
        source_database: 'Natural Earth',
        minzoom: 0,
        maxzoom: 8,
        vector_layers: worldLayers
      },
      region: {
        source_database: 'OpenStreetMap',
        extract_provider: 'Geofabrik GmbH',
        minzoom: 2,
        maxzoom: 9,
        vector_layers: regionLayers
      }
    },
    licences: [
      {
        dataset: 'Natural Earth',
        name: 'Public domain',
        attribution: 'Made with Natural Earth',
        url: 'https://www.naturalearthdata.com/about/terms-of-use/'
      },
      {
        dataset: 'OpenStreetMap',
        name: 'Open Database License 1.0',
        attribution: '© OpenStreetMap contributors',
        url: 'https://www.openstreetmap.org/copyright'
      }
    ],
    archives
  };
  await writeFile(args.output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(
    `Wrote ${args.output} with ${archives.length} archives ` +
    `(${totalBytes.toLocaleString('en-US')} bytes).`
  );
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
