#!/usr/bin/env node
/**
 * Build a clearly-labelled KPG 193 v2.0 model topology for the grid atlas.
 *
 * KPG 193 is a synthetic test system, not a surveyed asset inventory. Its
 * geographic bus metadata is used only to place model nodes; every branch is
 * rendered as a straight connection between those model-node centroids. Do
 * not use this output as a substation, transmission-route, or live-grid map.
 *
 * The script deliberately reads only the small, version-pinned inputs needed
 * for the topology. By default it downloads them from the source commit. A
 * sparse local checkout can be used with --network-root for reproducible,
 * offline rebuilding.
 *
 * Usage:
 *   node scripts/grid-atlas/build-kpg193-model.mjs
 *   node scripts/grid-atlas/build-kpg193-model.mjs \
 *     --network-root /private/tmp/kpg-testgrid-atlas/kpg193_v2_0/network
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PROJECT_ROOT = resolve(SCRIPT_DIR, '../..');
const DEFAULT_OUTPUT = resolve(PROJECT_ROOT, 'data/grid-atlas/kpg193-model.geojson');

const SOURCE = {
  repository: 'agm-center/kpg-testgrid',
  // Pinning avoids silently changing the displayed model when upstream moves.
  commit: '5c9580b9effdd388bcc2433c8b66dea85c159617',
  version: 'KPG 193 v2.0',
  releaseDate: '2026-06',
  licence: 'ODbL 1.0; Map data © OpenStreetMap contributors',
  licenceUrl: 'https://opendatacommons.org/licenses/odbl/1.0/',
  repositoryUrl: 'https://github.com/agm-center/kpg-testgrid',
  busPath: 'kpg193_v2_0/network/metadata/bus_metadata/bus_metadata_2025.csv',
  casePath: 'kpg193_v2_0/network/m/KPG193_ver2_0.m'
};

const GEOMETRY_CONFIDENCE =
  'synthetic-straight-line-between-model-bus-centroids; not surveyed transmission route or substation location';
const BUS_GEOMETRY_CONFIDENCE =
  'synthetic-model-bus-geographic-anchor; not verified substation location';

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error('Usage: node scripts/grid-atlas/build-kpg193-model.mjs [--network-root DIR] [--output FILE] [--ref COMMIT]');
  process.exit(2);
}

function parseArgs(argv) {
  const args = { output: DEFAULT_OUTPUT, ref: SOURCE.commit, networkRoot: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') usage();
    if (arg === '--network-root') args.networkRoot = argv[++index];
    else if (arg === '--output') args.output = argv[++index];
    else if (arg === '--ref') args.ref = argv[++index];
    else usage(`unknown option ${arg}`);
    if (!argv[index]) usage(`missing value for ${arg}`);
  }
  return args;
}

function sourceUrl(path, ref) {
  return `${SOURCE.repositoryUrl}/blob/${ref}/${path}`;
}

function rawUrl(path, ref) {
  return `https://raw.githubusercontent.com/${SOURCE.repository}/${ref}/${path}`;
}

async function readInput({ networkRoot, path, ref }) {
  if (networkRoot) {
    const relativePath = path.replace(/^kpg193_v2_0\/network\//, '');
    return readFile(resolve(networkRoot, relativePath), 'utf8');
  }
  const response = await fetch(rawUrl(path, ref), {
    headers: { accept: 'text/plain' }
  });
  if (!response.ok) throw new Error(`could not download ${path}: HTTP ${response.status}`);
  return response.text();
}

function parseCsv(text) {
  const rows = [];
  let cell = '';
  let row = [];
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some(value => value.trim())) rows.push(row);
  }
  if (!rows.length) throw new Error('bus metadata CSV is empty');
  const headers = rows.shift().map(header => header.replace(/^\uFEFF/, '').trim());
  return rows.map((values, rowIndex) => Object.fromEntries(headers.map((header, column) => [
    header,
    (values[column] ?? '').trim(),
    rowIndex + 2
  ])));
}

function number(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a finite number (got ${value})`);
  return parsed;
}

function parseMatpowerMatrix(text, matrixName, expectedColumns) {
  const escaped = matrixName.replace('.', '\\.');
  const pattern = new RegExp(`${escaped}\\s*=\\s*\\[([\\s\\S]*?)\\];`);
  const match = text.match(pattern);
  if (!match) throw new Error(`MATPOWER matrix ${matrixName} was not found`);
  const rows = [];
  for (const rawRow of match[1].split(';')) {
    const withoutComment = rawRow.replace(/%.*/, '').trim();
    if (!withoutComment) continue;
    const values = withoutComment.split(/\s+/).map(value => number(value, `${matrixName} value`));
    if (values.length !== expectedColumns) {
      throw new Error(`${matrixName} row ${rows.length + 1} has ${values.length} columns, expected ${expectedColumns}`);
    }
    rows.push(values);
  }
  if (!rows.length) throw new Error(`MATPOWER matrix ${matrixName} has no rows`);
  return rows;
}

function rounded(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function modelProperties({ ref, sourcePath, assetKind, name, voltageKv, status = 'in_service', extra = {} }) {
  return {
    REGION_KEY: 'corea-del-sur',
    ASSET_KIND: assetKind,
    NAME: name,
    VOLTAGE_KV: voltageKv,
    STATUS: status,
    SOURCE_ID: 'kpg193-v2-model',
    SOURCE_DATASET: SOURCE.version,
    SOURCE_DATE: SOURCE.releaseDate,
    SOURCE_URL: sourceUrl(sourcePath, ref),
    SOURCE_REPOSITORY: SOURCE.repositoryUrl,
    SOURCE_COMMIT: ref,
    SOURCE_LICENSE: SOURCE.licence,
    SOURCE_LICENSE_URL: SOURCE.licenceUrl,
    EVIDENCE: 'modelled',
    ...extra
  };
}

function makeBusFeature(bus, ref) {
  return {
    type: 'Feature',
    id: `kpg193-bus-${bus.id}`,
    geometry: { type: 'Point', coordinates: [bus.longitude, bus.latitude] },
    properties: modelProperties({
      ref,
      sourcePath: SOURCE.busPath,
      assetKind: 'model_bus',
      name: `KPG 193 model bus ${bus.id}: ${bus.nameEnglish}`,
      voltageKv: bus.baseKv,
      extra: {
        MODEL_BUS_ID: bus.id,
        MODEL_BUS_TYPE: bus.type,
        MODEL_NAME_EN: bus.nameEnglish,
        MODEL_NAME_KO: bus.nameKorean,
        MODEL_AREA: bus.area,
        MODEL_PD_MW: rounded(bus.pdMw),
        GEOMETRY_CONFIDENCE: BUS_GEOMETRY_CONFIDENCE,
        GEOMETRY_NOTE: 'Point marks a synthetic KPG model bus anchor, not a verified Korean substation.'
      }
    })
  };
}

function makeAcBranchFeature(row, index, buses, ref) {
  const [fromId, toId, resistancePu, reactancePu, chargingPu, rateA, rateB, rateC, ratio, angle, rawStatus, angleMin, angleMax, pfMw, qfMvar, ptMw, qtMvar] = row;
  const from = buses.get(fromId);
  const to = buses.get(toId);
  const voltageKv = Math.max(from.baseKv, to.baseKv);
  const isTransformer = ratio !== 0;
  return {
    type: 'Feature',
    id: `kpg193-ac-${String(index + 1).padStart(3, '0')}`,
    geometry: {
      type: 'LineString',
      coordinates: [[from.longitude, from.latitude], [to.longitude, to.latitude]]
    },
    properties: modelProperties({
      ref,
      sourcePath: SOURCE.casePath,
      assetKind: isTransformer ? 'model_ac_transformer' : 'model_ac_branch',
      name: `KPG 193 model ${isTransformer ? 'transformer' : 'AC branch'} ${fromId}–${toId}`,
      voltageKv,
      status: rawStatus === 1 ? 'in_service' : 'out_of_service',
      extra: {
        FROM_BUS_ID: fromId,
        TO_BUS_ID: toId,
        FROM_NAME_EN: from.nameEnglish,
        TO_NAME_EN: to.nameEnglish,
        FROM_BASE_KV: from.baseKv,
        TO_BASE_KV: to.baseKv,
        THERMAL_RATING_A_MVA: rateA,
        THERMAL_RATING_B_MVA: rateB,
        THERMAL_RATING_C_MVA: rateC,
        MODEL_RESISTANCE_PU: resistancePu,
        MODEL_REACTANCE_PU: reactancePu,
        MODEL_CHARGING_PU: chargingPu,
        MODEL_TAP_RATIO: ratio,
        MODEL_PHASE_SHIFT_DEG: angle,
        MODEL_ANGLE_MIN_DEG: angleMin,
        MODEL_ANGLE_MAX_DEG: angleMax,
        MODEL_FLOW_SNAPSHOT_MW: rounded(pfMw),
        MODEL_FLOW_TO_SNAPSHOT_MW: rounded(ptMw),
        MODEL_REACTIVE_FROM_SNAPSHOT_MVAR: rounded(qfMvar),
        MODEL_REACTIVE_TO_SNAPSHOT_MVAR: rounded(qtMvar),
        GEOMETRY_CONFIDENCE,
        GEOMETRY_NOTE: 'Straight line between synthetic KPG model-bus anchors; not an observed circuit route.'
      }
    })
  };
}

function makeDcLineFeature(row, index, buses, ref) {
  const [fromId, toId, rawStatus, pfMw, ptMw, qfMvar, qtMvar, vfPu, vtPu, pminMw, pmaxMw, qminFrom, qmaxFrom, qminTo, qmaxTo, loss0Mw, loss1] = row;
  const from = buses.get(fromId);
  const to = buses.get(toId);
  return {
    type: 'Feature',
    id: `kpg193-dc-${String(index + 1).padStart(2, '0')}`,
    geometry: {
      type: 'LineString',
      coordinates: [[from.longitude, from.latitude], [to.longitude, to.latitude]]
    },
    properties: modelProperties({
      ref,
      sourcePath: SOURCE.casePath,
      assetKind: 'model_hvdc_link',
      name: `KPG 193 model HVDC link ${fromId}–${toId}`,
      // MATPOWER's dcline matrix has no DC nominal-voltage field. Terminal
      // AC base kV values remain below, but must not be relabelled as DC kV.
      voltageKv: null,
      status: rawStatus === 1 ? 'in_service' : 'out_of_service',
      extra: {
        FROM_BUS_ID: fromId,
        TO_BUS_ID: toId,
        FROM_NAME_EN: from.nameEnglish,
        TO_NAME_EN: to.nameEnglish,
        FROM_BASE_KV: from.baseKv,
        TO_BASE_KV: to.baseKv,
        MODEL_PMIN_MW: pminMw,
        MODEL_PMAX_MW: pmaxMw,
        MODEL_FLOW_SNAPSHOT_MW: rounded(pfMw),
        MODEL_FLOW_TO_SNAPSHOT_MW: rounded(ptMw),
        MODEL_REACTIVE_FROM_SNAPSHOT_MVAR: rounded(qfMvar),
        MODEL_REACTIVE_TO_SNAPSHOT_MVAR: rounded(qtMvar),
        MODEL_VF_PU: vfPu,
        MODEL_VT_PU: vtPu,
        MODEL_QMIN_FROM_MVAR: qminFrom,
        MODEL_QMAX_FROM_MVAR: qmaxFrom,
        MODEL_QMIN_TO_MVAR: qminTo,
        MODEL_QMAX_TO_MVAR: qmaxTo,
        MODEL_LOSS0_MW: loss0Mw,
        MODEL_LOSS1_PU: loss1,
        GEOMETRY_CONFIDENCE,
        GEOMETRY_NOTE: 'Straight line between synthetic KPG model-bus anchors; not an observed HVDC route.'
      }
    })
  };
}

function validateBuses(metadataRows, matpowerBusRows) {
  const modelById = new Map();
  for (const row of matpowerBusRows) {
    const [id, type, pdMw, , , , area, , , baseKv] = row;
    if (modelById.has(id)) throw new Error(`duplicate MATPOWER bus id ${id}`);
    modelById.set(id, { id, type, pdMw, area, baseKv });
  }
  const buses = new Map();
  for (const row of metadataRows) {
    const id = number(row.bus_id, `CSV bus_id at row ${row[undefined] ?? '?'}`);
    if (!modelById.has(id)) throw new Error(`bus metadata contains id ${id} absent from MATPOWER bus matrix`);
    if (buses.has(id)) throw new Error(`duplicate bus metadata id ${id}`);
    const latitude = number(row.Latitude, `latitude for bus ${id}`);
    const longitude = number(row.Longitude, `longitude for bus ${id}`);
    if (latitude < 30 || latitude > 45 || longitude < 120 || longitude > 135) {
      throw new Error(`bus ${id} has implausible Korean-peninsula coordinate ${longitude}, ${latitude}`);
    }
    const model = modelById.get(id);
    buses.set(id, {
      ...model,
      latitude,
      longitude,
      nameKorean: row.name_Korean,
      nameEnglish: row.name_English
    });
  }
  if (buses.size !== modelById.size) {
    const missing = [...modelById.keys()].filter(id => !buses.has(id));
    throw new Error(`bus metadata is missing ${missing.length} MATPOWER buses: ${missing.join(', ')}`);
  }
  return buses;
}

function assertConnectedEndpoints(rows, buses, name) {
  const orphanIds = new Set();
  for (const row of rows) {
    for (const id of row.slice(0, 2)) if (!buses.has(id)) orphanIds.add(id);
  }
  if (orphanIds.size) throw new Error(`${name} has orphan endpoints: ${[...orphanIds].join(', ')}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [metadataText, caseText] = await Promise.all([
    readInput({ networkRoot: args.networkRoot, path: SOURCE.busPath, ref: args.ref }),
    readInput({ networkRoot: args.networkRoot, path: SOURCE.casePath, ref: args.ref })
  ]);
  const metadataRows = parseCsv(metadataText);
  const matpowerBusRows = parseMatpowerMatrix(caseText, 'mpc.bus', 13);
  const branchRows = parseMatpowerMatrix(caseText, 'mpc.branch', 17);
  const dcLineRows = parseMatpowerMatrix(caseText, 'mpc.dcline', 17);
  const buses = validateBuses(metadataRows, matpowerBusRows);
  assertConnectedEndpoints(branchRows, buses, 'mpc.branch');
  assertConnectedEndpoints(dcLineRows, buses, 'mpc.dcline');

  const activeAc = branchRows.filter(row => row[10] === 1).length;
  const activeDc = dcLineRows.filter(row => row[2] === 1).length;
  const features = [
    ...[...buses.values()].sort((a, b) => a.id - b.id).map(bus => makeBusFeature(bus, args.ref)),
    ...branchRows.map((row, index) => makeAcBranchFeature(row, index, buses, args.ref)),
    ...dcLineRows.map((row, index) => makeDcLineFeature(row, index, buses, args.ref))
  ];
  const output = {
    type: 'FeatureCollection',
    name: 'KPG 193 v2.0 synthetic Korean grid model',
    generated_at: new Date().toISOString(),
    source: {
      id: 'kpg193-v2-model',
      dataset: SOURCE.version,
      repository: SOURCE.repositoryUrl,
      commit: args.ref,
      licence: SOURCE.licence,
      licence_url: SOURCE.licenceUrl,
      bus_metadata_url: sourceUrl(SOURCE.busPath, args.ref),
      matpower_case_url: sourceUrl(SOURCE.casePath, args.ref)
    },
    limitations: [
      'Synthetic research test system derived from public data, not an official operational asset registry.',
      'Bus coordinates are model anchors, not verified substation coordinates.',
      'AC and HVDC geometry is a straight line between model-bus anchors, not a surveyed route.',
      'Snapshot flow fields come from the MATPOWER case and are not live operations data.'
    ],
    counts: {
      model_buses: buses.size,
      ac_branches: branchRows.length,
      ac_branches_in_service: activeAc,
      dc_lines: dcLineRows.length,
      dc_lines_in_service: activeDc,
      total_features: features.length
    },
    features
  };
  await mkdir(resolve(args.output, '..'), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Built ${args.output}`);
  console.log(JSON.stringify(output.counts));
  console.log('Endpoint validation: 0 orphan endpoints.');
}

main().catch(error => {
  console.error(`KPG 193 model build failed: ${error.message}`);
  process.exitCode = 1;
});
