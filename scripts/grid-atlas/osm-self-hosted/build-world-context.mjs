#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  access,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const builderPath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(builderPath);
const defaultManifestPath = path.join(scriptDirectory, 'natural-earth-sources.json');
const normalizerPath = path.join(scriptDirectory, 'normalize-natural-earth-context.mjs');
const validatorPath = path.join(scriptDirectory, 'validate-natural-earth-context.mjs');
const expectedLayers = [
  'base_land',
  'base_boundary',
  'base_water',
  'base_waterway',
  'base_urban'
];
const vectorLayerContract = [
  {
    id: 'base_land',
    description: 'Natural Earth 1:10m country land polygons.',
    minzoom: 0,
    maxzoom: 8,
    fields: {
      class: 'String',
      name: 'String',
      name_es: 'String',
      iso_a2: 'String',
      iso_a3: 'String',
      rank: 'Number'
    }
  },
  {
    id: 'base_boundary',
    description: 'Natural Earth 1:10m first-order administrative boundaries.',
    minzoom: 2,
    maxzoom: 8,
    fields: {
      class: 'String',
      country: 'String',
      rank: 'Number'
    }
  },
  {
    id: 'base_water',
    description: 'Natural Earth 1:10m lake polygons.',
    minzoom: 1,
    maxzoom: 8,
    fields: {
      class: 'String',
      name: 'String',
      rank: 'Number'
    }
  },
  {
    id: 'base_waterway',
    description: 'Natural Earth 1:10m river and lake-centre lines.',
    minzoom: 2,
    maxzoom: 8,
    fields: {
      class: 'String',
      name: 'String',
      rank: 'Number',
      weight: 'Number'
    }
  },
  {
    id: 'base_urban',
    description: 'Natural Earth 1:10m urban-area polygons.',
    minzoom: 3,
    maxzoom: 8,
    fields: {
      class: 'String',
      rank: 'Number'
    }
  }
];
const publicArchivePath = 'data/grid-atlas/osm-basemap/world.pmtiles';

const usage = `Usage:
  node build-world-context.mjs --source-root DIR --output world.pmtiles [options]

Required:
  --source-root DIR  Directory containing the five pinned Natural Earth files
  --output PATH      Destination PMTiles archive (basename must be world.pmtiles)

Options:
  --manifest PATH    Pinned source manifest
                     (default: natural-earth-sources.json beside this script)
  --work PATH        Durable intermediate directory (default: .work/world-context)
  --force            Rebuild an existing archive and sidecar
  --keep-mbtiles     Retain the intermediate MBTiles archive
  --help             Show this help

The archive metadata is rewritten after Tippecanoe conversion so it contains
only the path-independent, pinned build contract. The sidecar uses the source
manifest's pinned_at value as its reproducibility timestamp.
`;

function parseArguments(values) {
  const parsed = {
    force: false,
    keepMbtiles: false,
    manifest: defaultManifestPath
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--force') parsed.force = true;
    else if (value === '--keep-mbtiles') parsed.keepMbtiles = true;
    else if (value === '--help' || value === '-h') parsed.help = true;
    else if (
      value === '--source-root' ||
      value === '--output' ||
      value === '--manifest' ||
      value === '--work'
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

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, canonicalJson(value[key])])
  );
}

function sameJson(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function ensureCommand(command) {
  const result = spawnSync('which', [command], { stdio: 'ignore' });
  if (result.status !== 0) throw new Error(`Required command is unavailable: ${command}`);
}

function run(command, args, options = {}) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stderr || result.stdout || ''}` : '';
    throw new Error(`${command} exited with status ${result.status}${detail}`);
  }
  if (!options.capture) return '';
  return {
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim()
  };
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
    filename: path.basename(filePath),
    bytes: details.size,
    sha256: await hashFile(filePath)
  };
}

function toolVersion(command, args) {
  const result = run(command, args, { capture: true });
  return (result.stdout || result.stderr).split('\n')[0].trim();
}

function validateManifest(manifest) {
  if (
    !isObject(manifest) ||
    manifest.schema_version !== 1 ||
    manifest.dataset !== 'fecundidad-natural-earth-context' ||
    manifest.tile_minzoom !== 0 ||
    manifest.tile_maxzoom !== 8 ||
    !sameJson(manifest.vector_layers, expectedLayers) ||
    !Array.isArray(manifest.sources) ||
    !sameJson(manifest.sources.map(source => source.layer), expectedLayers) ||
    !isObject(manifest.licence) ||
    typeof manifest.pinned_at !== 'string' ||
    !Number.isFinite(Date.parse(manifest.pinned_at))
  ) {
    throw new Error('Pinned Natural Earth manifest does not match the world context contract');
  }
}

async function verifyPinnedSources(sourceRoot, manifest) {
  const records = [];
  for (const source of manifest.sources) {
    const sourcePath = path.join(sourceRoot, source.filename);
    const record = await fileRecord(sourcePath);
    if (record.bytes !== source.bytes || record.sha256 !== source.sha256) {
      throw new Error(
        `${source.filename}: pinned source mismatch ` +
        `(expected ${source.bytes} bytes/${source.sha256}, ` +
        `got ${record.bytes} bytes/${record.sha256})`
      );
    }
    records.push({ ...source, ...record });
  }
  return records;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usage);
    return;
  }
  if (!args['source-root'] || !args.output) {
    console.error(usage);
    process.exitCode = 2;
    return;
  }
  if (path.basename(args.output) !== 'world.pmtiles') {
    throw new Error('--output basename must be world.pmtiles');
  }

  for (const command of ['node', 'tippecanoe', 'pmtiles']) ensureCommand(command);
  const manifest = JSON.parse(await readFile(args.manifest, 'utf8'));
  validateManifest(manifest);

  const outputPath = args.output;
  const metadataPath = `${outputPath}.metadata.json`;
  const workDirectory = args.work || path.join(scriptDirectory, '.work', 'world-context');
  const normalizedDirectory = path.join(workDirectory, 'normalized');
  const normalizerStatsPath = path.join(workDirectory, 'world-feature-counts.json');
  const mbtilesPath = path.join(workDirectory, 'world.mbtiles');
  const tippecanoeTemporaryDirectory = path.join(workDirectory, 'tippecanoe-tmp');
  const pmtilesMetadataEditPath = path.join(workDirectory, 'world-pmtiles-metadata.json');

  if (
    ((await exists(outputPath)) || (await exists(metadataPath))) &&
    !args.force
  ) {
    throw new Error(
      `Output or sidecar exists; pass --force to rebuild: ${outputPath}`
    );
  }

  console.log('Verifying all five pinned source files before modifying generated outputs');
  const sourceRecords = await verifyPinnedSources(args['source-root'], manifest);
  const sourceManifestRecord = await fileRecord(args.manifest);
  const pipelineFiles = {
    builder: await fileRecord(builderPath),
    normalizer: await fileRecord(normalizerPath),
    validator: await fileRecord(validatorPath)
  };

  await mkdir(workDirectory, { recursive: true });
  await mkdir(tippecanoeTemporaryDirectory, { recursive: true });
  await mkdir(path.dirname(outputPath), { recursive: true });
  if (args.force) await rm(metadataPath, { force: true });

  run('node', [
    normalizerPath,
    '--source-root', args['source-root'],
    '--manifest', args.manifest,
    '--output-dir', normalizedDirectory,
    '--stats', normalizerStatsPath,
    '--force'
  ]);
  run('node', [
    validatorPath,
    '--input-dir', normalizedDirectory,
    '--stats', normalizerStatsPath,
    '--manifest', args.manifest
  ]);

  const tippecanoeArgs = [
    '--output', mbtilesPath,
    '--force',
    '--quiet',
    '--minimum-zoom', String(manifest.tile_minzoom),
    '--maximum-zoom', String(manifest.tile_maxzoom),
    '--simplification=2',
    '--maximum-tile-bytes=300000',
    '--drop-densest-as-needed',
    '--coalesce-densest-as-needed',
    '--preserve-input-order',
    '--name', 'Fecundidad Natural Earth context',
    '--description', `Natural Earth 1:10m context · ${manifest.snapshot}`,
    '--attribution', manifest.licence.attribution,
    '--temporary-directory', tippecanoeTemporaryDirectory
  ];
  for (const layer of expectedLayers) {
    tippecanoeArgs.push(
      '--named-layer',
      `${layer}:${path.join(normalizedDirectory, `${layer}.ndjson`)}`
    );
  }
  run('tippecanoe', tippecanoeArgs);
  run('pmtiles', ['convert', mbtilesPath, outputPath, '--force']);

  const generatedMetadata = JSON.parse(
    run('pmtiles', ['show', outputPath, '--metadata'], { capture: true }).stdout
  );
  const generatedLayerIds = (generatedMetadata.vector_layers || [])
    .map(layer => layer.id)
    .sort();
  if (!sameJson(generatedLayerIds, [...expectedLayers].sort())) {
    throw new Error(
      `Generated vector layers must be exactly ${expectedLayers.join(', ')}; ` +
      `got ${generatedLayerIds.join(', ')}`
    );
  }

  const deterministicArchiveMetadata = {
    name: 'Fecundidad Natural Earth context',
    description: `Natural Earth 1:10m context · ${manifest.snapshot}`,
    attribution: manifest.licence.attribution,
    format: 'pbf',
    minzoom: String(manifest.tile_minzoom),
    maxzoom: String(manifest.tile_maxzoom),
    type: 'overlay',
    version: '2',
    dataset: manifest.dataset,
    snapshot: manifest.snapshot,
    source_manifest_sha256: sourceManifestRecord.sha256,
    vector_layers: vectorLayerContract
  };
  await writeFile(
    pmtilesMetadataEditPath,
    `${JSON.stringify(deterministicArchiveMetadata, null, 2)}\n`,
    'utf8'
  );
  try {
    run('pmtiles', ['edit', outputPath, '--metadata', pmtilesMetadataEditPath]);
  } finally {
    await rm(pmtilesMetadataEditPath, { force: true });
  }
  run('pmtiles', ['verify', outputPath]);

  const header = JSON.parse(
    run('pmtiles', ['show', outputPath, '--header-json'], { capture: true }).stdout
  );
  const tileMetadata = JSON.parse(
    run('pmtiles', ['show', outputPath, '--metadata'], { capture: true }).stdout
  );
  if (
    header.minzoom !== manifest.tile_minzoom ||
    header.maxzoom !== manifest.tile_maxzoom ||
    header.tile_type !== 'mvt' ||
    header.tile_compression !== 'gzip' ||
    !sameJson(tileMetadata.vector_layers, vectorLayerContract)
  ) {
    throw new Error('Final PMTiles header/metadata does not match the pinned contract');
  }

  const featureStats = JSON.parse(await readFile(normalizerStatsPath, 'utf8'));
  const outputRecord = await fileRecord(outputPath);
  const sidecarSources = sourceRecords.map(source => {
    const layerStats = featureStats.layers[source.layer];
    return {
      layer: source.layer,
      filename: source.filename,
      url: source.url,
      bytes: source.bytes,
      sha256: source.sha256,
      feature_count: source.feature_count,
      emitted_count: layerStats.emitted_features,
      skipped_count: layerStats.skipped_records
    };
  });
  const sidecar = {
    schema_version: 1,
    dataset: manifest.dataset,
    generated_at: manifest.pinned_at,
    snapshot: manifest.snapshot,
    source_manifest: sourceManifestRecord,
    pipeline_files: pipelineFiles,
    sources: sidecarSources,
    output: {
      ...outputRecord,
      path: publicArchivePath,
      minzoom: header.minzoom,
      maxzoom: header.maxzoom,
      bounds: header.bounds,
      center: header.center,
      tile_type: header.tile_type,
      tile_compression: header.tile_compression
    },
    features: featureStats,
    vector_layers: tileMetadata.vector_layers,
    tools: {
      node: process.version,
      tippecanoe: toolVersion('tippecanoe', ['--version']),
      pmtiles: toolVersion('pmtiles', ['version'])
    },
    licence: manifest.licence,
    build_contract: {
      schema_version: 1,
      format: 'PMTiles',
      content: 'Mapbox Vector Tile',
      source_dataset: 'Natural Earth 1:10m',
      vector_layers: expectedLayers,
      minzoom: manifest.tile_minzoom,
      maxzoom: manifest.tile_maxzoom,
      simplification: 2,
      maximum_tile_bytes: 300000,
      drop_densest_as_needed: true,
      coalesce_densest_as_needed: true,
      preserve_input_order: true,
      archive_metadata_is_path_independent: true,
      reproducibility_timestamp_source: 'natural-earth-sources.json#pinned_at'
    }
  };
  await writeFile(metadataPath, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8');
  if (!args.keepMbtiles) await rm(mbtilesPath, { force: true });

  console.log(`\nBuilt ${outputPath} (${outputRecord.bytes.toLocaleString('en-US')} bytes)`);
  console.log(`SHA-256 ${outputRecord.sha256}`);
  console.log(`Metadata ${metadataPath}`);
}

await main();
