#!/usr/bin/env node
/**
 * Offline integrity checks for the Grid Atlas static assets.
 *
 * This deliberately validates only repository files.  It must never fetch a
 * source endpoint: source freshness and availability are separate concerns.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '../..');
const atlasDirectory = path.join(projectDirectory, 'data', 'grid-atlas');

const files = {
  profiles: path.join(atlasDirectory, 'region-profiles.json'),
  registry: path.join(atlasDirectory, 'source-registry.json'),
  corridors: path.join(atlasDirectory, 'model-corridors.geojson'),
  kpg193: path.join(atlasDirectory, 'kpg193-model.geojson'),
  taiwanDisplay: path.join(atlasDirectory, 'taiwan-hosting-capacity-display.geojson'),
  taiwanMetadata: path.join(atlasDirectory, 'taiwan-hosting-capacity.metadata.json'),
  eiaPlants: path.join(atlasDirectory, 'us-eia860m-plants.geojson'),
  eiaMetadata: path.join(atlasDirectory, 'us-eia860m-plants.metadata.json'),
  chinaHvdc: path.join(atlasDirectory, 'china-nea-hvdc-systems.json'),
  chinaHvdcMetadata: path.join(atlasDirectory, 'china-nea-hvdc.metadata.json'),
  kepcoProjects: path.join(atlasDirectory, 'kepco-transmission-projects.json'),
  kepcoProjectsMetadata: path.join(atlasDirectory, 'kepco-transmission-projects.metadata.json'),
  ukOpenMapLines: path.join(atlasDirectory, 'uk-os-openmap-local-electricity-lines.geojson'),
  ukOpenMapMetadata: path.join(atlasDirectory, 'uk-os-openmap-local-electricity-lines.metadata.json'),
  netherlandsGrid: path.join(atlasDirectory, 'netherlands-official-grid.geojson'),
  netherlandsGridMetadata: path.join(atlasDirectory, 'netherlands-official-grid.metadata.json'),
};

const expectedRegions = new Set([
  'europa',
  'estados-unidos',
  'china',
  'japon',
  'corea-del-sur',
  'taiwan',
]);
const taiwanDisplayFields = [
  'REGION_KEY',
  'ASSET_KIND',
  'SOURCE_ID',
  'POINT_COUNT',
  'FEEDER_COUNT',
  'CAPACITY_REPORTED_COUNT',
  'CAPACITY_MIN_KW',
  'CAPACITY_MAX_KW',
  'CAPACITY_MEAN_KW',
  'SOURCE_AREAS',
  'SOURCE_DATE',
  'SOURCE_URL',
  'SOURCE_LICENSE',
  'EVIDENCE',
  'GEOMETRY_CONFIDENCE',
];
const maxStaticGeoJsonBytes = 10 * 1024 * 1024;
const eiaPropertyFields = new Set([
  'src',
  'i',
  'n',
  'st',
  'co',
  'ei',
  'en',
  'ba',
  'se',
  'cu',
  'pu',
  'cm',
  'cs',
  'am',
  'pm',
  'psm',
  'dm',
  'os',
  'ps',
  't',
  'f',
  'oy',
  'py',
  'cv',
  'sp',
  'rd',
  'url',
  'lic',
  'ev',
  'gc',
]);
const chinaHvdcSourceId = 'cn-nea-reliability-2024';
const chinaHvdcSupplementalSourceId = 'cn-nrec-yangzhen-hvdc-2024';
const chinaHvdcExpectedSummary = {
  point_to_point_ehvdc: {
    system_count: 18,
    rated_transfer_capacity_mw: 45464,
    line_length_km: 15279,
  },
  point_to_point_uhvdc: {
    system_count: 19,
    rated_transfer_capacity_mw: 150600,
    line_length_km: 33795,
  },
  back_to_back: {
    system_count: 9,
    rated_transfer_capacity_mw: 20860,
    line_length_km: 0,
  },
  multi_terminal: {
    system_count: 5,
    rated_transfer_capacity_mw: 16650,
    line_length_km: 3875,
  },
};
const chinaHvdcExpectedTotal = {
  system_count: 51,
  rated_transfer_capacity_mw: 233574,
  line_length_km: 52949,
};
const kepcoSourceId = 'kr-kepco-transmission-construction-2026';
const kepcoExpectedStages = {
  plan_confirmed: {
    label: '계획확정 - 사업승인전',
    dashboardCount: 444,
    listedCount: 443,
    menuNumber: 63,
    boardManagementNumber: 64,
    pageCount: 45,
    listUrl: 'https://www.kepco.co.kr/home/disclosure/transdisclosure/transstatus/plantoapprove/boardList.do',
    detailUrl: 'https://www.kepco.co.kr/home/disclosure/transdisclosure/transstatus/plantoapprove/boardView.do',
  },
  project_approved: {
    label: '사업승인 - 공사착수전',
    dashboardCount: 189,
    listedCount: 189,
    menuNumber: 64,
    boardManagementNumber: 65,
    pageCount: 19,
    listUrl: 'https://www.kepco.co.kr/home/disclosure/transdisclosure/transstatus/approvetostart/boardList.do',
    detailUrl: 'https://www.kepco.co.kr/home/disclosure/transdisclosure/transstatus/approvetostart/boardView.do',
  },
  construction_started: {
    label: '공사착수 - 사업완료전',
    dashboardCount: 202,
    listedCount: 202,
    menuNumber: 65,
    boardManagementNumber: 66,
    pageCount: 21,
    listUrl: 'https://www.kepco.co.kr/home/disclosure/transdisclosure/transstatus/starttocomplete/boardList.do',
    detailUrl: 'https://www.kepco.co.kr/home/disclosure/transdisclosure/transstatus/starttocomplete/boardView.do',
  },
  completed_within_one_year: {
    label: '사업완료 - 준공후 1년',
    dashboardCount: 14,
    listedCount: 14,
    menuNumber: 66,
    boardManagementNumber: 67,
    pageCount: 2,
    listUrl: 'https://www.kepco.co.kr/home/disclosure/transdisclosure/transstatus/completetoyear/boardList.do',
    detailUrl: 'https://www.kepco.co.kr/home/disclosure/transdisclosure/transstatus/completetoyear/boardView.do',
  },
};
const kepcoProjectFields = new Set([
  'source_record_id',
  'board_mng_no',
  'board_no',
  'list_number',
  'stage',
  'stage_label_ko',
  'project_name',
  'facility_type',
  'responsible_headquarters',
  'responsible_office',
  'voltage_kv',
  'voltage_kv_values',
  'voltage_source',
  'source_list_page',
  'source_list_url',
  'source_detail_url',
]);
const ukOpenMapSourceId = 'uk-os-openmap-local-electricity-2026-04';
const ukOpenMapBounds = {
  west: -5.936317,
  south: 50.14287,
  east: 1.721511,
  north: 58.575236,
};
const ukOpenMapPropertyFields = new Set([
  'REGION_KEY',
  'ASSET_KIND',
  'SOURCE_ID',
  'ORIGINAL_ID',
  'FEATURE_CODE',
  'GRID_SQUARES',
  'VOLTAGE_KV',
  'SOURCE_DATE',
  'SOURCE_URL',
  'SOURCE_LICENSE',
  'EVIDENCE',
  'GEOMETRY_CONFIDENCE',
]);
const netherlandsGridSourceId = 'nl-kadaster-top10nl-high-voltage-2026-06';
const netherlandsGridBounds = {
  west: 3.509947,
  south: 50.752564,
  east: 7.1933,
  north: 53.451302,
};
const netherlandsGridPropertyFields = new Set([
  'REGION_KEY',
  'ASSET_KIND',
  'SOURCE_ID',
  'ORIGINAL_ID',
  'LOCAL_ID',
  'NAMESPACE',
  'TOP10NL_TYPE',
  'TOP10NL_CODE',
  'VISUALISATION_CODE',
  'NAME',
  'NUMBER',
  'HEIGHT_LEVEL',
  'SOURCE_FEATURE_DATE',
  'OBJECT_BEGIN_DATE',
  'REGISTRATION_DATE',
  'MUTATION_TYPE',
  'SOURCE_METHOD',
  'SOURCE_ACCURACY_M',
  'VOLTAGE_KV',
  'SOURCE_DATE',
  'SOURCE_URL',
  'SOURCE_LICENSE',
  'EVIDENCE',
  'GEOMETRY_CONFIDENCE',
]);
const forbiddenGeographicKeys = new Set([
  'geometry',
  'geometries',
  'coordinate',
  'coordinates',
  'latitude',
  'longitude',
  'lat',
  'lon',
  'lng',
  'x',
  'y',
  'easting',
  'northing',
  'bbox',
  'bounds',
  'bounding_box',
  'centroid',
  'center',
  'centre',
  'geohash',
  'wkt',
  'geojson',
  'shape',
  'point',
  'points',
  'linestring',
  'multi_linestring',
  'polygon',
  'multipolygon',
  'feature',
  'features',
  'feature_collection',
  'route',
  'route_path',
  'position',
  'crs',
  'epsg',
  'srid',
]);
const failures = [];

function fail(message) {
  failures.push(message);
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
  return condition;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function sameNumber(left, right, tolerance = 1e-9) {
  return isFiniteNumber(left) && isFiniteNumber(right) && Math.abs(left - right) <= tolerance;
}

function hasAtMostDecimalPlaces(value, places) {
  if (!isFiniteNumber(value)) return false;
  const scale = 10 ** places;
  return Math.abs(value * scale - Math.round(value * scale)) <= 1e-7;
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validateVoltage(value, description) {
  if (!requireCondition(isObject(value), `${description} must be an object.`)) return;
  requireCondition(isFiniteNumber(value.magnitude_kv) && value.magnitude_kv > 0, `${description}.magnitude_kv must be a positive number.`);
  requireCondition(value.notation === `±${value.magnitude_kv}`, `${description}.notation must match magnitude_kv.`);
}

function validateRecursiveHttpsUrls(value, description, trail = []) {
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) validateRecursiveHttpsUrls(child, description, [...trail, index]);
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childTrail = [...trail, key];
    const normalizedKey = key.toLowerCase();
    if (!trail.includes('property_schema') && (normalizedKey === 'url' || normalizedKey.endsWith('_url'))) {
      requireCondition(isHttpsUrl(child), `${description} ${childTrail.join('.')} must use HTTPS.`);
    }
    validateRecursiveHttpsUrls(child, description, childTrail);
  }
}

function validateRecursiveSha256Formats(value, description, trail = []) {
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) validateRecursiveSha256Formats(child, description, [...trail, index]);
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childTrail = [...trail, key];
    const normalizedKey = key.toLowerCase();
    const isDigestField = normalizedKey === 'sha256'
      || normalizedKey.endsWith('_sha256')
      || normalizedKey.endsWith('_sha256_digest')
      || normalizedKey.endsWith('_sha256_manifest_digest');
    if (isDigestField) {
      requireCondition(isSha256(child), `${description} ${childTrail.join('.')} must be a 64-character SHA-256 digest.`);
    }
    validateRecursiveSha256Formats(child, description, childTrail);
  }
}

function isForbiddenGeographicKey(key) {
  const normalized = key.toLowerCase().replaceAll('-', '_');
  if (normalized === 'contains_geometry') return false;
  if (forbiddenGeographicKeys.has(normalized)) return true;
  return [
    '_coordinate',
    '_coordinates',
    '_geometry',
    '_latitude',
    '_longitude',
    '_centroid',
    '_bbox',
    '_bounds',
    '_geohash',
    '_geojson',
    '_wkt',
  ].some((suffix) => normalized.endsWith(suffix));
}

function rejectGeographicPayload(value, description, trail = []) {
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) rejectGeographicPayload(child, description, [...trail, index]);
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childTrail = [...trail, key];
    if (key.toLowerCase().replaceAll('-', '_') === 'contains_geometry') {
      requireCondition(child === false, `${description} ${childTrail.join('.')} must be false.`);
    } else {
      requireCondition(!isForbiddenGeographicKey(key), `${description} contains forbidden geographic field ${childTrail.join('.')}.`);
    }
    rejectGeographicPayload(child, description, childTrail);
  }
}

function requireSummary(actual, expected, description) {
  if (!requireCondition(isObject(actual), `${description} must be an object.`)) return;
  for (const [key, expectedValue] of Object.entries(expected)) {
    requireCondition(actual[key] === expectedValue, `${description}.${key} must be ${expectedValue}; found ${String(actual[key])}.`);
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    fail(`${path.relative(projectDirectory, filePath)} could not be read as JSON: ${error.message}`);
    return null;
  }
}

async function sha256(filePath) {
  const contents = await readFile(filePath);
  return createHash('sha256').update(contents).digest('hex');
}

function validateProfiles(profiles) {
  if (!requireCondition(isObject(profiles?.regions), 'region-profiles.json must contain a regions object.')) return;

  const keys = Object.keys(profiles.regions);
  const unexpected = keys.filter((key) => !expectedRegions.has(key));
  const missing = [...expectedRegions].filter((key) => !Object.hasOwn(profiles.regions, key));
  requireCondition(unexpected.length === 0, `region-profiles.json has unexpected region keys: ${unexpected.join(', ')}.`);
  requireCondition(missing.length === 0, `region-profiles.json is missing region keys: ${missing.join(', ')}.`);
  requireCondition(keys.length === expectedRegions.size, `region-profiles.json must define exactly ${expectedRegions.size} regions; found ${keys.length}.`);

  for (const key of expectedRegions) {
    const profile = profiles.regions[key];
    if (!requireCondition(isObject(profile), `region profile ${key} must be an object.`)) continue;
    requireCondition(typeof profile.title === 'string' && profile.title.trim(), `region profile ${key} needs a non-empty title.`);
    requireCondition(typeof profile.summary === 'string' && profile.summary.trim(), `region profile ${key} needs a non-empty summary.`);
    requireCondition(Array.isArray(profile.metrics) && profile.metrics.length > 0, `region profile ${key} needs at least one metric.`);
    for (const [index, metric] of (profile.metrics ?? []).entries()) {
      requireCondition(isObject(metric), `region profile ${key} metric ${index} must be an object.`);
      requireCondition(typeof metric?.value === 'string' && metric.value.trim(), `region profile ${key} metric ${index} needs a value.`);
      requireCondition(typeof metric?.label === 'string' && metric.label.trim(), `region profile ${key} metric ${index} needs a label.`);
    }
    requireCondition(Array.isArray(profile.sources) && profile.sources.length > 0, `region profile ${key} needs at least one source link.`);
    for (const [index, source] of (profile.sources ?? []).entries()) {
      requireCondition(isObject(source), `region profile ${key} source ${index} must be an object.`);
      requireCondition(typeof source?.label === 'string' && source.label.trim(), `region profile ${key} source ${index} needs a label.`);
      requireCondition(isHttpsUrl(source?.url), `region profile ${key} source ${index} must use an HTTPS URL.`);
    }
  }
}

function validateRegistry(registry) {
  if (!requireCondition(Array.isArray(registry?.sources) && registry.sources.length > 0, 'source-registry.json must contain a non-empty sources array.')) return new Map();

  const sourceById = new Map();
  for (const [index, source] of registry.sources.entries()) {
    const id = source?.id;
    requireCondition(typeof id === 'string' && id.trim(), `source registry entry ${index} needs a non-empty id.`);
    requireCondition(!sourceById.has(id), `source registry id is duplicated: ${id}.`);
    if (typeof id === 'string' && id.trim() && !sourceById.has(id)) sourceById.set(id, source);
  }
  return sourceById;
}

function validateCoordinate(coordinate, description) {
  if (!requireCondition(Array.isArray(coordinate) && coordinate.length >= 2, `${description} must be a longitude/latitude coordinate.`)) return false;
  const [longitude, latitude] = coordinate;
  requireCondition(isFiniteNumber(longitude) && longitude >= -180 && longitude <= 180, `${description} longitude is outside [-180, 180].`);
  requireCondition(isFiniteNumber(latitude) && latitude >= -90 && latitude <= 90, `${description} latitude is outside [-90, 90].`);
  return isFiniteNumber(longitude) && isFiniteNumber(latitude) && longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90;
}

function validateModelCorridors(corridors, sourceById) {
  if (!requireCondition(corridors?.type === 'FeatureCollection', 'model-corridors.geojson must be a FeatureCollection.')) return;
  if (!requireCondition(Array.isArray(corridors.features) && corridors.features.length > 0, 'model-corridors.geojson must contain features.')) return;

  for (const [index, feature] of corridors.features.entries()) {
    const prefix = `model corridor ${index}`;
    requireCondition(feature?.type === 'Feature', `${prefix} must be a GeoJSON Feature.`);
    requireCondition(feature?.geometry?.type === 'LineString', `${prefix} geometry must be a LineString.`);
    const coordinates = feature?.geometry?.coordinates;
    requireCondition(Array.isArray(coordinates) && coordinates.length >= 2, `${prefix} LineString needs at least two coordinates.`);
    for (const [coordinateIndex, coordinate] of (coordinates ?? []).entries()) {
      validateCoordinate(coordinate, `${prefix} coordinate ${coordinateIndex}`);
    }

    const properties = feature?.properties;
    requireCondition(isObject(properties), `${prefix} needs properties.`);
    const regionKey = properties?.REGION_KEY;
    const sourceId = properties?.SOURCE_ID;
    requireCondition(expectedRegions.has(regionKey), `${prefix} REGION_KEY must be one of the six atlas regions.`);
    requireCondition(typeof sourceId === 'string' && sourceById.has(sourceId), `${prefix} SOURCE_ID must exist in source-registry.json.`);
    requireCondition(properties?.EVIDENCE === 'modelled', `${prefix} EVIDENCE must be modelled.`);
    requireCondition(typeof properties?.GEOMETRY_CONFIDENCE === 'string' && properties.GEOMETRY_CONFIDENCE.trim(), `${prefix} needs GEOMETRY_CONFIDENCE.`);

    const source = sourceById.get(sourceId);
    if (source) {
      requireCondition(source.evidence_level === 'modelled', `${prefix} SOURCE_ID ${sourceId} must reference a modelled source.`);
      requireCondition(Array.isArray(source.regions) && source.regions.includes(regionKey), `${prefix} SOURCE_ID ${sourceId} is not registered for ${regionKey}.`);
    }
  }
}

function validateUkOpenMapLines(lines, metadata, sourceById) {
  if (!requireCondition(lines?.type === 'FeatureCollection', 'UK OS OpenMap Local GeoJSON must be a FeatureCollection.')) return;
  if (!requireCondition(Array.isArray(lines.features), 'UK OS OpenMap Local GeoJSON must contain a features array.')) return;
  requireCondition(lines.name === 'uk_os_openmap_local_electricity_lines', 'UK OS OpenMap Local collection name is incorrect.');
  requireCondition(lines.features.length === 3414, `UK OS OpenMap Local must contain exactly 3,414 features; found ${lines.features.length}.`);

  const collectionSource = lines.source;
  requireCondition(isObject(collectionSource), 'UK OS OpenMap Local must contain a collection source object.');
  requireCondition(collectionSource?.id === ukOpenMapSourceId, `UK OS OpenMap Local source.id must be ${ukOpenMapSourceId}.`);
  requireCondition(collectionSource?.publisher === 'Ordnance Survey', 'UK OS OpenMap Local publisher must be Ordnance Survey.');
  requireCondition(collectionSource?.version === '2026-04', 'UK OS OpenMap Local source version must be 2026-04.');
  requireCondition(collectionSource?.licence === 'OGL 3.0', 'UK OS OpenMap Local source licence must be OGL 3.0.');
  requireCondition(collectionSource?.attribution === 'Contains OS data © Crown copyright and database right 2026', 'UK OS OpenMap Local source attribution is incorrect.');
  requireCondition(isHttpsUrl(collectionSource?.licence_url), 'UK OS OpenMap Local source licence_url must use HTTPS.');
  requireCondition(isHttpsUrl(collectionSource?.product_api_url), 'UK OS OpenMap Local source product_api_url must use HTTPS.');
  requireCondition(isHttpsUrl(collectionSource?.feature_documentation_url), 'UK OS OpenMap Local feature_documentation_url must use HTTPS.');

  const ids = new Set();
  const originalIds = new Set();
  let minLongitude = Infinity;
  let minLatitude = Infinity;
  let maxLongitude = -Infinity;
  let maxLatitude = -Infinity;

  for (const [index, feature] of lines.features.entries()) {
    const prefix = `UK OS OpenMap Local feature ${index}`;
    requireCondition(feature?.type === 'Feature', `${prefix} must be a GeoJSON Feature.`);
    requireCondition(typeof feature?.id === 'string' && /^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/i.test(feature.id), `${prefix} id must be an OS UUID.`);
    requireCondition(!ids.has(feature?.id), `${prefix} duplicates feature id ${String(feature?.id)}.`);
    if (typeof feature?.id === 'string') ids.add(feature.id);
    requireCondition(feature?.geometry?.type === 'LineString', `${prefix} geometry must be a LineString.`);
    const coordinates = feature?.geometry?.coordinates;
    requireCondition(Array.isArray(coordinates) && coordinates.length >= 2, `${prefix} LineString must contain at least two coordinates.`);
    for (const [coordinateIndex, coordinate] of (coordinates ?? []).entries()) {
      if (validateCoordinate(coordinate, `${prefix} coordinate ${coordinateIndex}`)) {
        const [longitude, latitude] = coordinate;
        requireCondition(hasAtMostDecimalPlaces(longitude, 6) && hasAtMostDecimalPlaces(latitude, 6), `${prefix} coordinate ${coordinateIndex} must be rounded to at most six decimal places.`);
        requireCondition(longitude >= ukOpenMapBounds.west && longitude <= ukOpenMapBounds.east, `${prefix} coordinate ${coordinateIndex} longitude is outside the verified Great Britain output bounds.`);
        requireCondition(latitude >= ukOpenMapBounds.south && latitude <= ukOpenMapBounds.north, `${prefix} coordinate ${coordinateIndex} latitude is outside the verified Great Britain output bounds.`);
        minLongitude = Math.min(minLongitude, longitude);
        minLatitude = Math.min(minLatitude, latitude);
        maxLongitude = Math.max(maxLongitude, longitude);
        maxLatitude = Math.max(maxLatitude, latitude);
      }
    }

    const properties = feature?.properties;
    if (!requireCondition(isObject(properties), `${prefix} needs properties.`)) continue;
    for (const key of Object.keys(properties)) requireCondition(ukOpenMapPropertyFields.has(key), `${prefix} contains undocumented property ${key}.`);
    for (const key of ukOpenMapPropertyFields) requireCondition(Object.hasOwn(properties, key), `${prefix} is missing required property ${key}.`);
    requireCondition(properties.REGION_KEY === 'great-britain', `${prefix} REGION_KEY must be great-britain.`);
    requireCondition(properties.ASSET_KIND === 'official_transmission_line', `${prefix} ASSET_KIND must be official_transmission_line.`);
    requireCondition(properties.SOURCE_ID === ukOpenMapSourceId, `${prefix} SOURCE_ID must be ${ukOpenMapSourceId}.`);
    requireCondition(properties.ORIGINAL_ID === feature.id, `${prefix} ORIGINAL_ID must match feature.id.`);
    requireCondition(!originalIds.has(properties.ORIGINAL_ID), `${prefix} duplicates ORIGINAL_ID ${String(properties.ORIGINAL_ID)}.`);
    if (typeof properties.ORIGINAL_ID === 'string') originalIds.add(properties.ORIGINAL_ID);
    requireCondition(properties.FEATURE_CODE === 15102, `${prefix} FEATURE_CODE must be 15102.`);
    requireCondition(typeof properties.GRID_SQUARES === 'string' && /^[A-Z]{2}(?:\|[A-Z]{2})*$/.test(properties.GRID_SQUARES), `${prefix} GRID_SQUARES must contain pipe-separated OS grid-square codes.`);
    requireCondition(properties.VOLTAGE_KV === null, `${prefix} VOLTAGE_KV must remain null because OS does not publish voltage.`);
    requireCondition(properties.SOURCE_DATE === '2026-04', `${prefix} SOURCE_DATE must be 2026-04.`);
    requireCondition(properties.SOURCE_URL === 'https://api.os.uk/downloads/v1/products/OpenMapLocal', `${prefix} SOURCE_URL is incorrect.`);
    requireCondition(properties.SOURCE_LICENSE === 'OGL 3.0', `${prefix} SOURCE_LICENSE must be OGL 3.0.`);
    requireCondition(properties.EVIDENCE === 'official', `${prefix} EVIDENCE must be official.`);
    requireCondition(properties.GEOMETRY_CONFIDENCE === 'official-openmap-local-1:10000-bng-helmert-wgs84-rounded-6dp-no-simplification', `${prefix} GEOMETRY_CONFIDENCE must preserve the scale, transform, precision and no-simplification facts.`);
  }

  requireCondition(ids.size === 3414, `UK OS OpenMap Local must contain 3,414 unique feature IDs; found ${ids.size}.`);
  requireCondition(originalIds.size === 3414, `UK OS OpenMap Local must contain 3,414 unique ORIGINAL_ID values; found ${originalIds.size}.`);
  requireCondition(sameNumber(minLongitude, ukOpenMapBounds.west), `UK OS OpenMap Local minimum longitude ${minLongitude} does not match the verified bound.`);
  requireCondition(sameNumber(minLatitude, ukOpenMapBounds.south), `UK OS OpenMap Local minimum latitude ${minLatitude} does not match the verified bound.`);
  requireCondition(sameNumber(maxLongitude, ukOpenMapBounds.east), `UK OS OpenMap Local maximum longitude ${maxLongitude} does not match the verified bound.`);
  requireCondition(sameNumber(maxLatitude, ukOpenMapBounds.north), `UK OS OpenMap Local maximum latitude ${maxLatitude} does not match the verified bound.`);
  validateRecursiveHttpsUrls(lines, 'UK OS OpenMap Local GeoJSON');

  requireCondition(metadata?.schema_version === 1, 'UK OS OpenMap Local metadata schema_version must be 1.');
  requireCondition(metadata?.source?.id === ukOpenMapSourceId, `UK OS OpenMap Local metadata source.id must be ${ukOpenMapSourceId}.`);
  requireCondition(metadata?.source?.publisher === 'Ordnance Survey', 'UK OS OpenMap Local metadata publisher must be Ordnance Survey.');
  requireCondition(metadata?.source?.version === '2026-04', 'UK OS OpenMap Local metadata version must be 2026-04.');
  requireCondition(metadata?.scope?.geography === 'Great Britain', 'UK OS OpenMap Local metadata geography must be Great Britain.');
  requireCondition(metadata?.scope?.source_layer === 'ElectricityTransmissionLine', 'UK OS OpenMap Local metadata source_layer is incorrect.');
  requireCondition(metadata?.scope?.source_scale === '1:10,000', 'UK OS OpenMap Local metadata source_scale must be 1:10,000.');
  requireCondition(metadata?.scope?.source_crs === 'EPSG:27700', 'UK OS OpenMap Local metadata source_crs must be EPSG:27700.');
  requireCondition(metadata?.scope?.output_crs === 'OGC:CRS84', 'UK OS OpenMap Local metadata output_crs must be OGC:CRS84.');
  requireCondition(metadata?.scope?.source_grid_square_count === 40, 'UK OS OpenMap Local metadata must report 40 source grid squares.');
  requireCondition(metadata?.processing?.script === 'scripts/grid-atlas/build-uk-os-openmap-local-grid.py', 'UK OS OpenMap Local metadata builder path is incorrect.');
  requireCondition(
    metadata?.transform?.geometry === 'No simplification, smoothing or inferred connectivity. Coordinates rounded to six decimal degrees. Identical parts are deduplicated and line direction is canonicalized.',
    'UK OS OpenMap Local metadata must preserve the exact no-simplification transformation statement.',
  );
  requireCondition(metadata?.transform?.coordinate_decimal_places === 6, 'UK OS OpenMap Local metadata coordinate precision must be six decimal places.');
  requireCondition(metadata?.transform?.self_check?.passed === true, 'UK OS OpenMap Local coordinate transform self-check must pass.');

  const statistics = metadata?.statistics;
  requireCondition(statistics?.source_record_count === 3659, 'UK OS OpenMap Local metadata source_record_count must be 3,659.');
  requireCondition(statistics?.source_part_count === 3659, 'UK OS OpenMap Local metadata source_part_count must be 3,659.');
  requireCondition(statistics?.source_point_count === 339719, 'UK OS OpenMap Local metadata source_point_count must be 339,719.');
  requireCondition(statistics?.deleted_record_count === 0, 'UK OS OpenMap Local metadata deleted_record_count must be zero.');
  requireCondition(statistics?.null_shape_count === 0, 'UK OS OpenMap Local metadata null_shape_count must be zero.');
  requireCondition(statistics?.feature_code_counts?.['15102'] === 3659, 'UK OS OpenMap Local metadata must report 3,659 source records with FEATURE_CODE 15102.');
  requireCondition(statistics?.unique_original_id_count === 3414, 'UK OS OpenMap Local metadata unique_original_id_count must be 3,414.');
  requireCondition(statistics?.multipart_feature_count === 0, 'UK OS OpenMap Local metadata multipart_feature_count must be zero.');
  requireCondition(statistics?.duplicate_identical_part_count === 245, 'UK OS OpenMap Local metadata duplicate_identical_part_count must be 245.');
  requireCondition(statistics?.source_record_count - statistics?.duplicate_identical_part_count === statistics?.unique_original_id_count, 'UK OS OpenMap Local source records minus exact duplicate parts must equal unique IDs.');
  requireCondition(statistics?.output_geometry_counts?.LineString === 3414 && Object.keys(statistics?.output_geometry_counts ?? {}).length === 1, 'UK OS OpenMap Local metadata must report exactly 3,414 LineString outputs.');
  requireSummary(statistics?.output_bounds_crs84, ukOpenMapBounds, 'UK OS OpenMap Local metadata output bounds');

  const verification = metadata?.verification;
  for (const key of [
    'product_version_verified',
    'catalog_archive_size_verified',
    'selected_member_zip_crc_verified',
    'selected_member_sha256_recorded',
    'source_crs_verified',
    'source_feature_code_verified',
    'transform_self_check_passed',
    'output_json_reparsed',
    'feature_ids_unique',
    'output_below_10_mib',
  ]) {
    requireCondition(verification?.[key] === true, `UK OS OpenMap Local verification.${key} must be true.`);
  }
  requireCondition(verification?.feature_count_verified === 3414, 'UK OS OpenMap Local verified feature count must be 3,414.');
  requireSummary(verification?.bounds_verified, ukOpenMapBounds, 'UK OS OpenMap Local verified bounds');

  requireCondition(metadata?.output?.path === 'data/grid-atlas/uk-os-openmap-local-electricity-lines.geojson', 'UK OS OpenMap Local metadata output.path is incorrect.');
  requireCondition(metadata?.output?.format === 'RFC 7946 GeoJSON FeatureCollection', 'UK OS OpenMap Local metadata output.format is incorrect.');
  requireCondition(metadata?.output?.feature_count === 3414, 'UK OS OpenMap Local metadata output.feature_count must be 3,414.');
  requireCondition(Number.isInteger(metadata?.output?.size_bytes) && metadata.output.size_bytes > 0 && metadata.output.size_bytes < maxStaticGeoJsonBytes, 'UK OS OpenMap Local metadata output size must be positive and below 10 MiB.');
  requireCondition(isSha256(metadata?.output?.sha256), 'UK OS OpenMap Local metadata output.sha256 must be a SHA-256 digest.');
  requireCondition(metadata?.licence?.name === 'Open Government Licence version 3.0', 'UK OS OpenMap Local metadata licence name is incorrect.');
  requireCondition(metadata?.licence?.short_name === 'OGL 3.0', 'UK OS OpenMap Local metadata licence short_name must be OGL 3.0.');
  requireCondition(metadata?.licence?.required_attribution === collectionSource?.attribution, 'UK OS OpenMap Local metadata required attribution must match the GeoJSON source attribution.');
  requireCondition(metadata?.licence?.attribution_required === true, 'UK OS OpenMap Local metadata must mark attribution as required.');
  requireCondition(metadata?.licence?.commercial_use_permitted === true, 'UK OS OpenMap Local metadata must preserve commercial-use permission.');
  requireCondition(metadata?.licence?.modification_permitted === true, 'UK OS OpenMap Local metadata must preserve modification permission.');
  requireCondition(metadata?.licence?.redistribution_permitted === true, 'UK OS OpenMap Local metadata must preserve redistribution permission.');
  requireCondition(isHttpsUrl(metadata?.licence?.url), 'UK OS OpenMap Local metadata licence URL must use HTTPS.');
  validateRecursiveHttpsUrls(metadata, 'UK OS OpenMap Local metadata');
  validateRecursiveSha256Formats(metadata, 'UK OS OpenMap Local metadata');

  const source = sourceById.get(ukOpenMapSourceId);
  requireCondition(Boolean(source), `UK OS OpenMap Local source ${ukOpenMapSourceId} must exist in source-registry.json.`);
  if (source) {
    requireCondition(source.source_class === 'official', `UK OS OpenMap Local source ${ukOpenMapSourceId} must be official.`);
    requireCondition(source.evidence_level === 'reported', `UK OS OpenMap Local source ${ukOpenMapSourceId} must be reported.`);
    requireCondition(Array.isArray(source.regions) && source.regions.includes('europa'), `UK OS OpenMap Local source ${ukOpenMapSourceId} must be registered for europa.`);
    requireCondition(source.publisher === 'Ordnance Survey', `UK OS OpenMap Local registry publisher must be Ordnance Survey.`);
    requireCondition(source.integration_status === 'active', `UK OS OpenMap Local registry source must be active.`);
    requireCondition(source.local_asset === 'data/grid-atlas/uk-os-openmap-local-electricity-lines.geojson', 'UK OS OpenMap Local registry local_asset is incorrect.');
    requireCondition(typeof source.licence === 'string' && /Open Government Licence 3\.0/i.test(source.licence), 'UK OS OpenMap Local registry licence must declare OGL 3.0.');
    requireCondition(isHttpsUrl(source.url), 'UK OS OpenMap Local registry URL must use HTTPS.');
    requireCondition(isHttpsUrl(source.endpoint), 'UK OS OpenMap Local registry endpoint must use HTTPS.');
    requireCondition(isHttpsUrl(source.licence_url), 'UK OS OpenMap Local registry licence_url must use HTTPS.');
    requireCondition(typeof source.redistribution === 'string' && /no geometry is simplified/i.test(source.redistribution), 'UK OS OpenMap Local registry must preserve the no-simplification fact.');
  }
}

function validateNetherlandsOfficialGrid(lines, metadata, sourceById) {
  if (!requireCondition(lines?.type === 'FeatureCollection', 'Netherlands official grid GeoJSON must be a FeatureCollection.')) return;
  if (!requireCondition(Array.isArray(lines.features), 'Netherlands official grid GeoJSON must contain a features array.')) return;
  requireCondition(lines.name === 'netherlands_official_grid', 'Netherlands official grid collection name is incorrect.');
  requireCondition(lines.features.length === 496, `Netherlands official grid must contain exactly 496 features; found ${lines.features.length}.`);

  const collectionSource = lines.source;
  requireCondition(isObject(collectionSource), 'Netherlands official grid must contain a collection source object.');
  requireCondition(collectionSource?.id === netherlandsGridSourceId, `Netherlands official grid source.id must be ${netherlandsGridSourceId}.`);
  requireCondition(collectionSource?.publisher === 'Kadaster (Basisregistratie Topografie)', 'Netherlands official grid publisher is incorrect.');
  requireCondition(collectionSource?.collection === 'inrichtingselement_lijn', 'Netherlands official grid source collection is incorrect.');
  requireCondition(collectionSource?.selected_type === 'hoogspanningsleiding', 'Netherlands official grid selected source type must be hoogspanningsleiding.');
  requireCondition(collectionSource?.date === '2026-06-01', 'Netherlands official grid source date must be 2026-06-01.');
  requireCondition(collectionSource?.licence === 'CC BY 4.0', 'Netherlands official grid source licence must be CC BY 4.0.');
  requireCondition(collectionSource?.api === 'https://api.pdok.nl/kadaster/brt-top10nl/ogc/v1', 'Netherlands official grid source API is incorrect.');
  requireCondition(isHttpsUrl(collectionSource?.licence_url), 'Netherlands official grid licence_url must use HTTPS.');

  const ids = new Set();
  const originalIds = new Set();
  const localIds = new Set();
  let vertexCount = 0;
  let minLongitude = Infinity;
  let minLatitude = Infinity;
  let maxLongitude = -Infinity;
  let maxLatitude = -Infinity;

  for (const [index, feature] of lines.features.entries()) {
    const prefix = `Netherlands official grid feature ${index}`;
    requireCondition(feature?.type === 'Feature', `${prefix} must be a GeoJSON Feature.`);
    requireCondition(typeof feature?.id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(feature.id), `${prefix} id must be a UUID.`);
    requireCondition(!ids.has(feature?.id), `${prefix} duplicates feature id ${String(feature?.id)}.`);
    if (typeof feature?.id === 'string') ids.add(feature.id);
    requireCondition(feature?.geometry?.type === 'LineString', `${prefix} geometry must be a LineString.`);
    const coordinates = feature?.geometry?.coordinates;
    requireCondition(Array.isArray(coordinates) && coordinates.length >= 2, `${prefix} LineString must contain at least two coordinates.`);
    vertexCount += coordinates?.length ?? 0;
    for (const [coordinateIndex, coordinate] of (coordinates ?? []).entries()) {
      if (validateCoordinate(coordinate, `${prefix} coordinate ${coordinateIndex}`)) {
        const [longitude, latitude] = coordinate;
        requireCondition(hasAtMostDecimalPlaces(longitude, 6) && hasAtMostDecimalPlaces(latitude, 6), `${prefix} coordinate ${coordinateIndex} must be rounded to at most six decimal places.`);
        requireCondition(longitude >= netherlandsGridBounds.west && longitude <= netherlandsGridBounds.east, `${prefix} coordinate ${coordinateIndex} longitude is outside the verified output bounds.`);
        requireCondition(latitude >= netherlandsGridBounds.south && latitude <= netherlandsGridBounds.north, `${prefix} coordinate ${coordinateIndex} latitude is outside the verified output bounds.`);
        minLongitude = Math.min(minLongitude, longitude);
        minLatitude = Math.min(minLatitude, latitude);
        maxLongitude = Math.max(maxLongitude, longitude);
        maxLatitude = Math.max(maxLatitude, latitude);
      }
    }

    const properties = feature?.properties;
    if (!requireCondition(isObject(properties), `${prefix} needs properties.`)) continue;
    for (const key of Object.keys(properties)) requireCondition(netherlandsGridPropertyFields.has(key), `${prefix} contains undocumented property ${key}.`);
    for (const key of netherlandsGridPropertyFields) requireCondition(Object.hasOwn(properties, key), `${prefix} is missing required property ${key}.`);
    requireCondition(properties.REGION_KEY === 'netherlands', `${prefix} REGION_KEY must be netherlands.`);
    requireCondition(properties.ASSET_KIND === 'official_transmission_line', `${prefix} ASSET_KIND must be official_transmission_line.`);
    requireCondition(properties.SOURCE_ID === netherlandsGridSourceId, `${prefix} SOURCE_ID must be ${netherlandsGridSourceId}.`);
    requireCondition(properties.ORIGINAL_ID === feature.id, `${prefix} ORIGINAL_ID must match feature.id.`);
    requireCondition(!originalIds.has(properties.ORIGINAL_ID), `${prefix} duplicates ORIGINAL_ID ${String(properties.ORIGINAL_ID)}.`);
    if (typeof properties.ORIGINAL_ID === 'string') originalIds.add(properties.ORIGINAL_ID);
    requireCondition(typeof properties.LOCAL_ID === 'string' && properties.LOCAL_ID.trim(), `${prefix} LOCAL_ID must be a non-empty string.`);
    requireCondition(!localIds.has(properties.LOCAL_ID), `${prefix} duplicates LOCAL_ID ${String(properties.LOCAL_ID)}.`);
    if (typeof properties.LOCAL_ID === 'string') localIds.add(properties.LOCAL_ID);
    requireCondition(properties.NAMESPACE === 'NL.TOP10NL', `${prefix} NAMESPACE must be NL.TOP10NL.`);
    requireCondition(properties.TOP10NL_TYPE === 'hoogspanningsleiding', `${prefix} TOP10NL_TYPE must be hoogspanningsleiding.`);
    requireCondition(properties.TOP10NL_CODE === 481, `${prefix} TOP10NL_CODE must be 481.`);
    requireCondition(Math.abs(properties.VISUALISATION_CODE) === 15210, `${prefix} VISUALISATION_CODE magnitude must be 15210.`);
    requireCondition(properties.NAME === null || typeof properties.NAME === 'string', `${prefix} NAME must be null or a string.`);
    requireCondition(properties.NUMBER === null || typeof properties.NUMBER === 'string', `${prefix} NUMBER must be null or a string.`);
    requireCondition(Number.isInteger(properties.HEIGHT_LEVEL) && [-1, 0].includes(properties.HEIGHT_LEVEL), `${prefix} HEIGHT_LEVEL must be -1 or 0.`);
    for (const key of ['SOURCE_FEATURE_DATE', 'OBJECT_BEGIN_DATE', 'REGISTRATION_DATE']) {
      requireCondition(isIsoDate(properties[key]), `${prefix} ${key} must be ISO YYYY-MM-DD.`);
    }
    requireCondition(properties.MUTATION_TYPE === null || ['kwaliteitsverbetering', 'werkelijke verandering'].includes(properties.MUTATION_TYPE), `${prefix} MUTATION_TYPE has an undocumented value.`);
    requireCondition(properties.SOURCE_METHOD === 'luchtfoto', `${prefix} SOURCE_METHOD must be luchtfoto.`);
    requireCondition(properties.SOURCE_ACCURACY_M === 0.1, `${prefix} SOURCE_ACCURACY_M must be 0.1.`);
    requireCondition(properties.VOLTAGE_KV === null, `${prefix} VOLTAGE_KV must remain null because TOP10NL does not publish numeric voltage.`);
    requireCondition(properties.SOURCE_DATE === '2026-06-01', `${prefix} SOURCE_DATE must be 2026-06-01.`);
    requireCondition(properties.SOURCE_URL === 'https://api.pdok.nl/kadaster/brt-top10nl/ogc/v1', `${prefix} SOURCE_URL is incorrect.`);
    requireCondition(properties.SOURCE_LICENSE === 'CC BY 4.0', `${prefix} SOURCE_LICENSE must be CC BY 4.0.`);
    requireCondition(properties.EVIDENCE === 'official', `${prefix} EVIDENCE must be official.`);
    requireCondition(properties.GEOMETRY_CONFIDENCE === 'official-top10nl-1:10000-rounded-6dp-no-simplification', `${prefix} GEOMETRY_CONFIDENCE must preserve the source scale, precision and no-simplification facts.`);
  }

  requireCondition(ids.size === 496, `Netherlands official grid must contain 496 unique feature IDs; found ${ids.size}.`);
  requireCondition(originalIds.size === 496, `Netherlands official grid must contain 496 unique ORIGINAL_ID values; found ${originalIds.size}.`);
  requireCondition(localIds.size === 496, `Netherlands official grid must contain 496 unique LOCAL_ID values; found ${localIds.size}.`);
  requireCondition(vertexCount === 16803, `Netherlands official grid must contain exactly 16,803 vertices; found ${vertexCount}.`);
  requireCondition(sameNumber(minLongitude, netherlandsGridBounds.west), `Netherlands official grid minimum longitude ${minLongitude} does not match the verified bound.`);
  requireCondition(sameNumber(minLatitude, netherlandsGridBounds.south), `Netherlands official grid minimum latitude ${minLatitude} does not match the verified bound.`);
  requireCondition(sameNumber(maxLongitude, netherlandsGridBounds.east), `Netherlands official grid maximum longitude ${maxLongitude} does not match the verified bound.`);
  requireCondition(sameNumber(maxLatitude, netherlandsGridBounds.north), `Netherlands official grid maximum latitude ${maxLatitude} does not match the verified bound.`);
  validateRecursiveHttpsUrls(lines, 'Netherlands official grid GeoJSON');

  requireCondition(metadata?.schema_version === 1, 'Netherlands official grid metadata schema_version must be 1.');
  requireCondition(metadata?.source?.id === netherlandsGridSourceId, `Netherlands official grid metadata source.id must be ${netherlandsGridSourceId}.`);
  requireCondition(metadata?.source?.publisher === collectionSource?.publisher, 'Netherlands official grid metadata publisher must match the GeoJSON source.');
  requireCondition(metadata?.source?.collection_id === 'inrichtingselement_lijn', 'Netherlands official grid metadata collection_id is incorrect.');
  requireCondition(metadata?.source?.declared_source_date === '2026-06-01', 'Netherlands official grid metadata source date must be 2026-06-01.');
  requireCondition(metadata?.source?.source_scale === '1:10,000', 'Netherlands official grid metadata source scale must be 1:10,000.');
  requireCondition(metadata?.source?.api_root === collectionSource?.api, 'Netherlands official grid metadata API root must match the GeoJSON source.');
  requireCondition(metadata?.source?.output_crs === 'OGC:CRS84', 'Netherlands official grid metadata output CRS must be OGC:CRS84.');
  requireCondition(metadata?.processing?.script === 'scripts/grid-atlas/build-netherlands-official-grid.py', 'Netherlands official grid metadata builder path is incorrect.');
  requireCondition(
    metadata?.transform?.geometry === 'Source CRS84 vertices rounded to six decimal places; no simplification, smoothing, merging or inferred connectivity.',
    'Netherlands official grid metadata must preserve the exact no-simplification transformation statement.',
  );
  requireCondition(metadata?.transform?.coordinate_decimal_places === 6, 'Netherlands official grid metadata coordinate precision must be six decimal places.');
  requireCondition(typeof metadata?.transform?.voltage === 'string' && /VOLTAGE_KV is intentionally null/.test(metadata.transform.voltage), 'Netherlands official grid metadata must document the intentionally null voltage.');

  const selection = metadata?.selection;
  requireCondition(selection?.collection === 'inrichtingselement_lijn', 'Netherlands official grid metadata selection collection is incorrect.');
  requireCondition(selection?.property === 'typeinrichtingselement', 'Netherlands official grid metadata selection property is incorrect.');
  requireCondition(selection?.exact_value === 'hoogspanningsleiding', 'Netherlands official grid metadata selection value must be hoogspanningsleiding.');
  requireCondition(selection?.server_side_attribute_filter === false, 'Netherlands official grid metadata must record that the attribute filter was applied locally.');
  requireCondition(selection?.page_limit === 1000 && selection?.api_maximum_page_limit === 1000, 'Netherlands official grid metadata page limit must be the API maximum of 1,000.');
  requireCondition(selection?.page_count === 844, 'Netherlands official grid metadata must report 844 pages.');
  requireCondition(selection?.cursor_exhausted === true, 'Netherlands official grid metadata must report the overall cursor as exhausted.');

  const partitioning = selection?.spatial_partitioning;
  requireCondition(partitioning?.enabled === true, 'Netherlands official grid spatial partitioning must be enabled.');
  requireCondition(partitioning?.columns === 8 && partitioning?.rows === 8, 'Netherlands official grid metadata must use an 8×8 partition grid.');
  requireCondition(partitioning?.partition_count === 64, 'Netherlands official grid metadata partition_count must be 64.');
  requireCondition(Array.isArray(partitioning?.partitions) && partitioning.partitions.length === 64, 'Netherlands official grid metadata must contain exactly 64 partition records.');
  const partitionKeys = new Set();
  let partitionPageCount = 0;
  let partitionScannedCount = 0;
  let partitionSelectedCount = 0;
  for (const [index, partition] of (partitioning?.partitions ?? []).entries()) {
    const prefix = `Netherlands official grid partition ${index}`;
    requireCondition(Number.isInteger(partition?.row) && partition.row >= 1 && partition.row <= 8, `${prefix} row must be 1 through 8.`);
    requireCondition(Number.isInteger(partition?.column) && partition.column >= 1 && partition.column <= 8, `${prefix} column must be 1 through 8.`);
    const expectedKey = `r${String(partition?.row).padStart(2, '0')}c${String(partition?.column).padStart(2, '0')}`;
    requireCondition(partition?.key === expectedKey, `${prefix} key must match row and column.`);
    requireCondition(!partitionKeys.has(partition?.key), `${prefix} duplicates partition key ${String(partition?.key)}.`);
    if (typeof partition?.key === 'string') partitionKeys.add(partition.key);
    requireCondition(Array.isArray(partition?.bbox) && partition.bbox.length === 4 && partition.bbox.every(isFiniteNumber), `${prefix} bbox must contain four finite numbers.`);
    requireCondition(Number.isInteger(partition?.page_count) && partition.page_count >= 1, `${prefix} page_count must be a positive integer.`);
    requireCondition(Number.isInteger(partition?.scanned_response_record_count) && partition.scanned_response_record_count >= 0, `${prefix} scanned_response_record_count must be non-negative.`);
    requireCondition(Number.isInteger(partition?.target_response_record_count) && partition.target_response_record_count >= 0, `${prefix} target_response_record_count must be non-negative.`);
    requireCondition(partition?.cursor_exhausted === true, `${prefix} cursor must be exhausted without a next link.`);
    requireCondition(partition?.transport === 'curl', `${prefix} transport must be curl.`);
    requireCondition(isSha256(partition?.page_response_digest_sha256), `${prefix} page-response digest must be SHA-256.`);
    partitionPageCount += partition?.page_count ?? 0;
    partitionScannedCount += partition?.scanned_response_record_count ?? 0;
    partitionSelectedCount += partition?.target_response_record_count ?? 0;
  }
  requireCondition(partitionKeys.size === 64, `Netherlands official grid metadata must contain 64 unique partition keys; found ${partitionKeys.size}.`);
  requireCondition(partitionPageCount === 844, `Netherlands official grid partition pages must sum to 844; found ${partitionPageCount}.`);
  requireCondition(partitionScannedCount === 785268, `Netherlands official grid partition scanned records must sum to 785,268; found ${partitionScannedCount}.`);
  requireCondition(partitionSelectedCount === 531, `Netherlands official grid partition selected responses must sum to 531; found ${partitionSelectedCount}.`);

  const statistics = metadata?.statistics;
  requireCondition(statistics?.source_response_records_scanned === 785268, 'Netherlands official grid metadata scanned response count must be 785,268.');
  requireCondition(statistics?.source_type_counts?.hoogspanningsleiding === 531, 'Netherlands official grid metadata source type count for hoogspanningsleiding must be 531.');
  requireCondition(statistics?.selected_response_record_count === 531, 'Netherlands official grid metadata selected response count must be 531.');
  requireCondition(statistics?.selected_feature_count === 496, 'Netherlands official grid metadata selected feature count must be 496.');
  requireCondition(statistics?.duplicate_selected_bbox_records === 35, 'Netherlands official grid metadata duplicate selected response count must be 35.');
  requireCondition(statistics?.selected_response_record_count - statistics?.duplicate_selected_bbox_records === statistics?.selected_feature_count, 'Netherlands official grid selected responses minus duplicate bbox records must equal output features.');
  requireCondition(statistics?.geometry_type_counts?.LineString === 496 && Object.keys(statistics?.geometry_type_counts ?? {}).length === 1, 'Netherlands official grid metadata must report exactly 496 LineStrings.');
  requireSummary(statistics?.output_bounds_crs84, netherlandsGridBounds, 'Netherlands official grid metadata output bounds');

  const verification = metadata?.verification;
  for (const key of [
    'all_partition_cursors_terminated_without_next_link',
    'declared_collection_extent_covered_by_gap_free_bbox_grid',
    'bbox_duplicate_ids_byte_identical',
    'output_json_reparsed',
    'feature_ids_unique',
    'output_below_10_mib',
  ]) {
    requireCondition(verification?.[key] === true, `Netherlands official grid verification.${key} must be true.`);
  }
  requireCondition(verification?.feature_count_verified === 496, 'Netherlands official grid verified feature count must be 496.');
  requireSummary(verification?.bounds_verified, netherlandsGridBounds, 'Netherlands official grid verified bounds');

  requireCondition(metadata?.output?.path === 'data/grid-atlas/netherlands-official-grid.geojson', 'Netherlands official grid metadata output.path is incorrect.');
  requireCondition(metadata?.output?.format === 'RFC 7946 GeoJSON FeatureCollection', 'Netherlands official grid metadata output.format is incorrect.');
  requireCondition(metadata?.output?.feature_count === 496, 'Netherlands official grid metadata output.feature_count must be 496.');
  requireCondition(Number.isInteger(metadata?.output?.size_bytes) && metadata.output.size_bytes > 0 && metadata.output.size_bytes < maxStaticGeoJsonBytes, 'Netherlands official grid metadata output size must be positive and below 10 MiB.');
  requireCondition(isSha256(metadata?.output?.sha256), 'Netherlands official grid metadata output.sha256 must be a SHA-256 digest.');
  requireCondition(metadata?.licence?.name === 'Creative Commons Attribution 4.0 International', 'Netherlands official grid metadata licence name is incorrect.');
  requireCondition(metadata?.licence?.short_name === 'CC BY 4.0', 'Netherlands official grid metadata licence short_name must be CC BY 4.0.');
  requireCondition(metadata?.licence?.attribution_required === true, 'Netherlands official grid metadata must mark attribution as required.');
  requireCondition(metadata?.licence?.commercial_use_permitted === true, 'Netherlands official grid metadata must preserve commercial-use permission.');
  requireCondition(metadata?.licence?.modification_permitted === true, 'Netherlands official grid metadata must preserve modification permission.');
  requireCondition(metadata?.licence?.redistribution_permitted === true, 'Netherlands official grid metadata must preserve redistribution permission.');
  requireCondition(isHttpsUrl(metadata?.licence?.url), 'Netherlands official grid metadata licence URL must use HTTPS.');
  validateRecursiveHttpsUrls(metadata, 'Netherlands official grid metadata');
  validateRecursiveSha256Formats(metadata, 'Netherlands official grid metadata');

  // The registry entry is added by the shared integration step. Once present,
  // these checks turn a bad or mismatched linkage into a validation failure.
  const source = sourceById.get(netherlandsGridSourceId);
  if (source) {
    requireCondition(source.source_class === 'official', `Netherlands official grid source ${netherlandsGridSourceId} must be official.`);
    requireCondition(source.evidence_level === 'reported', `Netherlands official grid source ${netherlandsGridSourceId} must be reported.`);
    requireCondition(Array.isArray(source.regions) && source.regions.includes('europa'), `Netherlands official grid source ${netherlandsGridSourceId} must be registered for europa.`);
    requireCondition(typeof source.publisher === 'string' && /Kadaster/i.test(source.publisher), 'Netherlands official grid registry publisher must name Kadaster.');
    requireCondition(source.integration_status === 'active', 'Netherlands official grid registry source must be active.');
    requireCondition(source.local_asset === 'data/grid-atlas/netherlands-official-grid.geojson', 'Netherlands official grid registry local_asset is incorrect.');
    requireCondition(
      typeof source.licence === 'string'
        && /(?:CC BY|Creative Commons Attribution) 4\.0/i.test(source.licence),
      'Netherlands official grid registry licence must declare Creative Commons Attribution 4.0.',
    );
    requireCondition(isHttpsUrl(source.url), 'Netherlands official grid registry URL must use HTTPS.');
    requireCondition(isHttpsUrl(source.endpoint), 'Netherlands official grid registry endpoint must use HTTPS.');
    requireCondition(isHttpsUrl(source.licence_url), 'Netherlands official grid registry licence_url must use HTTPS.');
    requireCondition(typeof source.redistribution === 'string' && /no (?:geometry )?(?:is )?simplified|without simplification/i.test(source.redistribution), 'Netherlands official grid registry must preserve the no-simplification fact.');
  }
}

function validateKpg193Model(kpg193, sourceById) {
  if (!requireCondition(kpg193?.type === 'FeatureCollection', 'kpg193-model.geojson must be a FeatureCollection.')) return;
  if (!requireCondition(Array.isArray(kpg193.features), 'kpg193-model.geojson must contain a features array.')) return;
  requireCondition(kpg193.features.length === 580, `kpg193-model.geojson must contain exactly 580 features; found ${kpg193.features.length}.`);

  const collectionSource = kpg193.source;
  requireCondition(isObject(collectionSource), 'kpg193-model.geojson must include a source object.');
  const sourceId = collectionSource?.id;
  const sourceCommit = collectionSource?.commit;
  requireCondition(typeof sourceId === 'string' && sourceById.has(sourceId), 'kpg193 source.id must exist in source-registry.json.');
  requireCondition(typeof sourceCommit === 'string' && /^[0-9a-f]{40}$/i.test(sourceCommit), 'kpg193 source.commit must be a 40-character Git commit SHA.');
  requireCondition(isHttpsUrl(collectionSource?.repository), 'kpg193 source.repository must use HTTPS.');
  requireCondition(typeof collectionSource?.licence === 'string' && /\bODbL\b/i.test(collectionSource.licence), 'kpg193 source.licence must declare ODbL.');
  requireCondition(isHttpsUrl(collectionSource?.licence_url), 'kpg193 source.licence_url must use HTTPS.');

  const registrySource = sourceById.get(sourceId);
  if (registrySource) {
    requireCondition(registrySource.evidence_level === 'modelled', `kpg193 source ${sourceId} must be modelled in source-registry.json.`);
    requireCondition(Array.isArray(registrySource.regions) && registrySource.regions.includes('corea-del-sur'), `kpg193 source ${sourceId} must be registered for corea-del-sur.`);
    requireCondition(typeof registrySource.date === 'string' && registrySource.date.includes(sourceCommit), 'kpg193 source.commit must match the commit declared in source-registry.json date.');
    requireCondition(isHttpsUrl(registrySource.url) && registrySource.url.includes(sourceCommit), 'kpg193 source.commit must match the commit pinned in source-registry.json URL.');
  }

  const busCoordinates = new Map();
  const branches = [];
  let busCount = 0;
  let acCount = 0;
  let dcCount = 0;
  for (const [index, feature] of kpg193.features.entries()) {
    const prefix = `kpg193 feature ${index}`;
    requireCondition(feature?.type === 'Feature', `${prefix} must be a GeoJSON Feature.`);
    const properties = feature?.properties;
    requireCondition(isObject(properties), `${prefix} needs properties.`);
    requireCondition(properties?.REGION_KEY === 'corea-del-sur', `${prefix} REGION_KEY must be corea-del-sur.`);
    requireCondition(properties?.EVIDENCE === 'modelled', `${prefix} EVIDENCE must be modelled.`);
    requireCondition(typeof properties?.GEOMETRY_CONFIDENCE === 'string' && properties.GEOMETRY_CONFIDENCE.trim(), `${prefix} needs GEOMETRY_CONFIDENCE.`);
    requireCondition(properties?.SOURCE_ID === sourceId && sourceById.has(properties?.SOURCE_ID), `${prefix} SOURCE_ID must match the registered kpg193 source.`);
    requireCondition(properties?.SOURCE_COMMIT === sourceCommit, `${prefix} SOURCE_COMMIT must match the collection source commit.`);
    requireCondition(isHttpsUrl(properties?.SOURCE_URL), `${prefix} SOURCE_URL must use HTTPS.`);
    requireCondition(isHttpsUrl(properties?.SOURCE_REPOSITORY), `${prefix} SOURCE_REPOSITORY must use HTTPS.`);
    requireCondition(typeof properties?.SOURCE_LICENSE === 'string' && /\bODbL\b/i.test(properties.SOURCE_LICENSE), `${prefix} SOURCE_LICENSE must declare ODbL.`);
    requireCondition(isHttpsUrl(properties?.SOURCE_LICENSE_URL), `${prefix} SOURCE_LICENSE_URL must use HTTPS.`);

    if (properties?.ASSET_KIND === 'model_bus') {
      busCount += 1;
      requireCondition(feature?.geometry?.type === 'Point', `${prefix} model_bus geometry must be a Point.`);
      if (validateCoordinate(feature?.geometry?.coordinates, `${prefix} coordinate`)) {
        const busId = properties?.MODEL_BUS_ID;
        requireCondition(Number.isInteger(busId), `${prefix} MODEL_BUS_ID must be an integer.`);
        requireCondition(!busCoordinates.has(busId), `${prefix} duplicates MODEL_BUS_ID ${busId}.`);
        if (Number.isInteger(busId) && !busCoordinates.has(busId)) busCoordinates.set(busId, feature.geometry.coordinates);
      }
      continue;
    }

    if (properties?.ASSET_KIND === 'model_ac_branch' || properties?.ASSET_KIND === 'model_hvdc_link') {
      if (properties.ASSET_KIND === 'model_ac_branch') acCount += 1;
      else dcCount += 1;
      requireCondition(feature?.geometry?.type === 'LineString', `${prefix} branch geometry must be a LineString.`);
      const coordinates = feature?.geometry?.coordinates;
      requireCondition(Array.isArray(coordinates) && coordinates.length >= 2, `${prefix} branch LineString needs at least two coordinates.`);
      for (const [coordinateIndex, coordinate] of (coordinates ?? []).entries()) {
        validateCoordinate(coordinate, `${prefix} coordinate ${coordinateIndex}`);
      }
      requireCondition(Number.isInteger(properties?.FROM_BUS_ID), `${prefix} FROM_BUS_ID must be an integer.`);
      requireCondition(Number.isInteger(properties?.TO_BUS_ID), `${prefix} TO_BUS_ID must be an integer.`);
      if (properties.ASSET_KIND === 'model_hvdc_link') {
        requireCondition(properties.VOLTAGE_KV === null, `${prefix} model_hvdc_link VOLTAGE_KV must be null.`);
      } else {
        requireCondition(isFiniteNumber(properties.VOLTAGE_KV) && properties.VOLTAGE_KV > 0, `${prefix} model_ac_branch VOLTAGE_KV must be a positive number.`);
      }
      branches.push({ prefix, properties, coordinates });
      continue;
    }

    fail(`${prefix} has unsupported ASSET_KIND ${String(properties?.ASSET_KIND)}.`);
  }

  requireCondition(busCount === 193, `kpg193-model.geojson must contain 193 model_bus features; found ${busCount}.`);
  requireCondition(acCount === 385, `kpg193-model.geojson must contain 385 model_ac_branch features; found ${acCount}.`);
  requireCondition(dcCount === 2, `kpg193-model.geojson must contain 2 model_hvdc_link features; found ${dcCount}.`);
  requireCondition(kpg193.counts?.total_features === kpg193.features.length, 'kpg193 counts.total_features does not match GeoJSON features.');
  requireCondition(kpg193.counts?.model_buses === busCount, 'kpg193 counts.model_buses does not match model_bus features.');
  requireCondition(kpg193.counts?.ac_branches === acCount, 'kpg193 counts.ac_branches does not match model_ac_branch features.');
  requireCondition(kpg193.counts?.dc_lines === dcCount, 'kpg193 counts.dc_lines does not match model_hvdc_link features.');

  let orphanCount = 0;
  for (const branch of branches) {
    const fromCoordinate = busCoordinates.get(branch.properties.FROM_BUS_ID);
    const toCoordinate = busCoordinates.get(branch.properties.TO_BUS_ID);
    if (!fromCoordinate || !toCoordinate) {
      orphanCount += 1;
      fail(`${branch.prefix} references an orphan bus (${branch.properties.FROM_BUS_ID} → ${branch.properties.TO_BUS_ID}).`);
      continue;
    }
    const coordinates = branch.coordinates;
    if (Array.isArray(coordinates) && coordinates.length >= 2) {
      requireCondition(sameNumber(coordinates[0]?.[0], fromCoordinate[0]) && sameNumber(coordinates[0]?.[1], fromCoordinate[1]), `${branch.prefix} first endpoint must match FROM_BUS_ID ${branch.properties.FROM_BUS_ID}.`);
      const lastCoordinate = coordinates[coordinates.length - 1];
      requireCondition(sameNumber(lastCoordinate?.[0], toCoordinate[0]) && sameNumber(lastCoordinate?.[1], toCoordinate[1]), `${branch.prefix} last endpoint must match TO_BUS_ID ${branch.properties.TO_BUS_ID}.`);
    }
  }
  requireCondition(orphanCount === 0, `kpg193-model.geojson must have zero orphan branches; found ${orphanCount}.`);
}

function validateTaiwanDisplay(display, metadata, sourceById) {
  if (!requireCondition(display?.type === 'FeatureCollection', 'taiwan display GeoJSON must be a FeatureCollection.')) return;
  if (!requireCondition(Array.isArray(display.features), 'taiwan display GeoJSON must contain a features array.')) return;
  requireCondition(display.features.length === 5570, `taiwan display must contain exactly 5,570 features; found ${display.features.length}.`);

  let pointCount = 0;
  let minLongitude = Infinity;
  let minLatitude = Infinity;
  let maxLongitude = -Infinity;
  let maxLatitude = -Infinity;
  const taiwanSourceIds = new Set();
  for (const [index, feature] of display.features.entries()) {
    const prefix = `taiwan display feature ${index}`;
    requireCondition(feature?.type === 'Feature', `${prefix} must be a GeoJSON Feature.`);
    requireCondition(feature?.geometry?.type === 'Point', `${prefix} geometry must be a Point.`);
    const coordinate = feature?.geometry?.coordinates;
    if (validateCoordinate(coordinate, `${prefix} coordinate`)) {
      const [longitude, latitude] = coordinate;
      minLongitude = Math.min(minLongitude, longitude);
      minLatitude = Math.min(minLatitude, latitude);
      maxLongitude = Math.max(maxLongitude, longitude);
      maxLatitude = Math.max(maxLatitude, latitude);
    }

    const properties = feature?.properties;
    requireCondition(isObject(properties), `${prefix} needs properties.`);
    for (const field of taiwanDisplayFields) {
      requireCondition(Object.hasOwn(properties ?? {}, field), `${prefix} is missing required field ${field}.`);
    }
    requireCondition(properties?.REGION_KEY === 'taiwan', `${prefix} REGION_KEY must be taiwan.`);
    requireCondition(properties?.ASSET_KIND === 'hosting_cluster', `${prefix} ASSET_KIND must be hosting_cluster.`);
    if (typeof properties?.SOURCE_ID === 'string') taiwanSourceIds.add(properties.SOURCE_ID);
    else fail(`${prefix} SOURCE_ID must be a string.`);
    requireCondition(Number.isInteger(properties?.POINT_COUNT) && properties.POINT_COUNT > 0, `${prefix} POINT_COUNT must be a positive integer.`);
    requireCondition(Number.isInteger(properties?.FEEDER_COUNT) && properties.FEEDER_COUNT >= 0, `${prefix} FEEDER_COUNT must be a non-negative integer.`);
    requireCondition(Number.isInteger(properties?.CAPACITY_REPORTED_COUNT) && properties.CAPACITY_REPORTED_COUNT >= 0, `${prefix} CAPACITY_REPORTED_COUNT must be a non-negative integer.`);
    requireCondition(properties?.CAPACITY_REPORTED_COUNT <= properties?.FEEDER_COUNT, `${prefix} CAPACITY_REPORTED_COUNT cannot exceed FEEDER_COUNT.`);
    for (const field of ['CAPACITY_MIN_KW', 'CAPACITY_MAX_KW', 'CAPACITY_MEAN_KW']) {
      requireCondition(properties?.[field] === null || (isFiniteNumber(properties[field]) && properties[field] >= 0), `${prefix} ${field} must be null or a non-negative finite number.`);
    }
    if (isFiniteNumber(properties?.CAPACITY_MIN_KW) && isFiniteNumber(properties?.CAPACITY_MAX_KW)) {
      requireCondition(properties.CAPACITY_MIN_KW <= properties.CAPACITY_MAX_KW, `${prefix} capacity minimum cannot exceed maximum.`);
    }
    requireCondition(Array.isArray(properties?.SOURCE_AREAS) && properties.SOURCE_AREAS.length > 0 && properties.SOURCE_AREAS.every((area) => typeof area === 'string' && area.trim()), `${prefix} SOURCE_AREAS must be a non-empty string array.`);
    requireCondition(typeof properties?.SOURCE_DATE === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(properties.SOURCE_DATE), `${prefix} SOURCE_DATE must be ISO YYYY-MM-DD.`);
    requireCondition(isHttpsUrl(properties?.SOURCE_URL), `${prefix} SOURCE_URL must use HTTPS.`);
    requireCondition(typeof properties?.SOURCE_LICENSE === 'string' && properties.SOURCE_LICENSE.trim(), `${prefix} needs SOURCE_LICENSE.`);
    requireCondition(properties?.EVIDENCE === 'reported', `${prefix} EVIDENCE must be reported.`);
    requireCondition(typeof properties?.GEOMETRY_CONFIDENCE === 'string' && properties.GEOMETRY_CONFIDENCE.trim(), `${prefix} needs GEOMETRY_CONFIDENCE.`);
    pointCount += properties?.POINT_COUNT ?? 0;
  }

  for (const sourceId of taiwanSourceIds) {
    const source = sourceById.get(sourceId);
    requireCondition(Boolean(source), `taiwan display SOURCE_ID ${sourceId} must exist in source-registry.json.`);
    if (source) {
      requireCondition(source.evidence_level === 'reported', `taiwan display SOURCE_ID ${sourceId} must reference a reported source.`);
      requireCondition(Array.isArray(source.regions) && source.regions.includes('taiwan'), `taiwan display SOURCE_ID ${sourceId} is not registered for taiwan.`);
    }
  }

  requireCondition(pointCount === 505791, `taiwan display POINT_COUNT sum must be 505,791; found ${pointCount}.`);

  const aggregation = metadata?.aggregation;
  const statistics = metadata?.statistics;
  const displayOutput = metadata?.display_output;
  requireCondition(isObject(aggregation) && isObject(statistics) && isObject(displayOutput), 'taiwan metadata must include aggregation, statistics and display_output objects.');
  if (aggregation && statistics && displayOutput) {
    requireCondition(aggregation.output_cell_count === 5570, 'taiwan metadata aggregation.output_cell_count must be 5,570.');
    requireCondition(aggregation.aggregated_point_count === 505791, 'taiwan metadata aggregation.aggregated_point_count must be 505,791.');
    requireCondition(statistics.feature_count === 505795, 'taiwan metadata statistics.feature_count must be 505,795.');
    requireCondition(statistics.valid_geometry_count === 505791, 'taiwan metadata statistics.valid_geometry_count must be 505,791.');
    requireCondition(displayOutput.feature_count === display.features.length, 'taiwan metadata display_output.feature_count does not match GeoJSON.');
    requireCondition(displayOutput.source_row_count === statistics.feature_count, 'taiwan metadata display_output.source_row_count does not match statistics.feature_count.');
    requireCondition(displayOutput.aggregated_valid_point_count === pointCount, 'taiwan metadata display_output.aggregated_valid_point_count does not match POINT_COUNT sum.');
    requireCondition(displayOutput.invalid_geometry_excluded_count === statistics.invalid_geometry_count, 'taiwan metadata invalid geometry count is inconsistent.');

    const bounds = aggregation.centroid_bounds;
    if (isObject(bounds)) {
      requireCondition(sameNumber(minLongitude, bounds.min_longitude), `taiwan display minimum longitude ${minLongitude} does not match metadata.`);
      requireCondition(sameNumber(minLatitude, bounds.min_latitude), `taiwan display minimum latitude ${minLatitude} does not match metadata.`);
      requireCondition(sameNumber(maxLongitude, bounds.max_longitude), `taiwan display maximum longitude ${maxLongitude} does not match metadata.`);
      requireCondition(sameNumber(maxLatitude, bounds.max_latitude), `taiwan display maximum latitude ${maxLatitude} does not match metadata.`);
    } else {
      fail('taiwan metadata aggregation.centroid_bounds is required.');
    }
  }
}

function validateEiaPlants(plants, metadata, sourceById) {
  if (!requireCondition(plants?.type === 'FeatureCollection', 'EIA plant GeoJSON must be a FeatureCollection.')) return;
  if (!requireCondition(Array.isArray(plants.features), 'EIA plant GeoJSON must contain a features array.')) return;
  requireCondition(plants.features.length === 15764, `EIA plant GeoJSON must contain exactly 15,764 features; found ${plants.features.length}.`);

  const plantIds = new Set();
  let currentPlantCount = 0;
  let plannedPlantCount = 0;
  let currentGeneratorRows = 0;
  let plannedGeneratorRows = 0;
  let coordinateConflictPlants = 0;

  for (const [index, feature] of plants.features.entries()) {
    const prefix = `EIA plant feature ${index}`;
    requireCondition(feature?.type === 'Feature', `${prefix} must be a GeoJSON Feature.`);
    requireCondition(feature?.geometry?.type === 'Point', `${prefix} geometry must be a Point.`);
    if (validateCoordinate(feature?.geometry?.coordinates, `${prefix} coordinate`)) {
      const [longitude, latitude] = feature.geometry.coordinates;
      requireCondition(longitude >= -125 && longitude <= -66, `${prefix} longitude is outside the declared CONUS bounds.`);
      requireCondition(latitude >= 24 && latitude <= 50, `${prefix} latitude is outside the declared CONUS bounds.`);
    }

    const properties = feature?.properties;
    if (!requireCondition(isObject(properties), `${prefix} needs properties.`)) continue;
    for (const key of Object.keys(properties)) {
      requireCondition(eiaPropertyFields.has(key), `${prefix} contains undocumented property ${key}.`);
    }
    for (const key of ['src', 'i', 'n', 'st', 'cu', 'pu', 'cv', 'sp', 'rd', 'url', 'lic', 'ev', 'gc']) {
      requireCondition(Object.hasOwn(properties, key), `${prefix} is missing required property ${key}.`);
    }

    requireCondition(properties.src === 'us-eia860m-2026-06', `${prefix} src must be us-eia860m-2026-06.`);
    requireCondition(Number.isInteger(properties.i), `${prefix} i must be an integer Plant ID.`);
    requireCondition(!plantIds.has(properties.i), `${prefix} duplicates Plant ID ${properties.i}.`);
    if (Number.isInteger(properties.i)) plantIds.add(properties.i);
    requireCondition(typeof properties.n === 'string' && properties.n.trim(), `${prefix} n must be a non-empty plant name.`);
    requireCondition(typeof properties.st === 'string' && /^[A-Z]{2}$/.test(properties.st), `${prefix} st must be a two-letter state code.`);
    requireCondition(!['AK', 'HI', 'PR'].includes(properties.st), `${prefix} contains excluded state ${properties.st}.`);
    requireCondition(Number.isInteger(properties.cu) && properties.cu >= 0, `${prefix} cu must be a non-negative integer.`);
    requireCondition(Number.isInteger(properties.pu) && properties.pu >= 0, `${prefix} pu must be a non-negative integer.`);
    requireCondition(properties.cu + properties.pu > 0, `${prefix} must have at least one current or planned generator row.`);
    requireCondition(Number.isInteger(properties.cv) && properties.cv >= 1, `${prefix} cv must be a positive integer.`);
    requireCondition(properties.sp === '2026-06', `${prefix} sp must be 2026-06.`);
    requireCondition(properties.rd === '2026-07-23', `${prefix} rd must be 2026-07-23.`);
    requireCondition(isHttpsUrl(properties.url), `${prefix} url must use HTTPS.`);
    requireCondition(typeof properties.lic === 'string' && /public domain/i.test(properties.lic), `${prefix} lic must declare public-domain reuse.`);
    requireCondition(properties.ev === 'reported-preliminary', `${prefix} ev must be reported-preliminary.`);
    requireCondition(typeof properties.gc === 'string' && properties.gc.trim(), `${prefix} gc must be a non-empty geometry confidence.`);

    if (properties.cu > 0) currentPlantCount += 1;
    if (properties.pu > 0) plannedPlantCount += 1;
    currentGeneratorRows += properties.cu ?? 0;
    plannedGeneratorRows += properties.pu ?? 0;
    if (properties.cv > 1) coordinateConflictPlants += 1;
  }

  const source = sourceById.get('us-eia860m-2026-06');
  requireCondition(Boolean(source), 'EIA source must exist in source-registry.json.');
  if (source) {
    requireCondition(source.evidence_level === 'reported', 'EIA source must be reported in source-registry.json.');
    requireCondition(Array.isArray(source.regions) && source.regions.includes('estados-unidos'), 'EIA source must be registered for estados-unidos.');
  }

  requireCondition(currentPlantCount === 14325, `EIA current-plant count must be 14,325; found ${currentPlantCount}.`);
  requireCondition(plannedPlantCount === 1535, `EIA planned-plant count must be 1,535; found ${plannedPlantCount}.`);
  requireCondition(currentGeneratorRows === 27427, `EIA current generator-row sum must be 27,427; found ${currentGeneratorRows}.`);
  requireCondition(plannedGeneratorRows === 2267, `EIA planned generator-row sum must be 2,267; found ${plannedGeneratorRows}.`);
  requireCondition(coordinateConflictPlants === 0, `EIA coordinate-conflict count must be zero; found ${coordinateConflictPlants}.`);

  const counts = metadata?.counts;
  requireCondition(isObject(counts), 'EIA metadata counts object is required.');
  if (counts) {
    requireCondition(counts.plant_features === plants.features.length, 'EIA metadata plant_features does not match GeoJSON.');
    requireCondition(counts.plants_with_current_units === currentPlantCount, 'EIA metadata current-plant count does not match GeoJSON.');
    requireCondition(counts.plants_with_planned_units === plannedPlantCount, 'EIA metadata planned-plant count does not match GeoJSON.');
    requireCondition(counts.current_generator_rows === currentGeneratorRows, 'EIA metadata current-generator count does not match GeoJSON.');
    requireCondition(counts.planned_generator_rows === plannedGeneratorRows, 'EIA metadata planned-generator count does not match GeoJSON.');
    requireCondition(counts.coordinate_conflict_plants === coordinateConflictPlants, 'EIA metadata coordinate-conflict count does not match GeoJSON.');
  }
  requireCondition(metadata?.source?.id === 'us-eia860m-2026-06', 'EIA metadata source id is incorrect.');
  requireCondition(metadata?.source?.source_sha256 === '47d28a1e5599135b619d249971f35f03fef8a5b3062c2d66c436b55e8f8c3072', 'EIA source-workbook SHA-256 is incorrect.');
}

function validateChinaHvdcInventory(inventory, metadata, sourceById) {
  if (!requireCondition(isObject(inventory), 'china-nea-hvdc-systems.json must contain an object.')) return;
  requireCondition(inventory.schema_version === '1.0.0', 'China HVDC schema_version must be 1.0.0.');
  requireCondition(inventory.dataset_id === 'cn-nea-reliability-2024-hvdc-systems', 'China HVDC dataset_id is incorrect.');
  requireCondition(inventory.source?.id === chinaHvdcSourceId, `China HVDC source.id must be ${chinaHvdcSourceId}.`);
  requireCondition(inventory.source?.pdf_sha256 === 'af0c088a6c25511ec9fa9f758af374c5a22d0002e2c507a9450f2d64c85e5e95', 'China HVDC source PDF SHA-256 is incorrect.');
  requireCondition(
    Array.isArray(inventory.supplemental_sources)
      && inventory.supplemental_sources.length === 1
      && inventory.supplemental_sources[0]?.id === chinaHvdcSupplementalSourceId,
    `China HVDC supplemental source must be exactly ${chinaHvdcSupplementalSourceId}.`,
  );
  validateRecursiveHttpsUrls(inventory, 'China HVDC inventory');
  validateRecursiveSha256Formats(inventory, 'China HVDC inventory');
  rejectGeographicPayload(inventory, 'China HVDC inventory');

  if (!requireCondition(Array.isArray(inventory.systems), 'China HVDC inventory must contain a systems array.')) return;
  requireCondition(inventory.systems.length === 51, `China HVDC inventory must contain exactly 51 systems; found ${inventory.systems.length}.`);

  const calculatedByType = Object.fromEntries(
    Object.keys(chinaHvdcExpectedSummary).map((key) => [key, {
      system_count: 0,
      rated_transfer_capacity_mw: 0,
      line_length_km: 0,
    }]),
  );
  const calculatedTotal = {
    system_count: 0,
    rated_transfer_capacity_mw: 0,
    line_length_km: 0,
  };
  let terminalSystemCount = 0;
  let terminalCount = 0;
  const sequences = new Set();

  for (const [index, system] of inventory.systems.entries()) {
    const prefix = `China HVDC system ${index}`;
    if (!requireCondition(isObject(system), `${prefix} must be an object.`)) continue;
    const sequence = system.nea_sequence;
    requireCondition(Number.isInteger(sequence) && sequence >= 1 && sequence <= 51, `${prefix} nea_sequence must be an integer from 1 to 51.`);
    requireCondition(!sequences.has(sequence), `${prefix} duplicates nea_sequence ${String(sequence)}.`);
    if (Number.isInteger(sequence)) sequences.add(sequence);
    requireCondition(sequence === index + 1, `${prefix} must preserve NEA sequence ${index + 1}.`);
    requireCondition(typeof system.system_name_zh === 'string' && system.system_name_zh.trim(), `${prefix} needs system_name_zh.`);

    const expectedType = chinaHvdcExpectedSummary[system.system_type];
    requireCondition(Boolean(expectedType), `${prefix} has unsupported system_type ${String(system.system_type)}.`);
    requireCondition(typeof system.system_type_zh === 'string' && system.system_type_zh.trim(), `${prefix} needs system_type_zh.`);
    requireCondition(isFiniteNumber(system.rated_transfer_capacity_mw) && system.rated_transfer_capacity_mw > 0, `${prefix} rated_transfer_capacity_mw must be positive.`);
    requireCondition(isFiniteNumber(system.line_length_km) && system.line_length_km >= 0, `${prefix} line_length_km must be non-negative.`);
    requireCondition(Array.isArray(system.grid_groups) && system.grid_groups.length > 0 && system.grid_groups.every((group) => typeof group === 'string' && group.trim()), `${prefix} grid_groups must be a non-empty string array.`);
    requireCondition(['reported_system_total', 'sum_of_reported_unit_ratings'].includes(system.capacity_basis), `${prefix} has unsupported capacity_basis.`);

    if (expectedType) {
      calculatedByType[system.system_type].system_count += 1;
      calculatedByType[system.system_type].rated_transfer_capacity_mw += system.rated_transfer_capacity_mw;
      calculatedByType[system.system_type].line_length_km += system.line_length_km;
    }
    calculatedTotal.system_count += 1;
    calculatedTotal.rated_transfer_capacity_mw += system.rated_transfer_capacity_mw ?? 0;
    calculatedTotal.line_length_km += system.line_length_km ?? 0;
    if (system.system_type === 'back_to_back') requireCondition(system.line_length_km === 0, `${prefix} back-to-back line_length_km must be zero.`);
    else requireCondition(system.line_length_km > 0, `${prefix} non-back-to-back line_length_km must be positive.`);

    if (system.rated_voltage !== undefined) validateVoltage(system.rated_voltage, `${prefix} rated_voltage`);
    requireCondition(Array.isArray(system.units) && system.units.length > 0, `${prefix} must contain at least one unit.`);
    let unitCapacityTotal = 0;
    for (const [unitIndex, unit] of (system.units ?? []).entries()) {
      const unitPrefix = `${prefix} unit ${unitIndex}`;
      requireCondition(isObject(unit), `${unitPrefix} must be an object.`);
      requireCondition(typeof unit?.label_zh === 'string' && unit.label_zh.trim(), `${unitPrefix} needs label_zh.`);
      if (unit?.commissioned_on !== undefined) requireCondition(isIsoDate(unit.commissioned_on), `${unitPrefix} commissioned_on must be ISO YYYY-MM-DD.`);
      if (unit?.rated_voltage !== undefined) validateVoltage(unit.rated_voltage, `${unitPrefix} rated_voltage`);
      if (unit?.rated_transfer_capacity_mw !== undefined) {
        requireCondition(isFiniteNumber(unit.rated_transfer_capacity_mw) && unit.rated_transfer_capacity_mw > 0, `${unitPrefix} rated_transfer_capacity_mw must be positive.`);
        unitCapacityTotal += unit.rated_transfer_capacity_mw;
      }
    }
    if (system.capacity_basis === 'sum_of_reported_unit_ratings') {
      requireCondition(unitCapacityTotal === system.rated_transfer_capacity_mw, `${prefix} unit capacity sum must match the system total.`);
    }
    for (const [eventIndex, commissioningEvent] of (system.commissioning_events ?? []).entries()) {
      requireCondition(isIsoDate(commissioningEvent?.commissioned_on), `${prefix} commissioning event ${eventIndex} must use ISO YYYY-MM-DD.`);
      requireCondition(typeof commissioningEvent?.scope_zh === 'string' && commissioningEvent.scope_zh.trim(), `${prefix} commissioning event ${eventIndex} needs scope_zh.`);
    }

    requireCondition(system.source_ref?.source_id === chinaHvdcSourceId, `${prefix} source_ref.source_id must be ${chinaHvdcSourceId}.`);
    requireCondition(system.source_ref?.table === '4-1', `${prefix} source_ref.table must be 4-1.`);
    requireCondition(Number.isInteger(system.source_ref?.physical_pdf_page), `${prefix} needs a physical PDF page reference.`);
    requireCondition(Number.isInteger(system.source_ref?.printed_report_page), `${prefix} needs a printed report page reference.`);

    requireCondition(Array.isArray(system.terminals), `${prefix} terminals must be an array.`);
    const expectedTerminalCount = sequence <= 37 ? 2 : 0;
    requireCondition(system.terminals?.length === expectedTerminalCount, `${prefix} must contain exactly ${expectedTerminalCount} verified terminal names.`);
    if (system.terminals?.length) terminalSystemCount += 1;
    terminalCount += system.terminals?.length ?? 0;
    for (const [terminalIndex, terminal] of (system.terminals ?? []).entries()) {
      const terminalPrefix = `${prefix} terminal ${terminalIndex}`;
      requireCondition(terminal?.terminal_index === terminalIndex + 1, `${terminalPrefix} terminal_index is incorrect.`);
      requireCondition(typeof terminal?.station_name_zh === 'string' && terminal.station_name_zh.trim(), `${terminalPrefix} needs station_name_zh.`);
      const expectedTerminalSource = sequence === 18 ? chinaHvdcSupplementalSourceId : chinaHvdcSourceId;
      requireCondition(terminal?.source_ref?.source_id === expectedTerminalSource, `${terminalPrefix} source_ref.source_id must be ${expectedTerminalSource}.`);
    }
  }

  requireCondition(sequences.size === 51, `China HVDC inventory must contain 51 unique NEA sequences; found ${sequences.size}.`);
  for (const [type, expected] of Object.entries(chinaHvdcExpectedSummary)) {
    requireSummary(calculatedByType[type], expected, `China HVDC calculated ${type}`);
    requireSummary(inventory.summary?.by_system_type?.[type], expected, `China HVDC summary ${type}`);
    requireSummary(metadata?.coverage?.by_system_type?.[type], expected, `China HVDC metadata coverage ${type}`);
  }
  requireSummary(calculatedTotal, chinaHvdcExpectedTotal, 'China HVDC calculated total');
  requireSummary(inventory.summary?.total, chinaHvdcExpectedTotal, 'China HVDC summary total');
  requireSummary(metadata?.coverage, chinaHvdcExpectedTotal, 'China HVDC metadata coverage');
  requireCondition(terminalSystemCount === 37, `China HVDC terminal coverage must include 37 systems; found ${terminalSystemCount}.`);
  requireCondition(terminalCount === 74, `China HVDC inventory must contain 74 verified terminal names; found ${terminalCount}.`);

  requireCondition(metadata?.schema_version === inventory.schema_version, 'China HVDC metadata schema_version must match the inventory.');
  requireCondition(metadata?.dataset_id === inventory.dataset_id, 'China HVDC metadata dataset_id must match the inventory.');
  requireCondition(metadata?.source?.id === chinaHvdcSourceId, `China HVDC metadata source.id must be ${chinaHvdcSourceId}.`);
  requireCondition(metadata?.source?.pdf_sha256 === inventory.source?.pdf_sha256, 'China HVDC metadata PDF SHA-256 must match the inventory.');
  requireCondition(metadata?.supplemental_sources?.length === 1 && metadata.supplemental_sources[0]?.id === chinaHvdcSupplementalSourceId, 'China HVDC metadata supplemental source is incorrect.');
  requireCondition(metadata?.coverage?.systems_with_verified_terminal_names === 37, 'China HVDC metadata must report 37 systems with terminal names.');
  requireCondition(metadata?.coverage?.verified_terminal_names === 74, 'China HVDC metadata must report 74 terminal names.');
  requireCondition(metadata?.coverage?.systems_without_inferred_geometry === 51, 'China HVDC metadata must report 51 systems without inferred geometry.');
  requireCondition(metadata?.output?.path === 'data/grid-atlas/china-nea-hvdc-systems.json', 'China HVDC metadata output.path is incorrect.');
  requireCondition(isSha256(metadata?.output?.sha256), 'China HVDC metadata output.sha256 must be a SHA-256 digest.');
  validateRecursiveHttpsUrls(metadata, 'China HVDC metadata');
  validateRecursiveSha256Formats(metadata, 'China HVDC metadata');

  const source = sourceById.get(chinaHvdcSourceId);
  requireCondition(Boolean(source), `China HVDC source ${chinaHvdcSourceId} must exist in source-registry.json.`);
  if (source) {
    requireCondition(source.source_class === 'official', `China HVDC source ${chinaHvdcSourceId} must be official.`);
    requireCondition(source.evidence_level === 'reported', `China HVDC source ${chinaHvdcSourceId} must be reported.`);
    requireCondition(Array.isArray(source.regions) && source.regions.includes('china'), `China HVDC source ${chinaHvdcSourceId} must be registered for china.`);
    requireCondition(isHttpsUrl(source.url), `China HVDC registry source ${chinaHvdcSourceId} must use HTTPS.`);
  }
}

function validateKepcoProjectInventory(inventory, metadata, sourceById) {
  if (!requireCondition(isObject(inventory), 'kepco-transmission-projects.json must contain an object.')) return;
  requireCondition(inventory.schema_version === 1, 'KEPCO project schema_version must be 1.');
  requireCondition(inventory.source_id === kepcoSourceId, `KEPCO project source_id must be ${kepcoSourceId}.`);
  requireCondition(inventory.dashboard_reported_total === 849, 'KEPCO dashboard_reported_total must be 849.');
  requireCondition(inventory.listed_record_total === 848, 'KEPCO listed_record_total must be 848.');
  requireCondition(inventory.contains_geometry === false, 'KEPCO inventory contains_geometry must be false.');
  validateRecursiveHttpsUrls(inventory, 'KEPCO project inventory');
  rejectGeographicPayload(inventory, 'KEPCO project inventory');

  if (!requireCondition(Array.isArray(inventory.projects), 'KEPCO inventory must contain a projects array.')) return;
  requireCondition(inventory.projects.length === 848, `KEPCO inventory must contain exactly 848 listed projects; found ${inventory.projects.length}.`);

  const stageCounts = Object.fromEntries(Object.keys(kepcoExpectedStages).map((key) => [key, 0]));
  const listNumbersByStage = new Map(Object.keys(kepcoExpectedStages).map((key) => [key, new Set()]));
  const sourceRecordIds = new Set();
  let recordsWithVoltage = 0;
  let recordsWithoutVoltage = 0;
  let recordsWithMultipleVoltages = 0;

  for (const [index, project] of inventory.projects.entries()) {
    const prefix = `KEPCO project ${index}`;
    if (!requireCondition(isObject(project), `${prefix} must be an object.`)) continue;
    for (const key of Object.keys(project)) requireCondition(kepcoProjectFields.has(key), `${prefix} contains undocumented field ${key}.`);
    for (const key of kepcoProjectFields) requireCondition(Object.hasOwn(project, key), `${prefix} is missing required field ${key}.`);

    const expectedStage = kepcoExpectedStages[project.stage];
    requireCondition(Boolean(expectedStage), `${prefix} has unsupported stage ${String(project.stage)}.`);
    if (expectedStage) {
      stageCounts[project.stage] += 1;
      requireCondition(project.stage_label_ko === expectedStage.label, `${prefix} stage_label_ko does not match ${project.stage}.`);
      requireCondition(project.board_mng_no === expectedStage.boardManagementNumber, `${prefix} board_mng_no does not match ${project.stage}.`);
      requireCondition(Number.isInteger(project.source_list_page) && project.source_list_page >= 1 && project.source_list_page <= expectedStage.pageCount, `${prefix} source_list_page is outside the stage page range.`);
      requireCondition(project.source_list_url === `${expectedStage.listUrl}?page=${project.source_list_page}`, `${prefix} source_list_url does not match its stage and page.`);
      requireCondition(project.source_detail_url === `${expectedStage.detailUrl}?boardMngNo=${project.board_mng_no}&boardNo=${project.board_no}`, `${prefix} source_detail_url does not match its record identifiers.`);
      const listNumbers = listNumbersByStage.get(project.stage);
      requireCondition(!listNumbers.has(project.list_number), `${prefix} duplicates list_number ${String(project.list_number)} within ${project.stage}.`);
      if (Number.isInteger(project.list_number)) listNumbers.add(project.list_number);
    }

    requireCondition(Number.isInteger(project.board_no) && project.board_no > 0, `${prefix} board_no must be a positive integer.`);
    requireCondition(Number.isInteger(project.list_number) && project.list_number > 0, `${prefix} list_number must be a positive integer.`);
    requireCondition(project.source_record_id === `${project.board_mng_no}:${project.board_no}`, `${prefix} source_record_id must match board_mng_no and board_no.`);
    requireCondition(!sourceRecordIds.has(project.source_record_id), `${prefix} duplicates source_record_id ${String(project.source_record_id)}.`);
    if (typeof project.source_record_id === 'string') sourceRecordIds.add(project.source_record_id);
    for (const key of ['project_name', 'facility_type', 'responsible_headquarters', 'responsible_office']) {
      requireCondition(typeof project[key] === 'string' && project[key].trim(), `${prefix} ${key} must be a non-empty string.`);
    }
    requireCondition(Array.isArray(project.voltage_kv_values), `${prefix} voltage_kv_values must be an array.`);
    requireCondition((project.voltage_kv_values ?? []).every((voltage) => isFiniteNumber(voltage) && voltage > 0), `${prefix} voltage_kv_values must contain only positive numbers.`);
    requireCondition(new Set(project.voltage_kv_values ?? []).size === (project.voltage_kv_values ?? []).length, `${prefix} voltage_kv_values must be unique.`);
    if (project.voltage_kv === null) {
      recordsWithoutVoltage += 1;
      requireCondition(project.voltage_kv_values?.length === 0, `${prefix} null voltage_kv requires an empty voltage_kv_values array.`);
      requireCondition(project.voltage_source === null, `${prefix} null voltage_kv requires null voltage_source.`);
    } else {
      recordsWithVoltage += 1;
      requireCondition(isFiniteNumber(project.voltage_kv) && project.voltage_kv > 0, `${prefix} voltage_kv must be positive or null.`);
      requireCondition(project.voltage_kv_values?.[0] === project.voltage_kv, `${prefix} voltage_kv must equal the first voltage_kv_values entry.`);
      requireCondition(project.voltage_source === 'project_name', `${prefix} non-null voltage must come from project_name.`);
      if ((project.voltage_kv_values?.length ?? 0) > 1) recordsWithMultipleVoltages += 1;
    }
  }

  requireCondition(sourceRecordIds.size === 848, `KEPCO inventory must contain 848 unique source_record_id values; found ${sourceRecordIds.size}.`);
  for (const [stage, expected] of Object.entries(kepcoExpectedStages)) {
    requireCondition(stageCounts[stage] === expected.listedCount, `KEPCO stage ${stage} must contain ${expected.listedCount} projects; found ${stageCounts[stage]}.`);
    const listNumbers = listNumbersByStage.get(stage);
    requireCondition(listNumbers.size === expected.listedCount, `KEPCO stage ${stage} must contain ${expected.listedCount} unique list numbers.`);
    for (let listNumber = 1; listNumber <= expected.listedCount; listNumber += 1) {
      if (!listNumbers.has(listNumber)) {
        fail(`KEPCO stage ${stage} is missing list_number ${listNumber}.`);
        break;
      }
    }
  }
  requireCondition(recordsWithVoltage === 836, `KEPCO inventory must contain 836 records with explicit title voltage; found ${recordsWithVoltage}.`);
  requireCondition(recordsWithoutVoltage === 12, `KEPCO inventory must contain 12 records without explicit title voltage; found ${recordsWithoutVoltage}.`);
  requireCondition(recordsWithMultipleVoltages === 0, `KEPCO inventory must contain zero records with multiple title voltages; found ${recordsWithMultipleVoltages}.`);

  requireCondition(metadata?.schema_version === inventory.schema_version, 'KEPCO metadata schema_version must match the inventory.');
  requireCondition(metadata?.source?.id === kepcoSourceId, `KEPCO metadata source.id must be ${kepcoSourceId}.`);
  requireCondition(metadata?.built_at === inventory.snapshot_built_at, 'KEPCO metadata built_at must match snapshot_built_at.');
  requireCondition(metadata?.source?.publisher === inventory.publisher, 'KEPCO metadata publisher must match the inventory.');
  requireCondition(metadata?.output?.path === 'data/grid-atlas/kepco-transmission-projects.json', 'KEPCO metadata output.path is incorrect.');
  requireCondition(metadata?.output?.contains_geometry === false, 'KEPCO metadata output.contains_geometry must be false.');
  requireCondition(metadata?.counts?.project_records === 848, 'KEPCO metadata counts.project_records must be 848.');
  requireCondition(metadata?.counts?.unique_source_record_ids === 848, 'KEPCO metadata unique source-record count must be 848.');
  requireCondition(metadata?.counts?.records_with_explicit_title_voltage === recordsWithVoltage, 'KEPCO metadata explicit-voltage count does not match the inventory.');
  requireCondition(metadata?.counts?.records_without_explicit_title_voltage === recordsWithoutVoltage, 'KEPCO metadata missing-voltage count does not match the inventory.');
  requireCondition(metadata?.counts?.records_with_multiple_explicit_title_voltages === recordsWithMultipleVoltages, 'KEPCO metadata multiple-voltage count does not match the inventory.');
  requireCondition(metadata?.count_reconciliation?.dashboard_reported_total === 849, 'KEPCO metadata dashboard total must be 849.');
  requireCondition(metadata?.count_reconciliation?.stage_list_total === 848, 'KEPCO metadata stage-list total must be 848.');
  requireCondition(metadata?.count_reconciliation?.dashboard_minus_list_total === 1, 'KEPCO metadata dashboard/list difference must be 1.');
  requireCondition(metadata?.count_reconciliation?.reconciled === false, 'KEPCO metadata must preserve the unreconciled one-record dashboard/list mismatch.');
  requireCondition(metadata?.snapshot?.dashboard_stable_during_collection === true, 'KEPCO metadata dashboard snapshot must be stable during collection.');
  requireCondition(metadata?.snapshot?.stage_first_pages_stable_during_collection === true, 'KEPCO metadata stage first pages must be stable during collection.');
  requireCondition(Array.isArray(metadata?.snapshot?.unstable_reasons) && metadata.snapshot.unstable_reasons.length === 0, 'KEPCO metadata must have no unstable snapshot reasons.');

  requireCondition(Array.isArray(metadata?.stages) && metadata.stages.length === 4, 'KEPCO metadata must contain exactly four stages.');
  const metadataStageKeys = new Set();
  for (const stageMetadata of metadata?.stages ?? []) {
    const expected = kepcoExpectedStages[stageMetadata?.key];
    requireCondition(Boolean(expected), `KEPCO metadata has unsupported stage ${String(stageMetadata?.key)}.`);
    if (!expected) continue;
    metadataStageKeys.add(stageMetadata.key);
    requireCondition(stageMetadata.label_ko === expected.label, `KEPCO metadata stage ${stageMetadata.key} label is incorrect.`);
    requireCondition(stageMetadata.menu_number === expected.menuNumber, `KEPCO metadata stage ${stageMetadata.key} menu_number is incorrect.`);
    requireCondition(stageMetadata.board_mng_no === expected.boardManagementNumber, `KEPCO metadata stage ${stageMetadata.key} board_mng_no is incorrect.`);
    requireCondition(stageMetadata.list_url === expected.listUrl, `KEPCO metadata stage ${stageMetadata.key} list_url is incorrect.`);
    requireCondition(stageMetadata.detail_url === expected.detailUrl, `KEPCO metadata stage ${stageMetadata.key} detail_url is incorrect.`);
    requireCondition(stageMetadata.dashboard_count_before === expected.dashboardCount, `KEPCO metadata stage ${stageMetadata.key} dashboard count is incorrect.`);
    requireCondition(stageMetadata.listed_count === expected.listedCount, `KEPCO metadata stage ${stageMetadata.key} listed_count is incorrect.`);
    requireCondition(stageMetadata.row_count === expected.listedCount, `KEPCO metadata stage ${stageMetadata.key} row_count is incorrect.`);
    requireCondition(stageMetadata.page_count === expected.pageCount, `KEPCO metadata stage ${stageMetadata.key} page_count is incorrect.`);
    requireCondition(Array.isArray(stageMetadata.pages) && stageMetadata.pages.length === expected.pageCount, `KEPCO metadata stage ${stageMetadata.key} must contain ${expected.pageCount} page records.`);
    let pageRowTotal = 0;
    for (const [pageIndex, pageMetadata] of (stageMetadata.pages ?? []).entries()) {
      requireCondition(pageMetadata?.page === pageIndex + 1, `KEPCO metadata stage ${stageMetadata.key} page order is incorrect at index ${pageIndex}.`);
      requireCondition(pageMetadata?.requested_url === `${expected.listUrl}?page=${pageIndex + 1}`, `KEPCO metadata stage ${stageMetadata.key} page ${pageIndex + 1} requested_url is incorrect.`);
      requireCondition(pageMetadata?.response_url === `${expected.listUrl}?page=${pageIndex + 1}`, `KEPCO metadata stage ${stageMetadata.key} page ${pageIndex + 1} response_url is incorrect.`);
      requireCondition(Number.isInteger(pageMetadata?.row_count) && pageMetadata.row_count > 0 && pageMetadata.row_count <= 10, `KEPCO metadata stage ${stageMetadata.key} page ${pageIndex + 1} row_count must be 1 through 10.`);
      pageRowTotal += pageMetadata?.row_count ?? 0;
    }
    requireCondition(pageRowTotal === expected.listedCount, `KEPCO metadata stage ${stageMetadata.key} page row total must be ${expected.listedCount}; found ${pageRowTotal}.`);
    requireCondition(stageMetadata.validation?.displayed_list_numbers_complete === true, `KEPCO metadata stage ${stageMetadata.key} list numbers must be complete.`);
    requireCondition(stageMetadata.validation?.displayed_list_numbers_unique === true, `KEPCO metadata stage ${stageMetadata.key} list numbers must be unique.`);
    requireCondition(stageMetadata.validation?.source_record_ids_unique_within_stage === true, `KEPCO metadata stage ${stageMetadata.key} source IDs must be unique.`);
    requireCondition(stageMetadata.validation?.required_public_list_fields_present === true, `KEPCO metadata stage ${stageMetadata.key} required fields must be present.`);
    requireCondition(stageMetadata.validation?.first_page_stable_during_collection === true, `KEPCO metadata stage ${stageMetadata.key} first page must be stable.`);
  }
  requireCondition(metadataStageKeys.size === 4, `KEPCO metadata must contain four unique stage keys; found ${metadataStageKeys.size}.`);

  for (const [stage, expected] of Object.entries(kepcoExpectedStages)) {
    requireCondition(metadata?.counts?.by_stage?.[stage] === expected.listedCount, `KEPCO metadata counts.by_stage.${stage} is incorrect.`);
    requireCondition(metadata?.count_reconciliation?.dashboard_reported_counts?.[stage] === expected.dashboardCount, `KEPCO metadata dashboard count for ${stage} is incorrect.`);
    requireCondition(metadata?.count_reconciliation?.stage_list_counts?.[stage] === expected.listedCount, `KEPCO metadata stage-list count for ${stage} is incorrect.`);
    requireCondition(metadata?.count_reconciliation?.dashboard_minus_list_by_stage?.[stage] === expected.dashboardCount - expected.listedCount, `KEPCO metadata dashboard/list difference for ${stage} is incorrect.`);
  }

  requireCondition(metadata?.extraction?.geometry?.coordinates_included === false, 'KEPCO metadata must declare coordinates_included false.');
  requireCondition(metadata?.extraction?.geometry?.centroids_created === false, 'KEPCO metadata must declare centroids_created false.');
  requireCondition(metadata?.extraction?.geometry?.line_routes_created === false, 'KEPCO metadata must declare line_routes_created false.');
  validateRecursiveHttpsUrls(metadata, 'KEPCO project metadata');
  validateRecursiveSha256Formats(metadata, 'KEPCO project metadata');

  const source = sourceById.get(kepcoSourceId);
  requireCondition(Boolean(source), `KEPCO source ${kepcoSourceId} must exist in source-registry.json.`);
  if (source) {
    requireCondition(source.source_class === 'official', `KEPCO source ${kepcoSourceId} must be official.`);
    requireCondition(source.evidence_level === 'reported', `KEPCO source ${kepcoSourceId} must be reported.`);
    requireCondition(Array.isArray(source.regions) && source.regions.includes('corea-del-sur'), `KEPCO source ${kepcoSourceId} must be registered for corea-del-sur.`);
    requireCondition(isHttpsUrl(source.url), `KEPCO registry source ${kepcoSourceId} must use HTTPS.`);
  }
}

async function validateMetadataIntegrity(
  chinaHvdcMetadata,
  kepcoProjectsMetadata,
  ukOpenMapMetadata,
  netherlandsGridMetadata,
) {
  const displayStats = await stat(files.taiwanDisplay);
  const taiwanMetadata = await readJson(files.taiwanMetadata);
  if (!taiwanMetadata) return;
  const output = taiwanMetadata.display_output;
  if (!requireCondition(isObject(output), 'taiwan metadata display_output is required.')) return;
  requireCondition(output.size_bytes === displayStats.size, `taiwan display byte size ${displayStats.size} does not match metadata ${output.size_bytes}.`);
  const digest = await sha256(files.taiwanDisplay);
  requireCondition(output.sha256 === digest, 'taiwan display SHA-256 does not match metadata.');

  const eiaStats = await stat(files.eiaPlants);
  const eiaMetadata = await readJson(files.eiaMetadata);
  if (!eiaMetadata) return;
  const eiaOutput = eiaMetadata.output;
  if (!requireCondition(isObject(eiaOutput), 'EIA metadata output is required.')) return;
  requireCondition(eiaOutput.bytes === eiaStats.size, `EIA plant byte size ${eiaStats.size} does not match metadata ${eiaOutput.bytes}.`);
  const eiaDigest = await sha256(files.eiaPlants);
  requireCondition(eiaOutput.sha256 === eiaDigest, 'EIA plant SHA-256 does not match metadata.');

  if (chinaHvdcMetadata) {
    const chinaOutput = chinaHvdcMetadata.output;
    if (requireCondition(isObject(chinaOutput), 'China HVDC metadata output is required.')) {
      const chinaDigest = await sha256(files.chinaHvdc);
      requireCondition(chinaOutput.sha256 === chinaDigest, 'China HVDC inventory SHA-256 does not match metadata.');
    }
  }

  if (kepcoProjectsMetadata) {
    const kepcoOutput = kepcoProjectsMetadata.output;
    if (requireCondition(isObject(kepcoOutput), 'KEPCO metadata output is required.')) {
      const kepcoStats = await stat(files.kepcoProjects);
      requireCondition(kepcoOutput.bytes === kepcoStats.size, `KEPCO inventory byte size ${kepcoStats.size} does not match metadata ${kepcoOutput.bytes}.`);
      const kepcoDigest = await sha256(files.kepcoProjects);
      requireCondition(kepcoOutput.sha256 === kepcoDigest, 'KEPCO inventory SHA-256 does not match metadata.');
    }
  }

  if (ukOpenMapMetadata) {
    const ukOutput = ukOpenMapMetadata.output;
    if (requireCondition(isObject(ukOutput), 'UK OS OpenMap Local metadata output is required.')) {
      const ukStats = await stat(files.ukOpenMapLines);
      requireCondition(ukStats.size < maxStaticGeoJsonBytes, `UK OS OpenMap Local is ${ukStats.size} bytes and must remain below 10 MiB.`);
      requireCondition(ukOutput.size_bytes === ukStats.size, `UK OS OpenMap Local byte size ${ukStats.size} does not match metadata ${ukOutput.size_bytes}.`);
      const ukDigest = await sha256(files.ukOpenMapLines);
      requireCondition(ukOutput.sha256 === ukDigest, 'UK OS OpenMap Local SHA-256 does not match metadata.');
    }
  }

  if (netherlandsGridMetadata) {
    const netherlandsOutput = netherlandsGridMetadata.output;
    if (requireCondition(isObject(netherlandsOutput), 'Netherlands official grid metadata output is required.')) {
      const netherlandsStats = await stat(files.netherlandsGrid);
      requireCondition(netherlandsStats.size < maxStaticGeoJsonBytes, `Netherlands official grid is ${netherlandsStats.size} bytes and must remain below 10 MiB.`);
      requireCondition(netherlandsOutput.size_bytes === netherlandsStats.size, `Netherlands official grid byte size ${netherlandsStats.size} does not match metadata ${netherlandsOutput.size_bytes}.`);
      const netherlandsDigest = await sha256(files.netherlandsGrid);
      requireCondition(netherlandsOutput.sha256 === netherlandsDigest, 'Netherlands official grid SHA-256 does not match metadata.');
    }
  }
}

async function validateStaticGeoJsonSizes() {
  const directoryEntries = await readdir(atlasDirectory, { withFileTypes: true });
  const geoJsonEntries = directoryEntries.filter((entry) => entry.isFile() && entry.name.endsWith('.geojson'));
  requireCondition(geoJsonEntries.length > 0, 'data/grid-atlas must contain static GeoJSON assets.');
  for (const entry of geoJsonEntries) {
    const filePath = path.join(atlasDirectory, entry.name);
    const fileStats = await stat(filePath);
    requireCondition(fileStats.size < maxStaticGeoJsonBytes, `${path.relative(projectDirectory, filePath)} is ${fileStats.size} bytes; every static GeoJSON must remain below ${maxStaticGeoJsonBytes} bytes.`);
  }
}

async function main() {
  const [
    profiles,
    registry,
    corridors,
    kpg193,
    taiwanDisplay,
    taiwanMetadata,
    eiaPlants,
    eiaMetadata,
    chinaHvdc,
    chinaHvdcMetadata,
    kepcoProjects,
    kepcoProjectsMetadata,
    ukOpenMapLines,
    ukOpenMapMetadata,
    netherlandsGrid,
    netherlandsGridMetadata,
  ] = await Promise.all([
    readJson(files.profiles),
    readJson(files.registry),
    readJson(files.corridors),
    readJson(files.kpg193),
    readJson(files.taiwanDisplay),
    readJson(files.taiwanMetadata),
    readJson(files.eiaPlants),
    readJson(files.eiaMetadata),
    readJson(files.chinaHvdc),
    readJson(files.chinaHvdcMetadata),
    readJson(files.kepcoProjects),
    readJson(files.kepcoProjectsMetadata),
    readJson(files.ukOpenMapLines),
    readJson(files.ukOpenMapMetadata),
    readJson(files.netherlandsGrid),
    readJson(files.netherlandsGridMetadata),
  ]);

  validateProfiles(profiles);
  const sourceById = validateRegistry(registry);
  validateModelCorridors(corridors, sourceById);
  validateKpg193Model(kpg193, sourceById);
  validateUkOpenMapLines(ukOpenMapLines, ukOpenMapMetadata, sourceById);
  validateNetherlandsOfficialGrid(netherlandsGrid, netherlandsGridMetadata, sourceById);
  validateTaiwanDisplay(taiwanDisplay, taiwanMetadata, sourceById);
  validateEiaPlants(eiaPlants, eiaMetadata, sourceById);
  validateChinaHvdcInventory(chinaHvdc, chinaHvdcMetadata, sourceById);
  validateKepcoProjectInventory(kepcoProjects, kepcoProjectsMetadata, sourceById);
  await validateMetadataIntegrity(
    chinaHvdcMetadata,
    kepcoProjectsMetadata,
    ukOpenMapMetadata,
    netherlandsGridMetadata,
  );
  await validateStaticGeoJsonSizes();

  if (failures.length) {
    console.error(`Grid Atlas asset validation failed with ${failures.length} issue(s):`);
    for (const message of failures) console.error(`- ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log('Grid Atlas asset validation passed.');
}

await main();
