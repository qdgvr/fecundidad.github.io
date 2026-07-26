(() => {
  'use strict';

  const host = typeof window === 'undefined' ? globalThis : window;
  const DEFAULT_BOUNDS = Object.freeze({
    europa: Object.freeze({ west: -25, south: 34, east: 45, north: 72 }),
    'estados-unidos': Object.freeze({ west: -125, south: 24, east: -66, north: 50 })
  });
  const COVERAGE = Object.freeze({
    rte: Object.freeze({ west: -6, south: 41, east: 10, north: 52 }),
    ignFrance: Object.freeze({ west: -6, south: 41, east: 10, north: 52 }),
    osGreatBritain: Object.freeze({ west: -5.94, south: 50.14, east: 1.73, north: 58.58 }),
    kadasterNetherlands: Object.freeze({ west: 3.1, south: 50.7, east: 7.3, north: 53.7 }),
    bkgGermany: Object.freeze({ west: 5.5, south: 47, east: 15.5, north: 55.5 }),
    bnetzaGermany: Object.freeze({ west: 6.05, south: 47.59, east: 14.51, north: 55.06 }),
    nve: Object.freeze({ west: 4, south: 57, east: 32, north: 72 }),
    cec: Object.freeze({ west: -125, south: 32, east: -113, north: 43 }),
    bpa: Object.freeze({ west: -125, south: 41.5, east: -110.5, north: 50 })
  });
  const ODS_PAGE_SIZE = 100;
  const WFS_PAGE_SIZE = 1000;
  const ARCGIS_PAGE_SIZE = 2000;
  const MAX_PAGES = 40;

  const RTE_API_ROOT = 'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets';
  const IGN_WFS_ROOT = 'https://data.geopf.fr/wfs/ows';
  const BKG_WFS_ROOT = 'https://sgx.geodatenzentrum.de/wfs_dlm250';
  const NVE_SERVICE_ROOT = 'https://kart.nve.no/enterprise/rest/services/Nettanlegg4/MapServer';
  const CEC_SERVICE_ROOT = 'https://services3.arcgis.com/bWPjFyq029ChCGur/arcgis/rest/services/Transmission_Line/FeatureServer';
  const BPA_SERVICE_ROOT = 'https://services3.arcgis.com/Iz3chmSt4P7oOoZy/arcgis/rest/services/BPA_TransmissionLines_View/FeatureServer';
  const BNETZA_SERVICE_ROOT = 'https://services-eu1.arcgis.com/TJm8oSvOdJUQvQT5/arcgis/rest/services/Monitoring_gdb/FeatureServer';

  const RTE_VOLTAGES = Object.freeze([
    Object.freeze({ label: '400kV', value: 400 }),
    Object.freeze({ label: '225kV', value: 225 }),
    Object.freeze({ label: '150kV', value: 150 }),
    Object.freeze({ label: '90kV', value: 90 }),
    Object.freeze({ label: '63kV', value: 63 }),
    Object.freeze({ label: '45kV', value: 45 }),
    Object.freeze({ label: '<45kV', value: 44.999 })
  ]);
  const IGN_VOLTAGES = Object.freeze([
    Object.freeze({ label: '400 kV', value: 400 }),
    Object.freeze({ label: '225 kV', value: 225 }),
    Object.freeze({ label: '150 kV', value: 150 }),
    Object.freeze({ label: '90 kV', value: 90 }),
    Object.freeze({ label: '63 kV', value: 63 }),
    Object.freeze({ label: '45 kV', value: 45 }),
    Object.freeze({ label: '< 45 kV', value: 44.999 })
  ]);

  const RTE_SOURCES = Object.freeze([
    Object.freeze({
      id: 'rte-lines-overhead-2026-06-16',
      dataset: 'lignes-aeriennes-rte-nv',
      title: 'RTE · lignes aériennes',
      assetKind: 'line',
      lineType: 'overhead',
      sourceUrl: 'https://odre.opendatasoft.com/explore/dataset/lignes-aeriennes-rte-nv/',
      coverage: COVERAGE.rte
    }),
    Object.freeze({
      id: 'rte-lines-underground-2026-06-16',
      dataset: 'lignes-souterraines-rte-nv',
      title: 'RTE · lignes souterraines',
      assetKind: 'line',
      lineType: 'underground',
      sourceUrl: 'https://odre.opendatasoft.com/explore/dataset/lignes-souterraines-rte-nv/',
      coverage: COVERAGE.rte
    }),
    Object.freeze({
      id: 'rte-substations-2026-06-16',
      dataset: 'postes-electriques-rte',
      title: 'RTE · sites électriques',
      assetKind: 'substation',
      lineType: null,
      sourceUrl: 'https://odre.opendatasoft.com/explore/dataset/postes-electriques-rte/',
      coverage: COVERAGE.rte
    })
  ]);

  const NVE_SOURCES = Object.freeze([
    Object.freeze({
      id: 'nve-nettanlegg4-transmission',
      layer: 0,
      title: 'NVE · lignes du réseau de transport',
      assetKind: 'line',
      lineType: 'overhead',
      coverage: COVERAGE.nve,
      maxRelevantVoltage: Infinity
    }),
    Object.freeze({
      id: 'nve-nettanlegg4-regional',
      layer: 1,
      title: 'NVE · lignes du réseau régional',
      assetKind: 'line',
      lineType: 'overhead',
      coverage: COVERAGE.nve,
      maxRelevantVoltage: 300
    }),
    Object.freeze({
      id: 'nve-nettanlegg4-substations',
      layer: 5,
      title: 'NVE · postes de transformation',
      assetKind: 'substation',
      lineType: null,
      coverage: COVERAGE.nve,
      maxRelevantVoltage: Infinity
    })
  ]);

  const WFS_SOURCES = Object.freeze([
    Object.freeze({
      id: 'ign-bdtopo-electric-lines',
      endpoint: IGN_WFS_ROOT,
      typeName: 'BDTOPO_V3:ligne_electrique',
      geometryField: 'geometrie',
      sortField: 'cleabs',
      title: 'IGN · BD TOPO lignes électriques',
      assetKind: 'line',
      coverage: COVERAGE.ignFrance,
      minZoom: 6,
      pageSize: 5000,
      sourceUrl: 'https://geoservices.ign.fr/bdtopo',
      registrySourceId: 'fr-ign-bdtopo-electricity-2026'
    }),
    Object.freeze({
      id: 'ign-bdtopo-transformer-sites',
      endpoint: IGN_WFS_ROOT,
      typeName: 'BDTOPO_V3:poste_de_transformation',
      geometryField: 'geometrie',
      sortField: 'cleabs',
      title: 'IGN · BD TOPO postes de transformation',
      assetKind: 'substation',
      coverage: COVERAGE.ignFrance,
      minZoom: 8,
      pageSize: 5000,
      requiresAllVoltages: true,
      sourceUrl: 'https://geoservices.ign.fr/bdtopo',
      registrySourceId: 'fr-ign-bdtopo-electricity-2026'
    }),
    Object.freeze({
      id: 'bkg-dlm250-power-lines',
      endpoint: BKG_WFS_ROOT,
      typeName: 'dlm250:objart_51005_l',
      geometryField: 'geom',
      sortField: 'objid',
      title: 'BKG · DLM250 Hochspannungsleitungen',
      assetKind: 'line',
      coverage: COVERAGE.bkgGermany,
      minZoom: 6,
      pageSize: 5000,
      maxRelevantVoltage: 110,
      sourceUrl: 'https://gdz.bkg.bund.de/index.php/default/digitales-landschaftsmodell-1-250-000-kompakt-dlm250-kompakt.html',
      registrySourceId: 'de-bkg-dlm250-transmission-2025'
    })
  ]);

  const CEC_SOURCE = Object.freeze({
    id: 'cec-california-transmission-lines',
    layer: 2,
    title: 'California Energy Commission · transmission lines',
    assetKind: 'line',
    coverage: COVERAGE.cec
  });

  const BPA_SOURCE = Object.freeze({
    id: 'bpa-transmission-lines-2026',
    layer: 0,
    title: 'Bonneville Power Administration · transmission lines',
    assetKind: 'line',
    coverage: COVERAGE.bpa
  });

  const BNETZA_SOURCES = Object.freeze([
    Object.freeze({
      id: 'bnetza-bbplg-projects-2026-07',
      layer: 0,
      title: 'Bundesnetzagentur · BBPlG projects',
      assetKind: 'planning_line',
      coverage: COVERAGE.bnetzaGermany,
      maxRelevantVoltage: Infinity
    }),
    Object.freeze({
      id: 'bnetza-enlag-projects-2026-07',
      layer: 1,
      title: 'Bundesnetzagentur · EnLAG projects',
      assetKind: 'planning_line',
      coverage: COVERAGE.bnetzaGermany,
      maxRelevantVoltage: Infinity
    })
  ]);

  const STATIC_SOURCES = Object.freeze([
    Object.freeze({
      id: 'uk-os-openmap-local-electricity-2026-04',
      title: 'Ordnance Survey · OS OpenMap Local electricity transmission lines',
      assetKind: 'line',
      coverage: COVERAGE.osGreatBritain,
      minZoom: 6,
      dataUrl: 'data/grid-atlas/uk-os-openmap-local-electricity-lines.geojson?v=1',
      sourceUrl: 'https://api.os.uk/downloads/v1/products/OpenMapLocal',
      registrySourceId: 'uk-os-openmap-local-electricity-2026-04',
      normalizer: 'uk-os-openmap-local'
    }),
    Object.freeze({
      id: 'nl-kadaster-top10nl-high-voltage-2026-06',
      title: 'Kadaster · BRT TOP10NL hoogspanningsleidingen',
      assetKind: 'line',
      coverage: COVERAGE.kadasterNetherlands,
      minZoom: 6,
      dataUrl: 'data/grid-atlas/netherlands-official-grid.geojson?v=1',
      sourceUrl: 'https://api.pdok.nl/kadaster/brt-top10nl/ogc/v1/collections/inrichtingselement_lijn',
      registrySourceId: 'nl-kadaster-top10nl-high-voltage-2026-06',
      normalizer: 'nl-kadaster-top10nl'
    })
  ]);
  const staticSourceCache = new Map();

  const emptyResult = (sourceCounts = {}, warnings = []) => ({
    type: 'FeatureCollection',
    features: [],
    sourceCounts,
    warnings
  });

  const asFiniteNumber = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  const cleanText = value => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text && text !== '-' ? text : null;
  };

  const firstText = (...values) => {
    for (const value of values) {
      const text = cleanText(value);
      if (text) return text;
    }
    return null;
  };

  const parseVoltage = value => {
    const number = asFiniteNumber(value);
    if (number !== null) return number;
    const text = cleanText(value);
    if (!text) return null;
    const match = text.replace(',', '.').match(/(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const parsed = Number(match[1]);
    if (!Number.isFinite(parsed)) return null;
    return text.startsWith('<') ? Math.max(0, parsed - 0.001) : parsed;
  };

  const parseCircuits = value => {
    const number = asFiniteNumber(value);
    if (number !== null) return number;
    const normalized = cleanText(value)?.toLowerCase();
    if (!normalized) return null;
    if (normalized === 'single') return 1;
    if (normalized === 'double') return 2;
    if (normalized === 'triple') return 3;
    const match = normalized.match(/\d+/);
    return match ? Number(match[0]) : null;
  };

  const normalizeStatus = value => {
    const status = cleanText(value);
    if (!status) return null;
    const normalized = status.toLowerCase();
    if (
      normalized === 'operational' ||
      normalized.includes('exploitation') ||
      normalized === 'en service'
    ) return 'operational';
    if (normalized === 'proposed' || normalized.includes('accord administratif')) return 'proposed';
    if (
      normalized === 'closed' ||
      normalized.includes('fermé') ||
      normalized.includes('détruit') ||
      normalized.includes('detruit')
    ) return 'closed';
    if (normalized === 'inactive' || normalized.includes('hors service')) return 'inactive';
    if (normalized === 'unknown') return 'unknown';
    return normalized;
  };

  const normalizeLineType = value => {
    const type = cleanText(value)?.toLowerCase();
    if (!type) return null;
    if (type === 'oh' || type.includes('aerien') || type.includes('aérien') || type.includes('luftlinje')) {
      return 'overhead';
    }
    if (type === 'ug' || type.includes('souterrain') || type.includes('underground')) return 'underground';
    if (type === 'uw' || type.includes('underwater') || type.includes('submarine')) return 'underwater';
    return type;
  };

  const toIsoDate = value => {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  };

  const normalizeBounds = bounds => {
    if (!bounds) return null;

    let values;
    if (Array.isArray(bounds) && bounds.length === 4) {
      values = bounds;
    } else if (
      Array.isArray(bounds) &&
      bounds.length === 2 &&
      Array.isArray(bounds[0]) &&
      Array.isArray(bounds[1])
    ) {
      values = [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]];
    } else if (
      typeof bounds.getWest === 'function' &&
      typeof bounds.getSouth === 'function' &&
      typeof bounds.getEast === 'function' &&
      typeof bounds.getNorth === 'function'
    ) {
      values = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
    } else if (bounds._sw && bounds._ne) {
      values = [bounds._sw.lng, bounds._sw.lat, bounds._ne.lng, bounds._ne.lat];
    } else {
      values = [bounds.west, bounds.south, bounds.east, bounds.north];
    }

    const [west, south, east, north] = values.map(Number);
    if (
      ![west, south, east, north].every(Number.isFinite) ||
      west >= east ||
      south >= north ||
      west < -180 ||
      east > 180 ||
      south < -90 ||
      north > 90
    ) {
      return null;
    }
    return { west, south, east, north };
  };

  const intersectBounds = (left, right) => {
    const bounds = {
      west: Math.max(left.west, right.west),
      south: Math.max(left.south, right.south),
      east: Math.min(left.east, right.east),
      north: Math.min(left.north, right.north)
    };
    return bounds.west < bounds.east && bounds.south < bounds.north ? bounds : null;
  };

  const geometryBounds = geometry => {
    if (!geometry || !Array.isArray(geometry.coordinates)) return null;
    const extent = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };

    const visit = coordinates => {
      if (!Array.isArray(coordinates)) return;
      if (
        coordinates.length >= 2 &&
        typeof coordinates[0] === 'number' &&
        typeof coordinates[1] === 'number'
      ) {
        extent.west = Math.min(extent.west, coordinates[0]);
        extent.south = Math.min(extent.south, coordinates[1]);
        extent.east = Math.max(extent.east, coordinates[0]);
        extent.north = Math.max(extent.north, coordinates[1]);
        return;
      }
      coordinates.forEach(visit);
    };

    visit(geometry.coordinates);
    return Number.isFinite(extent.west) ? extent : null;
  };

  const geometryIntersectsBounds = (geometry, bounds) => {
    const extent = geometryBounds(geometry);
    if (!extent) return false;
    return !(
      extent.east < bounds.west ||
      extent.west > bounds.east ||
      extent.north < bounds.south ||
      extent.south > bounds.north
    );
  };

  const hashString = value => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  };

  const featureId = (datasetId, sourceId, geometry) => {
    const geometryHash = hashString(JSON.stringify(geometry));
    return `${datasetId}:${sourceId || 'unknown'}:${geometryHash}`;
  };

  const throwIfAborted = signal => {
    if (!signal?.aborted) return;
    if (signal.reason instanceof Error) throw signal.reason;
    const error = new Error('The request was aborted.');
    error.name = 'AbortError';
    throw error;
  };

  const isAbortError = (error, signal) =>
    signal?.aborted || error?.name === 'AbortError' || error?.code === 20;

  const fetchJson = async (url, signal, title) => {
    throwIfAborted(signal);
    const response = await fetch(url, {
      signal,
      credentials: 'omit',
      headers: { Accept: 'application/geo+json, application/json' }
    });
    if (!response.ok) throw new Error(`${title}: HTTP ${response.status}`);
    const data = await response.json();
    if (data?.error) throw new Error(`${title}: ${data.error.message || 'API error'}`);
    if (!data || !Array.isArray(data.features)) throw new Error(`${title}: invalid GeoJSON response`);
    return data;
  };

  const rteWhere = minVoltage => {
    const labels = RTE_VOLTAGES
      .filter(entry => entry.value >= minVoltage)
      .map(entry => JSON.stringify(entry.label));
    return labels.length ? `tension in (${labels.join(',')})` : '1=0';
  };

  const normalizeRteFeature = (feature, source) => {
    if (!feature?.geometry) return null;
    const properties = feature.properties || {};
    const sourceId = firstText(properties.code_ligne, properties.code_poste, feature.id, 'unknown');
    const name = firstText(
      properties.nom_ligne,
      properties.nom_ouvrage_1,
      properties.nom_poste,
      properties.nom_ouvrage_2
    );
    const normalized = {
      ASSET_KIND: source.assetKind,
      SOURCE_ID: sourceId,
      NAME: name,
      VOLTAGE: parseVoltage(properties.tension),
      STATUS: normalizeStatus(properties.etat),
      OWNER: firstText(properties.source, 'RTE'),
      CIRCUITS: source.assetKind === 'line' ? parseCircuits(properties.nombre_circuit) : null,
      LINE_TYPE: source.lineType,
      SOURCE_DATASET: source.id,
      REGISTRY_SOURCE_ID: 'fr-rte-odre-network-2026',
      SOURCE_URL: source.sourceUrl,
      SOURCE_DATE: '2026-06-16',
      SOURCE_LICENSE: 'Licence Ouverte v2.0 (Etalab)',
      EVIDENCE: 'reported',
      GEOMETRY_CONFIDENCE: 'reported-generalized'
    };
    return {
      type: 'Feature',
      id: featureId(source.id, sourceId, feature.geometry),
      geometry: feature.geometry,
      properties: normalized
    };
  };

  const fetchRteSource = async (source, bounds, minVoltage, signal) => {
    const queryBounds = intersectBounds(bounds, source.coverage);
    if (!queryBounds) return { features: [], warnings: [] };

    const features = [];
    const warnings = [];
    const where = rteWhere(minVoltage);

    for (let page = 0, offset = 0; page < MAX_PAGES; page += 1) {
      const parameters = new URLSearchParams({
        where,
        limit: String(ODS_PAGE_SIZE),
        offset: String(offset)
      });
      const url = `${RTE_API_ROOT}/${source.dataset}/exports/geojson?${parameters}`;
      const data = await fetchJson(url, signal, source.title);
      const pageFeatures = data.features;
      const geometries = pageFeatures.filter(feature => feature?.geometry);

      if (page === 0 && pageFeatures.length > 0 && geometries.length === 0) {
        warnings.push(
          `${source.title}: la publicación oficial del 16-06-2026 conserva atributos, pero retiró las coordenadas GPS; no se añadieron objetos al mapa.`
        );
        break;
      }

      geometries.forEach(feature => {
        if (!geometryIntersectsBounds(feature.geometry, queryBounds)) return;
        const normalized = normalizeRteFeature(feature, source);
        if (normalized && (normalized.properties.VOLTAGE === null || normalized.properties.VOLTAGE >= minVoltage)) {
          features.push(normalized);
        }
      });

      if (pageFeatures.length < ODS_PAGE_SIZE) break;
      offset += pageFeatures.length;
      if (page === MAX_PAGES - 1) warnings.push(`${source.title}: se alcanzó el límite de paginación.`);
    }

    return { features, warnings };
  };

  const ignVoltageFilter = minVoltage => {
    if (minVoltage <= 0) return null;
    const labels = IGN_VOLTAGES
      .filter(entry => entry.value >= minVoltage)
      .map(entry => `'${entry.label.replaceAll("'", "''")}'`);
    return labels.length ? `voltage IN (${labels.join(',')})` : 'INCLUDE = false';
  };

  const wfsSpatialFilter = (source, bounds, minVoltage) => {
    const spatial = [
      `BBOX(${source.geometryField}`,
      bounds.west,
      bounds.south,
      bounds.east,
      `${bounds.north},'CRS:84')`
    ].join(',');
    if (source.id !== 'ign-bdtopo-electric-lines') return spatial;
    const voltageFilter = ignVoltageFilter(minVoltage);
    return voltageFilter ? `${spatial} AND ${voltageFilter}` : spatial;
  };

  const ignGeometryConfidence = properties => {
    const precision = asFiniteNumber(properties.precision_planimetrique);
    if (precision !== null && precision <= 2.5) return 'reported-high';
    if (precision !== null && precision <= 10) return 'reported-medium';
    return 'reported-variable';
  };

  const normalizeIgnFeature = (feature, source) => {
    if (!feature?.geometry) return null;
    const properties = feature.properties || {};
    const sourceId = firstText(properties.cleabs, feature.id, 'unknown');
    const normalized = {
      ASSET_KIND: source.assetKind,
      SOURCE_ID: sourceId,
      NAME: firstText(properties.toponyme, properties.identifiants_sources),
      VOLTAGE: source.assetKind === 'line' ? parseVoltage(properties.voltage) : null,
      STATUS: normalizeStatus(properties.etat_de_l_objet),
      STATUS_ORIGINAL: cleanText(properties.etat_de_l_objet),
      OWNER: firstText(properties.gestionnaire, properties.sources),
      OWNER_SIREN: cleanText(properties.siren_gestionnaire),
      CIRCUITS: null,
      LINE_TYPE: null,
      CARTOGRAPHIC_SOURCES: cleanText(properties.sources),
      ACQUISITION_METHOD: cleanText(properties.methode_d_acquisition_planimetrique),
      PLANIMETRIC_PRECISION_M: asFiniteNumber(properties.precision_planimetrique),
      SOURCE_DATASET: source.id,
      REGISTRY_SOURCE_ID: source.registrySourceId,
      SOURCE_URL: source.sourceUrl,
      SOURCE_DATE:
        toIsoDate(properties.date_modification) ||
        toIsoDate(properties.date_de_confirmation) ||
        toIsoDate(properties.date_creation) ||
        '2026-07-26',
      SOURCE_LICENSE: 'Licence Ouverte 2.0 (Etalab)',
      EVIDENCE: 'reported',
      GEOMETRY_CONFIDENCE: ignGeometryConfidence(properties)
    };
    return {
      type: 'Feature',
      id: featureId(source.id, sourceId, feature.geometry),
      geometry: feature.geometry,
      properties: normalized
    };
  };

  const normalizeBkgFeature = (feature, source) => {
    if (!feature?.geometry) return null;
    const properties = feature.properties || {};
    const sourceId = firstText(properties.objid, feature.id, 'unknown');
    const normalized = {
      ASSET_KIND: 'line',
      SOURCE_ID: sourceId,
      NAME: firstText(properties.objart_txt, 'Hochspannungsleitung'),
      VOLTAGE: null,
      VOLTAGE_FILTER_KV: 110,
      VOLTAGE_SCOPE: 'dataset complete for lines at or above 110 kV; per-feature voltage not published',
      STATUS: null,
      OWNER: null,
      CIRCUITS: null,
      LINE_TYPE: String(properties.bwf) === '1110' ? 'overhead' : null,
      OBJECT_CLASS: cleanText(properties.objart),
      MODEL: cleanText(properties.modellart),
      REMARK: cleanText(properties.bemerkung),
      SOURCE_DATASET: source.id,
      REGISTRY_SOURCE_ID: source.registrySourceId,
      SOURCE_URL: source.sourceUrl,
      SOURCE_DATE: toIsoDate(properties.beginn) || '2025-12-31',
      SOURCE_LICENSE: 'Datenlizenz Deutschland – Namensnennung – Version 2.0',
      EVIDENCE: 'reported',
      GEOMETRY_CONFIDENCE: 'reported-generalized-1:250000'
    };
    return {
      type: 'Feature',
      id: featureId(source.id, sourceId, feature.geometry),
      geometry: feature.geometry,
      properties: normalized
    };
  };

  const fetchWfsSource = async (source, bounds, minVoltage, signal, zoom) => {
    const queryBounds = intersectBounds(bounds, source.coverage);
    if (
      !queryBounds ||
      zoom < source.minZoom ||
      (source.requiresAllVoltages && minVoltage > 0) ||
      minVoltage > (source.maxRelevantVoltage ?? Infinity)
    ) {
      return { features: [], warnings: [] };
    }

    const features = [];
    const warnings = [];
    const pageSize = source.pageSize || WFS_PAGE_SIZE;
    for (let page = 0, startIndex = 0; page < MAX_PAGES; page += 1) {
      const parameters = new URLSearchParams({
        SERVICE: 'WFS',
        VERSION: '2.0.0',
        REQUEST: 'GetFeature',
        TYPENAMES: source.typeName,
        COUNT: String(pageSize),
        STARTINDEX: String(startIndex),
        OUTPUTFORMAT: 'application/json',
        SRSNAME: 'CRS:84',
        CQL_FILTER: wfsSpatialFilter(source, queryBounds, minVoltage),
        SORTBY: `${source.sortField} A`
      });
      const requestUrl = `${source.endpoint}?${parameters}`;
      const data = await fetchJson(requestUrl, signal, source.title);
      const pageFeatures = data.features;
      pageFeatures.forEach(feature => {
        const normalized = source.id.startsWith('ign-')
          ? normalizeIgnFeature(feature, source)
          : normalizeBkgFeature(feature, source);
        if (!normalized) return;
        const voltage = normalized.properties.VOLTAGE;
        const filterVoltage = normalized.properties.VOLTAGE_FILTER_KV;
        if (
          minVoltage <= 0 ||
          (voltage !== null && voltage >= minVoltage) ||
          (voltage === null && filterVoltage !== null && filterVoltage >= minVoltage)
        ) {
          features.push(normalized);
        }
      });

      const matched = asFiniteNumber(data.numberMatched ?? data.totalFeatures);
      startIndex += pageFeatures.length;
      if (
        !pageFeatures.length ||
        pageFeatures.length < pageSize ||
        (matched !== null && startIndex >= matched)
      ) break;
      if (page === MAX_PAGES - 1) warnings.push(`${source.title}: se alcanzó el límite de paginación.`);
    }
    return { features, warnings };
  };

  const normalizeStaticFeature = (feature, source) => {
    if (!feature?.geometry) return null;
    const properties = feature.properties || {};
    const sourceId = firstText(properties.ORIGINAL_ID, properties.LOCAL_ID, feature.id, 'unknown');
    if (source.normalizer === 'nl-kadaster-top10nl') {
      const normalized = {
        ASSET_KIND: source.assetKind,
        SOURCE_ID: sourceId,
        NAME: firstText(properties.NAME, 'Kadaster TOP10NL · hoogspanningsleiding'),
        VOLTAGE: null,
        VOLTAGE_UNFILTERED: true,
        VOLTAGE_SCOPE: 'official high-voltage cartographic feature; per-feature voltage not published',
        STATUS: null,
        OWNER: null,
        CIRCUITS: null,
        LINE_TYPE: null,
        FEATURE_CODE: properties.TOP10NL_CODE ?? null,
        LOCAL_ID: cleanText(properties.LOCAL_ID),
        TOP10NL_TYPE: cleanText(properties.TOP10NL_TYPE),
        TOP10NL_CODE: properties.TOP10NL_CODE ?? null,
        SOURCE_FEATURE_DATE: cleanText(properties.SOURCE_FEATURE_DATE),
        SOURCE_METHOD: cleanText(properties.SOURCE_METHOD),
        SOURCE_ACCURACY_M: asFiniteNumber(properties.SOURCE_ACCURACY_M),
        SOURCE_DATASET: source.id,
        REGISTRY_SOURCE_ID: source.registrySourceId,
        SOURCE_URL: firstText(properties.SOURCE_URL, source.sourceUrl),
        SOURCE_DATE: cleanText(properties.SOURCE_DATE) || '2026-06-01',
        SOURCE_LICENSE: cleanText(properties.SOURCE_LICENSE) || 'CC BY 4.0',
        EVIDENCE: cleanText(properties.EVIDENCE) || 'official',
        GEOMETRY_CONFIDENCE:
          cleanText(properties.GEOMETRY_CONFIDENCE) ||
          'official-top10nl-1:10000-rounded-6dp-no-simplification'
      };
      return {
        type: 'Feature',
        id: featureId(source.id, sourceId, feature.geometry),
        geometry: feature.geometry,
        properties: normalized
      };
    }

    const normalized = {
      ASSET_KIND: source.assetKind,
      SOURCE_ID: sourceId,
      NAME: 'OS OpenMap Local · Electricity Transmission Line',
      VOLTAGE: null,
      VOLTAGE_UNFILTERED: true,
      VOLTAGE_SCOPE: 'official transmission-line cartographic feature; per-feature voltage not published',
      STATUS: null,
      OWNER: null,
      CIRCUITS: null,
      LINE_TYPE: 'overhead',
      FEATURE_CODE: properties.FEATURE_CODE ?? null,
      GRID_SQUARES: cleanText(properties.GRID_SQUARES),
      SOURCE_DATASET: source.id,
      REGISTRY_SOURCE_ID: source.registrySourceId,
      SOURCE_URL: source.sourceUrl,
      SOURCE_DATE: cleanText(properties.SOURCE_DATE) || '2026-04',
      SOURCE_LICENSE: cleanText(properties.SOURCE_LICENSE) || 'Open Government Licence 3.0',
      EVIDENCE: 'reported',
      GEOMETRY_CONFIDENCE:
        cleanText(properties.GEOMETRY_CONFIDENCE) ||
        'official-openmap-local-1:10000-bng-helmert-wgs84-rounded-6dp-no-simplification'
    };
    return {
      type: 'Feature',
      id: featureId(source.id, sourceId, feature.geometry),
      geometry: feature.geometry,
      properties: normalized
    };
  };

  const fetchStaticSource = async (source, bounds, minVoltage, signal, zoom) => {
    const queryBounds = intersectBounds(bounds, source.coverage);
    if (!queryBounds || zoom < source.minZoom) return { features: [], warnings: [] };

    let dataPromise = staticSourceCache.get(source.id);
    if (!dataPromise) {
      dataPromise = fetchJson(source.dataUrl, undefined, source.title);
      staticSourceCache.set(source.id, dataPromise);
      dataPromise.catch(() => {
        if (staticSourceCache.get(source.id) === dataPromise) staticSourceCache.delete(source.id);
      });
    }
    const data = await dataPromise;
    throwIfAborted(signal);
    const features = data.features
      .filter(feature => geometryIntersectsBounds(feature.geometry, queryBounds))
      .map(feature => normalizeStaticFeature(feature, source))
      .filter(Boolean);
    return { features, warnings: [] };
  };

  const arcGisOffset = bounds => {
    const span = Math.max(bounds.east - bounds.west, bounds.north - bounds.south);
    if (span >= 15) return 0.005;
    if (span >= 5) return 0.002;
    if (span >= 1) return 0.0005;
    return 0.0001;
  };

  const arcGisWhere = (source, minVoltage) => {
    if (source.id === 'nve-nettanlegg4-substations') {
      return `(spenning_kv >= ${minVoltage} OR (spenning_kv IS NULL AND nvenettnivaa IN ('1','2')))`;
    }
    if (source.id.startsWith('nve-')) return `spenning_kv >= ${minVoltage}`;
    if (source.id.startsWith('bnetza-')) return '1=1';
    if (source.id === BPA_SOURCE.id) return `VoltageMeas >= ${minVoltage}`;
    return `kV_Sort >= ${minVoltage}`;
  };

  const nveSourceDate = properties =>
    toIsoDate(properties.kildeendretdato) ||
    toIsoDate(properties.nveendretdato) ||
    toIsoDate(properties.nveopprettetdato);

  const nveGeometryConfidence = properties => {
    const accuracy = asFiniteNumber(properties.noyaktighet);
    if (accuracy !== null && accuracy <= 5) return 'reported-high';
    if (accuracy !== null && accuracy <= 100) return 'reported-medium';
    return 'reported-variable';
  };

  const normalizeNveFeature = (feature, source) => {
    if (!feature?.geometry) return null;
    const properties = feature.properties || {};
    const sourceId = firstText(
      properties.globalid,
      properties.nvenetbasid,
      properties.objectid,
      feature.id,
      'unknown'
    );
    const sourceUrl = `${NVE_SERVICE_ROOT}/${source.layer}`;
    const normalized = {
      ASSET_KIND: source.assetKind,
      SOURCE_ID: sourceId,
      NAME: firstText(properties.navn, properties.objekttype),
      VOLTAGE: parseVoltage(properties.spenning_kv),
      STATUS: null,
      OWNER: cleanText(properties.eier),
      CIRCUITS: null,
      LINE_TYPE: source.assetKind === 'line'
        ? normalizeLineType(properties.objekttype) || source.lineType
        : null,
      SOURCE_DATASET: source.id,
      REGISTRY_SOURCE_ID: 'no-nve-nettanlegg4',
      SOURCE_URL: sourceUrl,
      SOURCE_DATE: nveSourceDate(properties),
      SOURCE_LICENSE: 'Norsk lisens for offentlige data (NLOD)',
      EVIDENCE: 'reported',
      GEOMETRY_CONFIDENCE: nveGeometryConfidence(properties)
    };
    return {
      type: 'Feature',
      id: featureId(source.id, sourceId, feature.geometry),
      geometry: feature.geometry,
      properties: normalized
    };
  };

  const normalizeCecFeature = feature => {
    if (!feature?.geometry) return null;
    const properties = feature.properties || {};
    const sourceId = firstText(properties.GlobalID, properties.OBJECTID, feature.id, 'unknown');
    const normalized = {
      ASSET_KIND: 'line',
      SOURCE_ID: sourceId,
      NAME: firstText(properties.TLine_Name, properties.Name),
      VOLTAGE: parseVoltage(properties.kV_Sort ?? properties.kV),
      STATUS: normalizeStatus(properties.Status),
      OWNER: cleanText(properties.Owner),
      CIRCUITS: parseCircuits(properties.Circuit),
      LINE_TYPE: normalizeLineType(properties.Type),
      SOURCE_DATASET: CEC_SOURCE.id,
      REGISTRY_SOURCE_ID: 'us-cec-transmission-2025',
      SOURCE_URL: `${CEC_SERVICE_ROOT}/${CEC_SOURCE.layer}`,
      SOURCE_DATE: toIsoDate(properties.Last_Editor_Date) || '2025-07-10',
      SOURCE_LICENSE: 'CC BY 4.0',
      EVIDENCE: 'reported',
      GEOMETRY_CONFIDENCE: 'reported'
    };
    return {
      type: 'Feature',
      id: featureId(CEC_SOURCE.id, sourceId, feature.geometry),
      geometry: feature.geometry,
      properties: normalized
    };
  };

  const normalizeBpaFeature = feature => {
    if (!feature?.geometry) return null;
    const properties = feature.properties || {};
    const sourceId = firstText(properties.GlobalID, properties.OBJECTID, feature.id, 'unknown');
    const normalized = {
      ASSET_KIND: 'line',
      SOURCE_ID: sourceId,
      NAME: firstText(properties.OperatingLineNm, properties.XRefCd),
      VOLTAGE: parseVoltage(properties.VoltageMeas),
      STATUS: null,
      OWNER: 'Bonneville Power Administration',
      CIRCUITS: null,
      LINE_TYPE: null,
      CROSS_REFERENCE: cleanText(properties.XRefCd),
      SOURCE_DATASET: BPA_SOURCE.id,
      REGISTRY_SOURCE_ID: 'us-bpa-transmission-2026-07',
      SOURCE_URL: `${BPA_SERVICE_ROOT}/${BPA_SOURCE.layer}`,
      SOURCE_DATE: toIsoDate(properties.EditDate) || '2026-07-24',
      SOURCE_LICENSE: 'BPA public item; informational/best-available-data disclaimer',
      EVIDENCE: 'reported',
      GEOMETRY_CONFIDENCE: 'reported'
    };
    return {
      type: 'Feature',
      id: featureId(BPA_SOURCE.id, sourceId, feature.geometry),
      geometry: feature.geometry,
      properties: normalized
    };
  };

  const normalizeBnetzaFeature = (feature, source) => {
    if (!feature?.geometry) return null;
    const properties = feature.properties || {};
    const sourceId = firstText(
      properties.Vorhabennu,
      properties.VGI_Nr,
      properties.OBJECTID,
      feature.id,
      'unknown'
    );
    const geometryKind = cleanText(properties.Typ);
    const isStraightLine = geometryKind?.toLowerCase() === 'luftlinie';
    const publishedLink = cleanText(properties.Link);
    const sourceUrl = publishedLink
      ? publishedLink.replace(/^http:/i, 'https:')
      : 'https://www.netzausbau.de/';
    const normalized = {
      ASSET_KIND: 'planning_line',
      SOURCE_ID: sourceId,
      NAME: firstText(properties.Vorhaben, properties.Vorhabennu),
      VOLTAGE: parseVoltage(properties.Spannung),
      STATUS: firstText(properties.Vorhabenst, properties.Filter_zus),
      STATUS_ORIGINAL: firstText(properties.Vorhabenst, properties.Filter_zus),
      OWNER: cleanText(properties.Vorhabentr),
      CIRCUITS: null,
      LINE_TYPE: normalizeLineType(properties.Ausführung),
      TECHNOLOGY: cleanText(properties.Technik),
      LEGAL_BASIS: firstText(properties.Rechtsgrun, properties.Grundlage),
      RESPONSIBLE_AUTHORITY: cleanText(properties.Zuständigk),
      GEOMETRY_KIND: geometryKind,
      SOURCE_ORGANISATION: cleanText(properties.Datenquell),
      SOURCE_DATASET: source.id,
      REGISTRY_SOURCE_ID: 'de-bnetza-grid-projects-2026-07',
      SOURCE_URL: sourceUrl,
      SOURCE_DATE: '2026-07-07',
      SOURCE_LICENSE: 'Public remote ArcGIS item; no explicit redistribution licence',
      EVIDENCE: 'reported',
      GEOMETRY_CONFIDENCE: isStraightLine
        ? 'reported-planning-schematic-straight-line'
        : 'reported-planning-route'
    };
    return {
      type: 'Feature',
      id: featureId(source.id, sourceId, feature.geometry),
      geometry: feature.geometry,
      properties: normalized
    };
  };

  const fetchArcGisSource = async (source, bounds, minVoltage, signal) => {
    const queryBounds = intersectBounds(bounds, source.coverage);
    if (!queryBounds || minVoltage > (source.maxRelevantVoltage ?? Infinity)) {
      return { features: [], warnings: [] };
    }

    const isNve = source.id.startsWith('nve-');
    const isBpa = source.id === BPA_SOURCE.id;
    const isBnetza = source.id.startsWith('bnetza-');
    const endpoint = isNve
      ? `${NVE_SERVICE_ROOT}/${source.layer}/query`
      : isBpa
        ? `${BPA_SERVICE_ROOT}/${source.layer}/query`
        : isBnetza
          ? `${BNETZA_SERVICE_ROOT}/${source.layer}/query`
          : `${CEC_SERVICE_ROOT}/${source.layer}/query`;
    const objectId = isNve ? 'objectid' : 'OBJECTID';
    const outFields = isNve
      ? [
        'objectid',
        'eier',
        'eierorgnr',
        'objekttype',
        'nvenetbasid',
        'nvenettnivaa',
        'sosinettnivaa',
        'navn',
        'spenning_kv',
        'driftsattaar',
        'nveopprettetdato',
        'nveendretdato',
        'kildeendretdato',
        'malemetode',
        'noyaktighet',
        'globalid'
      ].join(',')
      : isBpa
        ? [
          'OBJECTID',
          'XRefCd',
          'OperatingLineNm',
          'VoltageMeas',
          'CreationDate',
          'EditDate',
          'GlobalID'
        ].join(',')
        : isBnetza
          ? [
            'OBJECTID',
            'Vorhaben',
            'Typ',
            'Vorhabenst',
            'Vorhabennu',
            'Link',
            'Technik',
            'VGI',
            'VGI_Nr',
            'Rechtsgrun',
            'Vorhabentr',
            'Spannung',
            'Zuständigk',
            'Ausführung',
            'Filter_zus',
            'Grundlage',
            'Datenquell'
          ].join(',')
          : [
        'OBJECTID',
        'Name',
        'kV',
        'kV_Sort',
        'Owner',
        'Status',
        'Circuit',
        'Type',
        'Legend',
        'Length_Mile',
        'TLine_Name',
        'Source',
        'Comments',
        'Creator_Date',
        'Last_Editor_Date',
            'GlobalID'
          ].join(',');
    const features = [];
    const warnings = [];

    for (let page = 0, offset = 0; page < MAX_PAGES; page += 1) {
      const parameters = new URLSearchParams({
        where: arcGisWhere(source, minVoltage),
        geometry: `${queryBounds.west},${queryBounds.south},${queryBounds.east},${queryBounds.north}`,
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields,
        returnGeometry: 'true',
        returnZ: 'false',
        returnM: 'false',
        outSR: '4326',
        geometryPrecision: '5',
        maxAllowableOffset: String(arcGisOffset(queryBounds)),
        orderByFields: `${objectId} ASC`,
        resultOffset: String(offset),
        resultRecordCount: String(ARCGIS_PAGE_SIZE),
        f: 'geojson'
      });
      const data = await fetchJson(`${endpoint}?${parameters}`, signal, source.title);
      const pageFeatures = data.features;

      pageFeatures.forEach(feature => {
        const normalized = isNve
          ? normalizeNveFeature(feature, source)
          : isBpa
            ? normalizeBpaFeature(feature)
            : isBnetza
              ? normalizeBnetzaFeature(feature, source)
              : normalizeCecFeature(feature);
        if (!normalized) return;
        const voltage = normalized.properties.VOLTAGE;
        const isUnknownNveSubstation =
          source.id === 'nve-nettanlegg4-substations' && voltage === null;
        if (
          isUnknownNveSubstation ||
          minVoltage <= 0 ||
          (voltage !== null && voltage >= minVoltage)
        ) {
          features.push(normalized);
        }
      });

      const exceeded = Boolean(
        data.exceededTransferLimit ||
        data.properties?.exceededTransferLimit
      );
      if (!pageFeatures.length || (!exceeded && pageFeatures.length < ARCGIS_PAGE_SIZE)) break;
      offset += pageFeatures.length;
      if (page === MAX_PAGES - 1) warnings.push(`${source.title}: se alcanzó el límite de paginación.`);
    }

    return { features, warnings };
  };

  const loadSourceSafely = async (source, loader, bounds, minVoltage, signal, zoom = Infinity) => {
    try {
      const result = await loader(source, bounds, minVoltage, signal, zoom);
      return { source, features: result.features, warnings: result.warnings };
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      return {
        source,
        features: [],
        warnings: [`${source.title}: no se pudo consultar la fuente (${error.message || 'error de red'}).`]
      };
    }
  };

  const deduplicate = features => {
    const unique = new Map();
    features.forEach(feature => {
      const properties = feature.properties || {};
      const key = feature.id || [
        properties.SOURCE_DATASET,
        properties.SOURCE_ID,
        hashString(JSON.stringify(feature.geometry))
      ].join(':');
      unique.set(String(key), feature);
    });
    return [...unique.values()];
  };

  const load = async (options = {}) => {
    const regionKey = cleanText(options.regionKey)?.toLowerCase();
    const sourceCounts = {};
    const warnings = [];
    const defaultBounds = DEFAULT_BOUNDS[regionKey];
    if (!defaultBounds) {
      return emptyResult(sourceCounts, [`Región sin fuentes oficiales configuradas: ${regionKey || 'desconocida'}.`]);
    }

    const requestedBounds = options.bounds ? normalizeBounds(options.bounds) : defaultBounds;
    if (!requestedBounds) return emptyResult(sourceCounts, ['Los límites geográficos no son válidos.']);
    const bounds = intersectBounds(requestedBounds, defaultBounds);
    if (!bounds) return emptyResult(sourceCounts, ['La consulta queda fuera de la región seleccionada.']);

    const parsedMinimum = asFiniteNumber(options.minVoltage);
    const minVoltage = Math.min(1000, Math.max(0, parsedMinimum ?? 0));
    const parsedZoom = asFiniteNumber(options.zoom);
    const currentZoom = Math.max(0, parsedZoom ?? Infinity);
    const signal = options.signal;
    throwIfAborted(signal);

    let jobs;
    if (regionKey === 'europa') {
      const sources = [
        ...RTE_SOURCES,
        ...NVE_SOURCES,
        ...WFS_SOURCES,
        ...BNETZA_SOURCES,
        ...STATIC_SOURCES
      ];
      sources.forEach(source => {
        sourceCounts[source.id] = 0;
      });
      jobs = [
        ...RTE_SOURCES.map(source =>
          loadSourceSafely(source, fetchRteSource, bounds, minVoltage, signal)
        ),
        ...NVE_SOURCES.map(source =>
          loadSourceSafely(source, fetchArcGisSource, bounds, minVoltage, signal)
        ),
        ...WFS_SOURCES.map(source =>
          loadSourceSafely(source, fetchWfsSource, bounds, minVoltage, signal, currentZoom)
        ),
        ...BNETZA_SOURCES.map(source =>
          loadSourceSafely(source, fetchArcGisSource, bounds, minVoltage, signal)
        ),
        ...STATIC_SOURCES.map(source =>
          loadSourceSafely(source, fetchStaticSource, bounds, minVoltage, signal, currentZoom)
        )
      ];
    } else {
      sourceCounts[CEC_SOURCE.id] = 0;
      sourceCounts[BPA_SOURCE.id] = 0;
      jobs = [
        loadSourceSafely(CEC_SOURCE, fetchArcGisSource, bounds, minVoltage, signal),
        loadSourceSafely(BPA_SOURCE, fetchArcGisSource, bounds, minVoltage, signal)
      ];
    }

    const results = await Promise.all(jobs);
    throwIfAborted(signal);
    const features = deduplicate(results.flatMap(result => result.features));
    results.forEach(result => warnings.push(...result.warnings));
    features.forEach(feature => {
      const dataset = feature.properties?.SOURCE_DATASET;
      if (dataset) sourceCounts[dataset] = (sourceCounts[dataset] || 0) + 1;
    });

    return {
      type: 'FeatureCollection',
      features,
      sourceCounts,
      warnings
    };
  };

  host.GridAtlasRegionalSources = Object.freeze({
    version: '2.2.0',
    load
  });
})();
