export const CONTEXT_SCHEMA_VERSION = 2;
export const CONTEXT_SCHEMA_ID = 'osm-context-v2';
export const TILE_MINZOOM = 2;
export const TILE_MAXZOOM = 15;
export const MAXIMUM_TILE_BYTES = 750_000;
export const SIMPLIFICATION = 2;

export const LAYER_NAMES = [
  'base_landcover',
  'base_landuse',
  'base_water',
  'base_waterway',
  'base_coastline',
  'base_building',
  'base_road',
  'base_boundary',
  'base_rail',
  'base_place'
];

export const LAYER_DESCRIPTIONS = {
  base_landcover: 'OSM natural and vegetated land-cover polygons.',
  base_landuse: 'OSM urban, agricultural, civic and leisure land-use polygons.',
  base_water: 'OSM inland-water, reservoir, basin and riverbank polygons.',
  base_waterway: 'OSM river, canal, stream, ditch and drain lines.',
  base_coastline: 'OSM coastline ways for high-zoom coastal detail.',
  base_building: 'OSM building footprints, introduced only at high zoom.',
  base_road: 'OSM road hierarchy from motorways through local paths.',
  base_boundary: 'OSM administrative boundaries, levels 2 through 11.',
  base_rail: 'OSM heavy rail, metro, light rail, tram and related alignments.',
  base_place: 'OSM country-to-neighbourhood place labels with multilingual names.'
};

export const ROAD_CLASSES = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'pedestrian',
  'track',
  'road',
  'busway',
  'cycleway',
  'footway',
  'path',
  'bridleway',
  'steps'
]);

export const RAIL_CLASSES = new Set([
  'rail',
  'narrow_gauge',
  'light_rail',
  'subway',
  'tram',
  'monorail',
  'funicular'
]);

export const WATERWAY_CLASSES = new Set([
  'river',
  'canal',
  'stream',
  'ditch',
  'drain'
]);

export const PLACE_CLASSES = new Set([
  'country',
  'state',
  'province',
  'city',
  'town',
  'village',
  'suburb',
  'hamlet',
  'neighbourhood',
  'locality',
  'island'
]);

export const LANDCOVER_CLASSES = new Set([
  'wood',
  'scrub',
  'heath',
  'grass',
  'wetland',
  'glacier',
  'sand',
  'rock',
  'scree'
]);

export const LANDUSE_CLASSES = new Set([
  'residential',
  'commercial',
  'industrial',
  'retail',
  'railway',
  'military',
  'cemetery',
  'farmland',
  'farmyard',
  'orchard',
  'vineyard',
  'plant_nursery',
  'quarry',
  'landfill',
  'construction',
  'allotments',
  'brownfield',
  'greenfield',
  'recreation_ground',
  'park',
  'garden',
  'golf_course',
  'pitch',
  'common',
  'nature_reserve',
  'school',
  'university',
  'college',
  'hospital'
]);

export const GEOMETRIES = {
  base_landcover: new Set(['Polygon', 'MultiPolygon']),
  base_landuse: new Set(['Polygon', 'MultiPolygon']),
  base_water: new Set(['Polygon', 'MultiPolygon']),
  base_waterway: new Set(['LineString', 'MultiLineString']),
  base_coastline: new Set(['LineString', 'MultiLineString']),
  base_building: new Set(['Polygon', 'MultiPolygon']),
  base_road: new Set(['LineString', 'MultiLineString']),
  base_boundary: new Set([
    'LineString',
    'MultiLineString',
    'Polygon',
    'MultiPolygon'
  ]),
  base_rail: new Set(['LineString', 'MultiLineString']),
  base_place: new Set(['Point'])
};

const clampZoom = value => Math.max(TILE_MINZOOM, Math.min(TILE_MAXZOOM, value));

export const textValue = value => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

export const numericPopulation = value => {
  const parsed = Number(textValue(value).replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
};

export const osmIdentity = properties => {
  const rawType = textValue(properties?.['@type']).toLowerCase();
  const rawId = Number(textValue(properties?.['@id']));
  if (
    !['node', 'way', 'relation'].includes(rawType) ||
    !Number.isSafeInteger(rawId) ||
    rawId <= 0
  ) {
    return null;
  }
  return { osm_type: rawType, osm_id: rawId };
};

export const compactNames = properties => {
  const localName = textValue(properties?.name);
  const englishName = textValue(properties?.['name:en']);
  const spanishName = textValue(properties?.['name:es']);
  const name = englishName || localName || spanishName;
  return {
    ...(name ? { name } : {}),
    ...(localName && localName !== name ? { name_local: localName } : {}),
    ...(spanishName && spanishName !== name && spanishName !== localName
      ? { name_es: spanishName }
      : {})
  };
};

export const roadClass = value => textValue(value).replace(/_link$/, '');

export const roadMinzoom = (road, link = false) => clampZoom(({
  motorway: 4,
  trunk: 5,
  primary: 6,
  secondary: 7,
  tertiary: 9,
  busway: 10,
  unclassified: 11,
  residential: 11,
  road: 12,
  living_street: 12,
  service: 13,
  pedestrian: 13,
  track: 13,
  cycleway: 13,
  footway: 14,
  path: 14,
  bridleway: 14,
  steps: 14
})[road] + (link ? 1 : 0));

export const railMinzoom = rail => clampZoom(({
  rail: 7,
  narrow_gauge: 9,
  light_rail: 10,
  monorail: 10,
  subway: 11,
  tram: 12,
  funicular: 12
})[rail] ?? 12);

export const waterwayMinzoom = waterway => clampZoom(({
  river: 6,
  canal: 8,
  stream: 11,
  ditch: 13,
  drain: 13
})[waterway] ?? 13);

export const boundaryMinzoom = adminLevel => {
  const parsed = Number.parseInt(textValue(adminLevel), 10);
  return clampZoom(({
    2: 2,
    3: 3,
    4: 4,
    5: 6,
    6: 7,
    7: 9,
    8: 10,
    9: 12,
    10: 13,
    11: 14
  })[parsed] ?? 10);
};

export const placeMinzoom = properties => {
  const place = textValue(properties?.place || properties?.class);
  if (place === 'country') return 2;
  if (place === 'state' || place === 'province') return 4;
  const population = numericPopulation(properties?.population);
  const capital = textValue(properties?.capital);
  if (place === 'city') {
    if (capital === 'yes' || capital === '2') return 3;
    if (capital === '4' || population >= 5_000_000) return 4;
    if (population >= 1_000_000) return 5;
    if (population >= 250_000) return 6;
    return 7;
  }
  if (place === 'town') return population >= 100_000 ? 7 : 8;
  if (place === 'village') return population >= 20_000 ? 9 : 10;
  if (place === 'suburb') return 11;
  if (place === 'hamlet') return 12;
  if (place === 'neighbourhood') return 13;
  if (place === 'island') return 10;
  return 14;
};

const ringAreaSquareKilometres = ring => {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  let latitudeSum = 0;
  let coordinateCount = 0;
  for (const coordinate of ring) {
    if (
      Array.isArray(coordinate) &&
      Number.isFinite(coordinate[0]) &&
      Number.isFinite(coordinate[1])
    ) {
      latitudeSum += coordinate[1];
      coordinateCount += 1;
    }
  }
  if (!coordinateCount) return 0;
  const longitudeScale = 111.32 * Math.cos(
    (latitudeSum / coordinateCount) * Math.PI / 180
  );
  const latitudeScale = 110.574;
  let doubledArea = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const left = ring[index];
    const right = ring[index + 1];
    if (!Array.isArray(left) || !Array.isArray(right)) continue;
    doubledArea +=
      (left[0] * longitudeScale) * (right[1] * latitudeScale) -
      (right[0] * longitudeScale) * (left[1] * latitudeScale);
  }
  return Math.abs(doubledArea) / 2;
};

const polygonAreaSquareKilometres = rings => {
  if (!Array.isArray(rings) || !rings.length) return 0;
  const outer = ringAreaSquareKilometres(rings[0]);
  const holes = rings
    .slice(1)
    .reduce((sum, ring) => sum + ringAreaSquareKilometres(ring), 0);
  return Math.max(0, outer - holes);
};

export const geometryAreaSquareKilometres = geometry => {
  if (geometry?.type === 'Polygon') {
    return polygonAreaSquareKilometres(geometry.coordinates);
  }
  if (geometry?.type === 'MultiPolygon') {
    return geometry.coordinates.reduce(
      (sum, polygon) => sum + polygonAreaSquareKilometres(polygon),
      0
    );
  }
  return 0;
};

const zoomForArea = (area, thresholds, fallback) => {
  for (const [minimumArea, zoom] of thresholds) {
    if (area >= minimumArea) return clampZoom(zoom);
  }
  return clampZoom(fallback);
};

export const waterMinzoom = geometry => zoomForArea(
  geometryAreaSquareKilometres(geometry),
  [
    [10_000, 3],
    [1_000, 4],
    [100, 5],
    [10, 6],
    [1, 8],
    [0.1, 10],
    [0.01, 11]
  ],
  12
);

export const landcoverMinzoom = geometry => zoomForArea(
  geometryAreaSquareKilometres(geometry),
  [
    [10_000, 4],
    [2_000, 5],
    [500, 6],
    [100, 7],
    [20, 8],
    [5, 9],
    [1, 10],
    [0.2, 11],
    [0.04, 12]
  ],
  13
);

export const landuseMinzoom = geometry => zoomForArea(
  geometryAreaSquareKilometres(geometry),
  [
    [1_000, 7],
    [200, 8],
    [40, 9],
    [8, 10],
    [1, 11],
    [0.1, 12]
  ],
  13
);

export const normalizeLandcoverClass = properties => {
  const natural = textValue(properties?.natural);
  if (natural === 'wood') return 'wood';
  if (natural === 'scrub') return 'scrub';
  if (natural === 'heath') return 'heath';
  if (natural === 'grassland') return 'grass';
  if (natural === 'wetland') return 'wetland';
  if (natural === 'glacier') return 'glacier';
  if (natural === 'sand' || natural === 'beach') return 'sand';
  if (natural === 'bare_rock') return 'rock';
  if (natural === 'scree') return 'scree';
  const landuse = textValue(properties?.landuse);
  if (landuse === 'forest') return 'wood';
  if (landuse === 'meadow' || landuse === 'grass') return 'grass';
  return '';
};

export const normalizeLanduseClass = properties => {
  const landuse = textValue(properties?.landuse);
  if (LANDUSE_CLASSES.has(landuse)) return landuse;
  const leisure = textValue(properties?.leisure);
  if (LANDUSE_CLASSES.has(leisure)) return leisure;
  const amenity = textValue(properties?.amenity);
  if (LANDUSE_CLASSES.has(amenity)) return amenity;
  return '';
};

export const normalizeWaterClass = properties => {
  const water = textValue(properties?.water);
  if (water) return water;
  const landuse = textValue(properties?.landuse);
  if (['reservoir', 'basin', 'salt_pond'].includes(landuse)) return landuse;
  if (textValue(properties?.waterway) === 'riverbank') return 'river';
  return textValue(properties?.natural) === 'water' ? 'water' : '';
};
