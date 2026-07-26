#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  LAYERS,
  featureMinzoom,
  stripRecordSeparator,
} from "./power-schema.mjs";

const GEOMETRIES = {
  power_line: new Set(["LineString", "MultiLineString"]),
  power_plant: new Set(["Polygon", "MultiPolygon"]),
  power_generator_area: new Set(["Polygon", "MultiPolygon"]),
  power_substation: new Set(["Polygon", "MultiPolygon"]),
  power_plant_point: new Set(["Point", "MultiPoint"]),
  power_generator: new Set(["Point", "MultiPoint"]),
  power_substation_point: new Set(["Point", "MultiPoint"]),
  power_transformer: new Set(["Point"]),
  power_switch: new Set(["Point"]),
  power_compensator: new Set(["Point"]),
};

const TYPES = {
  power_line: new Set(["line", "minor_line", "cable", "minor_cable", "line_section"]),
  power_plant: new Set(["plant"]),
  power_generator_area: new Set(["generator"]),
  power_substation: new Set(["substation"]),
  power_plant_point: new Set(["plant"]),
  power_generator: new Set(["generator"]),
  power_substation_point: new Set(["substation"]),
  power_transformer: new Set(["transformer"]),
  power_switch: new Set(["switch"]),
  power_compensator: new Set(["compensator"]),
};

function usage() {
  return `Usage:
  node validate-osm-power.mjs --input-dir DIR [--stats FILE]
`;
}

export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--input-dir") options.inputDir = argv[++index];
    else if (argument === "--stats") options.statsPath = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function validCoordinates(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (typeof value[0] === "number") {
    return (
      value.length >= 2 &&
      value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
    );
  }
  return value.every(validCoordinates);
}

function validateFeature(feature, layer, source, lineNumber, errors) {
  const at = `${source}:${lineNumber}`;
  if (!feature || feature.type !== "Feature") {
    errors.push(`${at}: record is not a GeoJSON Feature`);
    return;
  }
  if (!feature.geometry || !GEOMETRIES[layer].has(feature.geometry.type)) {
    errors.push(`${at}: invalid geometry for ${layer}: ${feature.geometry?.type}`);
  } else if (!validCoordinates(feature.geometry.coordinates)) {
    errors.push(`${at}: invalid or non-finite coordinates`);
  }

  const properties = feature.properties ?? {};
  if (!TYPES[layer].has(properties.type)) {
    errors.push(`${at}: type does not match ${layer}`);
  }
  if (!["node", "way", "relation"].includes(properties.osm_type)) {
    errors.push(`${at}: missing or invalid osm_type`);
  }
  const osmId = properties.osm_id ?? feature.id;
  if (!(
    (typeof osmId === "number" && Number.isSafeInteger(osmId) && osmId > 0) ||
    (typeof osmId === "string" && /^[1-9]\d*$/.test(osmId))
  )) {
    errors.push(`${at}: missing or invalid osm_id`);
  }
  if (properties.osm_type === "relation" && properties.osm_id === undefined) {
    errors.push(`${at}: relation features must retain osm_id`);
  }
  for (const key of ["voltage", "voltage_2", "voltage_3", "voltage_4"]) {
    if (
      properties[key] !== undefined &&
      (typeof properties[key] !== "number" ||
        !Number.isFinite(properties[key]) ||
        properties[key] <= 0)
    ) {
      errors.push(`${at}: ${key} must be a positive numeric kV value`);
    }
  }
  if (
    properties.frequency !== undefined &&
    (typeof properties.frequency !== "number" ||
      !Number.isFinite(properties.frequency) ||
      properties.frequency < 0)
  ) {
    errors.push(`${at}: frequency must be a non-negative numeric Hz value`);
  }
  if (
    properties.output !== undefined &&
    (typeof properties.output !== "number" ||
      !Number.isFinite(properties.output) ||
      properties.output < 0)
  ) {
    errors.push(`${at}: output must be a non-negative numeric MW value`);
  }
  const expectedMinzoom = featureMinzoom(layer, properties);
  if (
    !feature.tippecanoe ||
    feature.tippecanoe.minzoom !== expectedMinzoom
  ) {
    errors.push(`${at}: tippecanoe.minzoom must be ${expectedMinzoom}`);
  }
}

async function validateLayer(path, layer, errors) {
  const input = createReadStream(path, { encoding: "utf8" });
  input.on("error", () => {});
  const lines = createInterface({ input, crlfDelay: Infinity });
  const identities = new Set();
  let count = 0;
  let lineNumber = 0;
  try {
    for await (const rawLine of lines) {
      lineNumber += 1;
      const line = stripRecordSeparator(rawLine);
      if (!line) continue;
      count += 1;
      try {
        const feature = JSON.parse(line);
        validateFeature(feature, layer, path, lineNumber, errors);
        const properties = feature.properties ?? {};
        const osmId = properties.osm_id ?? feature.id;
        const identity = `${properties.osm_type}:${osmId}`;
        if (identities.has(identity)) {
          errors.push(`${path}:${lineNumber}: duplicate OSM identity in ${layer}: ${identity}`);
        } else {
          identities.add(identity);
        }
      } catch (error) {
        errors.push(`${path}:${lineNumber}: invalid JSON (${error.message})`);
      }
      if (errors.length >= 100) break;
    }
  } catch (error) {
    errors.push(`${path}: cannot read layer (${error.message})`);
  }
  return count;
}

export async function runValidator(options) {
  if (!options.inputDir) throw new Error("--input-dir is required.");
  const inputDir = resolve(options.inputDir);
  const statsPath = resolve(options.statsPath ?? join(inputDir, "stats.json"));
  const errors = [];
  const counts = {};

  for (const layer of LAYERS) {
    counts[layer] = await validateLayer(join(inputDir, `${layer}.ndjson`), layer, errors);
  }

  let stats;
  try {
    stats = JSON.parse(await readFile(statsPath, "utf8"));
    for (const layer of LAYERS) {
      if (stats.layers?.[layer] !== counts[layer]) {
        errors.push(
          `${statsPath}: ${layer} count ${stats.layers?.[layer]} does not match ${counts[layer]}`,
        );
      }
    }
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    if (stats.emitted !== total) {
      errors.push(`${statsPath}: emitted count ${stats.emitted} does not match ${total}`);
    }
  } catch (error) {
    errors.push(`${statsPath}: cannot read statistics (${error.message})`);
  }

  return {
    valid: errors.length === 0,
    counts,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    errors,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const result = await runValidator(options);
  if (!result.valid) {
    throw new Error(`validation failed:\n${result.errors.map((error) => `- ${error}`).join("\n")}`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    process.stderr.write(`validate-osm-power: ${error.message}\n`);
    process.exitCode = 1;
  });
}
