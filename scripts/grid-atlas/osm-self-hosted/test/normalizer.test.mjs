import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runNormalizer } from "../normalize-osm-power.mjs";
import { runValidator } from "../validate-osm-power.mjs";
import {
  parseFrequency,
  parseOutputMegawatts,
  parseVoltages,
} from "../power-schema.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "power.geojsonseq");

async function readNdjson(path) {
  return (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("normalizes voltage, frequency and electrical output units", () => {
  assert.deepEqual(parseVoltages("400000;220 kV", "110000"), [400, 220, 110]);
  assert.equal(parseFrequency("16.7 Hz"), 16.7);
  assert.equal(parseFrequency("0"), 0);
  assert.equal(parseOutputMegawatts("1.2 GW"), 1200);
  assert.equal(parseOutputMegawatts("2500 kW"), 2.5);
});

test("streams RS-prefixed GeoJSONSeq and emits area-centroid companions", async () => {
  const work = await mkdtemp(join(tmpdir(), "osm-power-normalizer-"));
  const outputDir = join(work, "output");
  const rsInput = join(work, "input.geojsonseq");
  const sourceLines = (await readFile(fixture, "utf8")).trim().split("\n");
  await writeFile(
    rsInput,
    `${sourceLines.map((line, index) => (index % 2 ? line : `\u001e${line}`)).join("\n")}\n`,
    "utf8",
  );

  const result = await runNormalizer({
    inputs: [rsInput],
    outputDir,
    region: "fixture",
    force: true,
  });
  assert.equal(result.stats.records, 15);
  assert.equal(result.stats.source_objects, 12);
  assert.equal(result.stats.centroid_duplicates, 4);
  assert.equal(result.stats.emitted, 16);
  assert.equal(result.stats.skipped, 3);
  assert.equal(
    result.stats.records,
    result.stats.source_objects + result.stats.skipped,
  );
  assert.equal(
    result.stats.emitted,
    result.stats.source_objects + result.stats.centroid_duplicates,
  );
  assert.equal(result.stats.skip_reasons.excluded_support, 1);
  assert.equal(result.stats.skip_reasons.reference_node, 1);
  assert.equal(result.stats.skip_reasons.duplicate_area_representation, 1);
  assert.equal(result.stats.geometry_promotions, 0);
  assert.equal(result.stats.geometry_reductions, 1);
  assert.deepEqual(result.stats.layers, {
    power_line: 2,
    power_plant: 1,
    power_generator_area: 2,
    power_substation: 1,
    power_plant_point: 2,
    power_generator: 3,
    power_substation_point: 2,
    power_transformer: 1,
    power_switch: 1,
    power_compensator: 1,
  });
  assert.equal(
    result.stats.centroid_duplicates,
    result.stats.layers.power_plant +
      result.stats.layers.power_generator_area +
      result.stats.layers.power_substation,
  );

  const lines = await readNdjson(join(outputDir, "power_line.ndjson"));
  assert.equal(lines.length, 2);
  assert.deepEqual(
    ["voltage", "voltage_2", "voltage_3", "voltage_4"].map(
      (key) => lines[0].properties[key],
    ),
    [400, 220, 110, 33],
  );
  assert.equal(lines[0].tippecanoe.minzoom, 2);
  assert.equal(lines[1].properties.frequency, 0);
  assert.equal(lines[1].tippecanoe.minzoom, 2);
  assert.equal(lines[0].properties.osm_type, "way");
  assert.equal(lines[0].id, 101);
  assert.equal(lines[0].properties.osm_id, undefined);

  const plants = await readNdjson(join(outputDir, "power_plant.ndjson"));
  assert.equal(plants[0].properties.output, 1200);
  assert.equal(plants[0].properties.source, "solar");
  assert.equal(plants[0].tippecanoe.minzoom, 8);

  const plantPoints = await readNdjson(join(outputDir, "power_plant_point.ndjson"));
  assert.equal(plantPoints.length, 2);
  const plantCentroid = plantPoints.find(
    (feature) => feature.properties.osm_id === 201,
  );
  assert.ok(plantCentroid);
  assert.equal(plantCentroid.id, undefined);
  assert.equal(plantCentroid.geometry.type, "Point");
  assert.ok(Math.abs(plantCentroid.geometry.coordinates[0] - 1 / 3) < 1e-12);
  assert.ok(Math.abs(plantCentroid.geometry.coordinates[1] - 2 / 3) < 1e-12);
  assert.equal(plantCentroid.properties.osm_type, "relation");
  assert.equal(plantCentroid.properties.output, 1200);
  assert.equal(plantCentroid.tippecanoe.minzoom, 5);
  assert.equal(plantCentroid.tippecanoe.maxzoom, 11);
  assert.ok(plantPoints.some((feature) => feature.id === 301));

  const generators = await readNdjson(join(outputDir, "power_generator_area.ndjson"));
  assert.equal(generators[0].properties.output, 2.5);
  assert.equal(generators[0].properties.method, "photovoltaic");
  assert.equal(generators[0].properties.storage, "battery");
  assert.equal(generators[0].tippecanoe.minzoom, 12);
  assert.equal(generators[1].geometry.type, "MultiPolygon");
  assert.equal(generators[1].id, 403);

  const generatorPoints = await readNdjson(join(outputDir, "power_generator.ndjson"));
  assert.equal(generatorPoints.length, 3);
  for (const id of [202, 302, 403]) {
    assert.ok(generatorPoints.some((feature) => feature.id === id));
  }
  const promotedGeneratorCentroid = generatorPoints.find(
    (feature) => feature.id === 403,
  );
  assert.ok(promotedGeneratorCentroid);
  assert.equal(promotedGeneratorCentroid.geometry.type, "Point");
  assert.equal(promotedGeneratorCentroid.properties.name, "Closed generator way");
  assert.equal(promotedGeneratorCentroid.tippecanoe.minzoom, 9);
  assert.equal(promotedGeneratorCentroid.tippecanoe.maxzoom, 11);

  const substations = await readNdjson(join(outputDir, "power_substation.ndjson"));
  assert.equal(substations[0].properties.construction, true);
  assert.equal(substations[0].properties.status, "construction");

  const substationPoints = await readNdjson(
    join(outputDir, "power_substation_point.ndjson"),
  );
  assert.equal(substationPoints.length, 2);
  const substationCentroid = substationPoints.find(
    (feature) => feature.id === 203,
  );
  assert.ok(substationCentroid);
  assert.equal(substationCentroid.geometry.type, "Point");
  assert.equal(substationCentroid.properties.construction, true);
  assert.equal(substationCentroid.tippecanoe.maxzoom, 11);
  assert.equal(substationCentroid.tippecanoe.minzoom, 5);
  assert.ok(substationPoints.some((feature) => feature.id === 303));

  const transformers = await readNdjson(join(outputDir, "power_transformer.ndjson"));
  assert.equal(transformers[0].geometry.type, "Point");
  assert.equal(transformers[0].tippecanoe.minzoom, 12);

  const validation = await runValidator({ inputDir: outputDir });
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.equal(validation.total, 16);
});

test("line minzoom follows the voltage visibility gates", async () => {
  const work = await mkdtemp(join(tmpdir(), "osm-power-minzoom-"));
  const input = join(work, "input.geojsonseq");
  const outputDir = join(work, "output");
  const voltages = [200000, 100000, 50000, 25000, 10000, 9000, null];
  const records = voltages.map((voltage, index) => ({
    type: "Feature",
    id: `way/${900 + index}`,
    geometry: { type: "LineString", coordinates: [[0, index], [1, index]] },
    properties: {
      "@type": "way",
      "@id": 900 + index,
      power: "line",
      ...(voltage === null ? {} : { voltage: String(voltage) }),
    },
  }));
  await writeFile(input, `${records.map(JSON.stringify).join("\n")}\n`, "utf8");
  await runNormalizer({ inputs: [input], outputDir, force: true });
  const features = await readNdjson(join(outputDir, "power_line.ndjson"));
  assert.deepEqual(
    features.map((feature) => feature.tippecanoe.minzoom),
    [2, 4, 5, 6, 9, 11, 11],
  );
});
