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

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(scriptDirectory, 'regions.json');
const normalizerPath = path.join(scriptDirectory, 'normalize-osm-power.mjs');
const validatorPath = path.join(scriptDirectory, 'validate-osm-power.mjs');
const powerFilterPath = path.join(scriptDirectory, 'power-tags.filter');
const pointFilterPath = path.join(scriptDirectory, 'power-points.filter');
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

const usage = `Usage:
  node build-region.mjs --region KEY --raw INPUT.osm.pbf --output OUTPUT.pmtiles [options]

Required:
  --region KEY       europa | estados-unidos | china | japon | corea-del-sur | taiwan
  --raw PATH         Existing Geofabrik .osm.pbf input
  --output PATH      Destination .pmtiles archive

Options:
  --work PATH        Durable intermediate directory (default: .work/KEY)
  --force            Rebuild existing intermediate and output files
  --reuse-export     Reuse provenance-bound filtered/exported files in --work
  --adopt-reuse-export
                     One-time binding of existing exports that predate provenance
  --keep-mbtiles     Retain the intermediate MBTiles archive
  --help             Show this help
`;

const parseArguments = values => {
  const parsed = {
    force: false,
    keepMbtiles: false,
    reuseExport: false,
    adoptReuseExport: false
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--force') parsed.force = true;
    else if (value === '--keep-mbtiles') parsed.keepMbtiles = true;
    else if (value === '--reuse-export') parsed.reuseExport = true;
    else if (value === '--adopt-reuse-export') parsed.adoptReuseExport = true;
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

const run = (command, args, options = {}) => {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error) throw result.error;
  const allowedStatuses = options.allowedStatuses || [0];
  if (!allowedStatuses.includes(result.status)) {
    const detail = options.capture ? `\n${result.stderr || result.stdout || ''}` : '';
    throw new Error(`${command} exited with status ${result.status}${detail}`);
  }
  if (!options.capture) return '';
  return {
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim()
  };
};

const exists = async filePath => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
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
  const hashes = await hashFile(filePath);
  return {
    filename: path.basename(filePath),
    bytes: details.size,
    ...hashes
  };
};

const toolVersion = (command, args) => {
  const result = run(command, args, { capture: true });
  const output = result.stdout || result.stderr;
  return output.split('\n')[0].trim();
};

const parseReferenceCheck = output => {
  const patterns = {
    nodes_in_ways_missing: /Nodes\s+in ways\s+missing:\s+(\d+)/,
    nodes_in_relations_missing: /Nodes\s+in relations missing:\s+(\d+)/,
    ways_in_relations_missing: /Ways\s+in relations missing:\s+(\d+)/,
    relations_in_relations_missing: /Relations in relations missing:\s+(\d+)/
  };
  return Object.fromEntries(
    Object.entries(patterns).map(([key, pattern]) => [
      key,
      Number(output.match(pattern)?.[1] || 0)
    ])
  );
};

const verifyOfficialMd5 = async (rawPath, computedMd5) => {
  const md5Path = `${rawPath}.md5`;
  if (!(await exists(md5Path))) {
    return {
      official_md5: null,
      official_md5_file: null,
      official_md5_verified: false
    };
  }
  const value = (await readFile(md5Path, 'utf8')).trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{32}$/i.test(value)) {
    throw new Error(`Invalid official MD5 sidecar: ${md5Path}`);
  }
  const officialMd5 = value.toLowerCase();
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

const assertSameRecord = (label, expected, actual) => {
  for (const key of ['filename', 'bytes', 'sha256', 'md5']) {
    if (expected?.[key] !== actual?.[key]) {
      throw new Error(
        `Export provenance mismatch for ${label}.${key}: expected ${expected?.[key]}, got ${actual?.[key]}`
      );
    }
  }
};

const ensureCommand = command => {
  const result = spawnSync('which', [command], {
    stdio: 'ignore'
  });
  if (result.status !== 0) throw new Error(`Required command is unavailable: ${command}`);
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
if (args.adoptReuseExport && !args.reuseExport) {
  throw new Error('--adopt-reuse-export is only valid together with --reuse-export');
}

for (const command of ['node', 'osmium', 'tippecanoe', 'pmtiles']) ensureCommand(command);
if (!(await exists(normalizerPath))) {
  throw new Error(`Normalizer is missing: ${normalizerPath}`);
}

const config = JSON.parse(await readFile(configPath, 'utf8'));
const region = config.regions?.[args.region];
if (!region) throw new Error(`Unknown region: ${args.region}`);
if (
  !Number.isInteger(config.tile_minzoom) ||
  !Number.isInteger(config.tile_maxzoom) ||
  config.tile_minzoom < 0 ||
  config.tile_maxzoom < config.tile_minzoom
) {
  throw new Error('regions.json must define a valid tile_minzoom/tile_maxzoom pair');
}

const rawPath = path.resolve(args.raw);
const outputPath = path.resolve(args.output);
const workDirectory = path.resolve(
  args.work || path.join(scriptDirectory, '.work', args.region)
);
const normalizedDirectory = path.join(workDirectory, 'normalized');
const filteredPath = path.join(workDirectory, `${args.region}-power-filtered.osm.pbf`);
const clippedPath = path.join(workDirectory, `${args.region}-power-clipped.osm.pbf`);
const pointsPath = path.join(workDirectory, `${args.region}-power-points.osm.pbf`);
const linearSequencePath = path.join(workDirectory, `${args.region}-linear.geojsonseq`);
const pointSequencePath = path.join(workDirectory, `${args.region}-points.geojsonseq`);
const normalizerStatsPath = path.join(workDirectory, `${args.region}-feature-counts.json`);
const mbtilesPath = path.join(workDirectory, `${args.region}.mbtiles`);
const metadataPath = `${outputPath}.metadata.json`;
const exportProvenancePath = path.join(
  workDirectory,
  `${args.region}-export-provenance.json`
);

if (!(await exists(rawPath))) throw new Error(`Raw input does not exist: ${rawPath}`);
if ((await exists(outputPath)) && !args.force) {
  throw new Error(`Output exists; pass --force to rebuild: ${outputPath}`);
}

console.log(`Hashing raw PBF once for SHA-256 and MD5: ${rawPath}`);
const rawRecord = await fileRecord(rawPath);
const officialMd5Verification = await verifyOfficialMd5(rawPath, rawRecord.md5);
const configurationRecords = {
  regions: await fileRecord(configPath),
  power_tags_filter: await fileRecord(powerFilterPath),
  power_points_filter: await fileRecord(pointFilterPath)
};

await mkdir(workDirectory, { recursive: true });
await mkdir(normalizedDirectory, { recursive: true });
await mkdir(path.dirname(outputPath), { recursive: true });

let geographicInputPath = Array.isArray(region.clip_bbox) ? clippedPath : filteredPath;
const buildExportProvenance = async adopted => {
  const [geographicInput, linearGeojsonseq, pointGeojsonseq] = await Promise.all([
    fileRecord(geographicInputPath),
    fileRecord(linearSequencePath),
    fileRecord(pointSequencePath)
  ]);
  return {
    schema_version: 1,
    region: args.region,
    created_at: new Date().toISOString(),
    adopted_existing_exports: adopted,
    raw: {
      ...rawRecord,
      ...officialMd5Verification
    },
    configuration: configurationRecords,
    intermediates: {
      geographic_input: geographicInput,
      linear_geojsonseq: linearGeojsonseq,
      point_geojsonseq: pointGeojsonseq
    }
  };
};

const validateExportProvenance = async recorded => {
  if (recorded.schema_version !== 1) {
    throw new Error(`Unsupported export provenance schema: ${recorded.schema_version}`);
  }
  if (recorded.region !== args.region) {
    throw new Error(
      `Export provenance region mismatch: expected ${args.region}, got ${recorded.region}`
    );
  }
  assertSameRecord('raw', recorded.raw, rawRecord);
  for (const [name, actual] of Object.entries(configurationRecords)) {
    assertSameRecord(`configuration.${name}`, recorded.configuration?.[name], actual);
  }
  const current = await buildExportProvenance(false);
  for (const [name, actual] of Object.entries(current.intermediates)) {
    assertSameRecord(`intermediates.${name}`, recorded.intermediates?.[name], actual);
  }
};

let pendingAdoptedProvenance = null;
if (!args.reuseExport) {
  run('osmium', [
    'tags-filter',
    '--expressions', powerFilterPath,
    '--remove-tags',
    '--generator', 'fecundidad-osm-power/schema1',
    '--overwrite',
    rawPath,
    '--output', filteredPath
  ]);

  geographicInputPath = filteredPath;
  if (Array.isArray(region.clip_bbox)) {
    run('osmium', [
      'extract',
      '--bbox', region.clip_bbox.join(','),
      '--strategy', 'smart',
      '--option', 'types=multipolygon,power,route',
      '--set-bounds',
      '--generator', 'fecundidad-osm-power/schema1',
      '--overwrite',
      filteredPath,
      '--output', clippedPath
    ]);
    geographicInputPath = clippedPath;
  }
} else {
  for (const candidate of [
    geographicInputPath,
    linearSequencePath,
    pointSequencePath
  ]) {
    if (!(await exists(candidate))) {
      throw new Error(`--reuse-export requires the existing intermediate: ${candidate}`);
    }
  }
  if (await exists(exportProvenancePath)) {
    if (args.adoptReuseExport) {
      throw new Error(
        `Export provenance already exists; omit --adopt-reuse-export and use strict reuse: ${exportProvenancePath}`
      );
    }
    const recorded = JSON.parse(await readFile(exportProvenancePath, 'utf8'));
    await validateExportProvenance(recorded);
    console.log(`Verified reusable export provenance: ${exportProvenancePath}`);
  } else {
    if (!args.adoptReuseExport) {
      throw new Error(
        `Reusable exports have no provenance. Review them once, then rerun with --reuse-export --adopt-reuse-export: ${exportProvenancePath}`
      );
    }
    pendingAdoptedProvenance = await buildExportProvenance(true);
    console.log('Reusable exports are ready for one-time adoption after reference checks.');
  }
}

const referenceCheckResult = run('osmium', [
  'check-refs',
  '--check-relations',
  geographicInputPath
], {
  capture: true,
  allowedStatuses: [0, 1]
});
const referenceCheckOutput = [
  referenceCheckResult.stdout,
  referenceCheckResult.stderr
].filter(Boolean).join('\n');
if (referenceCheckOutput) console.log(referenceCheckOutput);
const referenceIntegrity = parseReferenceCheck(referenceCheckOutput);
if (referenceIntegrity.nodes_in_ways_missing > 0) {
  throw new Error(
    `Unsafe extract: ${referenceIntegrity.nodes_in_ways_missing} node references are missing from ways`
  );
}
if (referenceCheckResult.status !== 0) {
  console.warn(
    'Continuing with incomplete relation membership; counts will be recorded in metadata.'
  );
}
if (pendingAdoptedProvenance) {
  await writeFile(
    exportProvenancePath,
    `${JSON.stringify(pendingAdoptedProvenance, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx' }
  );
  console.log(`Adopted and bound reusable exports: ${exportProvenancePath}`);
}

if (!args.reuseExport) {
  run('osmium', [
    'tags-filter',
    '--omit-referenced',
    '--expressions', pointFilterPath,
    '--generator', 'fecundidad-osm-power/schema1',
    '--overwrite',
    geographicInputPath,
    '--output', pointsPath
  ]);

  run('osmium', [
    'export',
    '--geometry-types', 'linestring,polygon',
    '--attributes', 'type,id,version,timestamp',
    '--add-unique-id', 'type_id',
    '--output-format', 'geojsonseq',
    '--overwrite',
    geographicInputPath,
    '--output', linearSequencePath
  ]);

  run('osmium', [
    'export',
    '--geometry-types', 'point',
    '--attributes', 'type,id,version,timestamp',
    '--add-unique-id', 'type_id',
    '--output-format', 'geojsonseq',
    '--overwrite',
    pointsPath,
    '--output', pointSequencePath
  ]);

  const provenance = await buildExportProvenance(false);
  await writeFile(
    exportProvenancePath,
    `${JSON.stringify(provenance, null, 2)}\n`,
    'utf8'
  );
  console.log(`Wrote export provenance: ${exportProvenancePath}`);
}

run('node', [
  normalizerPath,
  '--input', linearSequencePath,
  '--input', pointSequencePath,
  '--output-dir', normalizedDirectory,
  '--stats', normalizerStatsPath,
  '--region', args.region,
  '--force'
]);

run('node', [
  validatorPath,
  '--input-dir', normalizedDirectory,
  '--stats', normalizerStatsPath
]);

const tippecanoeArgs = [
  '--output', mbtilesPath,
  '--force',
  '--read-parallel',
  '--minimum-zoom', String(config.tile_minzoom),
  '--maximum-zoom', String(config.tile_maxzoom),
  '--no-feature-limit',
  '--no-tile-size-limit',
  '--quiet',
  '--no-tiny-polygon-reduction-at-maximum-zoom',
  '--preserve-input-order',
  '--name', `Fecundidad OSM power · ${region.label}`,
  '--description', `Project-built OSM power snapshot ${config.snapshot}`,
  '--attribution', '© OpenStreetMap contributors · ODbL 1.0'
];
let nonEmptyLayerCount = 0;
for (const layerName of layerNames) {
  const layerPath = path.join(normalizedDirectory, `${layerName}.ndjson`);
  if (!(await exists(layerPath)) || (await stat(layerPath)).size === 0) continue;
  tippecanoeArgs.push('--named-layer', `${layerName}:${layerPath}`);
  nonEmptyLayerCount += 1;
}
if (!nonEmptyLayerCount) throw new Error(`No normalized features found for ${args.region}`);
tippecanoeArgs.push('--temporary-directory', path.join(workDirectory, 'tippecanoe-tmp'));
await mkdir(path.join(workDirectory, 'tippecanoe-tmp'), { recursive: true });
run('tippecanoe', tippecanoeArgs);

run('pmtiles', ['convert', mbtilesPath, outputPath, '--force']);
const generatedTileMetadata = JSON.parse(
  run('pmtiles', ['show', outputPath, '--metadata'], { capture: true }).stdout
);
const generatedLayersById = new Map(
  (generatedTileMetadata.vector_layers || []).map(layer => [layer.id, layer])
);
const contractLayerIds = new Set(layerNames);
const contractVectorLayers = layerNames.map(layerName => (
  generatedLayersById.get(layerName) || {
    id: layerName,
    description: 'No features in this regional OSM snapshot.',
    minzoom: config.tile_minzoom,
    maxzoom: config.tile_maxzoom,
    fields: {}
  }
));
for (const layer of generatedTileMetadata.vector_layers || []) {
  if (!contractLayerIds.has(layer.id)) contractVectorLayers.push(layer);
}
const editedTileMetadata = {
  ...generatedTileMetadata,
  vector_layers: contractVectorLayers
};
const pmtilesMetadataEditPath = path.join(
  workDirectory,
  `${args.region}-pmtiles-metadata-edit.json`
);
await writeFile(
  pmtilesMetadataEditPath,
  `${JSON.stringify(editedTileMetadata, null, 2)}\n`,
  'utf8'
);
try {
  run('pmtiles', [
    'edit',
    outputPath,
    '--metadata',
    pmtilesMetadataEditPath
  ]);
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
const advertisedLayerIds = new Set(
  (tileMetadata.vector_layers || []).map(layer => layer.id)
);
const missingContractLayers = layerNames.filter(
  layerName => !advertisedLayerIds.has(layerName)
);
if (missingContractLayers.length) {
  throw new Error(
    `PMTiles metadata is missing contract layers after edit: ${missingContractLayers.join(', ')}`
  );
}
const featureCounts = JSON.parse(await readFile(normalizerStatsPath, 'utf8'));
const rawTimestamp = run(
  'osmium',
  ['fileinfo', '-g', 'header.option.timestamp', rawPath],
  { capture: true }
).stdout;
const generatedAt = new Date().toISOString();

const metadata = {
  schema_version: 1,
  region: args.region,
  label: region.label,
  generated_at: generatedAt,
  snapshot: rawTimestamp || config.snapshot,
  bounds: region.bounds,
  source: {
    url: region.source_url,
    ...rawRecord,
    ...officialMd5Verification
  },
  export_provenance: await fileRecord(exportProvenancePath),
  filtered: await fileRecord(geographicInputPath),
  reference_integrity: referenceIntegrity,
  output: {
    ...(await fileRecord(outputPath)),
    path: `data/grid-atlas/osm-power/${region.output_filename}`,
    minzoom: header.minzoom,
    maxzoom: header.maxzoom,
    bounds: header.bounds,
    center: header.center,
    tile_type: header.tile_type,
    tile_compression: header.tile_compression
  },
  features: featureCounts,
  vector_layers: tileMetadata.vector_layers || [],
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

await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
if (!args.keepMbtiles) await rm(mbtilesPath, { force: true });

console.log(`\nBuilt ${outputPath}`);
console.log(`Metadata ${metadataPath}`);
