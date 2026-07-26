#!/usr/bin/env node

import { once } from "node:events";
import {
  createReadStream,
  createWriteStream,
  existsSync,
} from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { stdin } from "node:process";
import {
  LAYERS,
  normalizePowerFeature,
  stripRecordSeparator,
} from "./power-schema.mjs";

function usage() {
  return `Usage:
  node normalize-osm-power.mjs --input FILE [--input FILE ...] --output-dir DIR [options]
  node normalize-osm-power.mjs --lines FILE --polygons FILE --points FILE --output-dir DIR

Options:
  --input FILE        osmium GeoJSONSeq/NDJSON input; repeatable; "-" reads stdin
  --lines FILE        Alias for --input (orchestrator compatibility)
  --polygons FILE     Alias for --input (orchestrator compatibility)
  --points FILE       Alias for --input (orchestrator compatibility)
  --output-dir DIR    Directory for ten layer-specific .ndjson files
  --stats FILE        Statistics JSON path (default: OUTPUT_DIR/stats.json)
  --region KEY        Region key recorded in statistics
  --force             Replace existing layer/statistics files
  --help              Show this help
`;
}

export function parseArgs(argv) {
  const options = { inputs: [], force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--force") options.force = true;
    else if (["--input", "--lines", "--polygons", "--points"].includes(argument)) {
      options.inputs.push(argv[++index]);
    } else if (argument === "--output-dir") options.outputDir = argv[++index];
    else if (argument === "--stats") options.statsPath = argv[++index];
    else if (argument === "--region") options.region = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.inputs.some((value) => !value)) throw new Error("An input path is missing.");
  return options;
}

async function writeWithBackpressure(stream, value) {
  if (!stream.write(value)) await once(stream, "drain");
}

async function closeStreams(streams) {
  await Promise.all(
    [...streams.values()].map(
      (stream) =>
        new Promise((resolvePromise, rejectPromise) => {
          stream.once("error", rejectPromise);
          stream.end(resolvePromise);
        }),
    ),
  );
}

async function processInput(path, streams, stats) {
  const input = path === "-" ? stdin : createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let inputLine = 0;

  for await (const rawLine of lines) {
    inputLine += 1;
    const line = stripRecordSeparator(rawLine);
    if (!line) continue;
    stats.records += 1;
    let sourceFeature;
    try {
      sourceFeature = JSON.parse(line);
    } catch (error) {
      throw new Error(`${path}:${inputLine}: invalid JSON (${error.message})`);
    }

    const normalized = normalizePowerFeature(sourceFeature);
    if (!normalized.feature) {
      stats.skipped += 1;
      stats.skip_reasons[normalized.skipReason] =
        (stats.skip_reasons[normalized.skipReason] ?? 0) + 1;
      continue;
    }

    const outputs = [
      { layer: normalized.layer, feature: normalized.feature },
      ...(normalized.companions ?? []),
    ];
    for (const output of outputs) {
      await writeWithBackpressure(
        streams.get(output.layer),
        `${JSON.stringify(output.feature)}\n`,
      );
      stats.emitted += 1;
      stats.layers[output.layer] += 1;
    }
    stats.source_objects += 1;
    stats.centroid_duplicates += outputs.length - 1;
    stats.statuses[normalized.status] = (stats.statuses[normalized.status] ?? 0) + 1;
    if (normalized.geometryPromotedFrom) stats.geometry_promotions += 1;
    if (normalized.geometryReducedFrom) stats.geometry_reductions += 1;
  }
}

export async function runNormalizer(options) {
  if (!options.outputDir) throw new Error("--output-dir is required.");
  if (!options.inputs.length) throw new Error("At least one input is required.");
  if (options.inputs.filter((path) => path === "-").length > 1) {
    throw new Error("Standard input may only be specified once.");
  }

  const outputDir = resolve(options.outputDir);
  const statsPath = resolve(options.statsPath ?? join(outputDir, "stats.json"));
  const outputPaths = LAYERS.map((layer) => join(outputDir, `${layer}.ndjson`));
  if (!options.force) {
    const existing = [...outputPaths, statsPath].find(existsSync);
    if (existing) throw new Error(`Output already exists: ${existing} (use --force)`);
  }

  await mkdir(outputDir, { recursive: true });
  const streams = new Map(
    LAYERS.map((layer) => [
      layer,
      createWriteStream(join(outputDir, `${layer}.ndjson`), {
        encoding: "utf8",
        flags: "w",
      }),
    ]),
  );
  const stats = {
    schema_version: 1,
    region: options.region ?? null,
    generated_at: new Date().toISOString(),
    inputs: options.inputs.map((path) => (path === "-" ? "-" : basename(path))),
    records: 0,
    emitted: 0,
    source_objects: 0,
    centroid_duplicates: 0,
    skipped: 0,
    skip_reasons: {},
    layers: Object.fromEntries(LAYERS.map((layer) => [layer, 0])),
    statuses: {},
    geometry_promotions: 0,
    geometry_reductions: 0,
    units: { voltage: "kV", frequency: "Hz", output: "MW" },
  };

  try {
    for (const path of options.inputs) await processInput(path, streams, stats);
  } finally {
    await closeStreams(streams);
  }

  await writeFile(statsPath, `${JSON.stringify(stats, null, 2)}\n`, "utf8");
  return { stats, statsPath, outputDir };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const result = await runNormalizer(options);
  process.stdout.write(
    `Normalized ${result.stats.emitted}/${result.stats.records} features into ${result.outputDir}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    process.stderr.write(`normalize-osm-power: ${error.message}\n`);
    process.exitCode = 1;
  });
}
