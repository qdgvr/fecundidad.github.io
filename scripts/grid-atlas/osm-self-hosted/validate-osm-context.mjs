#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  CONTEXT_SCHEMA_VERSION,
  GEOMETRIES,
  LANDCOVER_CLASSES,
  LANDUSE_CLASSES,
  LAYER_NAMES,
  PLACE_CLASSES,
  RAIL_CLASSES,
  ROAD_CLASSES,
  TILE_MAXZOOM,
  WATERWAY_CLASSES,
  boundaryMinzoom,
  landcoverMinzoom,
  landuseMinzoom,
  placeMinzoom,
  railMinzoom,
  roadMinzoom,
  waterMinzoom,
  waterwayMinzoom
} from './context-schema.mjs';

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

const validateIdentity = (properties, location, errors) => {
  if (!['node', 'way', 'relation'].includes(properties.osm_type)) {
    errors.push(`${location}: osm_type is invalid`);
  }
  if (!Number.isSafeInteger(properties.osm_id) || properties.osm_id <= 0) {
    errors.push(`${location}: osm_id must be a positive safe integer`);
  }
};

const validateNames = (properties, location, errors, required = false) => {
  if (required && (typeof properties.name !== 'string' || !properties.name.trim())) {
    errors.push(`${location}: name must be a non-empty string`);
  }
  for (const key of ['name', 'name_local', 'name_es']) {
    if (
      properties[key] !== undefined &&
      (typeof properties[key] !== 'string' || !properties[key].trim())
    ) {
      errors.push(`${location}: ${key} must be a non-empty string when present`);
    }
  }
};

const validateFlag = (properties, key, location, errors) => {
  if (properties[key] !== undefined && ![0, 1].includes(properties[key])) {
    errors.push(`${location}: ${key} must be 0 or 1 when present`);
  }
};

const expectedMinzoom = (feature, layer) => {
  const properties = feature.properties;
  if (layer === 'base_landcover') return landcoverMinzoom(feature.geometry);
  if (layer === 'base_landuse') return landuseMinzoom(feature.geometry);
  if (layer === 'base_water') return waterMinzoom(feature.geometry);
  if (layer === 'base_waterway') return waterwayMinzoom(properties.class);
  if (layer === 'base_coastline') return 8;
  if (layer === 'base_building') return 13;
  if (layer === 'base_road') return roadMinzoom(properties.class, properties.link === 1);
  if (layer === 'base_boundary') return boundaryMinzoom(properties.admin_level);
  if (layer === 'base_rail') return railMinzoom(properties.class);
  if (layer === 'base_place') return placeMinzoom(properties);
  return undefined;
};

const validateLayerProperties = (feature, layer, location, errors) => {
  const properties = feature.properties;
  validateIdentity(properties, location, errors);
  validateNames(properties, location, errors, layer === 'base_place');

  if (layer === 'base_landcover' && !LANDCOVER_CLASSES.has(properties.class)) {
    errors.push(`${location}: invalid landcover class: ${properties.class}`);
  } else if (layer === 'base_landuse' && !LANDUSE_CLASSES.has(properties.class)) {
    errors.push(`${location}: invalid landuse class: ${properties.class}`);
  } else if (layer === 'base_water') {
    if (typeof properties.class !== 'string' || !properties.class.trim()) {
      errors.push(`${location}: water class must be a non-empty string`);
    }
    validateFlag(properties, 'intermittent', location, errors);
  } else if (layer === 'base_waterway') {
    if (!WATERWAY_CLASSES.has(properties.class)) {
      errors.push(`${location}: invalid waterway class: ${properties.class}`);
    }
    validateFlag(properties, 'intermittent', location, errors);
    validateFlag(properties, 'tunnel', location, errors);
  } else if (layer === 'base_coastline') {
    if (properties.class !== 'coastline') {
      errors.push(`${location}: coastline class must be coastline`);
    }
  } else if (layer === 'base_building') {
    if (
      typeof properties.class !== 'string' ||
      !properties.class.trim() ||
      properties.class === 'no'
    ) {
      errors.push(`${location}: invalid building class: ${properties.class}`);
    }
    if (
      properties.levels !== undefined &&
      (!Number.isInteger(properties.levels) ||
        properties.levels <= 0 ||
        properties.levels > 200)
    ) {
      errors.push(`${location}: levels must be an integer from 1 to 200`);
    }
    if (
      properties.height_m !== undefined &&
      (typeof properties.height_m !== 'number' ||
        !Number.isFinite(properties.height_m) ||
        properties.height_m <= 0 ||
        properties.height_m > 1_000)
    ) {
      errors.push(`${location}: height_m must be a number from 0 to 1000`);
    }
  } else if (layer === 'base_road') {
    if (!ROAD_CLASSES.has(properties.class)) {
      errors.push(`${location}: invalid road class: ${properties.class}`);
    }
    validateFlag(properties, 'link', location, errors);
    validateFlag(properties, 'bridge', location, errors);
    validateFlag(properties, 'tunnel', location, errors);
  } else if (layer === 'base_boundary') {
    if (properties.class !== 'administrative') {
      errors.push(`${location}: boundary class must be administrative`);
    }
    if (
      !Number.isInteger(properties.admin_level) ||
      properties.admin_level < 2 ||
      properties.admin_level > 11
    ) {
      errors.push(`${location}: admin_level must be an integer from 2 to 11`);
    }
    validateFlag(properties, 'maritime', location, errors);
    validateFlag(properties, 'disputed', location, errors);
  } else if (layer === 'base_rail') {
    if (!RAIL_CLASSES.has(properties.class)) {
      errors.push(`${location}: invalid rail class: ${properties.class}`);
    }
    validateFlag(properties, 'bridge', location, errors);
    validateFlag(properties, 'tunnel', location, errors);
  } else if (layer === 'base_place') {
    if (!PLACE_CLASSES.has(properties.class)) {
      errors.push(`${location}: invalid place class: ${properties.class}`);
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
  }
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
  validateLayerProperties(feature, layer, location, errors);

  if (!feature.tippecanoe || feature.tippecanoe.layer !== layer) {
    errors.push(`${location}: tippecanoe.layer must be ${layer}`);
  }
  const minzoom = expectedMinzoom(feature, layer);
  if (
    Number.isInteger(minzoom) &&
    feature.tippecanoe?.minzoom !== minzoom
  ) {
    errors.push(`${location}: tippecanoe.minzoom must be ${minzoom}`);
  }
  if (feature.tippecanoe?.maxzoom !== TILE_MAXZOOM) {
    errors.push(`${location}: tippecanoe.maxzoom must be ${TILE_MAXZOOM}`);
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

  for (const layer of LAYER_NAMES) {
    counts[layer] = await validateLayer(
      path.join(inputDirectory, `${layer}.ndjson`),
      layer,
      errors
    );
  }

  let stats;
  try {
    stats = JSON.parse(await readFile(statsPath, 'utf8'));
    if (stats.schema_version !== CONTEXT_SCHEMA_VERSION) {
      errors.push(`${statsPath}: unsupported schema_version ${stats.schema_version}`);
    }
    for (const layer of LAYER_NAMES) {
      if (stats.layers?.[layer] !== counts[layer]) {
        errors.push(
          `${statsPath}: ${layer} count ${stats.layers?.[layer]} does not match ${counts[layer]}`
        );
      }
    }
    for (const [layer, count] of Object.entries(stats.layers || {})) {
      if (!LAYER_NAMES.includes(layer) && count !== 0) {
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

  for (const layer of LAYER_NAMES) {
    if (counts[layer] === 0) errors.push(`${layer} must contain at least one feature`);
  }

  return {
    valid: errors.length === 0,
    schema_version: CONTEXT_SCHEMA_VERSION,
    layer_ids: [...LAYER_NAMES],
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
