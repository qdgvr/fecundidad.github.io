#!/usr/bin/env node

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { once } from 'node:events';
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
  compactNames,
  landcoverMinzoom,
  landuseMinzoom,
  normalizeLandcoverClass,
  normalizeLanduseClass,
  normalizeWaterClass,
  numericPopulation,
  osmIdentity,
  placeMinzoom,
  railMinzoom,
  roadClass,
  roadMinzoom,
  textValue,
  waterMinzoom,
  waterwayMinzoom
} from './context-schema.mjs';

const usage = `Usage:
  node normalize-osm-context.mjs --input INPUT.geojsonseq --output-dir DIR [options]

Options:
  --input PATH  GeoJSONSeq input; repeat to stream multiple inputs
  --stats PATH  Stats JSON destination (default: DIR/stats.json)
  --force       Replace an existing output directory
  --help        Show this help
`;

export const parseArguments = values => {
  const parsed = { force: false, inputs: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--force') parsed.force = true;
    else if (value === '--help' || value === '-h') parsed.help = true;
    else if (value === '--input') {
      const next = values[index + 1];
      if (!next || next.startsWith('--')) throw new Error('Missing value for --input');
      parsed.inputs.push(next);
      index += 1;
    } else if (value === '--output-dir' || value === '--stats') {
      const next = values[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`Missing value for ${value}`);
      if (value === '--output-dir') parsed.outputDir = next;
      else parsed.statsPath = next;
      index += 1;
    } else {
      throw new Error(`Unexpected argument: ${value}`);
    }
  }
  return parsed;
};

const optionalText = (properties, key) => {
  const value = textValue(properties[key]);
  return value ? { [key]: value } : {};
};

const booleanFlag = value => {
  const normalized = textValue(value).toLowerCase();
  if (!normalized || ['no', 'false', '0'].includes(normalized)) return 0;
  return 1;
};

const compactIdentity = properties => {
  const identity = osmIdentity(properties);
  return identity ? identity : null;
};

const compactLinearProperties = (properties, extra = {}) => {
  const identity = compactIdentity(properties);
  if (!identity) return null;
  return {
    ...identity,
    ...extra,
    ...compactNames(properties)
  };
};

const compactAreaProperties = (properties, extra = {}) => {
  const identity = compactIdentity(properties);
  if (!identity) return null;
  return {
    ...identity,
    ...extra,
    ...compactNames(properties)
  };
};

const numericBuildingValue = value => {
  const match = textValue(value).replace(',', '.').match(/^-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const buildingHeightMetres = value => {
  const raw = textValue(value).toLowerCase().replace(',', '.');
  const parsed = numericBuildingValue(raw);
  if (!parsed) return 0;
  if (/\bft\b|feet|foot/.test(raw)) return Math.round(parsed * 0.3048 * 10) / 10;
  return Math.round(parsed * 10) / 10;
};

export const classifyContextFeature = feature => {
  const geometry = feature?.geometry;
  const properties = feature?.properties;
  if (
    !geometry ||
    !properties ||
    typeof properties !== 'object' ||
    Array.isArray(properties)
  ) {
    return { skip: 'invalid_feature' };
  }
  if (!compactIdentity(properties)) return { skip: 'invalid_osm_identity' };

  const place = textValue(properties.place);
  if (
    PLACE_CLASSES.has(place) &&
    geometry.type === 'Point'
  ) {
    const names = compactNames(properties);
    if (!names.name) return { skip: 'unnamed_place' };
    const population = numericPopulation(properties.population);
    return {
      layer: 'base_place',
      geometry,
      minzoom: placeMinzoom(properties),
      properties: {
        ...compactIdentity(properties),
        ...names,
        class: place,
        ...(population ? { population } : {}),
        ...optionalText(properties, 'capital')
      }
    };
  }

  const highway = textValue(properties.highway);
  const normalizedRoad = roadClass(highway);
  if (
    ROAD_CLASSES.has(normalizedRoad) &&
    GEOMETRIES.base_road.has(geometry.type)
  ) {
    const link = highway.endsWith('_link') ? 1 : 0;
    const compact = compactLinearProperties(properties, {
      class: normalizedRoad,
      link,
      bridge: booleanFlag(properties.bridge),
      tunnel: booleanFlag(properties.tunnel),
      ...optionalText(properties, 'surface'),
      ...optionalText(properties, 'ref')
    });
    return compact
      ? {
          layer: 'base_road',
          geometry,
          minzoom: roadMinzoom(normalizedRoad, link === 1),
          properties: compact
        }
      : { skip: 'invalid_osm_identity' };
  }

  const railway = textValue(properties.railway);
  if (
    RAIL_CLASSES.has(railway) &&
    GEOMETRIES.base_rail.has(geometry.type)
  ) {
    const compact = compactLinearProperties(properties, {
      class: railway,
      bridge: booleanFlag(properties.bridge),
      tunnel: booleanFlag(properties.tunnel),
      ...optionalText(properties, 'service'),
      ...optionalText(properties, 'ref')
    });
    return compact
      ? {
          layer: 'base_rail',
          geometry,
          minzoom: railMinzoom(railway),
          properties: compact
        }
      : { skip: 'invalid_osm_identity' };
  }

  if (
    textValue(properties.boundary) === 'administrative' &&
    GEOMETRIES.base_boundary.has(geometry.type)
  ) {
    const adminLevel = Number.parseInt(textValue(properties.admin_level), 10);
    if (!Number.isInteger(adminLevel) || adminLevel < 2 || adminLevel > 11) {
      return { skip: 'unsupported_admin_level' };
    }
    const compact = compactLinearProperties(properties, {
      class: 'administrative',
      admin_level: adminLevel,
      maritime: booleanFlag(properties.maritime),
      disputed: booleanFlag(properties.disputed)
    });
    return compact
      ? {
          layer: 'base_boundary',
          geometry,
          minzoom: boundaryMinzoom(properties.admin_level),
          properties: compact
        }
      : { skip: 'invalid_osm_identity' };
  }

  if (
    textValue(properties.natural) === 'coastline' &&
    GEOMETRIES.base_coastline.has(geometry.type)
  ) {
    const compact = compactLinearProperties(properties, { class: 'coastline' });
    return compact
      ? {
          layer: 'base_coastline',
          geometry,
          minzoom: 8,
          properties: compact
        }
      : { skip: 'invalid_osm_identity' };
  }

  const waterway = textValue(properties.waterway);
  if (
    WATERWAY_CLASSES.has(waterway) &&
    GEOMETRIES.base_waterway.has(geometry.type)
  ) {
    const compact = compactLinearProperties(properties, {
      class: waterway,
      intermittent: booleanFlag(properties.intermittent),
      tunnel: booleanFlag(properties.tunnel)
    });
    return compact
      ? {
          layer: 'base_waterway',
          geometry,
          minzoom: waterwayMinzoom(waterway),
          properties: compact
        }
      : { skip: 'invalid_osm_identity' };
  }

  const water = normalizeWaterClass(properties);
  if (water && GEOMETRIES.base_water.has(geometry.type)) {
    const compact = compactAreaProperties(properties, {
      class: water,
      intermittent: booleanFlag(properties.intermittent)
    });
    return compact
      ? {
          layer: 'base_water',
          geometry,
          minzoom: waterMinzoom(geometry),
          properties: compact
        }
      : { skip: 'invalid_osm_identity' };
  }

  const building = textValue(properties.building);
  if (building && building !== 'no' && GEOMETRIES.base_building.has(geometry.type)) {
    const levels = Math.round(numericBuildingValue(properties['building:levels']));
    const height = buildingHeightMetres(properties.height);
    const compact = compactAreaProperties(properties, {
      class: building,
      ...(levels > 0 && levels <= 200 ? { levels } : {}),
      ...(height > 0 && height <= 1_000 ? { height_m: height } : {})
    });
    return compact
      ? {
          layer: 'base_building',
          geometry,
          minzoom: 13,
          properties: compact
        }
      : { skip: 'invalid_osm_identity' };
  }

  const landcover = normalizeLandcoverClass(properties);
  if (
    LANDCOVER_CLASSES.has(landcover) &&
    GEOMETRIES.base_landcover.has(geometry.type)
  ) {
    const compact = compactAreaProperties(properties, { class: landcover });
    return compact
      ? {
          layer: 'base_landcover',
          geometry,
          minzoom: landcoverMinzoom(geometry),
          properties: compact
        }
      : { skip: 'invalid_osm_identity' };
  }

  const landuse = normalizeLanduseClass(properties);
  if (
    LANDUSE_CLASSES.has(landuse) &&
    GEOMETRIES.base_landuse.has(geometry.type)
  ) {
    const compact = compactAreaProperties(properties, { class: landuse });
    return compact
      ? {
          layer: 'base_landuse',
          geometry,
          minzoom: landuseMinzoom(geometry),
          properties: compact
        }
      : { skip: 'invalid_osm_identity' };
  }

  return { skip: 'unsupported_or_reference_geometry' };
};

export const runNormalizer = async options => {
  const inputPaths = (options.inputs || []).map(inputPath => path.resolve(inputPath));
  if (!inputPaths.length) throw new Error('at least one --input is required');
  if (!options.outputDir) throw new Error('--output-dir is required');

  const outputDirectory = path.resolve(options.outputDir);
  const statsPath = path.resolve(
    options.statsPath || path.join(outputDirectory, 'stats.json')
  );
  if (options.force) await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: false });

  const writers = Object.fromEntries(LAYER_NAMES.map(layer => [
    layer,
    createWriteStream(path.join(outputDirectory, `${layer}.ndjson`), {
      encoding: 'utf8',
      flags: 'wx'
    })
  ]));
  const stats = {
    schema_version: CONTEXT_SCHEMA_VERSION,
    input_records: 0,
    emitted_features: 0,
    skipped_records: 0,
    layers: Object.fromEntries(LAYER_NAMES.map(layer => [layer, 0])),
    skipped: {}
  };
  const skip = reason => {
    stats.skipped_records += 1;
    stats.skipped[reason] = (stats.skipped[reason] || 0) + 1;
  };
  const writeFeature = async classification => {
    const feature = {
      type: 'Feature',
      geometry: classification.geometry,
      properties: classification.properties,
      tippecanoe: {
        layer: classification.layer,
        minzoom: classification.minzoom,
        maxzoom: TILE_MAXZOOM
      }
    };
    const writer = writers[classification.layer];
    if (!writer.write(`${JSON.stringify(feature)}\n`)) {
      await once(writer, 'drain');
    }
    stats.layers[classification.layer] += 1;
    stats.emitted_features += 1;
  };

  for (const inputPath of inputPaths) {
    const input = createReadStream(inputPath, { encoding: 'utf8' });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const rawLine of lines) {
      const line = rawLine.replace(/^\x1e/, '').trim();
      if (!line) continue;
      stats.input_records += 1;
      let feature;
      try {
        feature = JSON.parse(line);
      } catch (error) {
        throw new Error(
          `Could not parse ${inputPath} record ${stats.input_records}: ${error.message}`
        );
      }
      const classification = classifyContextFeature(feature);
      if (classification.skip) skip(classification.skip);
      else await writeFeature(classification);
    }
  }

  for (const writer of Object.values(writers)) writer.end();
  await Promise.all(Object.values(writers).map(writer => once(writer, 'finish')));

  if (stats.input_records !== stats.emitted_features + stats.skipped_records) {
    throw new Error('Context feature accounting invariant failed');
  }
  await writeFile(statsPath, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
  return { stats, outputDirectory, statsPath };
};

const main = async () => {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }
  const result = await runNormalizer(args);
  process.stdout.write(
    `Normalized ${result.stats.input_records.toLocaleString('en-US')} records into ` +
    `${result.stats.emitted_features.toLocaleString('en-US')} context features.\n`
  );
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(error => {
    process.stderr.write(`normalize-osm-context: ${error.message}\n`);
    process.exitCode = 1;
  });
}
