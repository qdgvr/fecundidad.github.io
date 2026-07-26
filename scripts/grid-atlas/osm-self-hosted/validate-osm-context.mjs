#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const LAYERS = ['base_road', 'base_place'];
const ROAD_CLASSES = new Set(['motorway', 'trunk', 'primary']);
const PLACE_CLASSES = new Set(['country', 'state', 'province', 'city', 'town']);
const GEOMETRIES = {
  base_road: new Set(['LineString', 'MultiLineString']),
  base_place: new Set(['Point'])
};

const usage = `Usage:
  node validate-osm-context.mjs --input-dir DIR [--stats FILE]
`;

export const parseArguments = values => {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--help' || value === '-h') parsed.help = true;
    else if (value === '--input-dir') parsed.inputDir = values[++index];
    else if (value === '--stats') parsed.statsPath = values[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return parsed;
};

const validCoordinates = value => {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (typeof value[0] === 'number') {
    if (
      value.length < 2 ||
      !value.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate))
    ) {
      return false;
    }
    return value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;
  }
  return value.every(validCoordinates);
};

const expectedRoadMinzoom = properties => {
  const base = {
    motorway: 4,
    trunk: 5,
    primary: 6
  }[properties.class];
  return base + (properties.link === 1 ? 1 : 0);
};

const expectedPlaceMinzoom = properties => {
  if (properties.class === 'country') return 2;
  if (properties.class === 'state' || properties.class === 'province') return 4;
  const population = Number(properties.population || 0);
  if (properties.class === 'city') {
    if (properties.capital === 'yes' || properties.capital === '2') return 3;
    if (properties.capital === '4' || population >= 5_000_000) return 4;
    if (population >= 1_000_000) return 5;
    if (population >= 250_000) return 6;
    return 7;
  }
  if (properties.class === 'town') return population >= 100_000 ? 7 : 8;
  return 9;
};

const validateFeature = (feature, layer, source, lineNumber, errors) => {
  const location = `${source}:${lineNumber}`;
  if (!feature || feature.type !== 'Feature') {
    errors.push(`${location}: record is not a GeoJSON Feature`);
    return;
  }
  if (!feature.geometry || !GEOMETRIES[layer].has(feature.geometry.type)) {
    errors.push(`${location}: invalid geometry for ${layer}: ${feature.geometry?.type}`);
  } else if (!validCoordinates(feature.geometry.coordinates)) {
    errors.push(`${location}: invalid or out-of-range coordinates`);
  }

  const properties = feature.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    errors.push(`${location}: properties must be an object`);
    return;
  }

  let expectedMinzoom;
  if (layer === 'base_road') {
    if (!ROAD_CLASSES.has(properties.class)) {
      errors.push(`${location}: invalid road class: ${properties.class}`);
    }
    if (![0, 1].includes(properties.link)) {
      errors.push(`${location}: road link must be 0 or 1`);
    }
    for (const key of ['bridge', 'tunnel']) {
      if (properties[key] !== undefined && typeof properties[key] !== 'string') {
        errors.push(`${location}: ${key} must be a string when present`);
      }
    }
    if (ROAD_CLASSES.has(properties.class) && [0, 1].includes(properties.link)) {
      expectedMinzoom = expectedRoadMinzoom(properties);
    }
  } else {
    if (!PLACE_CLASSES.has(properties.class)) {
      errors.push(`${location}: invalid place class: ${properties.class}`);
    }
    if (typeof properties.name !== 'string' || !properties.name.trim()) {
      errors.push(`${location}: place name must be a non-empty string`);
    }
    if (
      properties.name_local !== undefined &&
      (typeof properties.name_local !== 'string' || !properties.name_local.trim())
    ) {
      errors.push(`${location}: name_local must be a non-empty string when present`);
    }
    if (
      properties.population !== undefined &&
      (!Number.isSafeInteger(properties.population) || properties.population <= 0)
    ) {
      errors.push(`${location}: population must be a positive integer when present`);
    }
    if (properties.capital !== undefined && typeof properties.capital !== 'string') {
      errors.push(`${location}: capital must be a string when present`);
    }
    if (PLACE_CLASSES.has(properties.class)) expectedMinzoom = expectedPlaceMinzoom(properties);
  }

  if (!feature.tippecanoe || feature.tippecanoe.layer !== layer) {
    errors.push(`${location}: tippecanoe.layer must be ${layer}`);
  }
  if (expectedMinzoom !== undefined && feature.tippecanoe?.minzoom !== expectedMinzoom) {
    errors.push(`${location}: tippecanoe.minzoom must be ${expectedMinzoom}`);
  }
  if (feature.tippecanoe?.maxzoom !== 9) {
    errors.push(`${location}: tippecanoe.maxzoom must be 9`);
  }
};

const validateLayer = async (filePath, layer, errors) => {
  try {
    const details = await stat(filePath);
    if (!details.isFile()) {
      errors.push(`${filePath}: layer input is not a regular file`);
      return 0;
    }
  } catch (error) {
    errors.push(`${filePath}: cannot stat layer (${error.message})`);
    return 0;
  }

  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let count = 0;
  let lineNumber = 0;
  try {
    for await (const rawLine of lines) {
      lineNumber += 1;
      const line = rawLine.replace(/^\x1e/, '').trim();
      if (!line) continue;
      count += 1;
      try {
        validateFeature(JSON.parse(line), layer, filePath, lineNumber, errors);
      } catch (error) {
        errors.push(`${filePath}:${lineNumber}: invalid JSON (${error.message})`);
      }
      if (errors.length >= 100) break;
    }
  } catch (error) {
    errors.push(`${filePath}: cannot read layer (${error.message})`);
  }
  return count;
};

export const runValidator = async options => {
  if (!options.inputDir) throw new Error('--input-dir is required');
  const inputDirectory = path.resolve(options.inputDir);
  const statsPath = path.resolve(options.statsPath || path.join(inputDirectory, 'stats.json'));
  const errors = [];
  const counts = {};

  for (const layer of LAYERS) {
    counts[layer] = await validateLayer(
      path.join(inputDirectory, `${layer}.ndjson`),
      layer,
      errors
    );
  }

  let stats;
  try {
    stats = JSON.parse(await readFile(statsPath, 'utf8'));
    if (stats.schema_version !== 1) {
      errors.push(`${statsPath}: unsupported schema_version ${stats.schema_version}`);
    }
    for (const layer of LAYERS) {
      if (stats.layers?.[layer] !== counts[layer]) {
        errors.push(
          `${statsPath}: ${layer} count ${stats.layers?.[layer]} does not match ${counts[layer]}`
        );
      }
    }
    for (const [layer, count] of Object.entries(stats.layers || {})) {
      if (!LAYERS.includes(layer) && count !== 0) {
        errors.push(`${statsPath}: non-contract layer ${layer} emitted ${count} features`);
      }
    }
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    if (stats.emitted_features !== total) {
      errors.push(
        `${statsPath}: emitted_features ${stats.emitted_features} does not match ${total}`
      );
    }
    if (stats.input_records !== stats.emitted_features + stats.skipped_records) {
      errors.push(`${statsPath}: input/emitted/skipped accounting invariant failed`);
    }
  } catch (error) {
    errors.push(`${statsPath}: cannot read statistics (${error.message})`);
  }

  if (counts.base_road === 0) errors.push('base_road must contain at least one feature');
  if (counts.base_place === 0) errors.push('base_place must contain at least one feature');

  return {
    valid: errors.length === 0,
    layer_ids: [...LAYERS],
    counts,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    errors
  };
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
    return;
  }
  const result = await runValidator(options);
  if (!result.valid) {
    throw new Error(
      `validation failed:\n${result.errors.map(error => `- ${error}`).join('\n')}`
    );
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(error => {
    process.stderr.write(`validate-osm-context: ${error.message}\n`);
    process.exitCode = 1;
  });
}
