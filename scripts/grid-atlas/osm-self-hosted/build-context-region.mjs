#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CONTEXT_SCHEMA_ID,
  CONTEXT_SCHEMA_VERSION,
  LAYER_DESCRIPTIONS,
  LAYER_NAMES,
  MAXIMUM_TILE_BYTES,
  SIMPLIFICATION,
  TILE_MAXZOOM,
  TILE_MINZOOM
} from './context-schema.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '../../..');
const configPath = path.join(scriptDirectory, 'regions.json');
const filterPath = path.join(scriptDirectory, 'context-tags.filter');
const schemaPath = path.join(scriptDirectory, 'context-schema.mjs');
const normalizerPath = path.join(scriptDirectory, 'normalize-osm-context.mjs');
const validatorPath = path.join(scriptDirectory, 'validate-osm-context.mjs');

const usage = `Usage:
  node build-context-region.mjs --region KEY --raw INPUT.osm.pbf --output OUTPUT.pmtiles [options]

Required:
  --region KEY       europa | estados-unidos | china | japon | corea-del-sur | taiwan
  --raw PATH         Existing Geofabrik .osm.pbf input with adjacent .md5
  --output PATH      Destination .pmtiles archive

Options:
  --work PATH        Durable intermediate directory (default: .work/context/KEY)
  --force            Rebuild existing intermediate and output files
  --keep-mbtiles     Retain the intermediate MBTiles archive after success
  --help             Show this help
`;

const parseArguments = values => {
  const parsed = { force: false, keepMbtiles: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--force') parsed.force = true;
    else if (value === '--keep-mbtiles') parsed.keepMbtiles = true;
    else if (value === '--help' || value === '-h') parsed.help = true;
    else if (value.startsWith('--')) {
      const key = value.slice(2);
      const next = values[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`Missing value for ${value}`);
      parsed[key] = next;
      index += 1;
    } else {
      throw new Error(`Unexpected argument: ${value}`);
    }
  }
  return parsed;
};

const exists = async filePath => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const run = (command, arguments_, options = {}) => {
  const rendered = arguments_.map(value => (
    /\s/.test(value) ? JSON.stringify(value) : value
  )).join(' ');
  console.log(`\n$ ${command} ${rendered}`);
  const result = spawnSync(command, arguments_, {
    cwd: options.cwd,
    encoding: options.capture ? 'utf8' : undefined,
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error) throw result.error;
  const allowedStatuses = options.allowedStatuses || [0];
  if (!allowedStatuses.includes(result.status)) {
    const detail = options.capture
      ? `\n${String(result.stderr || result.stdout || '').trim()}`
      : '';
    throw new Error(`${command} exited with status ${result.status}${detail}`);
  }
  if (!options.capture) return null;
  return {
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim()
  };
};

const ensureCommand = command => {
  const result = spawnSync('which', [command], { stdio: 'ignore' });
  if (result.status !== 0) throw new Error(`Required command is unavailable: ${command}`);
};

const hashFile = filePath => new Promise((resolve, reject) => {
  const sha256 = createHash('sha256');
  const md5 = createHash('md5');
  const input = createReadStream(filePath);
  input.on('error', reject);
  input.on('data', chunk => {
    sha256.update(chunk);
    md5.update(chunk);
  });
  input.on('end', () => resolve({
    sha256: sha256.digest('hex'),
    md5: md5.digest('hex')
  }));
});

const fileRecord = async filePath => {
  const details = await stat(filePath);
  return {
    filename: path.basename(filePath),
    bytes: details.size,
    ...(await hashFile(filePath))
  };
};

const verifyOfficialMd5 = async (rawPath, computedMd5) => {
  const md5Path = `${rawPath}.md5`;
  if (!(await exists(md5Path))) {
    throw new Error(`Official MD5 sidecar is required: ${md5Path}`);
  }
  const sidecar = await readFile(md5Path, 'utf8');
  const officialMd5 = sidecar.match(/\b[a-f0-9]{32}\b/i)?.[0]?.toLowerCase();
  if (!officialMd5) throw new Error(`Invalid official MD5 sidecar: ${md5Path}`);
  if (officialMd5 !== computedMd5) {
    throw new Error(
      `Raw PBF MD5 mismatch: computed ${computedMd5}, official ${officialMd5} (${md5Path})`
    );
  }
  return {
    official_md5: officialMd5,
    official_md5_file: path.basename(md5Path),
    official_md5_verified: true
  };
};

const toolVersion = (command, arguments_) => {
  const result = run(command, arguments_, { capture: true });
  const output = result.stdout || result.stderr;
  return output.split('\n')[0].trim();
};

const parseReferenceCheck = output => ({
  nodes_in_ways_missing: Number(
    output.match(/Nodes\s+in ways\s+missing:\s+(\d+)/)?.[1] || 0
  ),
  nodes_in_relations_missing: Number(
    output.match(/Nodes\s+in relations missing:\s+(\d+)/)?.[1] || 0
  ),
  ways_in_relations_missing: Number(
    output.match(/Ways\s+in relations missing:\s+(\d+)/)?.[1] || 0
  ),
  relations_in_relations_missing: Number(
    output.match(/Relations in relations missing:\s+(\d+)/)?.[1] || 0
  )
});

const relativeOutputPath = (outputPath, filename) => {
  const expected = path.join(
    projectDirectory,
    'data',
    'grid-atlas',
    'osm-basemap',
    filename
  );
  if (path.resolve(outputPath) === expected) {
    return path.relative(projectDirectory, expected).split(path.sep).join('/');
  }
  const relative = path.relative(projectDirectory, outputPath);
  return relative.startsWith('..')
    ? `data/grid-atlas/osm-basemap/${filename}`
    : relative.split(path.sep).join('/');
};

const validateRegion = (key, region) => {
  if (!region || typeof region !== 'object') throw new Error(`Unknown region: ${key}`);
  if (!Array.isArray(region.bounds) || region.bounds.length !== 4) {
    throw new Error(`Region ${key} must define four numeric bounds`);
  }
  if (!region.bounds.every(value => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error(`Region ${key} has invalid bounds`);
  }
  if (key === 'estados-unidos' && (
    !Array.isArray(region.clip_bbox) ||
    region.clip_bbox.length !== 4 ||
    !region.clip_bbox.every(value => typeof value === 'number' && Number.isFinite(value))
  )) {
    throw new Error('The continental United States must define region.clip_bbox');
  }
};

const readJsonOutput = (command, arguments_) => {
  const result = run(command, arguments_, { capture: true });
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `Could not parse JSON from ${command} ${arguments_.join(' ')}: ${error.message}`
    );
  }
};

const build = async args => {
  for (const command of ['node', 'osmium', 'tippecanoe', 'pmtiles']) {
    ensureCommand(command);
  }
  for (const requiredPath of [
    configPath,
    filterPath,
    schemaPath,
    normalizerPath,
    validatorPath
  ]) {
    if (!(await exists(requiredPath))) throw new Error(`Required input is missing: ${requiredPath}`);
  }

  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const region = config.regions?.[args.region];
  validateRegion(args.region, region);

  const rawPath = path.resolve(args.raw);
  const outputPath = path.resolve(args.output);
  const metadataPath = `${outputPath}.metadata.json`;
  const stagedOutputPath = `${outputPath}.partial`;
  const stagedMetadataPath = `${metadataPath}.partial`;
  const workDirectory = path.resolve(
    args.work || path.join(scriptDirectory, '.work', 'context', args.region)
  );
  const filteredPath = path.join(workDirectory, `${args.region}-context-filtered.osm.pbf`);
  const clippedPath = path.join(workDirectory, `${args.region}-context-clipped.osm.pbf`);
  const sequencePath = path.join(workDirectory, `${args.region}-context.geojsonseq`);
  const normalizedDirectory = path.join(workDirectory, 'normalized');
  const statsPath = path.join(workDirectory, `${args.region}-context-counts.json`);
  const mbtilesPath = path.join(workDirectory, `${args.region}-context.mbtiles`);
  const temporaryDirectory = path.join(workDirectory, 'tippecanoe-tmp');
  const metadataEditPath = path.join(workDirectory, `${args.region}-context-metadata.json`);

  if (!(await exists(rawPath))) throw new Error(`Raw input does not exist: ${rawPath}`);
  const potentialCollisions = [
    outputPath,
    metadataPath,
    stagedOutputPath,
    stagedMetadataPath,
    filteredPath,
    sequencePath,
    normalizedDirectory,
    statsPath,
    mbtilesPath,
    ...(Array.isArray(region.clip_bbox) ? [clippedPath] : [])
  ];
  if (!args.force) {
    const collisions = [];
    for (const candidate of potentialCollisions) {
      if (await exists(candidate)) collisions.push(candidate);
    }
    if (collisions.length) {
      throw new Error(
        `Build artifacts already exist; pass --force to rebuild:\n${collisions.join('\n')}`
      );
    }
  } else {
    await rm(stagedOutputPath, { force: true });
    await rm(stagedMetadataPath, { force: true });
    await rm(normalizedDirectory, { recursive: true, force: true });
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  await mkdir(workDirectory, { recursive: true });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(temporaryDirectory, { recursive: true });

  console.log(`Hashing raw PBF once for SHA-256 and MD5: ${rawPath}`);
  const rawRecord = await fileRecord(rawPath);
  const officialMd5 = await verifyOfficialMd5(rawPath, rawRecord.md5);
  const configuration = {
    regions: await fileRecord(configPath),
    context_tags_filter: await fileRecord(filterPath),
    context_schema: await fileRecord(schemaPath),
    normalizer: await fileRecord(normalizerPath),
    validator: await fileRecord(validatorPath)
  };

  run('osmium', [
    'tags-filter',
    '--expressions', filterPath,
    '--remove-tags',
    '--generator', `fecundidad-osm-context/schema${CONTEXT_SCHEMA_VERSION}`,
    '--overwrite',
    rawPath,
    '--output', filteredPath
  ]);

  let geographicInputPath = filteredPath;
  if (Array.isArray(region.clip_bbox)) {
    run('osmium', [
      'extract',
      '--bbox', region.clip_bbox.join(','),
      '--strategy', 'smart',
      '--set-bounds',
      '--generator', `fecundidad-osm-context/schema${CONTEXT_SCHEMA_VERSION}`,
      '--overwrite',
      filteredPath,
      '--output', clippedPath
    ]);
    geographicInputPath = clippedPath;
  }

  const referenceResult = run('osmium', ['check-refs', geographicInputPath], {
    capture: true,
    allowedStatuses: [0, 1]
  });
  const referenceOutput = [referenceResult.stdout, referenceResult.stderr]
    .filter(Boolean)
    .join('\n');
  if (referenceOutput) console.log(referenceOutput);
  const referenceIntegrity = parseReferenceCheck(referenceOutput);
  if (referenceResult.status !== 0 || referenceIntegrity.nodes_in_ways_missing !== 0) {
    throw new Error(
      `Unsafe context extract: ${referenceIntegrity.nodes_in_ways_missing} way-node references are missing`
    );
  }

  run('osmium', [
    'export',
    '--geometry-types', 'point,linestring,polygon',
    '--attributes', 'type,id,version,timestamp',
    '--add-unique-id', 'type_id',
    '--output-format', 'geojsonseq',
    '--overwrite',
    geographicInputPath,
    '--output', sequencePath
  ]);

  run('node', [
    normalizerPath,
    '--input', sequencePath,
    '--output-dir', normalizedDirectory,
    '--stats', statsPath,
    '--force'
  ]);

  const validation = readJsonOutput('node', [
    validatorPath,
    '--input-dir', normalizedDirectory,
    '--stats', statsPath
  ]);
  console.log(
    `Validated ${validation.total.toLocaleString('en-US')} features in ` +
    `${validation.layer_ids.join(', ')}.`
  );

  const statsDocument = JSON.parse(await readFile(statsPath, 'utf8'));
  for (const layerName of LAYER_NAMES) {
    if (!Number.isInteger(statsDocument.layers?.[layerName]) || statsDocument.layers[layerName] <= 0) {
      throw new Error(`Contract layer ${layerName} has no normalized features`);
    }
  }

  const tippecanoeArguments = [
    '--output', mbtilesPath,
    '--force',
    '--read-parallel',
    '--minimum-zoom', String(TILE_MINZOOM),
    '--maximum-zoom', String(TILE_MAXZOOM),
    `--simplification=${SIMPLIFICATION}`,
    '--simplify-only-low-zooms',
    `--maximum-tile-bytes=${MAXIMUM_TILE_BYTES}`,
    '--drop-smallest-as-needed',
    '--coalesce-smallest-as-needed',
    '--detect-shared-borders',
    '--preserve-input-order',
    '--quiet',
    '--name', `Fecundidad OSM context · ${region.label}`,
    '--description', `Project-built high-detail OSM geographic context snapshot ${config.snapshot}`,
    '--attribution', '© OpenStreetMap contributors · ODbL 1.0',
    '--temporary-directory', temporaryDirectory
  ];
  for (const layerName of LAYER_NAMES) {
    tippecanoeArguments.push(
      '--named-layer',
      `${layerName}:${path.join(normalizedDirectory, `${layerName}.ndjson`)}`
    );
  }
  run('tippecanoe', tippecanoeArguments);

  run('pmtiles', ['convert', mbtilesPath, stagedOutputPath, '--force']);
  const generatedMetadata = readJsonOutput(
    'pmtiles',
    ['show', stagedOutputPath, '--metadata']
  );
  const generatedLayerIds = (generatedMetadata.vector_layers || []).map(layer => layer.id);
  const unexpectedLayers = generatedLayerIds.filter(layer => !LAYER_NAMES.includes(layer));
  if (unexpectedLayers.length) {
    throw new Error(`Unexpected PMTiles layers: ${unexpectedLayers.join(', ')}`);
  }
  const layersById = new Map(
    (generatedMetadata.vector_layers || []).map(layer => [layer.id, layer])
  );
  const contractVectorLayers = LAYER_NAMES.map(layerName => ({
    ...(layersById.get(layerName) || {}),
    id: layerName,
    description: LAYER_DESCRIPTIONS[layerName],
    minzoom: TILE_MINZOOM,
    maxzoom: TILE_MAXZOOM,
    fields: layersById.get(layerName)?.fields || {}
  }));
  const embeddedMetadata = {
    ...generatedMetadata,
    name: `Fecundidad OSM context · ${region.label}`,
    description: `Project-built high-detail OSM geographic context snapshot ${config.snapshot}`,
    attribution: '© OpenStreetMap contributors · ODbL 1.0',
    minzoom: String(TILE_MINZOOM),
    maxzoom: String(TILE_MAXZOOM),
    fecundidad_schema: CONTEXT_SCHEMA_ID,
    vector_layers: contractVectorLayers
  };
  await writeFile(
    metadataEditPath,
    `${JSON.stringify(embeddedMetadata, null, 2)}\n`,
    'utf8'
  );
  run('pmtiles', ['edit', stagedOutputPath, '--metadata', metadataEditPath]);
  run('pmtiles', ['verify', stagedOutputPath]);

  const header = readJsonOutput('pmtiles', ['show', stagedOutputPath, '--header-json']);
  const tileMetadata = readJsonOutput('pmtiles', ['show', stagedOutputPath, '--metadata']);
  const actualLayerIds = (tileMetadata.vector_layers || []).map(layer => layer.id);
  if (JSON.stringify(actualLayerIds) !== JSON.stringify(LAYER_NAMES)) {
    throw new Error(
      `PMTiles layer contract mismatch: expected ${LAYER_NAMES.join(', ')}, ` +
      `got ${actualLayerIds.join(', ')}`
    );
  }
  if (
    header.minzoom !== TILE_MINZOOM ||
    header.maxzoom !== TILE_MAXZOOM ||
    header.tile_type !== 'mvt'
  ) {
    throw new Error(
      `PMTiles header contract mismatch: z${header.minzoom}-${header.maxzoom}, ${header.tile_type}`
    );
  }
  if (
    tileMetadata.fecundidad_schema !== CONTEXT_SCHEMA_ID ||
    tileMetadata.attribution !== '© OpenStreetMap contributors · ODbL 1.0'
  ) {
    throw new Error('PMTiles embedded metadata contract is incomplete');
  }

  const rawTimestamp = run(
    'osmium',
    ['fileinfo', '-g', 'header.option.timestamp', rawPath],
    { capture: true }
  ).stdout;
  const outputRecord = await fileRecord(stagedOutputPath);
  const metadata = {
    schema_version: CONTEXT_SCHEMA_VERSION,
    dataset: 'fecundidad-osm-regional-context',
    contract: {
      id: 'fecundidad-osm-context',
      version: CONTEXT_SCHEMA_VERSION,
      minzoom: TILE_MINZOOM,
      maxzoom: TILE_MAXZOOM,
      max_tile_bytes: MAXIMUM_TILE_BYTES,
      simplification: SIMPLIFICATION,
      simplify_only_low_zooms: true,
      layer_ids: LAYER_NAMES,
      drop_smallest_as_needed: true,
      coalesce_smallest_as_needed: true,
      detect_shared_borders: true
    },
    region: args.region,
    label: region.label,
    generated_at: new Date().toISOString(),
    snapshot: rawTimestamp || config.snapshot,
    bounds: region.bounds,
    clip_bbox: Array.isArray(region.clip_bbox) ? region.clip_bbox : null,
    source: {
      url: region.source_url,
      ...rawRecord,
      ...officialMd5
    },
    configuration,
    intermediates: {
      filtered: await fileRecord(filteredPath),
      clipped: Array.isArray(region.clip_bbox) ? await fileRecord(clippedPath) : null,
      geojsonseq: await fileRecord(sequencePath),
      stats: await fileRecord(statsPath)
    },
    reference_integrity: referenceIntegrity,
    output: {
      ...outputRecord,
      filename: path.basename(outputPath),
      path: relativeOutputPath(outputPath, region.output_filename),
      minzoom: header.minzoom,
      maxzoom: header.maxzoom,
      bounds: header.bounds,
      center: header.center,
      tile_type: header.tile_type,
      tile_compression: header.tile_compression
    },
    features: statsDocument,
    validation,
    vector_layers: tileMetadata.vector_layers,
    tools: {
      node: process.version,
      osmium: toolVersion('osmium', ['--version']),
      tippecanoe: toolVersion('tippecanoe', ['--version']),
      pmtiles: toolVersion('pmtiles', ['version'])
    },
    licence: {
      database: 'Open Database License 1.0',
      attribution: '© OpenStreetMap contributors',
      url: 'https://www.openstreetmap.org/copyright'
    }
  };

  await writeFile(stagedMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  await rename(stagedOutputPath, outputPath);
  await rename(stagedMetadataPath, metadataPath);
  await rm(metadataEditPath, { force: true });
  if (!args.keepMbtiles) await rm(mbtilesPath, { force: true });

  console.log(`\nBuilt ${outputPath}`);
  console.log(`Metadata ${metadataPath}`);
};

const args = parseArguments(process.argv.slice(2));
if (args.help) {
  console.log(usage);
  process.exit(0);
}
if (!args.region || !args.raw || !args.output) {
  console.error(usage);
  process.exit(2);
}

build(args).catch(error => {
  process.stderr.write(`build-context-region: ${error.message}\n`);
  process.stderr.write('Intermediate build artifacts were preserved for inspection.\n');
  process.exitCode = 1;
});
