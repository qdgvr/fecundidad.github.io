#!/usr/bin/env node

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { once } from 'node:events';

const layerNames = ['base_road', 'base_water', 'base_waterway', 'base_place'];

const usage = `Usage:
  node normalize-osm-context.mjs --input INPUT.geojsonseq --output-dir DIR [options]

Options:
  --stats PATH  Stats JSON destination (default: DIR/stats.json)
  --force       Replace an existing output directory
  --help        Show this help
`;

const parseArguments = values => {
  const parsed = { force: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--force') parsed.force = true;
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

const args = parseArguments(process.argv.slice(2));
if (args.help) {
  console.log(usage);
  process.exit(0);
}
if (!args.input || !args['output-dir']) {
  console.error(usage);
  process.exit(2);
}

const inputPath = path.resolve(args.input);
const outputDirectory = path.resolve(args['output-dir']);
const statsPath = path.resolve(args.stats || path.join(outputDirectory, 'stats.json'));

if (args.force) await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: false });

const writers = Object.fromEntries(layerNames.map(layer => [
  layer,
  createWriteStream(path.join(outputDirectory, `${layer}.ndjson`), {
    encoding: 'utf8',
    flags: 'wx'
  })
]));

const stats = {
  schema_version: 1,
  input_records: 0,
  emitted_features: 0,
  skipped_records: 0,
  layers: Object.fromEntries(layerNames.map(layer => [layer, 0])),
  skipped: {}
};

const skip = reason => {
  stats.skipped_records += 1;
  stats.skipped[reason] = (stats.skipped[reason] || 0) + 1;
};

const textValue = value => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const numericPopulation = value => {
  const parsed = Number(textValue(value).replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
};

const osmIdentity = properties => {
  const rawType = textValue(properties['@type']).toLowerCase();
  const rawId = textValue(properties['@id']);
  if (!['node', 'way', 'relation'].includes(rawType) || !/^[1-9]\d*$/.test(rawId)) {
    return null;
  }
  return { osm_type: rawType, osm_id: rawId };
};

const transportProperties = (properties, extra = {}) => (
  osmIdentity(properties) ? extra : null
);

const placeProperties = (properties, extra = {}) => {
  if (!osmIdentity(properties)) return null;
  const name = textValue(
    properties['name:en'] ||
    properties.name ||
    properties['name:es']
  );
  const originalName = textValue(properties.name);
  return {
    name,
    ...(originalName && originalName !== name ? { name_local: originalName } : {}),
    ...extra
  };
};

const roadClass = value => textValue(value).replace(/_link$/, '');

const roadMinzoom = highway => ({
  motorway: 4,
  trunk: 5,
  primary: 6
})[roadClass(highway)] ?? 7;

const placeMinzoom = properties => {
  const place = textValue(properties.place);
  if (place === 'country') return 2;
  if (place === 'state' || place === 'province') return 4;
  const population = numericPopulation(properties.population);
  const capital = textValue(properties.capital);
  if (place === 'city') {
    if (capital === 'yes' || capital === '2') return 3;
    if (capital === '4' || population >= 5_000_000) return 4;
    if (population >= 1_000_000) return 5;
    if (population >= 250_000) return 6;
    return 7;
  }
  if (place === 'town') return population >= 100_000 ? 7 : 8;
  return 9;
};

const writeFeature = async (layer, geometry, properties, minzoom) => {
  const feature = {
    type: 'Feature',
    geometry,
    properties,
    tippecanoe: {
      layer,
      minzoom,
      maxzoom: 9
    }
  };
  if (!writers[layer].write(`${JSON.stringify(feature)}\n`)) {
    await once(writers[layer], 'drain');
  }
  stats.layers[layer] += 1;
  stats.emitted_features += 1;
};

const classifyAndWrite = async feature => {
  const geometry = feature?.geometry;
  const properties = feature?.properties;
  if (!geometry || !properties || typeof properties !== 'object') {
    skip('invalid_feature');
    return;
  }

  const highway = textValue(properties.highway);
  if (
    highway &&
    ['LineString', 'MultiLineString'].includes(geometry.type) &&
    /^(motorway|trunk|primary)(?:_link)?$/.test(highway)
  ) {
    const compact = transportProperties(properties, {
      class: roadClass(highway),
      link: highway.endsWith('_link') ? 1 : 0,
      ...(textValue(properties.bridge) ? { bridge: textValue(properties.bridge) } : {}),
      ...(textValue(properties.tunnel) ? { tunnel: textValue(properties.tunnel) } : {})
    });
    if (!compact) {
      skip('invalid_osm_identity');
      return;
    }
    await writeFeature(
      'base_road',
      geometry,
      compact,
      roadMinzoom(highway) + (highway.endsWith('_link') ? 1 : 0)
    );
    return;
  }

  const waterway = textValue(properties.waterway);
  if (
    ['river', 'canal'].includes(waterway) &&
    ['LineString', 'MultiLineString'].includes(geometry.type)
  ) {
    const compact = transportProperties(properties, { class: waterway });
    if (!compact) {
      skip('invalid_osm_identity');
      return;
    }
    await writeFeature('base_waterway', geometry, compact, waterway === 'river' ? 6 : 8);
    return;
  }

  const waterKind = textValue(
    properties.water ||
    (properties.natural === 'water' ? 'water' : '') ||
    (properties.landuse === 'reservoir' ? 'reservoir' : '')
  );
  if (waterKind && ['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    const compact = transportProperties(properties, { class: waterKind });
    if (!compact) {
      skip('invalid_osm_identity');
      return;
    }
    await writeFeature('base_water', geometry, compact, 5);
    return;
  }

  const place = textValue(properties.place);
  if (
    ['country', 'state', 'province', 'city', 'town'].includes(place) &&
    geometry.type === 'Point'
  ) {
    const label = textValue(
      properties['name:en'] ||
      properties.name ||
      properties['name:es']
    );
    if (!label) {
      skip('unnamed_place');
      return;
    }
    const population = numericPopulation(properties.population);
    const compact = placeProperties(properties, {
      class: place,
      ...(population ? { population } : {}),
      ...(textValue(properties.capital) ? { capital: textValue(properties.capital) } : {})
    });
    if (!compact) {
      skip('invalid_osm_identity');
      return;
    }
    await writeFeature('base_place', geometry, compact, placeMinzoom(properties));
    return;
  }

  skip('unsupported_or_duplicate_geometry');
};

const input = createReadStream(inputPath, { encoding: 'utf8' });
const lines = readline.createInterface({ input, crlfDelay: Infinity });
for await (const rawLine of lines) {
  const line = rawLine.replace(/^\x1e/, '').trim();
  if (!line) continue;
  stats.input_records += 1;
  try {
    await classifyAndWrite(JSON.parse(line));
  } catch (error) {
    throw new Error(`Could not normalize record ${stats.input_records}: ${error.message}`);
  }
}

for (const writer of Object.values(writers)) writer.end();
await Promise.all(Object.values(writers).map(writer => once(writer, 'finish')));

if (stats.input_records !== stats.emitted_features + stats.skipped_records) {
  throw new Error('Context feature accounting invariant failed');
}

await writeFile(statsPath, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
console.log(
  `Normalized ${stats.input_records.toLocaleString('en-US')} records into ` +
  `${stats.emitted_features.toLocaleString('en-US')} context features.`
);
