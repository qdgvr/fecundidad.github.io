import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  LAYER_NAMES,
  TILE_MAXZOOM
} from '../context-schema.mjs';
import { runNormalizer } from '../normalize-osm-context.mjs';
import { runValidator } from '../validate-osm-context.mjs';

const line = (id, properties) => ({
  type: 'Feature',
  geometry: {
    type: 'LineString',
    coordinates: [[121, 23], [121.1, 23.1]]
  },
  properties: { '@type': 'way', '@id': id, ...properties }
});

const polygon = (id, properties, size = 0.01) => ({
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [121, 23],
      [121 + size, 23],
      [121 + size, 23 + size],
      [121, 23 + size],
      [121, 23]
    ]]
  },
  properties: { '@type': 'way', '@id': id, ...properties }
});

const point = (id, properties) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [121, 23] },
  properties: { '@type': 'node', '@id': id, ...properties }
});

const readNdjson = async filePath => {
  const content = (await readFile(filePath, 'utf8')).trim();
  return content ? content.split('\n').map(JSON.parse) : [];
};

test('normalizes all high-detail geographic context layers through z15', async () => {
  const work = await mkdtemp(join(tmpdir(), 'osm-context-normalizer-'));
  const inputPath = join(work, 'context.geojsonseq');
  const outputDir = join(work, 'normalized');
  const records = [
    polygon(101, { natural: 'wood', name: 'Bosque local', 'name:en': 'Local forest' }, 0.2),
    polygon(102, { landuse: 'residential' }, 0.1),
    polygon(103, { natural: 'water', water: 'lake', name: 'Lago' }, 0.3),
    line(104, { waterway: 'stream', intermittent: 'yes' }),
    line(105, { natural: 'coastline' }),
    polygon(106, { building: 'apartments', 'building:levels': '8', height: '25 m' }),
    line(107, { highway: 'secondary_link', bridge: 'yes', name: 'Road name' }),
    {
      ...line(108, { boundary: 'administrative', admin_level: '6', name: 'County' }),
      properties: {
        '@type': 'relation',
        '@id': 108,
        boundary: 'administrative',
        admin_level: '6',
        name: 'County'
      }
    },
    line(109, { railway: 'light_rail', tunnel: 'yes' }),
    point(110, {
      place: 'city',
      name: '臺北市',
      'name:en': 'Taipei',
      'name:es': 'Taipéi',
      population: '2,494,813',
      capital: '4'
    }),
    point(111, {})
  ];
  await writeFile(
    inputPath,
    `${records.map((record, index) => (
      index % 2 ? JSON.stringify(record) : `\u001e${JSON.stringify(record)}`
    )).join('\n')}\n`,
    'utf8'
  );

  const result = await runNormalizer({
    inputs: [inputPath],
    outputDir,
    force: true
  });
  assert.equal(result.stats.schema_version, 2);
  assert.equal(result.stats.input_records, 11);
  assert.equal(result.stats.emitted_features, 10);
  assert.equal(result.stats.skipped_records, 1);
  assert.equal(result.stats.skipped.unsupported_or_reference_geometry, 1);
  assert.deepEqual(
    Object.values(result.stats.layers),
    LAYER_NAMES.map(() => 1)
  );

  for (const layer of LAYER_NAMES) {
    const features = await readNdjson(join(outputDir, `${layer}.ndjson`));
    assert.equal(features.length, 1, layer);
    assert.equal(features[0].tippecanoe.layer, layer);
    assert.equal(features[0].tippecanoe.maxzoom, TILE_MAXZOOM);
    assert.equal(features[0].properties.osm_id > 0, true);
  }

  const roads = await readNdjson(join(outputDir, 'base_road.ndjson'));
  assert.equal(roads[0].properties.class, 'secondary');
  assert.equal(roads[0].properties.link, 1);
  assert.equal(roads[0].tippecanoe.minzoom, 8);
  const buildings = await readNdjson(join(outputDir, 'base_building.ndjson'));
  assert.equal(buildings[0].properties.levels, 8);
  assert.equal(buildings[0].properties.height_m, 25);
  assert.equal(buildings[0].tippecanoe.minzoom, 13);
  const places = await readNdjson(join(outputDir, 'base_place.ndjson'));
  assert.equal(places[0].properties.name, 'Taipei');
  assert.equal(places[0].properties.name_local, '臺北市');
  assert.equal(places[0].properties.name_es, 'Taipéi');
  assert.equal(places[0].properties.population, 2_494_813);

  const validation = await runValidator({ inputDir: outputDir });
  assert.equal(validation.valid, true, validation.errors.join('\n'));
  assert.equal(validation.total, 10);
  assert.deepEqual(validation.layer_ids, LAYER_NAMES);
});

test('rejects unranked administrative boundaries and building=no', async () => {
  const work = await mkdtemp(join(tmpdir(), 'osm-context-skips-'));
  const inputPath = join(work, 'context.geojsonseq');
  const outputDir = join(work, 'normalized');
  const records = [
    line(201, { boundary: 'administrative' }),
    polygon(202, { building: 'no' })
  ];
  await writeFile(inputPath, `${records.map(JSON.stringify).join('\n')}\n`, 'utf8');
  const result = await runNormalizer({
    inputs: [inputPath],
    outputDir,
    force: true
  });
  assert.equal(result.stats.emitted_features, 0);
  assert.equal(result.stats.skipped.unsupported_admin_level, 1);
  assert.equal(result.stats.skipped.unsupported_or_reference_geometry, 1);
});
