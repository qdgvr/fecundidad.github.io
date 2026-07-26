(() => {
  'use strict';

  const root = document.querySelector('[data-grid-atlas]');
  if (!root) return;

  const mapContainer = root.querySelector('[data-grid-map]');
  const status = root.querySelector('[data-map-status]');
  const openMap = root.querySelector('[data-open-map]');
  const layersButton = root.querySelector('[data-layers-button]');
  const layersPanel = root.querySelector('[data-layers-panel]');
  const scopeButton = root.querySelector('[data-scope-button]');
  const scopePanel = root.querySelector('[data-scope-panel]');
  const regionLabel = root.querySelector('[data-region-label]');
  const sourceLabel = root.querySelector('[data-source-label]');
  const visibleLabel = root.querySelector('[data-visible-label]');
  const dataStatus = root.querySelector('[data-data-status]');
  const sourceSummary = root.querySelector('[data-source-summary]');
  const officialCredit = root.querySelector('[data-official-credit]');
  const profileTitle = root.querySelector('[data-profile-title]');
  const profileSummary = root.querySelector('[data-profile-summary]');
  const profileMetrics = root.querySelector('[data-profile-metrics]');
  const profileLinks = root.querySelector('[data-profile-links]');
  const inventoryPanel = root.querySelector('[data-official-inventory]');
  const inventoryTitle = root.querySelector('[data-inventory-title]');
  const inventorySummary = root.querySelector('[data-inventory-summary]');
  const inventorySearch = root.querySelector('[data-inventory-search]');
  const inventoryList = root.querySelector('[data-inventory-list]');
  const inventoryDetail = root.querySelector('[data-inventory-detail]');
  const inventoryNote = root.querySelector('[data-inventory-note]');
  const inventoryPrevious = root.querySelector('[data-inventory-previous]');
  const inventoryNext = root.querySelector('[data-inventory-next]');
  const inventoryPageStatus = root.querySelector('[data-inventory-page-status]');
  const voltageSelect = root.querySelector('[data-voltage-filter]');
  const filterStatus = root.querySelector('[data-filter-status]');
  const featureStatus = root.querySelector('[data-feature-status]');
  const mapWarning = root.querySelector('[data-map-warning]');
  const regionButtons = [...root.querySelectorAll('[data-region-button]')];
  const layerToggleInputs = [...root.querySelectorAll('[data-layer-toggle]')];
  const voltageLegendItems = [...root.querySelectorAll('[data-voltage-value]')];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isNarrow = () => window.matchMedia('(max-width: 640px)').matches;

  let map;
  let selectedButton;
  let activePopup;
  let resizeTimer;
  let loadingTimer;
  let regionRequest = 0;
  let sourceErrorCount = 0;
  let officialRequest = 0;
  let officialAbortController;
  let officialLoadTimer;
  let officialFeatureCount = 0;
  let officialQueryKey = '';
  let hifldState = 'idle';
  let regionalRequest = 0;
  let regionalAbortController;
  let regionalFeatureCount = 0;
  let regionalSourceCounts = {};
  let regionalWarnings = [];
  let regionalQueryKey = '';
  let regionalState = 'idle';
  let regionProfiles = {};
  let inventoryRegion = '';
  let inventoryRecords = [];
  let inventorySelectedKey = '';
  let inventoryPage = 0;
  let inventoryLoadToken = 0;
  let taiwanFeatureCount = 5570;
  let taiwanSourceRequested = false;
  let taiwanSourceState = 'idle';
  let eiaSourceRequested = false;
  let eiaSourceState = 'idle';
  let eiaFeatureCount = 0;
  let kpgSourceRequested = false;
  let kpgSourceState = 'idle';
  let kpgFeatureCount = 0;
  let hoverFrame = 0;
  let hoverPoint;
  let popupSequence = 0;
  const taiwanSourcePointCount = 505791;
  const taiwanExpectedFeatureCount = 5570;
  const eiaExpectedFeatureCount = 15764;
  const kpgExpectedFeatureCount = 580;
  const officialDataCache = new Map();
  const regionalDataCache = new Map();
  const inventoryDataCache = new Map();
  const hoverAvailable = window.matchMedia('(hover: hover)').matches;
  const inventoryConfigs = Object.freeze({
    china: {
      url: 'data/grid-atlas/china-nea-hvdc-systems.json?v=1',
      loadingTitle: '51 sistemas HVDC · NEA 2024',
      searchPlaceholder: 'Sistema, terminal, tensión, red…'
    },
    'corea-del-sur': {
      url: 'data/grid-atlas/kepco-transmission-projects.json?v=1',
      loadingTitle: '848 proyectos enumerados · KEPCO',
      searchPlaceholder: 'Proyecto, etapa, tensión, oficina…'
    }
  });
  const osmPowerSnapshot = '2026-07-25T20:21:51Z';
  const osmPowerArchiveVersion = 'osm-power-2026-07-25-schema1';
  const osmPowerArchives = Object.freeze({
    europa: 'data/grid-atlas/osm-power/europa.pmtiles',
    'estados-unidos': 'data/grid-atlas/osm-power/estados-unidos.pmtiles',
    china: 'data/grid-atlas/osm-power/china.pmtiles',
    japon: 'data/grid-atlas/osm-power/japon.pmtiles',
    'corea-del-sur': 'data/grid-atlas/osm-power/corea-del-sur.pmtiles',
    taiwan: 'data/grid-atlas/osm-power/taiwan.pmtiles'
  });
  const osmPowerArchiveUrl = regionKey => {
    const archive = osmPowerArchives[regionKey];
    if (!archive) return '';
    const url = new URL(archive, window.location.href);
    url.searchParams.set('v', osmPowerArchiveVersion);
    return `pmtiles://${url.href}`;
  };
  let activePowerRegion = '';

  const emptyFeatureCollection = () => ({
    type: 'FeatureCollection',
    features: []
  });
  const usTransmissionService = 'https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/US_Electric_Power_Transmission_Lines/FeatureServer/0/query';

  const numberProperty = key => ['to-number', ['coalesce', ['get', key], 0], 0];
  const voltage = numberProperty('voltage');
  const voltageValues = [
    voltage,
    numberProperty('voltage_2'),
    numberProperty('voltage_3'),
    numberProperty('voltage_4')
  ];
  const frequency = ['to-number', ['coalesce', ['get', 'frequency'], 50], 50];
  const output = numberProperty('output');
  const officialVoltage = numberProperty('VOLTAGE');
  const kpgVoltage = numberProperty('VOLTAGE_KV');
  const gemCapacity = numberProperty('capacity-(mw)');
  const eiaCapacity = numberProperty('dm');
  const eiaCurrentUnits = numberProperty('cu');
  const eiaPlannedUnits = numberProperty('pu');
  const zoom = ['zoom'];
  const construction = ['coalesce', ['get', 'construction'], false];
  const disused = ['coalesce', ['get', 'disused'], false];

  const voltageColor = [
    'case',
    ['==', frequency, 0],
    '#4E01B5',
    [
      'step',
      voltage,
      '#7A7A85',
      9.99, '#6E97B8',
      24.99, '#55B555',
      51.99, '#B59F10',
      131.99, '#B55D00',
      219.99, '#C73030',
      309.99, '#B54EB2',
      549.99, '#00C1CF'
    ]
  ];

  const sourceColor = [
    'match',
    ['coalesce', ['get', 'source'], ''],
    'wind', '#6eb6cb',
    'solar', '#e7b54a',
    'hydro', '#4f93c7',
    'nuclear', '#c589c9',
    'gas', '#d78055',
    'coal', '#898989',
    'geothermal', '#c26355',
    'biomass', '#73a976',
    '#d8d0c2'
  ];

  const gemTypeColor = [
    'match',
    ['coalesce', ['get', 'type'], ''],
    'wind', '#6eb6cb',
    'utility-scale solar', '#e7b54a',
    'hydropower', '#4f93c7',
    'nuclear', '#c589c9',
    'oil/gas', '#d78055',
    'coal', '#898989',
    'geothermal', '#c26355',
    'bioenergy', '#73a976',
    '#d8d0c2'
  ];

  const gemPlantVisible = [
    'any',
    ['>=', zoom, 8],
    ['>', gemCapacity, 1000],
    ['all', ['>', gemCapacity, 500], ['>=', zoom, 5]],
    ['all', ['>', gemCapacity, 250], ['>=', zoom, 6]],
    ['all', ['>', gemCapacity, 50], ['>=', zoom, 7]]
  ];

  const eiaPlantVisible = [
    'any',
    ['>', eiaCapacity, 1000],
    ['all', ['>', eiaCapacity, 500], ['>=', zoom, 5]],
    ['all', ['>', eiaCapacity, 250], ['>=', zoom, 6]],
    ['all', ['>', eiaCapacity, 50], ['>=', zoom, 7]],
    ['>=', zoom, 8]
  ];

  const underground = [
    'any',
    ['==', ['get', 'location'], 'underground'],
    ['==', ['get', 'location'], 'underwater'],
    ['==', ['get', 'tunnel'], true],
    [
      'all',
      ['==', ['get', 'type'], 'cable'],
      ['==', ['coalesce', ['get', 'location'], ''], '']
    ],
    [
      'all',
      ['==', ['get', 'type'], 'minor_cable'],
      ['==', ['coalesce', ['get', 'location'], ''], '']
    ]
  ];

  const powerVisible = [
    'all',
    [
      'any',
      ['==', frequency, 0],
      ['>', voltage, 199],
      ['all', ['>', voltage, 99], ['>=', zoom, 4]],
      ['all', ['>', voltage, 49], ['>=', zoom, 5]],
      ['all', ['>', voltage, 24], ['>=', zoom, 6]],
      ['all', ['>', voltage, 9], ['>=', zoom, 9]],
      ['>', zoom, 10]
    ],
    [
      'any',
      [
        'all',
        ['!=', ['get', 'line'], 'busbar'],
        ['!=', ['get', 'line'], 'bay']
      ],
      ['>', zoom, 12]
    ]
  ];

  const substationVisible = [
    'all',
    [
      'any',
      ['all', ['>=', zoom, 5], ['>', voltage, 200]],
      ['all', ['>=', zoom, 9], ['>', voltage, 50]],
      ['>=', zoom, 10]
    ],
    [
      'any',
      ['!=', ['get', 'substation'], 'transition'],
      ['>', zoom, 12]
    ]
  ];

  const plantVisible = [
    'any',
    ['>', output, 1000],
    ['all', ['>', output, 500], ['>=', zoom, 6]],
    ['all', ['>', output, 250], ['>=', zoom, 7]],
    ['>=', zoom, 8]
  ];

  const layerGroups = {
    official: [
      'official-us-line-halo',
      'official-us-line-reported',
      'official-us-line-other',
      'official-us-line-inferred',
      'official-regional-line-halo',
      'official-regional-line',
      'official-regional-planning-halo',
      'official-regional-planning-line',
      'official-regional-area-fill',
      'official-regional-area-outline',
      'official-regional-point',
      'official-switzerland-sfoe',
      'official-taiwan-point',
      'official-us-eia-plant-operating',
      'official-us-eia-plant-planned',
      'official-japan-gsi-line-halo',
      'official-japan-gsi-line',
      'official-japan-gsi-plant'
    ],
    'model-corridors': [
      'model-corridor-halo',
      'model-corridor-line'
    ],
    'kpg-model': [
      'kpg193-line-halo',
      'kpg193-line',
      'kpg193-bus'
    ],
    'gem-plants': ['gem-plant-operating', 'gem-plant-construction'],
    'gem-planned': ['gem-plant-planned'],
    'gem-retired': ['gem-plant-retired'],
    overhead: ['power-line-overhead'],
    underground: ['power-line-underground'],
    substations: [
      'power-substation-areas',
      'power-substation-points',
      'power-converter-points'
    ],
    plants: ['power-plant-areas', 'power-plant-points'],
    generators: ['power-generator-areas', 'power-generator-points'],
    equipment: [
      'power-transformer-points',
      'power-switch-points',
      'power-compensator-points'
    ],
    construction: ['power-line-construction'],
    disused: ['power-line-disused']
  };

  const interactiveLayers = [
    'gem-plant-operating',
    'gem-plant-construction',
    'gem-plant-planned',
    'gem-plant-retired',
    'power-converter-points',
    'power-generator-points',
    'power-transformer-points',
    'power-switch-points',
    'power-compensator-points',
    'power-plant-points',
    'power-substation-points',
    'power-line-construction',
    'power-line-disused',
    'power-line-underground',
    'power-line-overhead',
    'official-us-line-reported',
    'official-us-line-other',
    'official-us-line-inferred',
    'official-regional-line',
    'official-regional-planning-line',
    'official-regional-area-fill',
    'official-regional-point',
    'official-taiwan-point',
    'official-us-eia-plant-planned',
    'official-us-eia-plant-operating',
    'official-japan-gsi-line',
    'official-japan-gsi-plant',
    'model-corridor-line',
    'kpg193-line',
    'kpg193-bus',
    'power-generator-areas',
    'power-substation-areas',
    'power-plant-areas'
  ];

  const style = {
    version: 8,
    name: 'Comunicación · mosaicos OSM propios',
    sources: {
      basemap: {
        type: 'geojson',
        data: 'data/world-countries.geojson?v=1'
      },
      power: {
        type: 'vector',
        url: osmPowerArchiveUrl('europa'),
        minzoom: 2,
        maxzoom: 12,
        attribution: `© OpenStreetMap contributors · ODbL 1.0 · snapshot ${osmPowerSnapshot}`
      },
      'power-centroids': {
        type: 'vector',
        url: osmPowerArchiveUrl('europa'),
        minzoom: 2,
        maxzoom: 11
      },
      gem: {
        type: 'vector',
        tiles: ['https://mapsintegrated.nyc3.cdn.digitaloceanspaces.com/maps/integrated-2026-04/{z}/{x}/{y}.pbf'],
        minzoom: 0,
        maxzoom: 14,
        attribution: 'Global Integrated Power Tracker, Global Energy Monitor, March 2026'
      },
      'official-us-lines': {
        type: 'geojson',
        data: emptyFeatureCollection(),
        promoteId: 'ID',
        attribution: 'U.S. Government, HIFLD/EIA transmission lines, 2024-09-30'
      },
      'official-regional': {
        type: 'geojson',
        data: emptyFeatureCollection(),
        attribution: 'Regional official open-data publishers; see feature provenance'
      },
      'official-switzerland-sfoe': {
        type: 'raster',
        tiles: [
          'https://wms.geo.admin.ch/?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ch.bfe.elektrische-anlagen_ueber_36&STYLES=&CRS=EPSG%3A3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image%2Fpng&TRANSPARENT=TRUE'
        ],
        tileSize: 256,
        attribution: 'Plant operators and Swiss Federal Office of Energy (SFOE)'
      },
      'official-taiwan': {
        type: 'geojson',
        data: emptyFeatureCollection(),
        generateId: true,
        attribution: 'Taiwan Power Company / data.gov.tw, OGDL 1.0'
      },
      'official-us-eia-plants': {
        type: 'geojson',
        data: emptyFeatureCollection(),
        attribution: 'U.S. Energy Information Administration, EIA-860M June 2026 · public domain'
      },
      'official-japan-gsi': {
        type: 'vector',
        tiles: ['https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/{z}/{x}/{y}.pbf'],
        minzoom: 4,
        maxzoom: 16,
        attribution: 'Geospatial Information Authority of Japan · experimental vector tiles'
      },
      'model-corridors': {
        type: 'geojson',
        data: 'data/grid-atlas/model-corridors.geojson?v=1',
        attribution: 'Official capacity facts; geometry explicitly modelled'
      },
      'kpg193-model': {
        type: 'geojson',
        data: emptyFeatureCollection(),
        attribution: 'KPG 193 v2.0, AGM Center / KENTECH · ODbL 1.0 · map data © OpenStreetMap contributors'
      }
    },
    layers: [
      {
        id: 'atlas-background',
        type: 'background',
        paint: { 'background-color': '#0b1115' }
      },
      {
        id: 'atlas-landcover',
        type: 'fill',
        source: 'basemap',
        paint: {
          'fill-color': '#151a1d',
          'fill-opacity': 0.96
        }
      },
      {
        id: 'atlas-boundaries',
        type: 'line',
        source: 'basemap',
        paint: {
          'line-color': '#7f8b91',
          'line-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 0.46,
            8, 0.7
          ],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 0.55,
            8, 1.05
          ],
          'line-dasharray': [3, 2]
        }
      },
      {
        id: 'power-plant-areas',
        type: 'fill',
        source: 'power',
        'source-layer': 'power_plant',
        minzoom: 8,
        paint: {
          'fill-color': '#ddd6c6',
          'fill-opacity': 0.16,
          'fill-outline-color': '#eee6d5'
        }
      },
      {
        id: 'power-generator-areas',
        type: 'fill',
        source: 'power',
        'source-layer': 'power_generator_area',
        minzoom: 12,
        paint: {
          'fill-color': sourceColor,
          'fill-opacity': 0.22,
          'fill-outline-color': sourceColor
        }
      },
      {
        id: 'power-substation-areas',
        type: 'fill',
        source: 'power',
        'source-layer': 'power_substation',
        filter: substationVisible,
        minzoom: 12,
        paint: {
          'fill-color': voltageColor,
          'fill-opacity': 0.15,
          'fill-outline-color': voltageColor
        }
      },
      {
        id: 'power-line-disused',
        type: 'line',
        source: 'power',
        'source-layer': 'power_line',
        minzoom: 2,
        paint: {
          'line-color': '#8b8b8b',
          'line-opacity': 0.72,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 0.65,
            10, 2.2,
            15, 4.2
          ],
          'line-dasharray': [1, 2]
        }
      },
      {
        id: 'power-line-construction',
        type: 'line',
        source: 'power',
        'source-layer': 'power_line',
        minzoom: 2,
        paint: {
          'line-color': '#a38b10',
          'line-opacity': 0.9,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 0.65,
            10, 2.25,
            15, 4.3
          ],
          'line-dasharray': [4, 2]
        }
      },
      {
        id: 'power-line-underground',
        type: 'line',
        source: 'power',
        'source-layer': 'power_line',
        minzoom: 2,
        paint: {
          'line-color': voltageColor,
          'line-opacity': 0.9,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 0.55,
            6, 1.05,
            10, 2,
            15, 4.2
          ],
          'line-dasharray': [2, 2]
        }
      },
      {
        id: 'power-line-overhead',
        type: 'line',
        source: 'power',
        'source-layer': 'power_line',
        minzoom: 2,
        paint: {
          'line-color': voltageColor,
          'line-opacity': 0.92,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 0.55,
            6, 1.1,
            10, 2.15,
            15, 4.3
          ]
        }
      },
      {
        id: 'official-us-line-halo',
        type: 'line',
        source: 'official-us-lines',
        minzoom: 2,
        paint: {
          'line-color': '#050708',
          'line-opacity': 0.9,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 2.2,
            7, 4.8,
            12, 8
          ]
        }
      },
      {
        id: 'official-us-line-reported',
        type: 'line',
        source: 'official-us-lines',
        minzoom: 2,
        filter: ['all', ['!=', ['get', 'INFERRED'], 'Y'], ['==', ['get', 'STATUS'], 'IN SERVICE']],
        paint: {
          'line-color': [
            'step',
            officialVoltage,
            '#7a7a85',
            100, '#b55d00',
            220, '#c73030',
            310, '#b54eb2',
            550, '#00c1cf'
          ],
          'line-opacity': 0.98,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 1.1,
            7, 2.6,
            12, 4.8
          ]
        }
      },
      {
        id: 'official-us-line-other',
        type: 'line',
        source: 'official-us-lines',
        minzoom: 2,
        filter: ['all', ['!=', ['get', 'INFERRED'], 'Y'], ['!=', ['get', 'STATUS'], 'IN SERVICE']],
        paint: {
          'line-color': [
            'step',
            officialVoltage,
            '#7a7a85',
            100, '#b55d00',
            220, '#c73030',
            310, '#b54eb2',
            550, '#00c1cf'
          ],
          'line-opacity': 0.94,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 1.1,
            7, 2.6,
            12, 4.8
          ],
          'line-dasharray': [4, 2]
        }
      },
      {
        id: 'official-us-line-inferred',
        type: 'line',
        source: 'official-us-lines',
        minzoom: 2,
        filter: ['==', ['get', 'INFERRED'], 'Y'],
        paint: {
          'line-color': [
            'step',
            officialVoltage,
            '#7a7a85',
            100, '#b55d00',
            220, '#c73030',
            310, '#b54eb2',
            550, '#00c1cf'
          ],
          'line-opacity': 0.82,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 1,
            7, 2.4,
            12, 4.4
          ],
          'line-dasharray': [1, 2]
        }
      },
      {
        id: 'official-regional-line-halo',
        type: 'line',
        source: 'official-regional',
        minzoom: 2,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
          'line-color': '#050708',
          'line-opacity': 0.88,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 2.2,
            7, 4.8,
            12, 8
          ]
        }
      },
      {
        id: 'official-regional-line',
        type: 'line',
        source: 'official-regional',
        minzoom: 2,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
          'line-color': [
            'step',
            officialVoltage,
            '#7a7a85',
            100, '#b55d00',
            220, '#c73030',
            310, '#b54eb2',
            550, '#00c1cf'
          ],
          'line-opacity': [
            'case',
            ['match', ['coalesce', ['get', 'STATUS'], ''], ['closed', 'inactive'], true, false],
            0.56,
            0.98
          ],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 1.1,
            7, 2.6,
            12, 4.8
          ],
          'line-dasharray': [1, 0]
        }
      },
      {
        id: 'official-regional-planning-halo',
        type: 'line',
        source: 'official-regional',
        minzoom: 3,
        filter: [
          'all',
          ['==', ['geometry-type'], 'LineString'],
          ['==', ['coalesce', ['get', 'ASSET_KIND'], ''], 'planning_line']
        ],
        paint: {
          'line-color': '#050708',
          'line-opacity': 0.86,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            3, 2.8,
            7, 5.2,
            12, 8
          ],
          'line-dasharray': [3, 2]
        }
      },
      {
        id: 'official-regional-planning-line',
        type: 'line',
        source: 'official-regional',
        minzoom: 3,
        filter: [
          'all',
          ['==', ['geometry-type'], 'LineString'],
          ['==', ['coalesce', ['get', 'ASSET_KIND'], ''], 'planning_line']
        ],
        paint: {
          'line-color': '#e7b54a',
          'line-opacity': 0.95,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            3, 1.4,
            7, 2.8,
            12, 4.6
          ],
          'line-dasharray': [3, 2]
        }
      },
      {
        id: 'official-regional-area-fill',
        type: 'fill',
        source: 'official-regional',
        minzoom: 8,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'fill-color': '#36babc',
          'fill-opacity': 0.28
        }
      },
      {
        id: 'official-regional-area-outline',
        type: 'line',
        source: 'official-regional',
        minzoom: 8,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'line-color': '#8ee5e3',
          'line-opacity': 0.92,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            8, 1,
            13, 2.4
          ]
        }
      },
      {
        id: 'official-switzerland-sfoe',
        type: 'raster',
        source: 'official-switzerland-sfoe',
        minzoom: 4,
        maxzoom: 15,
        layout: { visibility: 'none' },
        paint: {
          'raster-opacity': 0.8,
          'raster-fade-duration': 120
        }
      },
      {
        id: 'model-corridor-halo',
        type: 'line',
        source: 'model-corridors',
        minzoom: 2,
        filter: false,
        layout: { visibility: 'none' },
        paint: {
          'line-color': '#050708',
          'line-opacity': 0.92,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 3.4,
            8, 6.2,
            12, 9
          ]
        }
      },
      {
        id: 'model-corridor-line',
        type: 'line',
        source: 'model-corridors',
        minzoom: 2,
        filter: false,
        layout: { visibility: 'none' },
        paint: {
          'line-color': [
            'case',
            ['==', ['coalesce', ['get', 'LINE_TYPE'], ''], 'HVDC'],
            '#7f57cf',
            '#e7b54a'
          ],
          'line-opacity': 0.96,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 1.8,
            8, 3.4,
            12, 5
          ],
          'line-dasharray': [3, 2]
        }
      },
      {
        id: 'kpg193-line-halo',
        type: 'line',
        source: 'kpg193-model',
        minzoom: 4,
        filter: false,
        layout: { visibility: 'none' },
        paint: {
          'line-color': '#050708',
          'line-opacity': 0.88,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            4, 2.6,
            8, 4.8,
            12, 7
          ]
        }
      },
      {
        id: 'kpg193-line',
        type: 'line',
        source: 'kpg193-model',
        minzoom: 4,
        filter: false,
        layout: { visibility: 'none' },
        paint: {
          'line-color': [
            'case',
            ['==', ['coalesce', ['get', 'ASSET_KIND'], ''], 'model_hvdc_link'],
            '#7f57cf',
            [
              'step',
              kpgVoltage,
              '#7a7a85',
              100, '#b55d00',
              220, '#c73030',
              310, '#b54eb2',
              550, '#00c1cf'
            ]
          ],
          'line-opacity': [
            'case',
            ['==', ['coalesce', ['get', 'STATUS'], ''], 'out_of_service'],
            0.42,
            0.84
          ],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            4, 1.2,
            8, 2.4,
            12, 3.8
          ],
          'line-dasharray': [2, 2]
        }
      },
      {
        id: 'kpg193-bus',
        type: 'circle',
        source: 'kpg193-model',
        minzoom: 5,
        filter: false,
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5, 1.8,
            8, 3.6,
            12, 6
          ],
          'circle-color': [
            'step',
            kpgVoltage,
            '#7a7a85',
            100, '#b55d00',
            220, '#c73030',
            310, '#b54eb2',
            550, '#00c1cf'
          ],
          'circle-opacity': 0.94,
          'circle-stroke-color': '#050708',
          'circle-stroke-width': 1.2
        }
      },
      {
        id: 'official-regional-point',
        type: 'circle',
        source: 'official-regional',
        minzoom: 4,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            4, 2.4,
            8, 4.8,
            13, 7
          ],
          'circle-color': '#36babc',
          'circle-opacity': 0.95,
          'circle-stroke-color': '#050708',
          'circle-stroke-width': 1.3
        }
      },
      {
        id: 'official-taiwan-point',
        type: 'circle',
        source: 'official-taiwan',
        minzoom: 6,
        filter: ['==', ['coalesce', ['get', 'REGION_KEY'], 'taiwan'], 'taiwan'],
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            6, 1,
            7, 2,
            10, 4.2,
            14, 7
          ],
          'circle-color': [
            'step',
            ['to-number', ['coalesce', ['get', 'CAPACITY_MAX_KW'], 0], 0],
            '#6e97b8',
            100, '#55b555',
            500, '#e7b54a',
            1000, '#c73030'
          ],
          'circle-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            6, 0.48,
            8, 0.72,
            10, 0.9
          ],
          'circle-stroke-color': '#050708',
          'circle-stroke-width': 1.2
        }
      },
      {
        id: 'official-us-eia-plant-operating',
        type: 'circle',
        source: 'official-us-eia-plants',
        minzoom: 3,
        filter: ['all', ['>', eiaCurrentUnits, 0], eiaPlantVisible],
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            3, 1.7,
            7, 3.5,
            12, 6.8
          ],
          'circle-color': '#36babc',
          'circle-opacity': 0.88,
          'circle-stroke-color': '#050708',
          'circle-stroke-width': 1.2
        }
      },
      {
        id: 'official-us-eia-plant-planned',
        type: 'circle',
        source: 'official-us-eia-plants',
        minzoom: 3,
        filter: ['all', ['>', eiaPlannedUnits, 0], eiaPlantVisible],
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            3, 2.6,
            7, 4.8,
            12, 8.4
          ],
          'circle-color': '#e7b54a',
          'circle-opacity': 0.2,
          'circle-stroke-color': '#e7b54a',
          'circle-stroke-opacity': 0.98,
          'circle-stroke-width': 1.8
        }
      },
      {
        id: 'official-japan-gsi-line-halo',
        type: 'line',
        source: 'official-japan-gsi',
        'source-layer': 'structurel',
        minzoom: 14,
        maxzoom: 17,
        filter: ['==', ['to-number', ['get', 'ftCode']], 8202],
        paint: {
          'line-color': '#050708',
          'line-opacity': 0.92,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14, 4.2,
            16, 7
          ]
        }
      },
      {
        id: 'official-japan-gsi-line',
        type: 'line',
        source: 'official-japan-gsi',
        'source-layer': 'structurel',
        minzoom: 14,
        maxzoom: 17,
        filter: ['==', ['to-number', ['get', 'ftCode']], 8202],
        paint: {
          'line-color': '#36babc',
          'line-opacity': 0.98,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14, 2,
            16, 4.2
          ]
        }
      },
      {
        id: 'official-japan-gsi-plant',
        type: 'circle',
        source: 'official-japan-gsi',
        'source-layer': 'label',
        minzoom: 13,
        maxzoom: 17,
        filter: [
          'all',
          ['==', ['to-number', ['get', 'ftCode']], 100],
          ['==', ['to-number', ['get', 'annoCtg']], 653]
        ],
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            13, 3.2,
            16, 5.4
          ],
          'circle-color': '#f2eadb',
          'circle-opacity': 0.95,
          'circle-stroke-color': '#36babc',
          'circle-stroke-width': 1.5
        }
      },
      {
        id: 'power-plant-points',
        type: 'circle',
        source: 'power',
        'source-layer': 'power_plant_point',
        filter: plantVisible,
        minzoom: 5,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5, 1.7,
            8, 3.4,
            13, 6.5
          ],
          'circle-color': '#f2eadb',
          'circle-opacity': 0.9,
          'circle-stroke-color': '#090c0e',
          'circle-stroke-width': 1
        }
      },
      {
        id: 'power-generator-points',
        type: 'circle',
        source: 'power',
        'source-layer': 'power_generator',
        minzoom: 9,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            9, 1.8,
            13, 3.6,
            16, 5
          ],
          'circle-color': sourceColor,
          'circle-opacity': 0.9,
          'circle-stroke-color': '#090c0e',
          'circle-stroke-width': 1
        }
      },
      {
        id: 'power-substation-points',
        type: 'circle',
        source: 'power',
        'source-layer': 'power_substation_point',
        minzoom: 5,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5, 1.25,
            9, 2.6,
            14, 5.5
          ],
          'circle-color': '#0b1115',
          'circle-stroke-color': voltageColor,
          'circle-stroke-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5, 0.8,
            12, 1.7
          ]
        }
      },
      {
        id: 'power-converter-points',
        type: 'circle',
        source: 'power',
        'source-layer': 'power_substation_point',
        minzoom: 5,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5, 2,
            10, 4,
            14, 6.5
          ],
          'circle-color': '#4e01b5',
          'circle-stroke-color': '#d8cfff',
          'circle-stroke-width': 1.4
        }
      },
      {
        id: 'power-transformer-points',
        type: 'circle',
        source: 'power',
        'source-layer': 'power_transformer',
        minzoom: 12,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12, 3,
            16, 5
          ],
          'circle-color': '#36babc',
          'circle-stroke-color': '#061012',
          'circle-stroke-width': 1.2
        },
        layout: { visibility: 'none' }
      },
      {
        id: 'power-switch-points',
        type: 'circle',
        source: 'power',
        'source-layer': 'power_switch',
        minzoom: 12,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12, 2.4,
            16, 4.2
          ],
          'circle-color': '#e4a451',
          'circle-stroke-color': '#100b05',
          'circle-stroke-width': 1.1
        },
        layout: { visibility: 'none' }
      },
      {
        id: 'power-compensator-points',
        type: 'circle',
        source: 'power',
        'source-layer': 'power_compensator',
        minzoom: 12,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12, 2.6,
            16, 4.5
          ],
          'circle-color': '#728de5',
          'circle-stroke-color': '#080b16',
          'circle-stroke-width': 1.1
        },
        layout: { visibility: 'none' }
      },
      {
        id: 'gem-plant-operating',
        type: 'circle',
        source: 'gem',
        'source-layer': 'integrated',
        filter: ['all', gemPlantVisible, ['==', ['get', 'status'], 'operating']],
        minzoom: 2,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            gemCapacity,
            0, 2,
            250, 3,
            1000, 5.2,
            5000, 9,
            15000, 13
          ],
          'circle-color': gemTypeColor,
          'circle-opacity': 0.92,
          'circle-stroke-color': '#f5f1e9',
          'circle-stroke-opacity': 0.78,
          'circle-stroke-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 0.5,
            10, 1.2
          ]
        }
      },
      {
        id: 'gem-plant-construction',
        type: 'circle',
        source: 'gem',
        'source-layer': 'integrated',
        filter: ['all', gemPlantVisible, ['==', ['get', 'status'], 'construction']],
        minzoom: 2,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            gemCapacity,
            0, 2,
            250, 3,
            1000, 5.2,
            5000, 9,
            15000, 13
          ],
          'circle-color': gemTypeColor,
          'circle-opacity': 0.38,
          'circle-stroke-color': '#f0d45c',
          'circle-stroke-opacity': 1,
          'circle-stroke-width': 1.4
        }
      },
      {
        id: 'gem-plant-planned',
        type: 'circle',
        source: 'gem',
        'source-layer': 'integrated',
        filter: [
          'all',
          gemPlantVisible,
          ['in', ['get', 'status'], ['literal', ['pre-construction', 'announced']]]
        ],
        minzoom: 2,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            gemCapacity,
            0, 2,
            250, 3,
            1000, 5.2,
            5000, 9,
            15000, 13
          ],
          'circle-color': '#0b1115',
          'circle-opacity': 0.72,
          'circle-stroke-color': gemTypeColor,
          'circle-stroke-opacity': 0.9,
          'circle-stroke-width': 1.4
        },
        layout: { visibility: 'none' }
      },
      {
        id: 'gem-plant-retired',
        type: 'circle',
        source: 'gem',
        'source-layer': 'integrated',
        filter: [
          'all',
          gemPlantVisible,
          ['in', ['get', 'status'], ['literal', ['retired', 'mothballed']]]
        ],
        minzoom: 2,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            gemCapacity,
            0, 2,
            250, 3,
            1000, 5.2,
            5000, 9,
            15000, 13
          ],
          'circle-color': '#707070',
          'circle-opacity': 0.32,
          'circle-stroke-color': '#a4a4a4',
          'circle-stroke-opacity': 0.65,
          'circle-stroke-width': 1
        },
        layout: { visibility: 'none' }
      }
    ]
  };

  const centroidTransitionLayerIds = [
    'power-plant-points',
    'power-generator-points',
    'power-substation-points',
    'power-converter-points'
  ];
  const centroidOverzoomLayerId = layerId => `${layerId}-overzoom`;
  centroidTransitionLayerIds.forEach(layerId => {
    const layerIndex = style.layers.findIndex(layer => layer.id === layerId);
    if (layerIndex < 0) return;
    const primaryLayer = style.layers[layerIndex];
    primaryLayer.maxzoom = 12;
    const overzoomLayer = {
      ...primaryLayer,
      id: centroidOverzoomLayerId(layerId),
      source: 'power-centroids',
      minzoom: 12
    };
    delete overzoomLayer.maxzoom;
    style.layers.splice(layerIndex + 1, 0, overzoomLayer);
  });
  for (const groupName of ['substations', 'plants', 'generators']) {
    layerGroups[groupName] = layerGroups[groupName].flatMap(layerId => (
      centroidTransitionLayerIds.includes(layerId)
        ? [layerId, centroidOverzoomLayerId(layerId)]
        : [layerId]
    ));
  }
  centroidTransitionLayerIds.forEach(layerId => {
    const layerIndex = interactiveLayers.indexOf(layerId);
    if (layerIndex >= 0) {
      interactiveLayers.splice(
        layerIndex + 1,
        0,
        centroidOverzoomLayerId(layerId)
      );
    }
  });

  const getLayerState = key => {
    const input = layerToggleInputs.find(item => item.dataset.layerToggle === key);
    return input ? input.checked : true;
  };

  const getMinimumVoltage = () => Number(voltageSelect?.value || 100);

  const voltageGate = () => {
    const minimum = getMinimumVoltage();
    if (minimum <= 0) return true;
    return [
      'any',
      ['==', frequency, 0],
      ...voltageValues.map(value => ['>=', value, minimum])
    ];
  };

  const officialUsAutomaticMinimum = currentZoom => {
    if (currentZoom < 4) return 345;
    if (currentZoom < 5) return 220;
    if (currentZoom < 7) return 100;
    return 69;
  };

  const officialUsMinimumVoltage = () => {
    const userMinimum = getMinimumVoltage();
    const automaticMinimum = officialUsAutomaticMinimum(map ? map.getZoom() : 3);
    return Math.max(userMinimum > 0 ? userMinimum : 0, automaticMinimum);
  };

  const regionalOfficialMinimumVoltage = () => (
    root.dataset.activeRegion === 'estados-unidos'
      ? officialUsMinimumVoltage()
      : Math.max(getMinimumVoltage(), 0)
  );

  const officialVoltageGate = () => ['>=', officialVoltage, officialUsMinimumVoltage()];

  const officialStatusFilter = kind => {
    const reported = ['!=', ['get', 'INFERRED'], 'Y'];
    const inferred = ['==', ['get', 'INFERRED'], 'Y'];
    const inService = ['==', ['get', 'STATUS'], 'IN SERVICE'];
    if (kind === 'reported') return ['all', officialVoltageGate(), reported, inService];
    if (kind === 'other') return ['all', officialVoltageGate(), reported, ['!', inService]];
    if (kind === 'inferred') return ['all', officialVoltageGate(), inferred];
    return officialVoltageGate();
  };

  const regionalOfficialFilter = (geometryType, mode = 'standard') => {
    const minimum = regionalOfficialMinimumVoltage();
    const kind = ['==', ['geometry-type'], geometryType];
    const planning = [
      '==',
      ['coalesce', ['get', 'ASSET_KIND'], ''],
      'planning_line'
    ];
    const assetGate = mode === 'planning'
      ? planning
      : geometryType === 'LineString'
        ? ['!', planning]
        : true;
    const base = ['all', kind, assetGate];
    if (minimum <= 0) return base;
    const filterVoltage = [
      'to-number',
      ['coalesce', ['get', 'VOLTAGE'], ['get', 'VOLTAGE_FILTER_KV'], 0],
      0
    ];
    const unfilteredOfficialTransmission = [
      '==',
      ['coalesce', ['get', 'VOLTAGE_UNFILTERED'], false],
      true
    ];
    return [
      'all',
      ...base.slice(1),
      ['any', ['>=', filterVoltage, minimum], unfilteredOfficialTransmission]
    ];
  };

  const modelCorridorFilter = () => [
    '==',
    ['coalesce', ['get', 'REGION_KEY'], ''],
    root.dataset.activeRegion || 'europa'
  ];

  const kpgModelFilter = geometryType => {
    const minimum = getMinimumVoltage();
    const voltageGate = minimum > 0
      ? ['>=', kpgVoltage, minimum]
      : true;
    return [
      'all',
      ['==', ['coalesce', ['get', 'REGION_KEY'], ''], root.dataset.activeRegion || 'europa'],
      ['==', ['geometry-type'], geometryType],
      voltageGate
    ];
  };

  const positionGate = mode => {
    if (mode === 'overhead') return ['!', underground];
    if (mode === 'underground') return underground;

    const overheadVisible = getLayerState('overhead');
    const undergroundVisible = getLayerState('underground');
    if (overheadVisible && undergroundVisible) return true;
    if (overheadVisible) return ['!', underground];
    if (undergroundVisible) return underground;
    return false;
  };

  const lifecycleGate = state => {
    if (state === 'construction') return ['all', construction, ['!', disused]];
    if (state === 'disused') return disused;
    return ['all', ['!', construction], ['!', disused]];
  };

  const lineFilter = (position, lifecycle) => [
    'all',
    powerVisible,
    voltageGate(),
    positionGate(position),
    lifecycleGate(lifecycle)
  ];

  const substationFilter = converter => {
    const kindFilter = converter
      ? ['==', ['get', 'substation'], 'converter']
      : ['!=', ['get', 'substation'], 'converter'];
    return ['all', substationVisible, voltageGate(), kindFilter];
  };

  const substationAreaFilter = () => ['all', substationVisible, voltageGate()];

  const setDrawer = (button, panel, open) => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };

  const closeDrawers = () => {
    setDrawer(layersButton, layersPanel, false);
    setDrawer(scopeButton, scopePanel, false);
  };

  const toggleDrawer = (button, panel, otherButton, otherPanel) => {
    const open = panel.hidden;
    setDrawer(otherButton, otherPanel, false);
    setDrawer(button, panel, open);
    if (map) window.requestAnimationFrame(() => map.resize());
  };

  const parseBounds = button => {
    const values = button.dataset.bounds.split(',').map(Number);
    return [[values[0], values[1]], [values[2], values[3]]];
  };

  const showMapError = () => {
    window.clearTimeout(loadingTimer);
    root.dataset.mapError = 'true';
    root.dataset.mapReady = 'false';
    status.textContent = 'No se pudo cargar el mapa. Recarga la página para volver a intentarlo.';
    status.hidden = false;
  };

  const setLoading = (text, requestToken) => {
    window.clearTimeout(loadingTimer);
    delete root.dataset.mapError;
    root.dataset.mapReady = 'false';
    sourceErrorCount = 0;
    mapWarning.hidden = true;
    mapWarning.textContent = '';
    status.textContent = text;
    status.hidden = false;
    loadingTimer = window.setTimeout(() => {
      if (requestToken === regionRequest && root.dataset.mapReady !== 'true') showMapError();
    }, 15000);
  };

  const finishLoading = requestToken => {
    if (requestToken !== regionRequest || root.dataset.mapError === 'true') return;
    window.clearTimeout(loadingTimer);
    delete root.dataset.mapError;
    status.hidden = true;
    root.dataset.mapReady = 'true';
  };

  const officialVoltageThreshold = currentZoom => {
    if (currentZoom < 4) return { value: 199, inclusive: false };
    if (currentZoom < 6) return { value: 100, inclusive: false };
    if (currentZoom < 9) return { value: 24, inclusive: false };
    if (currentZoom <= 10) return { value: 9, inclusive: false };
    return null;
  };

  const updateVisibleLabel = () => {
    if (!visibleLabel) return;
    const regionKey = root.dataset.activeRegion;
    const osmLinesVisible = getLayerState('overhead') || getLayerState('underground');
    const officialLinesVisible = (
      ['estados-unidos', 'europa'].includes(regionKey) &&
      getLayerState('official')
    );
    const gsiLinesVisible = (
      regionKey === 'japon' &&
      getLayerState('official')
    );
    const corridorLinesVisible = (
      ['china', 'japon', 'corea-del-sur'].includes(regionKey) &&
      getLayerState('model-corridors')
    );
    const kpgLinesVisible = (
      regionKey === 'corea-del-sur' &&
      getLayerState('kpg-model')
    );
    if (!osmLinesVisible && !officialLinesVisible && !gsiLinesVisible && !corridorLinesVisible && !kpgLinesVisible) {
      visibleLabel.textContent = 'Líneas ocultas';
      return;
    }

    const userMinimum = getMinimumVoltage();
    const automatic = map ? officialVoltageThreshold(map.getZoom()) : { value: 199, inclusive: false };
    let value = userMinimum > 0 ? userMinimum : null;
    let inclusive = true;

    if (automatic && (value === null || automatic.value > value)) {
      value = automatic.value;
      inclusive = automatic.inclusive;
    } else if (automatic && automatic.value === value) {
      inclusive = automatic.inclusive;
    }

    const osmThreshold = value === null
      ? 'todo lo etiquetado'
      : `${inclusive ? '≥' : '>'}${value} kV`;
    const officialThreshold = officialLinesVisible ? regionalOfficialMinimumVoltage() : null;
    const parts = [];
    if (osmLinesVisible) parts.push(`OSM ${osmThreshold} + HVDC`);
    if (officialThreshold !== null) {
      const regionalNames = regionKey === 'europa'
        ? 'IGN/OS/Kadaster/BKG/NVE/BNetzA'
        : 'HIFLD/CEC/BPA';
      parts.push(
        `${regionalNames} ≥${officialThreshold} kV`
      );
      if (regionKey === 'europa' && officialThreshold <= 36) parts.push('SFOE >36 kV');
      if (regionKey === 'europa') parts.push('OS GB · tensión no publicada');
      if (regionKey === 'europa') parts.push('Kadaster NL · tensión no publicada');
    }
    if (gsiLinesVisible) parts.push('GSI oficial z14+ · tensión no publicada');
    if (corridorLinesVisible) parts.push('capacidad esquemática');
    if (kpgLinesVisible) parts.push('topología KPG sintética');
    const fullLabel = `Líneas visibles · ${parts.join(' · ')}`;
    visibleLabel.textContent = isNarrow() ? parts.join(' · ') : fullLabel;
    visibleLabel.setAttribute('aria-label', fullLabel);
    visibleLabel.title = fullLabel;
  };

  const updateLegend = () => {
    const minimum = getMinimumVoltage();
    const bands = [
      { lower: 0, upper: 0, unknown: true },
      { lower: 10, upper: 24 },
      { lower: 25, upper: 51 },
      { lower: 52, upper: 131 },
      { lower: 132, upper: 219 },
      { lower: 220, upper: 309 },
      { lower: 310, upper: 549 },
      { lower: 550, upper: Infinity }
    ];

    voltageLegendItems.forEach((item, index) => {
      const band = bands[index];
      const filtered = band.unknown ? minimum > 0 : band.upper < minimum;
      const partial = !band.unknown && band.lower < minimum && band.upper >= minimum;
      item.classList.toggle('is-filtered', filtered);
      item.classList.toggle('is-partial', partial);
    });
  };

  const announceFilters = () => {
    const minimum = getMinimumVoltage();
    const threshold = minimum > 0 ? `desde ${minimum} kV` : 'sin umbral adicional';
    const enabled = layerToggleInputs
      .filter(input => input.checked)
      .map(input => input.nextElementSibling?.textContent?.trim())
      .filter(Boolean);
    filterStatus.textContent = `Filtro actualizado: tensión ${threshold}. Capas visibles: ${enabled.join(', ') || 'ninguna'}.`;
  };

  const applyFilters = () => {
    if (!map || !map.getLayer('power-line-overhead')) return;

    map.setFilter('power-line-overhead', lineFilter('overhead', 'active'));
    map.setFilter('power-line-underground', lineFilter('underground', 'active'));
    map.setFilter('power-line-construction', lineFilter('either', 'construction'));
    map.setFilter('power-line-disused', lineFilter('either', 'disused'));
    map.setFilter('power-substation-areas', substationAreaFilter());
    map.setFilter('power-substation-points', substationFilter(false));
    map.setFilter('power-substation-points-overzoom', substationFilter(false));
    map.setFilter('power-converter-points', substationFilter(true));
    map.setFilter('power-converter-points-overzoom', substationFilter(true));
    map.setFilter('official-us-line-halo', officialStatusFilter('all'));
    map.setFilter('official-us-line-reported', officialStatusFilter('reported'));
    map.setFilter('official-us-line-other', officialStatusFilter('other'));
    map.setFilter('official-us-line-inferred', officialStatusFilter('inferred'));
    map.setFilter('official-regional-line-halo', regionalOfficialFilter('LineString'));
    map.setFilter('official-regional-line', regionalOfficialFilter('LineString'));
    map.setFilter('official-regional-planning-halo', regionalOfficialFilter('LineString', 'planning'));
    map.setFilter('official-regional-planning-line', regionalOfficialFilter('LineString', 'planning'));
    map.setFilter('official-regional-area-fill', regionalOfficialFilter('Polygon'));
    map.setFilter('official-regional-area-outline', regionalOfficialFilter('Polygon'));
    map.setFilter('official-regional-point', regionalOfficialFilter('Point'));
    map.setFilter('official-taiwan-point', [
      '==',
      ['coalesce', ['get', 'REGION_KEY'], 'taiwan'],
      root.dataset.activeRegion || 'europa'
    ]);
    map.setFilter('model-corridor-halo', modelCorridorFilter());
    map.setFilter('model-corridor-line', modelCorridorFilter());
    map.setFilter('kpg193-line-halo', kpgModelFilter('LineString'));
    map.setFilter('kpg193-line', kpgModelFilter('LineString'));
    map.setFilter('kpg193-bus', kpgModelFilter('Point'));
  };

  const applyLayerVisibility = () => {
    if (!map || !map.getLayer('power-line-overhead')) return;
    Object.entries(layerGroups).forEach(([key, layerIds]) => {
      const visibility = getLayerState(key) ? 'visible' : 'none';
      layerIds.forEach(layerId => map.setLayoutProperty(layerId, 'visibility', visibility));
    });
    const officialVisible = getLayerState('official');
    const regionKey = root.dataset.activeRegion;
    const setRegionVisibility = (layerIds, region) => {
      const visibility = officialVisible && regionKey === region ? 'visible' : 'none';
      layerIds.forEach(layerId => {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', visibility);
      });
    };
    setRegionVisibility(
      ['official-us-eia-plant-operating', 'official-us-eia-plant-planned'],
      'estados-unidos'
    );
    setRegionVisibility(
      ['official-japan-gsi-line-halo', 'official-japan-gsi-line', 'official-japan-gsi-plant'],
      'japon'
    );
    if (map.getLayer('official-switzerland-sfoe')) {
      const swissVisibility = (
        officialVisible &&
        regionKey === 'europa' &&
        getMinimumVoltage() <= 36
      ) ? 'visible' : 'none';
      map.setLayoutProperty('official-switzerland-sfoe', 'visibility', swissVisibility);
    }
  };

  const ensureDeferredSources = () => {
    if (!map) return;
    const regionKey = root.dataset.activeRegion;
    const taiwanSource = map.getSource('official-taiwan');
    const eiaSource = map.getSource('official-us-eia-plants');
    const kpgSource = map.getSource('kpg193-model');

    if (
      regionKey === 'taiwan' &&
      getLayerState('official') &&
      taiwanSource &&
      !taiwanSourceRequested
    ) {
      taiwanSourceRequested = true;
      taiwanSourceState = 'loading';
      root.dataset.taiwanSource = 'loading';
      taiwanSource.setData(
        'data/grid-atlas/taiwan-hosting-capacity-display.geojson?v=2'
      );
    }

    if (
      regionKey === 'estados-unidos' &&
      getLayerState('official') &&
      eiaSource &&
      !eiaSourceRequested
    ) {
      eiaSourceRequested = true;
      eiaSourceState = 'loading';
      root.dataset.eiaSource = 'loading';
      eiaSource.setData(
        'data/grid-atlas/us-eia860m-plants.geojson?v=1'
      );
    }

    if (
      regionKey === 'corea-del-sur' &&
      getLayerState('kpg-model') &&
      kpgSource &&
      !kpgSourceRequested
    ) {
      kpgSourceRequested = true;
      kpgSourceState = 'loading';
      root.dataset.kpgSource = 'loading';
      kpgSource.setData(
        'data/grid-atlas/kpg193-model.geojson?v=2'
      );
    }
  };

  const updateKpgDiagnostics = () => {
    if (
      !map ||
      !map.getLayer('kpg193-line') ||
      root.dataset.activeRegion !== 'corea-del-sur'
    ) return;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (
        !map ||
        !map.getLayer('kpg193-line') ||
        root.dataset.activeRegion !== 'corea-del-sur'
      ) return;
      const canvas = map.getCanvas();
      const rendered = map.queryRenderedFeatures(
        [[0, 0], [canvas.clientWidth, canvas.clientHeight]],
        { layers: ['kpg193-line', 'kpg193-bus'] }
      );
      root.dataset.kpgRendered = String(rendered.length);
      root.dataset.kpgZoom = map.getZoom().toFixed(2);
      root.dataset.kpgVisibility = String(map.getLayoutProperty('kpg193-line', 'visibility'));
    }));
  };

  const refreshDeferredSourceStates = sourceId => {
    if (!map) return;
    if (
      taiwanSourceRequested &&
      taiwanSourceState === 'loading' &&
      (!sourceId || sourceId === 'official-taiwan')
    ) {
      const features = map.querySourceFeatures('official-taiwan');
      const identifiers = new Set(features.map((feature, index) =>
        feature.id ?? `${feature.geometry?.coordinates?.join(',') || 'unknown'}:${index}`
      ));
      if (
        identifiers.size >= taiwanExpectedFeatureCount ||
        (!sourceId && identifiers.size > 0)
      ) {
        taiwanFeatureCount = taiwanExpectedFeatureCount;
        taiwanSourceState = 'ready';
        root.dataset.taiwanSource = 'ready';
        root.dataset.taiwanFeatures = String(taiwanFeatureCount);
        if (root.dataset.activeRegion === 'taiwan') updateSourceSummary();
      }
    }

    if (
      eiaSourceRequested &&
      eiaSourceState === 'loading' &&
      (!sourceId || sourceId === 'official-us-eia-plants')
    ) {
      const features = map.querySourceFeatures('official-us-eia-plants');
      const identifiers = new Set(features.map((feature, index) =>
        feature.id ?? feature.properties?.i ?? `eia:${index}`
      ));
      if (
        identifiers.size >= eiaExpectedFeatureCount ||
        (!sourceId && identifiers.size > 0)
      ) {
        eiaFeatureCount = eiaExpectedFeatureCount;
        eiaSourceState = 'ready';
        root.dataset.eiaSource = 'ready';
        root.dataset.eiaFeatures = String(eiaFeatureCount);
        if (root.dataset.activeRegion === 'estados-unidos') updateSourceSummary();
      }
    }

    if (
      kpgSourceRequested &&
      kpgSourceState === 'loading' &&
      (!sourceId || sourceId === 'kpg193-model')
    ) {
      const features = map.querySourceFeatures('kpg193-model');
      const identifiers = new Set(features.map((feature, index) =>
        feature.id ?? `${feature.geometry?.type || 'unknown'}:${index}`
      ));
      if (
        identifiers.size >= kpgExpectedFeatureCount ||
        (!sourceId && identifiers.size > 0)
      ) {
        kpgFeatureCount = kpgExpectedFeatureCount;
        kpgSourceState = 'ready';
        root.dataset.kpgSource = 'ready';
        root.dataset.kpgFeatures = String(kpgFeatureCount);
        if (root.dataset.activeRegion === 'corea-del-sur') updateSourceSummary();
        updateKpgDiagnostics();
      }
    }
  };

  const updateMapControls = (announce = false) => {
    updateLegend();
    updateVisibleLabel();
    applyFilters();
    applyLayerVisibility();
    ensureDeferredSources();
    updateSourceSummary();
    updateKpgDiagnostics();
    root.dataset.minVoltage = String(getMinimumVoltage());
    scheduleOfficialDataLoad();
    if (announce) announceFilters();
  };

  const setTextWithTitle = (element, text, fullText = text) => {
    if (!element) return;
    element.textContent = text;
    element.title = fullText;
    element.setAttribute('aria-label', fullText);
  };

  const updateRegionProfile = regionKey => {
    const profile = regionProfiles[regionKey];
    if (!profile) return;
    if (profileTitle) profileTitle.textContent = profile.title || '';
    if (profileSummary) profileSummary.textContent = profile.summary || '';

    if (profileMetrics) {
      const metrics = (profile.metrics || []).map(metric => {
        const item = document.createElement('div');
        const value = document.createElement('dt');
        const label = document.createElement('dd');
        value.textContent = metric.value || '—';
        label.textContent = metric.label || '';
        item.append(value, label);
        return item;
      });
      profileMetrics.replaceChildren(...metrics);
    }

    if (profileLinks) {
      const links = (profile.sources || []).flatMap(source => {
        try {
          const url = new URL(source.url);
          if (url.protocol !== 'https:') return [];
          const link = document.createElement('a');
          link.href = url.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = `${source.label || 'Fuente'} ↗`;
          return [link];
        } catch {
          return [];
        }
      });
      profileLinks.replaceChildren(...links);
    }
  };

  const hasInventoryNumber = value => (
    value !== null &&
    value !== undefined &&
    value !== '' &&
    Number.isFinite(Number(value))
  );

  const formatInventoryNumber = value => {
    if (!hasInventoryNumber(value)) return '—';
    const number = Number(value);
    return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(number);
  };

  const normalizeInventoryText = value => (
    String(value ?? '')
      .normalize('NFKC')
      .toLocaleLowerCase()
      .trim()
  );

  const inventoryRecordKey = (regionKey, record) => (
    regionKey === 'china'
      ? `china:${record.nea_sequence}`
      : `corea:${record.source_record_id}`
  );

  const chinaVoltageLabel = record => {
    if (record?.rated_voltage?.notation) return `${record.rated_voltage.notation} kV`;
    const unitVoltages = [...new Set((record?.units || [])
      .map(unit => unit?.rated_voltage?.notation)
      .filter(Boolean))];
    return unitVoltages.length ? `${unitVoltages.join(' / ')} kV` : 'No publicada';
  };

  const chinaSystemTypeLabel = value => ({
    point_to_point_ehvdc: 'Punto a punto EHVDC',
    point_to_point_uhvdc: 'Punto a punto UHVDC',
    back_to_back: 'Back-to-back',
    multi_terminal: 'Multiterminal'
  }[value] || value || 'No publicado');

  const koreaStageLabel = value => ({
    plan_confirmed: 'Plan confirmado · antes de la aprobación',
    project_approved: 'Proyecto aprobado · antes del inicio',
    construction_started: 'Obra iniciada',
    completed_within_one_year: 'Terminada · dentro del primer año'
  }[value] || value || 'No publicada');

  const koreaStageSearchAliases = value => ({
    plan_confirmed: 'plan confirmado planes confirmados antes de aprobación',
    project_approved: 'proyecto aprobado proyectos aprobados aprobación',
    construction_started: 'obra iniciada obras iniciadas construcción empezada',
    completed_within_one_year: 'terminada terminado terminadas terminados completada completados'
  }[value] || '');

  const koreaFacilityLabel = value => {
    const labels = {
      가공송전: 'Transmisión aérea',
      변전: 'Subestación',
      변전소: 'Subestación',
      전력구: 'Galería o túnel eléctrico',
      지중송전: 'Transmisión subterránea',
      지중송전선로: 'Línea de transmisión subterránea',
      변환: 'Conversión'
    };
    return String(value || '')
      .split(',')
      .map(part => labels[part.trim()] || part.trim())
      .filter(Boolean)
      .join(' + ') || 'No publicado';
  };

  const inventorySearchText = (regionKey, record) => {
    if (regionKey === 'china') {
      return normalizeInventoryText([
        record.nea_sequence,
        record.system_name_zh,
        record.system_type,
        chinaSystemTypeLabel(record.system_type),
        record.system_type === 'back_to_back' ? 'espalda contra espalda' : '',
        record.system_type === 'multi_terminal' ? 'múltiples terminales' : '',
        record.system_type_zh,
        record.rated_voltage?.notation,
        record.rated_voltage?.magnitude_kv,
        record.rated_transfer_capacity_mw,
        record.line_length_km,
        ...(record.grid_groups || []),
        ...(record.terminals || []).map(terminal => terminal.station_name_zh),
        ...(record.units || []).flatMap(unit => [
          unit.label_zh,
          unit.commissioned_on,
          unit.rated_voltage?.notation,
          unit.rated_transfer_capacity_mw
        ]),
        ...(record.commissioning_events || []).flatMap(event => [
          event.scope_zh,
          event.commissioned_on
        ])
      ].join(' '));
    }
    return normalizeInventoryText([
      record.source_record_id,
      record.list_number,
      record.stage,
      koreaStageLabel(record.stage),
      koreaStageSearchAliases(record.stage),
      record.stage_label_ko,
      record.project_name,
      record.facility_type,
      koreaFacilityLabel(record.facility_type),
      record.responsible_headquarters,
      record.responsible_office,
      record.voltage_kv,
      ...(record.voltage_kv_values || [])
    ].join(' '));
  };

  const appendInventoryDetailRow = (list, label, value, language = '') => {
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = label;
    detail.textContent = value === undefined || value === null || value === ''
      ? 'No publicado'
      : String(value);
    if (language) detail.lang = language;
    list.append(term, detail);
  };

  const appendInventorySourceLink = (container, href, label) => {
    const safeHref = safeHttpsUrl(href);
    if (!safeHref) return;
    if (container.querySelector('a')) container.append(document.createTextNode(' · '));
    const link = document.createElement('a');
    link.href = safeHref;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = label;
    container.append(link);
  };

  const chinaUnitLabel = unit => {
    const parts = [unit.label_zh];
    if (unit.rated_voltage?.notation) parts.push(`${unit.rated_voltage.notation} kV`);
    if (hasInventoryNumber(unit.rated_transfer_capacity_mw)) {
      parts.push(`${formatInventoryNumber(unit.rated_transfer_capacity_mw)} MW`);
    }
    if (unit.commissioned_on) parts.push(unit.commissioned_on);
    return parts.filter(Boolean).join(' · ');
  };

  const chinaTerminalReferences = record => {
    const references = new Map();
    (record.terminals || []).forEach(terminal => {
      const reference = terminal.source_ref;
      if (!reference?.source_id) return;
      const key = [
        reference.source_id,
        reference.table,
        reference.url,
        JSON.stringify(reference.physical_pdf_pages || [])
      ].join(':');
      if (!references.has(key)) references.set(key, reference);
    });
    return [...references.values()];
  };

  const chinaTerminalReferenceLabel = reference => {
    if (reference.source_id === 'cn-nea-reliability-2024') {
      const physicalPages = (reference.physical_pdf_pages || []).join('–');
      const reportPages = (reference.printed_report_pages || []).join('–');
      return [
        'NEA',
        reference.table ? `tabla ${reference.table}` : '',
        physicalPages ? `PDF pp. ${physicalPages}` : '',
        reportPages ? `informe pp. ${reportPages}` : ''
      ].filter(Boolean).join(' · ');
    }
    if (reference.source_id === 'cn-nrec-yangzhen-hvdc-2024') {
      return `NR Electric · publicación del ${reference.published_on || '2024-04-29'}`;
    }
    return reference.source_id;
  };

  const renderInventoryDetail = record => {
    if (!inventoryDetail) return;
    if (!record) {
      const empty = document.createElement('p');
      empty.textContent = 'No hay registros que coincidan con la búsqueda.';
      inventoryDetail.replaceChildren(empty);
      return;
    }

    const heading = document.createElement('h4');
    const details = document.createElement('dl');
    const sources = document.createElement('div');
    const geometryNote = document.createElement('p');
    geometryNote.className = 'grid-atlas-popup-note';

    if (inventoryRegion === 'china') {
      const terminalReferences = chinaTerminalReferences(record);
      heading.lang = 'zh';
      heading.textContent = `${record.nea_sequence}. ${record.system_name_zh}`;
      appendInventoryDetailRow(details, 'Tipo normalizado', chinaSystemTypeLabel(record.system_type));
      appendInventoryDetailRow(details, 'Tipo original', record.system_type_zh, 'zh');
      appendInventoryDetailRow(details, 'Tensión nominal', chinaVoltageLabel(record));
      appendInventoryDetailRow(
        details,
        'Capacidad de transferencia',
        `${formatInventoryNumber(record.rated_transfer_capacity_mw)} MW`
      );
      appendInventoryDetailRow(
        details,
        'Base de la capacidad',
        record.capacity_basis === 'sum_of_reported_unit_ratings'
          ? 'Suma de capacidades unitarias reportadas'
          : 'Total del sistema reportado'
      );
      appendInventoryDetailRow(
        details,
        'Longitud publicada',
        `${formatInventoryNumber(record.line_length_km)} km`
      );
      appendInventoryDetailRow(details, 'Grupo de red', (record.grid_groups || []).join(' · '), 'zh');
      appendInventoryDetailRow(
        details,
        'Terminales enumerados',
        (record.terminals || []).map(terminal => terminal.station_name_zh).join(' — ') ||
          'No enumerados en las fuentes seleccionadas',
        (record.terminals || []).length ? 'zh' : ''
      );
      if (terminalReferences.length) {
        appendInventoryDetailRow(
          details,
          'Procedencia de los terminales',
          terminalReferences.map(chinaTerminalReferenceLabel).join(' | ')
        );
      }
      appendInventoryDetailRow(
        details,
        'Polos / unidades',
        (record.units || []).map(chinaUnitLabel).join(' | '),
        'zh'
      );
      if ((record.commissioning_events || []).length) {
        appendInventoryDetailRow(
          details,
          'Hitos de puesta en servicio',
          record.commissioning_events
            .map(event => [event.scope_zh, event.commissioned_on].filter(Boolean).join(' · '))
            .join(' | '),
          'zh'
        );
      }
      appendInventoryDetailRow(
        details,
        'Referencia',
        `Tabla ${record.source_ref?.table || '4-1'} · PDF p. ${record.source_ref?.physical_pdf_page || '—'} · informe p. ${record.source_ref?.printed_report_page || '—'}`
      );
      appendInventoryDetailRow(
        details,
        'Nivel de evidencia',
        [
          record.capacity_basis === 'sum_of_reported_unit_ratings'
            ? 'Capacidades unitarias reportadas por NEA; total calculado como suma'
            : 'Atributos del sistema reportados por NEA',
          terminalReferences.some(reference => reference.source_id === 'cn-nrec-yangzhen-hvdc-2024')
            ? 'terminales reportados por NR Electric'
            : terminalReferences.length
              ? 'terminales enumerados reportados por NEA'
              : 'terminales no enumerados en las fuentes seleccionadas'
        ].join('; ')
      );
      geometryNote.textContent = 'La fuente publica el inventario y sus atributos, pero no coordenadas ni trazados reutilizables. Por eso este registro se puede buscar y auditar, pero el atlas no inventa una línea sobre el mapa.';
      appendInventorySourceLink(
        sources,
        'https://prpq.nea.gov.cn/uploads/file1/20250331/67ea4fb889529.pdf',
        'Informe oficial NEA · tabla 4-1 ↗'
      );
      appendInventorySourceLink(
        sources,
        'https://prpq.nea.gov.cn/zxdt/12012.html',
        'Página oficial ↗'
      );
      terminalReferences
        .filter(reference => reference.source_id === 'cn-nrec-yangzhen-hvdc-2024')
        .forEach(reference => {
          appendInventorySourceLink(
            sources,
            reference.url,
            'Fuente del proyecto NR Electric ↗'
          );
        });
    } else {
      heading.lang = 'ko';
      heading.textContent = record.project_name || `Proyecto KEPCO ${record.source_record_id}`;
      appendInventoryDetailRow(details, 'Etapa normalizada', koreaStageLabel(record.stage));
      appendInventoryDetailRow(details, 'Etapa original', record.stage_label_ko, 'ko');
      appendInventoryDetailRow(details, 'Instalación normalizada', koreaFacilityLabel(record.facility_type));
      appendInventoryDetailRow(details, 'Instalación original', record.facility_type, 'ko');
      appendInventoryDetailRow(
        details,
        'Tensión indicada en el nombre',
        hasInventoryNumber(record.voltage_kv)
          ? `${formatInventoryNumber(record.voltage_kv)} kV`
          : 'No indicada'
      );
      appendInventoryDetailRow(details, 'Sede responsable', record.responsible_headquarters, 'ko');
      appendInventoryDetailRow(details, 'Oficina responsable', record.responsible_office, 'ko');
      appendInventoryDetailRow(details, 'N.º en la lista', record.list_number);
      appendInventoryDetailRow(details, 'ID original', record.source_record_id);
      appendInventoryDetailRow(details, 'Página de lista', record.source_list_page);
      appendInventoryDetailRow(details, 'Nivel de evidencia', 'Registro numerado publicado por KEPCO');
      geometryNote.textContent = 'KEPCO publica el registro del proyecto, su etapa y responsables, pero esta lista no aporta coordenadas ni ruta vectorial. El nombre no se geocodifica ni se convierte en una línea aproximada.';
      appendInventorySourceLink(sources, record.source_detail_url, 'Ficha oficial KEPCO ↗');
      appendInventorySourceLink(sources, record.source_list_url, 'Lista oficial de la etapa ↗');
    }

    inventoryDetail.replaceChildren(heading, details, geometryNote, sources);
  };

  const inventoryListLabel = record => {
    if (inventoryRegion === 'china') {
      return {
        name: `${record.nea_sequence}. ${record.system_name_zh}`,
        meta: `${chinaVoltageLabel(record)} · ${formatInventoryNumber(record.rated_transfer_capacity_mw)} MW`
      };
    }
    return {
      name: record.project_name || `Proyecto ${record.source_record_id}`,
      meta: `#${record.list_number}${hasInventoryNumber(record.voltage_kv) ? ` · ${formatInventoryNumber(record.voltage_kv)} kV` : ''}`
    };
  };

  const selectInventoryRecord = record => {
    inventorySelectedKey = inventoryRecordKey(inventoryRegion, record);
    inventoryList?.querySelectorAll('button').forEach(button => {
      button.setAttribute('aria-current', String(button.dataset.inventoryKey === inventorySelectedKey));
    });
    renderInventoryDetail(record);
  };

  const renderOfficialInventoryList = () => {
    if (!inventoryList || !inventoryNote) return;
    const query = normalizeInventoryText(inventorySearch?.value);
    const matches = query
      ? inventoryRecords.filter(record => inventorySearchText(inventoryRegion, record).includes(query))
      : inventoryRecords;
    const pageSize = isNarrow() ? 12 : 30;
    const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
    inventoryPage = Math.min(Math.max(0, inventoryPage), pageCount - 1);
    const pageStart = inventoryPage * pageSize;
    const displayed = matches.slice(pageStart, pageStart + pageSize);
    const selected = displayed.find(record =>
      inventoryRecordKey(inventoryRegion, record) === inventorySelectedKey
    ) || displayed[0];
    inventorySelectedKey = selected ? inventoryRecordKey(inventoryRegion, selected) : '';

    const items = displayed.map(record => {
      const item = document.createElement('div');
      const button = document.createElement('button');
      const name = document.createElement('span');
      const meta = document.createElement('small');
      const label = inventoryListLabel(record);
      item.setAttribute('role', 'listitem');
      button.type = 'button';
      button.dataset.inventoryKey = inventoryRecordKey(inventoryRegion, record);
      button.setAttribute('aria-current', String(button.dataset.inventoryKey === inventorySelectedKey));
      name.textContent = label.name;
      name.lang = inventoryRegion === 'china' ? 'zh' : 'ko';
      meta.textContent = label.meta;
      button.append(name, meta);
      button.addEventListener('click', () => selectInventoryRecord(record));
      item.append(button);
      return item;
    });
    inventoryList.replaceChildren(...items);
    renderInventoryDetail(selected);

    const displayedText = `${formatInventoryNumber(matches.length)} coincidencia${matches.length === 1 ? '' : 's'}.`;
    const geometryText = inventoryRegion === 'china'
      ? ' 51/51 sistemas se conservan como inventario oficial; ninguno recibe una ruta inventada.'
      : ' Los 848 registros enumerados se conservan; ninguno recibe coordenadas o ruta inferidas.';
    inventoryNote.textContent = `${displayedText}${geometryText}`;
    if (inventoryPrevious) inventoryPrevious.disabled = inventoryPage === 0 || matches.length === 0;
    if (inventoryNext) inventoryNext.disabled = inventoryPage >= pageCount - 1 || matches.length === 0;
    if (inventoryPageStatus) {
      const first = matches.length ? pageStart + 1 : 0;
      const last = Math.min(pageStart + pageSize, matches.length);
      inventoryPageStatus.textContent = matches.length
        ? `Página ${formatInventoryNumber(inventoryPage + 1)} de ${formatInventoryNumber(pageCount)} · ${formatInventoryNumber(first)}–${formatInventoryNumber(last)}`
        : 'Sin resultados';
    }
  };

  const useOfficialInventoryData = (regionKey, data) => {
    inventoryRegion = regionKey;
    inventorySelectedKey = '';
    inventoryPage = 0;
    if (regionKey === 'china') {
      inventoryRecords = Array.isArray(data?.systems) ? data.systems : [];
      const total = data?.summary?.total || {};
      if (inventoryTitle) inventoryTitle.textContent = `${formatInventoryNumber(total.system_count)} sistemas HVDC · NEA 2024`;
      if (inventorySummary) {
        inventorySummary.textContent = `${formatInventoryNumber(total.rated_transfer_capacity_mw)} MW y ${formatInventoryNumber(total.line_length_km)} km reportados en la tabla 4-1; 37 sistemas incluyen nombres de terminales, sin coordenadas.`;
      }
    } else {
      inventoryRecords = Array.isArray(data?.projects) ? data.projects : [];
      const stageCounts = inventoryRecords.reduce((counts, record) => {
        counts[record.stage] = (counts[record.stage] || 0) + 1;
        return counts;
      }, {});
      if (inventoryTitle) inventoryTitle.textContent = `${formatInventoryNumber(data?.listed_record_total)} proyectos enumerados · KEPCO`;
      if (inventorySummary) {
        inventorySummary.textContent = `Listas por etapa: ${formatInventoryNumber(stageCounts.plan_confirmed || 0)} con plan confirmado, ${formatInventoryNumber(stageCounts.project_approved || 0)} aprobados, ${formatInventoryNumber(stageCounts.construction_started || 0)} iniciados y ${formatInventoryNumber(stageCounts.completed_within_one_year || 0)} terminados. El panel principal declara ${formatInventoryNumber(data?.dashboard_reported_total)}; las listas exponen ${formatInventoryNumber(data?.listed_record_total)}.`;
      }
    }
    renderOfficialInventoryList();
  };

  const loadOfficialInventory = async regionKey => {
    if (!inventoryPanel) return;
    const config = inventoryConfigs[regionKey];
    const token = ++inventoryLoadToken;
    if (!config) {
      inventoryRegion = '';
      inventoryRecords = [];
      inventorySelectedKey = '';
      inventoryPage = 0;
      inventoryPanel.hidden = true;
      return;
    }

    const changedRegion = inventoryRegion !== regionKey;
    inventoryRegion = regionKey;
    inventoryPanel.hidden = false;
    if (changedRegion && inventorySearch) inventorySearch.value = '';
    if (changedRegion) inventoryPage = 0;
    if (inventorySearch) {
      inventorySearch.placeholder = config.searchPlaceholder;
      inventorySearch.disabled = true;
    }
    if (inventoryTitle) inventoryTitle.textContent = config.loadingTitle;
    if (inventorySummary) inventorySummary.textContent = 'Cargando el inventario oficial verificable…';
    if (inventoryList) inventoryList.replaceChildren();
    if (inventoryDetail) inventoryDetail.replaceChildren();
    if (inventoryNote) inventoryNote.textContent = '';
    if (inventoryPrevious) inventoryPrevious.disabled = true;
    if (inventoryNext) inventoryNext.disabled = true;
    if (inventoryPageStatus) inventoryPageStatus.textContent = 'Cargando…';

    try {
      let data = inventoryDataCache.get(regionKey);
      if (!data) {
        const response = await fetch(config.url, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.json();
        inventoryDataCache.set(regionKey, data);
      }
      if (token !== inventoryLoadToken || root.dataset.activeRegion !== regionKey) return;
      if (inventorySearch) inventorySearch.disabled = false;
      useOfficialInventoryData(regionKey, data);
    } catch (error) {
      if (token !== inventoryLoadToken || root.dataset.activeRegion !== regionKey) return;
      console.warn('No se pudo cargar el inventario oficial sin geometría.', error);
      inventoryRecords = [];
      if (inventorySearch) inventorySearch.disabled = false;
      if (inventorySummary) inventorySummary.textContent = 'El archivo local verificado no respondió.';
      if (inventoryNote) inventoryNote.textContent = 'La ausencia temporal del inventario no altera las capas geográficas visibles.';
      if (inventoryPageStatus) inventoryPageStatus.textContent = 'No disponible';
      renderInventoryDetail();
    }
  };

  const loadRegionProfiles = async () => {
    try {
      const response = await fetch('data/grid-atlas/region-profiles.json?v=1', {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      regionProfiles = data?.regions || {};
      updateRegionProfile(root.dataset.activeRegion || 'europa');
    } catch (error) {
      console.warn('No se pudieron cargar los perfiles regionales.', error);
    }
  };

  const updateSourceSummary = () => {
    const regionKey = root.dataset.activeRegion;
    const number = value => new Intl.NumberFormat('es-ES').format(value);
    if (officialCredit) {
      officialCredit.textContent = 'Capas oficiales regionales · consulte Fuentes';
    }

    if (regionKey === 'estados-unidos') {
      setTextWithTitle(sourceLabel, 'HIFLD + CEC + BPA + EIA + OSM + GEM', 'HIFLD / U.S. Government + California Energy Commission + Bonneville Power Administration + EIA-860M + OpenStreetMap + Global Energy Monitor');
      if (hifldState === 'loading' || regionalState === 'loading' || eiaSourceState === 'loading') {
        setTextWithTitle(dataStatus, 'Capas oficiales cargando', 'Cargando HIFLD nacional, CEC California, BPA en el noroeste y las centrales EIA-860M de junio de 2026');
      } else if (officialFeatureCount > 0 || regionalFeatureCount > 0 || eiaFeatureCount > 0) {
        const parts = [];
        if (officialFeatureCount) parts.push(`${number(officialFeatureCount)} HIFLD`);
        const cecCount = Number(regionalSourceCounts['cec-california-transmission-lines'] || 0);
        const bpaCount = Number(regionalSourceCounts['bpa-transmission-lines-2026'] || 0);
        if (cecCount) parts.push(`${number(cecCount)} CEC`);
        if (bpaCount) parts.push(`${number(bpaCount)} BPA`);
        if (eiaFeatureCount) parts.push(`${number(eiaFeatureCount)} centrales EIA`);
        const shortText = parts.join(' · ');
        setTextWithTitle(dataStatus, shortText, `${shortText} en la consulta visible; cada objeto conserva fuente y fecha`);
      } else if (hifldState === 'error' || regionalState === 'error' || eiaSourceState === 'error') {
        setTextWithTitle(dataStatus, 'Oficial parcial', 'Alguna consulta oficial no respondió; OSM y GEM permanecen visibles');
      } else {
        setTextWithTitle(dataStatus, 'HIFLD 2024 · CEC 2025 · EIA 2026-06', 'Red federal archivada, geometría estatal de California y centrales EIA-860M publicadas el 23-07-2026');
      }
      if (sourceSummary) {
        sourceSummary.textContent = 'HIFLD aporta la red nacional archivada, CEC actualiza California, BPA añade sus 705 líneas oficiales del noroeste y EIA-860M incorpora cada central continental con coordenadas, unidades, estado y capacidad de junio de 2026. OSM y GEM permanecen como contraste separado.';
      }
      if (officialCredit) officialCredit.hidden = false;
      return;
    }

    if (regionKey === 'europa') {
      setTextWithTitle(sourceLabel, 'IGN + OS + Kadaster + BKG + BNetzA + NVE + SFOE + RTE + OSM + GEM', 'IGN BD TOPO + Ordnance Survey OpenMap Local + Kadaster BRT TOP10NL + BKG DLM250 + Bundesnetzagentur + NVE Nettanlegg + Swiss Federal Office of Energy + inventario RTE ODRÉ + OpenStreetMap + Global Energy Monitor');
      if (regionalState === 'loading') {
        setTextWithTitle(dataStatus, 'Fuentes europeas cargando', 'Consultando geometría oficial de Francia, Gran Bretaña, Países Bajos, Alemania y Noruega, más proyectos federales alemanes');
      } else if (regionalFeatureCount > 0) {
        const countByPrefix = prefix => Object.entries(regionalSourceCounts)
          .filter(([sourceId]) => sourceId.startsWith(prefix))
          .reduce((sum, [, count]) => sum + Number(count || 0), 0);
        const nveCount = countByPrefix('nve-');
        const rteCount = countByPrefix('rte-');
        const ignCount = countByPrefix('ign-');
        const osCount = countByPrefix('uk-os-');
        const kadasterCount = countByPrefix('nl-kadaster-');
        const bkgCount = countByPrefix('bkg-');
        const bnetzaCount = countByPrefix('bnetza-');
        const parts = [];
        if (ignCount) parts.push(`${number(ignCount)} IGN`);
        if (osCount) parts.push(`${number(osCount)} OS GB`);
        if (kadasterCount) parts.push(`${number(kadasterCount)} Kadaster NL`);
        if (bkgCount) parts.push(`${number(bkgCount)} BKG`);
        if (bnetzaCount) parts.push(`${number(bnetzaCount)} BNetzA`);
        if (nveCount) parts.push(`${number(nveCount)} activos NVE`);
        if (rteCount) parts.push(`${number(rteCount)} RTE`);
        const shortText = parts.join(' · ') || `${number(regionalFeatureCount)} activos oficiales`;
        setTextWithTitle(dataStatus, shortText, `${shortText} en la consulta visible; IGN, OS, Kadaster y BKG se cargan desde z6 y los polígonos IGN sin tensión sólo al elegir todo desde z8`);
      } else if (regionalState === 'error') {
        setTextWithTitle(dataStatus, 'Oficial no disponible', 'Las consultas oficiales no respondieron; OSM, GEM y las referencias fechadas permanecen disponibles');
      } else {
        setTextWithTitle(dataStatus, 'Oficial · ampliar para IGN/OS/Kadaster/BKG', 'IGN, Ordnance Survey, Kadaster y BKG cargan geometría desde z6; NVE aporta geometría oficial y RTE conserva el inventario sin coordenadas GPS');
      }
      if (sourceSummary) {
        sourceSummary.textContent = 'Francia incorpora IGN BD TOPO; Gran Bretaña añade 3.414 líneas de transmisión cartográficas OS sin simplificar. Países Bajos añade las 496 líneas de alta tensión TOP10NL completas, también sin simplificar. Ninguno de esos dos productos publica tensión por objeto, y el atlas no la inventa. Alemania añade BKG ≥110 kV y proyectos BNetzA, separando traza publicada de línea recta. Noruega conserva NVE, Suiza ofrece el WMS SFOE >36 kV y RTE sigue como inventario aunque su edición actual retiró sus propias coordenadas.';
      }
      if (officialCredit) {
        officialCredit.textContent = 'Contains OS data © Crown copyright and database right 2026 · Kadaster BRT TOP10NL 2026, CC BY 4.0 · otras fuentes oficiales';
        officialCredit.hidden = false;
      }
      return;
    }

    if (regionKey === 'taiwan') {
      setTextWithTitle(sourceLabel, 'Taipower + OSM + GEM', 'Taiwan Power Company / data.gov.tw + OpenStreetMap + Global Energy Monitor');
      const taiwanStatus = taiwanSourceState === 'loading'
        ? 'Taipower cargando'
        : taiwanSourceState === 'error'
          ? 'Taipower no disponible'
          : `${number(taiwanFeatureCount)} celdas · ${number(taiwanSourcePointCount)} puntos`;
      setTextWithTitle(dataStatus, taiwanStatus, 'Todos los puntos válidos del conjunto oficial, agregados a una malla de 0,02° para visualizar sin muestreo');
      if (sourceSummary) {
        sourceSummary.textContent = 'Taipower aporta 505.795 filas oficiales: 505.791 coordenadas válidas se transforman TWD67→WGS84 y se representan en 5.570 celdas. El resultado conserva fecha, licencia y hash, pero no inventa geometría de feeder.';
      }
      if (officialCredit) officialCredit.hidden = false;
      return;
    }

    if (regionKey === 'japon') {
      setTextWithTitle(sourceLabel, 'GSI + OCCTO + OSM + GEM', 'Geospatial Information Authority of Japan + OCCTO + OpenStreetMap + Global Energy Monitor');
      setTextWithTitle(dataStatus, 'GSI oficial z13–16 · 7 OCCTO', 'Geometría oficial GSI de líneas desde z14 y centrales desde z13; siete relaciones OCCTO de capacidad direccional');
      if (sourceSummary) {
        sourceSummary.textContent = 'GSI aporta geometría oficial nacional de líneas de transmisión a z14–16 y centrales a z13–16. OCCTO aporta capacidad direccional; sus rectas se conservan separadas como esquema y OSM sigue como cobertura multiescala.';
      }
      if (officialCredit) officialCredit.hidden = false;
      return;
    }

    if (regionKey === 'china') {
      setTextWithTitle(sourceLabel, 'NEA/CSG + OSM + GEM', 'National Energy Administration / China Southern Power Grid + OpenStreetMap + Global Energy Monitor');
      setTextWithTitle(dataStatus, '51 sistemas HVDC consultables · 2024', 'NEA: los 51 sistemas, 233.574 MW y 52.949 km están normalizados para búsqueda; la ruta de proyecto CSG es esquemática');
      if (sourceSummary) {
        sourceSummary.textContent = 'El inventario NEA permite buscar los 51 sistemas HVDC y auditar tensión, capacidad, longitud, fechas y terminales publicados. Como el informe no ofrece coordenadas ni trazados reutilizables, OSM conserva aparte la geometría pública y el proyecto CSG ±800 kV sólo une terminales publicadas con una recta marcada como modelo.';
      }
      if (officialCredit) officialCredit.hidden = false;
      return;
    }

    const kpgVisible = getLayerState('kpg-model');
    setTextWithTitle(
      sourceLabel,
      kpgVisible ? 'KEPCO + OSM + GEM + KPG sintético' : 'KEPCO + OSM + GEM',
      kpgVisible
        ? 'Korea Electric Power Corporation + OpenStreetMap + Global Energy Monitor + modelo sintético KPG 193 / KENTECH'
        : 'Korea Electric Power Corporation + Korea Power Exchange + OpenStreetMap + Global Energy Monitor'
    );
    setTextWithTitle(
      dataStatus,
      kpgVisible
        ? kpgSourceState === 'loading'
          ? 'KEPCO 35.856 c-km · KPG cargando'
          : kpgSourceState === 'error'
            ? 'KEPCO 35.856 c-km · KPG no disponible'
            : `KEPCO 35.856 c-km · KPG ${number(kpgFeatureCount || kpgExpectedFeatureCount)} elementos`
        : 'KEPCO 35.856 c-km · 4 HVDC esquemáticos',
      kpgVisible
        ? 'Inventario KEPCO de 2024; el modelo sintético KPG 193 v2.0 ODbL está activado y no es la red real'
        : 'Inventario KEPCO de 2024 y cuatro enlaces HVDC oficiales con geometría esquemática; KPG está desactivado'
    );
    if (sourceSummary) {
      sourceSummary.textContent = 'KEPCO aporta 848 registros numerados de obras consultables; su panel declara 849 y la diferencia se conserva sin fabricar el registro faltante. Las listas no publican coordenadas ni rutas, por lo que OSM conserva aparte la geometría pública. KPG 193 ofrece una topología sintética ODbL activable y GIST queda como contraste no redistribuido.';
    }
    if (officialCredit) officialCredit.hidden = false;
  };

  const clearHifldData = () => {
    officialAbortController?.abort();
    officialAbortController = undefined;
    officialQueryKey = '';
    officialFeatureCount = 0;
    hifldState = 'idle';
    delete root.dataset.officialFeatures;
    delete root.dataset.officialThreshold;
    if (map?.getSource('official-us-lines')) {
      map.getSource('official-us-lines')?.setData(emptyFeatureCollection());
    }
  };

  const clearRegionalData = () => {
    regionalAbortController?.abort();
    regionalAbortController = undefined;
    regionalQueryKey = '';
    regionalFeatureCount = 0;
    regionalSourceCounts = {};
    regionalWarnings = [];
    regionalState = 'idle';
    delete root.dataset.regionalFeatures;
    delete root.dataset.regionalSources;
    if (map?.getSource('official-regional')) {
      map.getSource('official-regional')?.setData(emptyFeatureCollection());
    }
  };

  const clipBounds = bounds => {
    const west = Math.max(-125, bounds.getWest());
    const south = Math.max(24, bounds.getSouth());
    const east = Math.min(-66, bounds.getEast());
    const north = Math.min(50, bounds.getNorth());
    if (west >= east || south >= north) return null;
    return { west, south, east, north };
  };

  const snappedOfficialBounds = () => {
    if (!map) return null;
    const currentZoom = map.getZoom();
    if (currentZoom < 4.2) return { west: -125, south: 24, east: -66, north: 50 };
    const clipped = clipBounds(map.getBounds());
    if (!clipped) return null;
    const step = currentZoom < 5 ? 5 : currentZoom < 7 ? 2 : 0.5;
    return {
      west: Math.max(-125, Math.floor(clipped.west / step) * step),
      south: Math.max(24, Math.floor(clipped.south / step) * step),
      east: Math.min(-66, Math.ceil(clipped.east / step) * step),
      north: Math.min(50, Math.ceil(clipped.north / step) * step)
    };
  };

  const splitBounds = (bounds, columns, rows) => {
    const boxes = [];
    const width = (bounds.east - bounds.west) / columns;
    const height = (bounds.north - bounds.south) / rows;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        boxes.push({
          west: bounds.west + width * column,
          south: bounds.south + height * row,
          east: bounds.west + width * (column + 1),
          north: bounds.south + height * (row + 1)
        });
      }
    }
    return boxes;
  };

  const mapWithConcurrency = async (items, limit, worker) => {
    const results = new Array(items.length);
    let nextIndex = 0;
    const runners = Array.from(
      { length: Math.min(limit, items.length) },
      async () => {
        while (nextIndex < items.length) {
          const index = nextIndex;
          nextIndex += 1;
          results[index] = await worker(items[index], index);
        }
      }
    );
    await Promise.all(runners);
    return results;
  };

  const setBoundedCache = (cache, key, value, maximum = 3) => {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    while (cache.size > maximum) cache.delete(cache.keys().next().value);
  };

  const fetchOfficialCell = async (bounds, threshold, signal) => {
    const features = [];
    const currentZoom = map?.getZoom() || 3;
    const maxAllowableOffset = currentZoom < 4 ? 0.035 : currentZoom < 6 ? 0.012 : 0.003;

    for (let offset = 0, page = 0; page < 8; page += 1, offset += 2000) {
      const parameters = new URLSearchParams({
        where: `VOLTAGE >= ${threshold}`,
        geometry: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'OBJECTID_1,ID,TYPE,STATUS,OWNER,VOLTAGE,VOLT_CLASS,INFERRED,SUB_1,SUB_2,SOURCE,SOURCEDATE,VAL_METHOD,VAL_DATE',
        returnGeometry: 'true',
        outSR: '4326',
        geometryPrecision: '5',
        maxAllowableOffset: String(maxAllowableOffset),
        orderByFields: 'OBJECTID_1',
        resultOffset: String(offset),
        resultRecordCount: '2000',
        f: 'geojson'
      });
      const response = await fetch(`${usTransmissionService}?${parameters}`, {
        signal,
        headers: { Accept: 'application/geo+json, application/json' }
      });
      if (!response.ok) throw new Error(`HIFLD HTTP ${response.status}`);
      const pageData = await response.json();
      if (pageData.error) throw new Error(pageData.error.message || 'HIFLD query error');
      const pageFeatures = Array.isArray(pageData.features) ? pageData.features : [];
      features.push(...pageFeatures);
      if (!pageData.exceededTransferLimit && pageFeatures.length < 2000) break;
    }

    return features;
  };

  const loadOfficialData = async () => {
    if (!map?.getSource('official-us-lines') || root.dataset.activeRegion !== 'estados-unidos') return;
    const bounds = snappedOfficialBounds();
    if (!bounds) {
      clearHifldData();
      updateSourceSummary();
      return;
    }

    const threshold = officialUsMinimumVoltage();
    const queryKey = [
      threshold,
      bounds.west,
      bounds.south,
      bounds.east,
      bounds.north
    ].join('|');
    if (queryKey === officialQueryKey) return;
    if (officialDataCache.has(queryKey)) {
      const cachedFeatures = officialDataCache.get(queryKey);
      officialQueryKey = queryKey;
      officialFeatureCount = cachedFeatures.length;
      hifldState = 'ready';
      map.getSource('official-us-lines')?.setData({
        type: 'FeatureCollection',
        features: cachedFeatures
      });
      root.dataset.officialFeatures = String(cachedFeatures.length);
      root.dataset.officialThreshold = String(threshold);
      updateSourceSummary();
      applyFilters();
      return;
    }

    officialQueryKey = queryKey;
    officialAbortController?.abort();
    officialAbortController = new AbortController();
    const signal = officialAbortController.signal;
    const requestToken = ++officialRequest;
    hifldState = 'loading';
    updateSourceSummary();

    const currentZoom = map.getZoom();
    const columns = currentZoom < 4.2 ? 4 : currentZoom < 5 ? 2 : 1;
    const rows = currentZoom < 4.2 ? 2 : 1;

    try {
      const cells = splitBounds(bounds, columns, rows);
      const results = await mapWithConcurrency(
        cells,
        3,
        cell => fetchOfficialCell(cell, threshold, signal)
      );
      if (signal.aborted || requestToken !== officialRequest || root.dataset.activeRegion !== 'estados-unidos') return;

      const unique = new Map();
      results.flat().forEach(feature => {
        const properties = feature.properties || {};
        const key = properties.ID || properties.OBJECTID_1 || `${feature.geometry?.type}:${unique.size}`;
        properties._source_id = 'us-hifld-transmission-2024';
        properties._source_class = 'official';
        properties._source_date = '2024-09-30';
        properties._evidence_level = properties.INFERRED === 'Y' ? 'inferred' : 'reported';
        feature.properties = properties;
        unique.set(String(key), feature);
      });

      const source = map.getSource('official-us-lines');
      const features = [...unique.values()];
      setBoundedCache(officialDataCache, queryKey, features);
      source?.setData({ type: 'FeatureCollection', features });
      officialFeatureCount = features.length;
      hifldState = 'ready';
      root.dataset.officialFeatures = String(features.length);
      root.dataset.officialThreshold = String(threshold);
      updateSourceSummary();
      applyFilters();
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') return;
      console.warn('No se pudo cargar la capa oficial HIFLD.', error);
      officialQueryKey = '';
      officialFeatureCount = 0;
      hifldState = 'error';
      map.getSource('official-us-lines')?.setData(emptyFeatureCollection());
      updateSourceSummary();
      mapWarning.textContent = 'La capa oficial HIFLD no respondió. OSM y GEM siguen disponibles.';
      mapWarning.hidden = false;
    }
  };

  const snappedRegionalBounds = () => {
    if (!map) return null;
    const currentZoom = map.getZoom();
    const active = regionButtons.find(button => button.dataset.regionKey === root.dataset.activeRegion);
    if (currentZoom < 4.6 && active) {
      const [[west, south], [east, north]] = parseBounds(active);
      return { west, south, east, north };
    }
    const bounds = map.getBounds();
    const step = currentZoom < 6 ? 2 : currentZoom < 8 ? 0.5 : 0.1;
    return {
      west: Math.floor(bounds.getWest() / step) * step,
      south: Math.floor(bounds.getSouth() / step) * step,
      east: Math.ceil(bounds.getEast() / step) * step,
      north: Math.ceil(bounds.getNorth() / step) * step
    };
  };

  const loadRegionalData = async () => {
    const regionKey = root.dataset.activeRegion;
    if (
      !map?.getSource('official-regional') ||
      !['europa', 'estados-unidos'].includes(regionKey)
    ) return;

    const loader = window.GridAtlasRegionalSources;
    if (!loader?.load) {
      regionalState = 'error';
      updateSourceSummary();
      return;
    }

    const bounds = snappedRegionalBounds();
    if (!bounds) return;
    const currentZoom = map.getZoom();
    const zoomBand = Math.floor(currentZoom);
    const threshold = regionKey === 'estados-unidos'
      ? officialUsMinimumVoltage()
      : Math.max(getMinimumVoltage(), 0);
    const queryKey = [
      regionKey,
      threshold,
      zoomBand,
      bounds.west,
      bounds.south,
      bounds.east,
      bounds.north
    ].join('|');
    if (queryKey === regionalQueryKey) return;
    if (regionalDataCache.has(queryKey)) {
      const cachedResult = regionalDataCache.get(queryKey);
      regionalQueryKey = queryKey;
      regionalFeatureCount = cachedResult.features.length;
      regionalSourceCounts = cachedResult.sourceCounts;
      regionalWarnings = cachedResult.warnings;
      regionalState = 'ready';
      map.getSource('official-regional')?.setData({
        type: 'FeatureCollection',
        features: cachedResult.features
      });
      root.dataset.regionalFeatures = String(cachedResult.features.length);
      root.dataset.regionalSources = JSON.stringify(cachedResult.sourceCounts);
      updateSourceSummary();
      applyFilters();
      return;
    }

    regionalQueryKey = queryKey;
    regionalAbortController?.abort();
    regionalAbortController = new AbortController();
    const signal = regionalAbortController.signal;
    const requestToken = ++regionalRequest;
    regionalState = 'loading';
    updateSourceSummary();

    try {
      const result = await loader.load({
        regionKey,
        bounds,
        minVoltage: threshold,
        zoom: currentZoom,
        signal
      });
      if (
        signal.aborted ||
        requestToken !== regionalRequest ||
        root.dataset.activeRegion !== regionKey
      ) return;

      const features = Array.isArray(result?.features) ? result.features : [];
      regionalFeatureCount = features.length;
      regionalSourceCounts = result?.sourceCounts || {};
      regionalWarnings = Array.isArray(result?.warnings) ? result.warnings : [];
      setBoundedCache(regionalDataCache, queryKey, {
        features,
        sourceCounts: regionalSourceCounts,
        warnings: regionalWarnings
      });
      regionalState = 'ready';
      map.getSource('official-regional')?.setData({
        type: 'FeatureCollection',
        features
      });
      root.dataset.regionalFeatures = String(features.length);
      root.dataset.regionalSources = JSON.stringify(regionalSourceCounts);
      updateSourceSummary();
      applyFilters();

      const actionableWarnings = regionalWarnings.filter(message =>
        !/retiró las coordenadas GPS/i.test(message)
      );
      if (actionableWarnings.length) {
        mapWarning.textContent = actionableWarnings[0];
        mapWarning.hidden = false;
      }
    } catch (error) {
      if (signal.aborted || error?.name === 'AbortError') return;
      console.warn('No se pudieron cargar las capas oficiales regionales.', error);
      regionalQueryKey = '';
      regionalFeatureCount = 0;
      regionalSourceCounts = {};
      regionalWarnings = [];
      regionalState = 'error';
      map.getSource('official-regional')?.setData(emptyFeatureCollection());
      updateSourceSummary();
      mapWarning.textContent = 'Una consulta oficial regional no respondió. OSM y GEM siguen disponibles.';
      mapWarning.hidden = false;
    }
  };

  const scheduleOfficialDataLoad = () => {
    if (!map?.getSource('official-us-lines') || !map?.getSource('official-regional')) return;
    window.clearTimeout(officialLoadTimer);
    const regionKey = root.dataset.activeRegion;

    if (!getLayerState('official')) {
      clearHifldData();
      clearRegionalData();
      updateSourceSummary();
      return;
    }

    if (regionKey !== 'estados-unidos') clearHifldData();
    if (!['europa', 'estados-unidos'].includes(regionKey)) clearRegionalData();
    updateSourceSummary();

    if (!['europa', 'estados-unidos'].includes(regionKey)) return;
    officialLoadTimer = window.setTimeout(() => {
      if (root.dataset.activeRegion === 'estados-unidos') loadOfficialData();
      loadRegionalData();
    }, 280);
  };

  const setPowerRegion = (regionKey, options = {}) => {
    const { force = false } = options;
    const archive = osmPowerArchives[regionKey];
    if (!archive || (!force && activePowerRegion === regionKey)) return;
    const archiveUrl = osmPowerArchiveUrl(regionKey);
    activePowerRegion = regionKey;
    root.dataset.osmPowerRegion = regionKey;
    delete root.dataset.osmPowerReady;
    const sourceIds = ['power', 'power-centroids'];
    for (const sourceId of sourceIds) {
      const source = map?.getSource(sourceId);
      if (source && typeof source.setUrl === 'function') source.setUrl(archiveUrl);
      else style.sources[sourceId].url = archiveUrl;
    }
  };

  const setRegion = (button, options = {}) => {
    const { animate = !reducedMotion, updateHash = true } = options;
    const region = button.dataset.region;
    const regionKey = button.dataset.regionKey;
    const url = button.dataset.mapUrl;
    if (!region || !regionKey || !url) return;

    selectedButton = button;
    const requestToken = ++regionRequest;
    regionButtons.forEach(item => {
      item.setAttribute('aria-pressed', String(item === button));
      item.tabIndex = item === button ? 0 : -1;
    });
    mapContainer.setAttribute('aria-label', `Infraestructura eléctrica cartografiada en ${region}`);
    if (map) {
      const canvas = map.getCanvas();
      canvas.setAttribute('aria-label', `Mapa de infraestructura eléctrica cartografiada en ${region}`);
    }
    regionLabel.textContent = region;
    openMap.href = url;
    root.dataset.activeRegion = regionKey;
    setPowerRegion(regionKey);
    updateRegionProfile(regionKey);
    loadOfficialInventory(regionKey);
    updateMapControls(false);
    setLoading(`Cargando ${region}…`, requestToken);
    closeDrawers();
    if (activePopup) activePopup.remove();
    button.scrollIntoView({
      behavior: animate ? 'smooth' : 'auto',
      block: 'nearest',
      inline: 'nearest'
    });

    if (updateHash) {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}#${regionKey}`
      );
    }

    if (!map) return;
    let completionStarted = false;
    const finishAfterMovement = () => {
      if (completionStarted || requestToken !== regionRequest) return;
      completionStarted = true;
      map.once('idle', () => finishLoading(requestToken));
    };
    map.once('moveend', finishAfterMovement);
    map.fitBounds(parseBounds(button), {
      padding: isNarrow() ? 24 : 56,
      maxZoom: Number(button.dataset.maxZoom),
      duration: animate ? 820 : 0,
      essential: false
    });
    window.requestAnimationFrame(() => {
      if (map.isMoving() || completionStarted || requestToken !== regionRequest) return;
      completionStarted = true;
      if (map.loaded()) finishLoading(requestToken);
      else map.once('idle', () => finishLoading(requestToken));
    });
  };

  const propertyValue = (properties, keys) => {
    for (const key of keys) {
      const value = properties[key];
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    return '';
  };

  const formatTaggedNumber = value => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return value;
    return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 }).format(numericValue);
  };

  const formatListProperty = value => {
    const text = String(value ?? '').trim();
    if (!text) return '';
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.filter(Boolean).join(', ') : text;
    } catch {
      return text;
    }
  };

  const trueProperty = value => (
    value === true ||
    value === 1 ||
    String(value).toLowerCase() === 'true' ||
    String(value).toLowerCase() === 'yes'
  );

  const sourceLayerName = feature => (
    feature.sourceLayer ||
    feature.layer?.['source-layer'] ||
    ''
  );

  const featureKind = feature => {
    const sourceLayer = sourceLayerName(feature);
    const properties = feature.properties || {};
    if (feature.source === 'official-us-lines') return 'Línea de transmisión oficial';
    if (feature.source === 'official-us-eia-plants') return 'Central eléctrica oficial EIA';
    if (feature.source === 'official-japan-gsi') {
      return sourceLayer === 'structurel'
        ? 'Línea de transmisión oficial GSI'
        : 'Central eléctrica oficial GSI';
    }
    if (feature.source === 'official-regional') {
      if (properties.ASSET_KIND === 'substation') return 'Subestación oficial';
      if (properties.ASSET_KIND === 'planning_line') return 'Proyecto oficial de red';
      if (properties.ASSET_KIND === 'line') return 'Línea oficial';
      return 'Infraestructura oficial';
    }
    if (feature.source === 'official-taiwan') return 'Agregado oficial de capacidad';
    if (feature.source === 'model-corridors') return 'Corredor de capacidad esquemático';
    if (feature.source === 'kpg193-model') {
      if (properties.ASSET_KIND === 'model_bus') return 'Barra sintética KPG';
      if (properties.ASSET_KIND === 'model_hvdc_link') return 'Enlace HVDC sintético KPG';
      if (properties.ASSET_KIND === 'model_ac_transformer') return 'Transformador sintético KPG';
      return 'Rama AC sintética KPG';
    }
    if (feature.source === 'gem') return 'Central eléctrica verificada';
    if (sourceLayer.includes('generator')) return 'Generador';
    if (sourceLayer.includes('plant')) return 'Central eléctrica';
    if (sourceLayer.includes('transformer')) return 'Transformador OSM';
    if (sourceLayer.includes('switch')) return 'Interruptor OSM';
    if (sourceLayer.includes('compensator')) return 'Compensador OSM';
    if (sourceLayer.includes('substation')) {
      return properties.substation === 'converter' ? 'Estación convertidora' : 'Subestación';
    }
    return 'Trazado eléctrico';
  };

  const translatedType = value => {
    const types = {
      line: 'Línea aérea',
      minor_line: 'Línea menor',
      cable: 'Cable',
      minor_cable: 'Cable menor'
    };
    return types[value] || value || 'Sin etiqueta';
  };

  const translatedLocation = value => {
    const locations = {
      underground: 'Subterránea',
      underwater: 'Submarina',
      overhead: 'Aérea',
      indoor: 'Interior',
      outdoor: 'Exterior'
    };
    return locations[value] || value || 'Sin etiqueta';
  };

  const translatedEvidence = value => ({
    official: 'Oficial',
    reported: 'Reportado por la fuente',
    'reported-preliminary': 'Reportado · inventario oficial preliminar',
    validated: 'Validado',
    inferred: 'Inferido',
    modelled: 'Modelado'
  }[String(value || '').toLowerCase()] || value || 'Sin dato');

  const translatedOfficialStatus = value => {
    const normalized = String(value || '').trim().toLowerCase().replaceAll('_', ' ');
    return {
      operational: 'En operación',
      operating: 'En operación',
      'in service': 'En servicio',
      proposed: 'Propuesta',
      construction: 'En construcción',
      'under construction': 'En construcción',
      closed: 'Cerrada',
      inactive: 'Inactiva',
      unknown: 'Desconocido'
    }[normalized] || value || 'Sin dato';
  };

  const translatedOfficialLineType = value => {
    const labels = {
      ac: 'CA',
      dc: 'CC',
      overhead: 'aérea',
      freileitung: 'aérea',
      underground: 'subterránea',
      erdkabel: 'subterránea',
      underwater: 'submarina',
      submarine: 'submarina'
    };
    const parts = String(value || '')
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => labels[part.toLowerCase()] || part);
    return parts.join(' · ') || 'Sin dato';
  };

  const translatedAssetKind = value => ({
    line: 'Línea',
    substation: 'Subestación',
    planning_line: 'Proyecto de línea'
  }[value] || value || 'Sin dato');

  const translatedGeometryConfidence = value => ({
    reported: 'Reportada por la fuente',
    'reported-high': 'Reportada · precisión alta según la fuente',
    'reported-medium': 'Reportada · precisión media según la fuente',
    'reported-variable': 'Reportada · precisión variable según la fuente',
    'reported-generalized': 'Reportada · geometría generalizada',
    'reported-generalized-1:250000': 'Reportada · generalizada a escala 1:250.000',
    'reported-planning-route': 'Trazado de planificación publicado por la autoridad',
    'reported-planning-schematic-straight-line': 'Línea recta esquemática publicada por la autoridad · no es el trazado',
    'reported-plant-coordinate': 'Coordenada de central reportada por EIA',
    'reported-most-common-plant-coordinate': 'Coordenada oficial más frecuente para el ID de central',
    'reported-gsi-vector-tile': 'Geometría del mapa vectorial oficial GSI',
    'official-openmap-local-1:10000-bng-helmert-wgs84-rounded-6dp-no-simplification': 'OS OpenMap Local 1:10.000 · BNG transformado a WGS84 · sin simplificación',
    'official-top10nl-1:10000-rounded-6dp-no-simplification': 'Kadaster BRT TOP10NL 1:10.000 · CRS84 a 6 decimales · sin simplificación'
  }[value] || value || 'Sin dato');

  const lifecycleValue = properties => {
    if (trueProperty(properties.disused)) return 'Fuera de uso';
    if (trueProperty(properties.construction)) return 'En construcción';
    return 'Sin etiqueta de ciclo de vida';
  };

  const osmUrl = (properties, featureId) => {
    const rawId = propertyValue(properties, ['osm_id']) || (
      featureId !== undefined && featureId !== null ? String(featureId) : ''
    );
    if (!/^-?\d+$/.test(rawId)) return '';
    const numericId = Number(rawId);
    if (!Number.isSafeInteger(numericId) || numericId === 0) return '';
    const explicitType = propertyValue(properties, ['osm_type']).toLowerCase();
    if (['node', 'way', 'relation'].includes(explicitType)) {
      return `https://www.openstreetmap.org/${explicitType}/${Math.abs(numericId)}`;
    }
    if (numericId < 0) return `https://www.openstreetmap.org/relation/${Math.abs(numericId)}`;
    const objectType = trueProperty(properties.is_node) ? 'node' : 'way';
    return `https://www.openstreetmap.org/${objectType}/${numericId}`;
  };

  const addPopupRow = (content, label, value) => {
    const row = document.createElement('div');
    row.className = 'grid-atlas-popup-row';
    const key = document.createElement('span');
    const detail = document.createElement('span');
    key.textContent = label;
    detail.textContent = value || 'Sin etiqueta';
    row.append(key, detail);
    content.append(row);
  };

  const formatSourceDate = value => {
    if (value === undefined || value === null || value === '') return 'Sin fecha';
    const numericValue = Number(value);
    const parsed = Number.isFinite(numericValue)
      ? new Date(numericValue)
      : new Date(String(value));
    if (Number.isNaN(parsed.getTime())) return String(value);
    return new Intl.DateTimeFormat('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(parsed);
  };

  const safeHttpsUrl = value => {
    try {
      const parsed = new URL(String(value || ''));
      return parsed.protocol === 'https:' ? parsed.href : '';
    } catch {
      return '';
    }
  };

  const addPopupSource = (content, href, label, fallback) => {
    const safeHref = safeHttpsUrl(href);
    if (safeHref) {
      const link = document.createElement('a');
      link.className = 'grid-atlas-popup-source';
      link.href = safeHref;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = label;
      content.append(link);
      return;
    }
    const sourceText = document.createElement('span');
    sourceText.className = 'grid-atlas-popup-source grid-atlas-popup-source-static';
    sourceText.textContent = fallback;
    content.append(sourceText);
  };

  const kpgDisplayName = properties => {
    const assetKind = propertyValue(properties, ['ASSET_KIND']);
    if (assetKind === 'model_bus') {
      const busId = propertyValue(properties, ['MODEL_BUS_ID']);
      const placeNames = [
        propertyValue(properties, ['MODEL_NAME_EN']),
        propertyValue(properties, ['MODEL_NAME_KO'])
      ].filter(Boolean).join(' · ');
      return `Barra KPG${busId ? ` ${busId}` : ''}${placeNames ? `: ${placeNames}` : ''}`;
    }
    const fromId = propertyValue(properties, ['FROM_BUS_ID']);
    const toId = propertyValue(properties, ['TO_BUS_ID']);
    const endpoints = fromId && toId ? ` ${fromId}–${toId}` : '';
    return assetKind === 'model_hvdc_link'
      ? `Enlace HVDC KPG${endpoints}`
      : `Rama AC KPG${endpoints}`;
  };

  const kpgGeometryLabel = assetKind => (
    assetKind === 'model_bus'
      ? 'Ancla geográfica sintética · no es una subestación verificada'
      : 'Recta sintética entre barras · no es un trazado verificado'
  );

  const kpgGeometryNote = assetKind => (
    assetKind === 'model_bus'
      ? 'El punto marca el ancla geográfica de una barra del modelo KPG; no confirma la ubicación de una subestación coreana.'
      : assetKind === 'model_hvdc_link'
        ? 'La recta une anclas de barras del modelo KPG; no reproduce una ruta HVDC observada.'
        : 'La recta une anclas de barras del modelo KPG; no reproduce el trazado observado de un circuito.'
  );

  const modelCorridorStatusLabel = value => ({
    operating: 'En operación',
    construction: 'En construcción'
  }[value] || value || 'Sin dato');

  const modelCorridorGeometryLabel = value => ({
    'schematic-regional-centroids': 'Recta entre centroides regionales · no es el trazado físico',
    'schematic-terminal-locality-centroids': 'Recta entre localidades terminales · no es el trazado físico'
  }[value] || 'Geometría esquemática · no es el trazado físico');

  const modelCorridorLicenceLabel = value => {
    if (/OCCTO/i.test(value)) return 'Condiciones de publicación de OCCTO · hechos resumidos con atribución';
    if (/not reproduced/i.test(value)) {
      return 'Publicación oficial · hechos resumidos y enlazados; no se reproduce la geometría';
    }
    if (/official publication/i.test(value)) {
      return 'Condiciones de la publicación oficial · hechos resumidos con atribución';
    }
    return value || 'Condiciones del editor';
  };

  const formatDelimitedList = value => (
    String(value || '')
      .split('|')
      .map(part => part.trim())
      .filter(Boolean)
      .join(', ') || 'Sin dato'
  );

  const formatEiaStatusCounts = value => {
    const labels = {
      OP: 'operando',
      SB: 'reserva',
      OA: 'fuera de servicio temporal',
      OS: 'fuera de servicio sin retorno próximo',
      P: 'planificada',
      U: 'en construcción ≤50 %',
      V: 'en construcción >50 %',
      L: 'permisos pendientes',
      T: 'permisos aprobados',
      TS: 'construcción terminada'
    };
    const parts = String(value || '').split('|').filter(Boolean).map(entry => {
      const [code, count] = entry.split(':');
      return `${labels[code] || code}: ${count || '0'}`;
    });
    return parts.join(' · ') || 'Sin dato';
  };

  const featurePopupContent = feature => {
    const properties = feature.properties || {};
    const kind = featureKind(feature);
    const sourceLayer = sourceLayerName(feature);
    const isOfficialUsLine = feature.source === 'official-us-lines';
    const isOfficialEiaPlant = feature.source === 'official-us-eia-plants';
    const isOfficialJapanGsi = feature.source === 'official-japan-gsi';
    const isRegionalOfficial = feature.source === 'official-regional';
    const isTaiwanOfficial = feature.source === 'official-taiwan';
    const isModelCorridor = feature.source === 'model-corridors';
    const isKpgModel = feature.source === 'kpg193-model';
    const isGemPlant = feature.source === 'gem';
    const isLine = sourceLayer.includes('line');
    const isSubstation = sourceLayer.includes('substation');
    const isPlant = sourceLayer.includes('plant');
    const isGenerator = sourceLayer.includes('generator');
    const isTransformer = sourceLayer.includes('transformer');
    const isSwitch = sourceLayer.includes('switch');
    const isCompensator = sourceLayer.includes('compensator');
    const isEquipment = isTransformer || isSwitch || isCompensator;
    const officialEndpoints = [
      propertyValue(properties, ['SUB_1']),
      propertyValue(properties, ['SUB_2'])
    ].filter(Boolean);
    const name = isOfficialUsLine
      ? officialEndpoints.join(' — ') || `Tramo HIFLD ${propertyValue(properties, ['ID']) || 'sin identificador'}`
      : isOfficialEiaPlant
        ? propertyValue(properties, ['n']) || `Central EIA ${propertyValue(properties, ['i']) || 'sin identificador'}`
        : isOfficialJapanGsi
          ? sourceLayer === 'structurel'
            ? 'Línea de transmisión GSI'
            : propertyValue(properties, ['knj']) || 'Central eléctrica GSI'
          : isRegionalOfficial
            ? propertyValue(properties, ['NAME', 'SOURCE_ID']) || 'Activo oficial sin nombre'
            : isTaiwanOfficial
              ? `Celda Taipower${formatListProperty(properties.SOURCE_AREAS) ? ` · ${formatListProperty(properties.SOURCE_AREAS)}` : ''}`
              : isModelCorridor
                ? propertyValue(properties, ['NAME']) || 'Corredor esquemático'
                : isKpgModel
                  ? kpgDisplayName(properties)
                  : isGemPlant
                    ? propertyValue(properties, ['plant-/-project-name', 'plant-/-project-name-(local)', 'plant-/-project-name-(other)']) || 'Central sin nombre'
                    : propertyValue(properties, ['name_es', 'name_en', 'name', 'ref', 'operator']) || 'Sin nombre';

    const content = document.createElement('div');
    content.setAttribute('role', 'dialog');
    content.setAttribute('aria-label', `${kind}: ${name}`);

    const title = document.createElement('strong');
    title.className = 'grid-atlas-popup-title';
    title.textContent = name;
    content.append(title);

    const type = document.createElement('div');
    type.className = 'grid-atlas-popup-kind';
    type.textContent = kind;
    content.append(type);

    if (isOfficialUsLine) {
      const voltageValue = propertyValue(properties, ['VOLTAGE']);
      addPopupRow(content, 'Tensión', voltageValue ? `${formatTaggedNumber(voltageValue)} kV` : 'Sin dato');
      addPopupRow(content, 'Clase', propertyValue(properties, ['VOLT_CLASS']) || 'Sin dato');
      addPopupRow(content, 'Tipo', translatedOfficialLineType(propertyValue(properties, ['TYPE'])));
      addPopupRow(content, 'Estado', translatedOfficialStatus(propertyValue(properties, ['STATUS'])));
      addPopupRow(content, 'Propietario', propertyValue(properties, ['OWNER']) || 'Sin dato');
      addPopupRow(content, 'Origen', propertyValue(properties, ['SUB_1']) || 'Sin dato');
      addPopupRow(content, 'Destino', propertyValue(properties, ['SUB_2']) || 'Sin dato');
      addPopupRow(
        content,
        'Evidencia',
        propertyValue(properties, ['INFERRED']).toUpperCase() === 'Y'
          ? 'Atributo inferido por la fuente'
          : 'Registro reportado'
      );
      addPopupRow(content, 'Validación', propertyValue(properties, ['VAL_METHOD']) || 'Sin dato');
      addPopupRow(content, 'Fecha de validación', formatSourceDate(properties.VAL_DATE));
      addPopupRow(content, 'Fecha de la fuente', formatSourceDate(properties.SOURCEDATE));
      addPopupRow(content, 'Referencia original', propertyValue(properties, ['SOURCE']) || 'Sin dato');
      addPopupRow(content, 'Estado en tiempo real', 'No disponible');

      const note = document.createElement('p');
      note.className = 'grid-atlas-popup-note';
      note.textContent = 'Geometría HIFLD/EIA archivada el 30-09-2024; la marca «inferido» procede del propio registro oficial.';
      content.append(note);
      addPopupSource(
        content,
        'https://resilience.climate.gov/datasets/d4090758322c4d32a4cd002ffaa0aa12_0/explore',
        'Ver conjunto oficial HIFLD ↗',
        'U.S. Government / HIFLD'
      );
      return { content, announcement: `${kind}: ${name}. ${note.textContent}` };
    }

    if (isOfficialEiaPlant) {
      const currentUnits = propertyValue(properties, ['cu']);
      const plannedUnits = propertyValue(properties, ['pu']);
      const currentCapacity = propertyValue(properties, ['cm']);
      const availableCapacity = propertyValue(properties, ['am']);
      const summerCapacity = propertyValue(properties, ['cs']);
      const plannedCapacity = propertyValue(properties, ['pm']);
      const plannedSummerCapacity = propertyValue(properties, ['psm']);
      addPopupRow(content, 'ID de central EIA', propertyValue(properties, ['i']) || 'Sin dato');
      addPopupRow(
        content,
        'Ubicación',
        [propertyValue(properties, ['co']), propertyValue(properties, ['st'])]
          .filter(Boolean)
          .join(', ') || 'Sin dato'
      );
      addPopupRow(content, 'Entidad', propertyValue(properties, ['en']) || 'Sin dato');
      addPopupRow(content, 'ID de entidad', propertyValue(properties, ['ei']) || 'Sin dato');
      addPopupRow(content, 'Autoridad de balance', propertyValue(properties, ['ba']) || 'Sin dato');
      addPopupRow(content, 'Sector', propertyValue(properties, ['se']) || 'Sin dato');
      addPopupRow(content, 'Unidades en inventario actual', currentUnits || '0');
      addPopupRow(
        content,
        'Capacidad actual nominal',
        currentCapacity ? `${formatTaggedNumber(currentCapacity)} MW` : 'Sin dato'
      );
      addPopupRow(
        content,
        'Capacidad disponible',
        availableCapacity ? `${formatTaggedNumber(availableCapacity)} MW` : 'Sin dato'
      );
      addPopupRow(
        content,
        'Capacidad neta de verano',
        summerCapacity ? `${formatTaggedNumber(summerCapacity)} MW` : 'Sin dato'
      );
      addPopupRow(content, 'Estados actuales', formatEiaStatusCounts(properties.os));
      addPopupRow(content, 'Unidades planificadas', plannedUnits || '0');
      addPopupRow(
        content,
        'Capacidad planificada nominal',
        plannedCapacity ? `${formatTaggedNumber(plannedCapacity)} MW` : 'Sin dato'
      );
      addPopupRow(
        content,
        'Capacidad planificada de verano',
        plannedSummerCapacity ? `${formatTaggedNumber(plannedSummerCapacity)} MW` : 'Sin dato'
      );
      addPopupRow(content, 'Estados planificados', formatEiaStatusCounts(properties.ps));
      addPopupRow(content, 'Tecnologías', formatDelimitedList(properties.t));
      addPopupRow(content, 'Códigos de energía', formatDelimitedList(properties.f));
      addPopupRow(content, 'Primer año operativo', propertyValue(properties, ['oy']) || 'Sin dato');
      addPopupRow(content, 'Primer año planificado', propertyValue(properties, ['py']) || 'Sin dato');
      addPopupRow(content, 'Periodo', propertyValue(properties, ['sp']) || '2026-06');
      addPopupRow(content, 'Publicación', formatSourceDate(properties.rd || '2026-07-23'));
      addPopupRow(content, 'Evidencia', translatedEvidence(propertyValue(properties, ['ev'])));
      addPopupRow(
        content,
        'Geometría',
        translatedGeometryConfidence(propertyValue(properties, ['gc']))
      );
      addPopupRow(content, 'Licencia', propertyValue(properties, ['lic']) || 'Dominio público de EE. UU.');
      addPopupRow(content, 'Estado en tiempo real', 'No disponible');

      const note = document.createElement('p');
      note.className = 'grid-atlas-popup-note';
      note.textContent = 'Punto oficial agregado por EIA Plant ID a partir de todas las filas Operating y Planned de junio de 2026. Las capacidades son inventario preliminar, no telemetría ni compromiso de capacidad.';
      content.append(note);
      addPopupSource(
        content,
        propertyValue(properties, ['url']) || 'https://www.eia.gov/electricity/data/eia860m/',
        'Ver inventario oficial EIA-860M ↗',
        'U.S. Energy Information Administration'
      );
      return { content, announcement: `${kind}: ${name}. ${note.textContent}` };
    }

    if (isOfficialJapanGsi) {
      const isGsiLine = sourceLayer === 'structurel';
      addPopupRow(content, 'Tipo de objeto GSI', isGsiLine ? 'Línea de transmisión' : 'Central eléctrica');
      addPopupRow(content, 'Código ftCode', propertyValue(properties, ['ftCode']) || 'Sin dato');
      addPopupRow(content, 'Nivel de origen', propertyValue(properties, ['orgGILvl']) || 'Sin dato');
      if (!isGsiLine) {
        addPopupRow(content, 'Nombre cartográfico', propertyValue(properties, ['knj']) || 'Sin dato');
      }
      addPopupRow(content, 'Cobertura de zoom', isGsiLine ? 'z14–16' : 'z13–16');
      addPopupRow(content, 'Fecha de los datos', '01-04-2026');
      addPopupRow(content, 'Actualización de la publicación', '24-06-2026');
      addPopupRow(content, 'Evidencia', 'Geometría cartográfica oficial GSI');
      addPopupRow(content, 'Geometría', 'Vector oficial · sin inferencia del atlas');
      if (isGsiLine) {
        addPopupRow(content, 'Tensión / circuitos', 'No publicados en esta tesela');
      }
      addPopupRow(content, 'Estado en tiempo real', 'No disponible');

      const note = document.createElement('p');
      note.className = 'grid-atlas-popup-note';
      note.textContent = isGsiLine
        ? 'La forma procede directamente del mapa vectorial oficial GSI. El objeto no publica nombre, tensión, circuitos ni conectividad eléctrica, por lo que el atlas no los infiere.'
        : 'Marcador cartográfico oficial GSI de una central. No contiene capacidad, tecnología ni estado operativo; esos atributos permanecen en capas separadas.';
      content.append(note);
      addPopupSource(
        content,
        'https://maps.gsi.go.jp/development/vt.html',
        'Ver documentación oficial GSI ↗',
        'Geospatial Information Authority of Japan'
      );
      return { content, announcement: `${kind}: ${name}. ${note.textContent}` };
    }

    if (isRegionalOfficial) {
      const voltageValue = propertyValue(properties, ['VOLTAGE']);
      const assetKind = propertyValue(properties, ['ASSET_KIND']);
      const voltageScope = propertyValue(properties, ['VOLTAGE_SCOPE']);
      const sourceDataset = propertyValue(properties, ['SOURCE_DATASET']);
      addPopupRow(
        content,
        'Tensión',
        voltageValue
          ? `${formatTaggedNumber(voltageValue)} kV`
          : trueProperty(properties.VOLTAGE_UNFILTERED)
            ? 'No publicada por objeto · capa oficial de líneas de transmisión'
          : voltageScope
            ? 'No publicada por objeto · el conjunto cubre ≥110 kV'
            : 'Sin dato'
      );
      addPopupRow(content, 'Tipo de activo', translatedAssetKind(assetKind));
      addPopupRow(content, 'Tipo físico', translatedOfficialLineType(propertyValue(properties, ['LINE_TYPE'])));
      addPopupRow(content, 'Estado', translatedOfficialStatus(propertyValue(properties, ['STATUS'])));
      addPopupRow(content, 'Propietario', propertyValue(properties, ['OWNER']) || 'Sin dato');
      addPopupRow(content, 'Circuitos', propertyValue(properties, ['CIRCUITS']) || 'Sin dato');
      if (assetKind === 'planning_line') {
        addPopupRow(content, 'Tipo de geometría publicado', propertyValue(properties, ['GEOMETRY_KIND']) || 'Sin dato');
        addPopupRow(content, 'Tecnología', propertyValue(properties, ['TECHNOLOGY']) || 'Sin dato');
        addPopupRow(content, 'Base legal', propertyValue(properties, ['LEGAL_BASIS']) || 'Sin dato');
        addPopupRow(content, 'Promotor', propertyValue(properties, ['OWNER']) || 'Sin dato');
      }
      addPopupRow(content, 'ID original', propertyValue(properties, ['SOURCE_ID']) || 'Sin dato');
      addPopupRow(content, 'Conjunto', sourceDataset || 'Sin dato');
      addPopupRow(content, 'Registro de fuente', propertyValue(properties, ['REGISTRY_SOURCE_ID']) || 'Sin dato');
      if (sourceDataset === 'nl-kadaster-top10nl-high-voltage-2026-06') {
        addPopupRow(content, 'Clasificación TOP10NL', propertyValue(properties, ['TOP10NL_TYPE']) || 'hoogspanningsleiding');
        addPopupRow(content, 'Código TOP10NL', propertyValue(properties, ['TOP10NL_CODE', 'FEATURE_CODE']) || 'Sin dato');
        addPopupRow(content, 'Fecha del objeto', formatSourceDate(properties.SOURCE_FEATURE_DATE));
        const sourceAccuracy = propertyValue(properties, ['SOURCE_ACCURACY_M']);
        addPopupRow(content, 'Precisión declarada', sourceAccuracy ? `${formatTaggedNumber(sourceAccuracy)} m` : 'Sin dato');
        addPopupRow(content, 'Método de origen', propertyValue(properties, ['SOURCE_METHOD']) || 'Sin dato');
      }
      addPopupRow(content, 'Evidencia', translatedEvidence(propertyValue(properties, ['EVIDENCE'])));
      addPopupRow(
        content,
        'Geometría',
        translatedGeometryConfidence(propertyValue(properties, ['GEOMETRY_CONFIDENCE']))
      );
      addPopupRow(content, 'Fecha de la fuente', formatSourceDate(properties.SOURCE_DATE));
      addPopupRow(content, 'Licencia', propertyValue(properties, ['SOURCE_LICENSE']) || 'Sin dato');
      addPopupRow(content, 'Estado en tiempo real', 'No disponible');

      const note = document.createElement('p');
      note.className = 'grid-atlas-popup-note';
      const geometryConfidence = propertyValue(properties, ['GEOMETRY_CONFIDENCE']);
      note.textContent = geometryConfidence === 'reported-planning-schematic-straight-line'
        ? 'La propia Bundesnetzagentur publica este objeto como «Luftlinie»: es una línea recta de planificación, no el trazado físico. El atlas la mantiene discontinua y separada.'
        : geometryConfidence === 'reported-generalized-1:250000'
          ? 'Geometría oficial BKG generalizada a 1:250.000. El conjunto es completo para líneas ≥110 kV, pero no publica la tensión de cada objeto.'
          : geometryConfidence === 'official-openmap-local-1:10000-bng-helmert-wgs84-rounded-6dp-no-simplification'
            ? 'Geometría cartográfica OS OpenMap Local sin simplificación. Ordnance Survey la clasifica como línea de transmisión, pero no publica tensión, circuitos, operador ni topología eléctrica por objeto; el atlas no los infiere.'
          : geometryConfidence === 'official-top10nl-1:10000-rounded-6dp-no-simplification'
            ? 'Geometría cartográfica Kadaster BRT TOP10NL sin simplificación. La clase oficial es «hoogspanningsleiding», pero el producto no publica tensión, circuitos, operador ni conectividad eléctrica por objeto; el atlas no los infiere.'
          : 'Registro consultado directamente a una fuente regional oficial; no se infiere topología eléctrica a partir de cruces geométricos.';
      content.append(note);
      addPopupSource(
        content,
        propertyValue(properties, ['SOURCE_URL']),
        'Ver fuente oficial ↗',
        sourceDataset || 'Fuente oficial regional'
      );
      return { content, announcement: `${kind}: ${name}. ${note.textContent}` };
    }

    if (isTaiwanOfficial) {
      const pointCount = propertyValue(properties, ['POINT_COUNT']);
      const feederCount = propertyValue(properties, ['FEEDER_COUNT']);
      const reportedCount = propertyValue(properties, ['CAPACITY_REPORTED_COUNT']);
      const capacityMin = propertyValue(properties, ['CAPACITY_MIN_KW']);
      const capacityMax = propertyValue(properties, ['CAPACITY_MAX_KW']);
      const capacityMean = propertyValue(properties, ['CAPACITY_MEAN_KW']);
      addPopupRow(content, 'Puntos incluidos', pointCount || 'Sin dato');
      addPopupRow(content, 'Feeders únicos', feederCount || 'Sin dato');
      addPopupRow(content, 'Capacidades enlazadas', reportedCount || 'Sin dato');
      addPopupRow(
        content,
        'Capacidad mín./máx.',
        capacityMin && capacityMax
          ? `${formatTaggedNumber(capacityMin)} / ${formatTaggedNumber(capacityMax)} kW`
          : 'Sin dato'
      );
      addPopupRow(content, 'Capacidad media', capacityMean ? `${formatTaggedNumber(capacityMean)} kW` : 'Sin dato');
      addPopupRow(content, 'Áreas fuente', formatListProperty(properties.SOURCE_AREAS) || 'Sin dato');
      addPopupRow(content, 'Celda', '0,02° · centroide derivado');
      addPopupRow(content, 'Conjunto', propertyValue(properties, ['SOURCE_DATASET']) || 'Taipower d077009');
      addPopupRow(content, 'Fecha de la fuente', formatSourceDate(properties.SOURCE_DATE));
      addPopupRow(content, 'Licencia', propertyValue(properties, ['SOURCE_LICENSE']) || 'OGDL 1.0');
      addPopupRow(content, 'Evidencia', translatedEvidence(propertyValue(properties, ['EVIDENCE'])));
      addPopupRow(content, 'Estado en tiempo real', 'No disponible');

      const note = document.createElement('p');
      note.className = 'grid-atlas-popup-note';
      note.textContent = 'Agregado espacial que incluye todos los puntos oficiales de la celda; no es una muestra ni representa la geometría del feeder.';
      content.append(note);
      addPopupSource(
        content,
        propertyValue(properties, ['SOURCE_URL']) || 'https://data.gov.tw/dataset/161874',
        'Ver conjunto oficial Taipower ↗',
        'Taipower / data.gov.tw'
      );
      return { content, announcement: `${kind}: ${name}. ${note.textContent}` };
    }

    if (isModelCorridor) {
      const voltageValue = propertyValue(properties, ['VOLTAGE']);
      const forward = propertyValue(properties, ['CAPACITY_FORWARD_MW']);
      const reverse = propertyValue(properties, ['CAPACITY_REVERSE_MW']);
      const length = propertyValue(properties, ['LENGTH_KM']);
      addPopupRow(content, 'Desde', propertyValue(properties, ['FROM_NAME']) || 'Sin dato');
      addPopupRow(content, 'Hasta', propertyValue(properties, ['TO_NAME']) || 'Sin dato');
      addPopupRow(content, 'Capacidad →', forward ? `${formatTaggedNumber(forward)} MW` : 'Sin dato');
      addPopupRow(content, 'Capacidad ←', reverse ? `${formatTaggedNumber(reverse)} MW` : reverse === '0' ? '0 MW' : 'Sin dato');
      addPopupRow(content, 'Contexto', propertyValue(properties, ['CAPACITY_CONTEXT']) || 'Sin dato');
      addPopupRow(content, 'Tensión', voltageValue ? `±${formatTaggedNumber(voltageValue)} kV` : 'Sin dato');
      addPopupRow(content, 'Longitud publicada', length ? `${formatTaggedNumber(length)} km` : 'Sin dato');
      addPopupRow(content, 'Estado', modelCorridorStatusLabel(propertyValue(properties, ['STATUS'])));
      addPopupRow(content, 'Evidencia', 'Hechos oficiales · geometría modelada');
      addPopupRow(
        content,
        'Geometría',
        modelCorridorGeometryLabel(propertyValue(properties, ['GEOMETRY_CONFIDENCE']))
      );
      addPopupRow(content, 'Fecha de la fuente', formatSourceDate(properties.SOURCE_DATE));
      addPopupRow(
        content,
        'Licencia/uso',
        modelCorridorLicenceLabel(propertyValue(properties, ['SOURCE_LICENSE']))
      );

      const note = document.createElement('p');
      note.className = 'grid-atlas-popup-note';
      note.textContent = propertyValue(properties, ['NOTE']) || 'La recta muestra una relación documentada, no el trazado físico del conductor.';
      content.append(note);
      addPopupSource(
        content,
        propertyValue(properties, ['SOURCE_URL']),
        'Ver documento oficial ↗',
        propertyValue(properties, ['SOURCE_DATASET']) || 'Fuente oficial'
      );
      return { content, announcement: `${kind}: ${name}. ${note.textContent}` };
    }

    if (isKpgModel) {
      const assetKind = propertyValue(properties, ['ASSET_KIND']);
      const isModelBus = assetKind === 'model_bus';
      const isModelHvdc = assetKind === 'model_hvdc_link';
      const voltageValue = propertyValue(properties, ['VOLTAGE_KV']);
      const sourceCommit = propertyValue(properties, ['SOURCE_COMMIT']);

      if (isModelBus) {
        const demand = propertyValue(properties, ['MODEL_PD_MW']);
        addPopupRow(content, 'ID de barra', propertyValue(properties, ['MODEL_BUS_ID']) || 'Sin dato');
        addPopupRow(content, 'Nombre del modelo', [
          propertyValue(properties, ['MODEL_NAME_EN']),
          propertyValue(properties, ['MODEL_NAME_KO'])
        ].filter(Boolean).join(' · ') || 'Sin dato');
        addPopupRow(content, 'Tensión base', voltageValue ? `${formatTaggedNumber(voltageValue)} kV` : 'Sin dato');
        addPopupRow(content, 'Demanda del modelo', demand === '' ? 'Sin dato' : `${formatTaggedNumber(demand)} MW`);
        addPopupRow(content, 'Área del modelo', propertyValue(properties, ['MODEL_AREA']) || 'Sin dato');
      } else {
        addPopupRow(content, 'Desde', [
          propertyValue(properties, ['FROM_NAME_EN']),
          propertyValue(properties, ['FROM_BUS_ID'])
        ].filter(Boolean).join(' · barra ') || 'Sin dato');
        addPopupRow(content, 'Hasta', [
          propertyValue(properties, ['TO_NAME_EN']),
          propertyValue(properties, ['TO_BUS_ID'])
        ].filter(Boolean).join(' · barra ') || 'Sin dato');
        addPopupRow(
          content,
          isModelHvdc ? 'Tensión DC nominal' : 'Máxima tensión base AC de las barras',
          isModelHvdc
            ? 'No especificada en la matriz MATPOWER dcline'
            : voltageValue
              ? `${formatTaggedNumber(voltageValue)} kV · valor derivado del caso`
              : 'Sin dato'
        );
        addPopupRow(
          content,
          'Bases AC terminales',
          `${[
            propertyValue(properties, ['FROM_BASE_KV']),
            propertyValue(properties, ['TO_BASE_KV'])
          ].filter(Boolean).map(value => `${formatTaggedNumber(value)} kV`).join(' / ') || 'Sin dato'}${isModelHvdc ? ' · no equivalen a la tensión DC' : ''}`
        );
        if (isModelHvdc) {
          addPopupRow(content, 'Límite P del modelo', [
            propertyValue(properties, ['MODEL_PMIN_MW']),
            propertyValue(properties, ['MODEL_PMAX_MW'])
          ].filter(Boolean).map(value => `${formatTaggedNumber(value)} MW`).join(' / ') || 'Sin dato');
        } else {
          addPopupRow(content, 'Límite térmico A', propertyValue(properties, ['THERMAL_RATING_A_MVA'])
            ? `${formatTaggedNumber(properties.THERMAL_RATING_A_MVA)} MVA`
            : 'Sin dato');
          addPopupRow(content, 'R / X (p.u.)', [
            propertyValue(properties, ['MODEL_RESISTANCE_PU']),
            propertyValue(properties, ['MODEL_REACTANCE_PU'])
          ].filter(Boolean).map(formatTaggedNumber).join(' / ') || 'Sin dato');
        }
        addPopupRow(content, 'Flujo calculado del caso', propertyValue(properties, ['MODEL_FLOW_SNAPSHOT_MW'])
          ? `${formatTaggedNumber(properties.MODEL_FLOW_SNAPSHOT_MW)} MW`
          : 'Sin dato');
      }

      const modelStatus = propertyValue(properties, ['STATUS']);
      const modelStatusLabels = {
        in_service: 'En servicio en el caso de estudio',
        out_of_service: 'Fuera de servicio en el caso de estudio'
      };
      addPopupRow(
        content,
        'Estado del modelo',
        modelStatusLabels[modelStatus] || modelStatus || 'Sin dato'
      );
      addPopupRow(content, 'Evidencia', 'Modelo sintético · no activo oficial');
      addPopupRow(content, 'Geometría', kpgGeometryLabel(assetKind));
      addPopupRow(content, 'Versión', propertyValue(properties, ['SOURCE_DATASET']) || 'KPG 193 v2.0');
      addPopupRow(content, 'Commit fuente', sourceCommit ? sourceCommit.slice(0, 12) : 'Sin dato');
      addPopupRow(content, 'Licencia', propertyValue(properties, ['SOURCE_LICENSE']) || 'ODbL 1.0');
      addPopupRow(content, 'Telemetría', 'No disponible · los valores del caso no son mediciones operativas');

      const note = document.createElement('p');
      note.className = 'grid-atlas-popup-note';
      note.textContent = kpgGeometryNote(assetKind);
      content.append(note);
      addPopupSource(
        content,
        propertyValue(properties, ['SOURCE_URL']),
        'Ver dato KPG versionado ↗',
        'KPG 193 v2.0 · AGM Center / KENTECH'
      );
      return { content, announcement: `${kind}: ${name}. ${note.textContent}` };
    }

    if (isGemPlant) {
      const capacity = propertyValue(properties, ['capacity-(mw)']);
      const location = [
        propertyValue(properties, ['subnational-unit-(state,-province)']),
        propertyValue(properties, ['country/area'])
      ].filter(Boolean).join(', ');
      const statusLabels = {
        operating: 'En operación',
        construction: 'En construcción',
        'pre-construction': 'Preconstrucción',
        announced: 'Anunciada',
        retired: 'Retirada',
        mothballed: 'Inactiva',
        shelved: 'Archivada',
        cancelled: 'Cancelada'
      };
      const rawStatus = propertyValue(properties, ['status']);
      addPopupRow(content, 'Unidad o fase', propertyValue(properties, ['unit-/-phase-name']) || 'Sin dato');
      addPopupRow(content, 'Capacidad', capacity ? `${formatTaggedNumber(capacity)} MW` : 'Sin dato');
      addPopupRow(content, 'Estado', statusLabels[rawStatus] || rawStatus || 'Sin dato');
      addPopupRow(content, 'Tipo', propertyValue(properties, ['type']) || 'Sin dato');
      addPopupRow(content, 'Tecnología', propertyValue(properties, ['technology']) || 'Sin dato');
      addPopupRow(content, 'Combustible', propertyValue(properties, ['fuel-(combustion-only)', 'fuel']) || 'Sin dato');
      addPopupRow(content, 'Operador', propertyValue(properties, ['operator(s)']) || 'Sin dato');
      addPopupRow(content, 'Propietario', propertyValue(properties, ['owner(s)']) || 'Sin dato');
      addPopupRow(content, 'Matriz', propertyValue(properties, ['parent(s)']) || 'Sin dato');
      addPopupRow(content, 'Ubicación', location || 'Sin dato');
      addPopupRow(content, 'Precisión', propertyValue(properties, ['location-accuracy']) || 'Sin dato');
      addPopupRow(content, 'Inicio', propertyValue(properties, ['start-year']) || 'Sin dato');
      addPopupRow(content, 'Retiro', propertyValue(properties, ['retired-year']) || 'Sin dato');
      addPopupRow(content, 'ID GEM', propertyValue(properties, ['gem-unit/phase-id', 'gem-location-id']) || 'Sin dato');
      addPopupRow(content, 'Estado en tiempo real', 'No disponible');

      const note = document.createElement('p');
      note.className = 'grid-atlas-popup-note';
      note.textContent = 'Registro por unidad o fase de Global Energy Monitor, publicación de marzo de 2026; no es telemetría operativa.';
      content.append(note);
      addPopupSource(
        content,
        propertyValue(properties, ['url']),
        'Ver ficha en Global Energy Monitor ↗',
        'Global Integrated Power Tracker · marzo de 2026'
      );
      return { content, announcement: `${kind}: ${name}. ${note.textContent}` };
    }

    const voltages = ['voltage', 'voltage_2', 'voltage_3', 'voltage_4']
      .map(key => propertyValue(properties, [key]))
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index);
    const frequencyValue = propertyValue(properties, ['frequency']);
    const frequencyLabel = frequencyValue === '0'
      ? 'HVDC etiquetado · 0 Hz'
      : frequencyValue
        ? `${formatTaggedNumber(frequencyValue)} Hz`
        : 'Sin etiqueta';
    const voltageLabel = voltages.length
      ? `${voltages.map(formatTaggedNumber).join(' / ')} kV`
      : 'Sin etiqueta';

    if (isLine) {
      addPopupRow(content, 'Tipo físico', translatedType(propertyValue(properties, ['type'])));
      addPopupRow(content, 'Tensiones', voltageLabel);
      addPopupRow(content, 'Frecuencia', frequencyLabel);
      addPopupRow(content, 'Circuitos', propertyValue(properties, ['circuits']) || 'Sin etiqueta');
      addPopupRow(content, 'Ubicación', translatedLocation(propertyValue(properties, ['location'])));
      addPopupRow(content, 'Ciclo OSM', lifecycleValue(properties));
      addPopupRow(content, 'Operador', propertyValue(properties, ['operator']) || 'Sin etiqueta');
      addPopupRow(content, 'Inicio', propertyValue(properties, ['start_date']) || 'Sin etiqueta');
      addPopupRow(content, 'Capacidad térmica', 'No disponible');
      addPopupRow(content, 'Parámetros R/X/B', 'No disponibles');
      addPopupRow(content, 'Estado en tiempo real', 'No disponible');
    }

    if (isSubstation) {
      addPopupRow(content, 'Tipo OSM', propertyValue(properties, ['substation']) || 'Sin etiqueta');
      addPopupRow(content, 'Tensiones', voltageLabel);
      addPopupRow(content, 'Frecuencia', frequencyLabel);
      addPopupRow(content, 'Ubicación', translatedLocation(propertyValue(properties, ['location'])));
      addPopupRow(content, 'Ciclo OSM', lifecycleValue(properties));
      addPopupRow(content, 'Operador', propertyValue(properties, ['operator']) || 'Sin etiqueta');
      addPopupRow(content, 'Inicio', propertyValue(properties, ['start_date']) || 'Sin etiqueta');
      addPopupRow(content, 'Topología interna', 'No disponible');
      addPopupRow(content, 'Estado en tiempo real', 'No disponible');
    }

    if (isPlant || isGenerator) {
      addPopupRow(content, 'Fuente', propertyValue(properties, ['source']) || 'Sin etiqueta');
      const outputValue = propertyValue(properties, ['output']);
      addPopupRow(content, 'Potencia etiquetada', outputValue ? `${formatTaggedNumber(outputValue)} MW` : 'Sin etiqueta');
      addPopupRow(content, 'Método', propertyValue(properties, ['method']) || 'Sin etiqueta');
      addPopupRow(content, 'Almacenamiento', propertyValue(properties, ['storage']) || 'Sin etiqueta');
      addPopupRow(content, 'Ciclo OSM', lifecycleValue(properties));
      addPopupRow(content, 'Operador', propertyValue(properties, ['operator']) || 'Sin etiqueta');
      addPopupRow(content, 'Inicio', propertyValue(properties, ['start_date']) || 'Sin etiqueta');
      addPopupRow(content, 'Estado en tiempo real', 'No disponible');
    }

    if (isEquipment) {
      if (isTransformer) {
        const transformerVoltages = ['voltage_primary', 'voltage_secondary', 'voltage_tertiary']
          .map(key => propertyValue(properties, [key]))
          .filter(Boolean);
        addPopupRow(content, 'Transformación', transformerVoltages.length ? `${transformerVoltages.map(formatTaggedNumber).join(' / ')} kV` : 'Sin etiqueta');
        addPopupRow(content, 'Tipo', propertyValue(properties, ['transformer_type', 'type']) || 'Sin etiqueta');
        addPopupRow(content, 'Rating etiquetado', propertyValue(properties, ['rating']) || 'Sin etiqueta');
        addPopupRow(content, 'Devanados', propertyValue(properties, ['windings']) || 'Sin etiqueta');
        addPopupRow(content, 'Fases', propertyValue(properties, ['phases']) || 'Sin etiqueta');
      } else if (isSwitch) {
        addPopupRow(content, 'Tipo', propertyValue(properties, ['switch_type', 'type']) || 'Sin etiqueta');
        addPopupRow(content, 'Aislamiento', trueProperty(properties.gas_insulated) ? 'Gas aislado · etiqueta OSM' : 'Sin etiqueta');
        addPopupRow(content, 'Cables', propertyValue(properties, ['cables']) || 'Sin etiqueta');
      } else {
        addPopupRow(content, 'Tipo', propertyValue(properties, ['compensator_type', 'type']) || 'Sin etiqueta');
        const compensatorVoltage = propertyValue(properties, ['voltage']);
        addPopupRow(content, 'Tensión', compensatorVoltage ? `${formatTaggedNumber(compensatorVoltage)} kV` : 'Sin etiqueta');
        addPopupRow(content, 'Rating etiquetado', propertyValue(properties, ['rating']) || 'Sin etiqueta');
      }
      addPopupRow(content, 'Inicio', propertyValue(properties, ['start_date']) || 'Sin etiqueta');
      addPopupRow(content, 'Topología de barras', 'No disponible');
      addPopupRow(content, 'Estado actual', 'No disponible');
    }

    const note = document.createElement('p');
    note.className = 'grid-atlas-popup-note';
    if (isLine) {
      note.textContent = 'El trazo representa geometría OSM: un cruce no prueba conexión y la longitud no equivale a circuit-km.';
    } else if (isSubstation) {
      note.textContent = 'El recinto no representa barras, interruptores ni la topología eléctrica completa.';
    } else if (isEquipment) {
      note.textContent = 'El inventario de equipos OSM no reconstruye la topología interna ni el estado de maniobra.';
    } else {
      note.textContent = 'La ausencia de potencia o de unidades cartografiadas no equivale a cero.';
    }
    content.append(note);

    addPopupSource(
      content,
      osmUrl(properties, feature.id),
      'Ver objeto en OpenStreetMap ↗',
      'Objeto cartografiado en OpenStreetMap'
    );

    return { content, announcement: `${kind}: ${name}. ${note.textContent}` };
  };

  const showFeature = (feature, lngLat, options = {}) => {
    const { returnFocus = false } = options;
    const popupToken = ++popupSequence;
    if (activePopup) activePopup.remove();
    const popupContent = featurePopupContent(feature);
    root.dataset.popupOpen = 'true';
    featureStatus.textContent = popupContent.announcement;
    const popup = new window.maplibregl.Popup({
      closeButton: true,
      closeOnClick: true,
      focusAfterOpen: returnFocus,
      maxWidth: '330px'
    })
      .setLngLat(lngLat)
      .setDOMContent(popupContent.content)
      .addTo(map);
    activePopup = popup;
    popup.on('close', () => {
      delete root.dataset.popupOpen;
      featureStatus.textContent = '';
      if (activePopup === popup) activePopup = null;
      if (returnFocus && popupToken === popupSequence) {
        window.requestAnimationFrame(() => map.getCanvas().focus({ preventScroll: true }));
      }
    });
  };

  const queryFeature = (point, radius = 12) => {
    const box = [
      [point.x - radius, point.y - radius],
      [point.x + radius, point.y + radius]
    ];
    const visibleLayers = interactiveLayers.filter(layerId => (
      map.getLayer(layerId) &&
      map.getLayoutProperty(layerId, 'visibility') !== 'none'
    ));
    if (!visibleLayers.length) return undefined;
    const features = map.queryRenderedFeatures(box, { layers: visibleLayers });
    return features
      .map((feature, index) => ({ feature, index }))
      .sort((a, b) => {
        const rank = item => {
          const sourceRank = {
            'official-taiwan': 0,
            'official-regional': 1,
            'official-us-lines': 2,
            'official-us-eia-plants': 2,
            'official-japan-gsi': 2,
            gem: 3,
            'model-corridors': 4,
            'kpg193-model': 5,
            power: 6
          };
          const sourceScore = sourceRank[item.feature.source] ?? 6;
          const geometryScore = item.feature.layer?.type === 'circle'
            ? 0
            : item.feature.layer?.type === 'line'
              ? 1
              : 2;
          return sourceScore * 10 + geometryScore;
        };
        return rank(a) - rank(b) || a.index - b.index;
      })[0]?.feature;
  };

  const inspectMapCenter = () => {
    const canvas = map.getCanvas();
    const point = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
    const feature = queryFeature(point, 14);
    if (!feature) {
      featureStatus.textContent = 'No hay infraestructura cartografiada seleccionable en el centro del mapa.';
      return;
    }
    showFeature(feature, map.unproject([point.x, point.y]), { returnFocus: true });
  };

  layersButton.addEventListener('click', () => {
    toggleDrawer(layersButton, layersPanel, scopeButton, scopePanel);
  });
  scopeButton.addEventListener('click', () => {
    toggleDrawer(scopeButton, scopePanel, layersButton, layersPanel);
  });

  layerToggleInputs.forEach(input => {
    input.addEventListener('change', () => updateMapControls(true));
  });
  voltageSelect.addEventListener('change', () => updateMapControls(true));
  inventorySearch?.addEventListener('input', () => {
    inventoryPage = 0;
    inventorySelectedKey = '';
    renderOfficialInventoryList();
  });
  inventoryPrevious?.addEventListener('click', () => {
    inventoryPage = Math.max(0, inventoryPage - 1);
    inventorySelectedKey = '';
    renderOfficialInventoryList();
  });
  inventoryNext?.addEventListener('click', () => {
    inventoryPage += 1;
    inventorySelectedKey = '';
    renderOfficialInventoryList();
  });

  regionButtons.forEach((button, index) => {
    button.addEventListener('click', () => setRegion(button));
    button.addEventListener('keydown', event => {
      let nextIndex;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        nextIndex = (index + 1) % regionButtons.length;
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        nextIndex = (index - 1 + regionButtons.length) % regionButtons.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = regionButtons.length - 1;
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        button.click();
        return;
      } else {
        return;
      }
      event.preventDefault();
      regionButtons[nextIndex].focus();
    });
  });

  mapContainer.addEventListener('keydown', event => {
    if (!map || (event.key !== 'Enter' && event.key !== ' ')) return;
    if (event.target instanceof HTMLButtonElement) {
      event.preventDefault();
      event.target.click();
      return;
    }
    if (event.target !== map.getCanvas()) return;
    event.preventDefault();
    inspectMapCenter();
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!layersPanel.hidden) {
      setDrawer(layersButton, layersPanel, false);
      layersButton.focus();
      if (map) map.resize();
    } else if (!scopePanel.hidden) {
      setDrawer(scopeButton, scopePanel, false);
      scopeButton.focus();
      if (map) map.resize();
    } else if (activePopup) {
      activePopup.remove();
    }
  });

  const hashRegion = window.location.hash.slice(1);
  const initialButton = regionButtons.find(button => button.dataset.regionKey === hashRegion) || regionButtons[0];
  loadRegionProfiles();
  updateLegend();
  updateVisibleLabel();
  setRegion(initialButton, { animate: false, updateHash: Boolean(hashRegion) });

  try {
    if (!window.maplibregl || !window.pmtiles) {
      showMapError();
      return;
    }

    const mapSupported = typeof window.maplibregl.supported !== 'function' || window.maplibregl.supported();
    if (!mapSupported) {
      showMapError();
      return;
    }

    const pmtilesProtocol = new window.pmtiles.Protocol();
    window.maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile);

    map = new window.maplibregl.Map({
      container: mapContainer,
      style,
      center: [10, 50],
      zoom: 3,
      attributionControl: false,
      cooperativeGestures: true,
      dragRotate: false,
      touchPitch: false,
      pitchWithRotate: false,
      renderWorldCopies: false,
      maxPitch: 0,
      minZoom: 2,
      maxZoom: 16,
      keyboard: true,
      locale: {
        'NavigationControl.ZoomIn': 'Acercar',
        'NavigationControl.ZoomOut': 'Alejar',
        'Popup.Close': 'Cerrar información',
        'CooperativeGesturesHandler.WindowsHelpText': 'Usa Ctrl + desplazamiento para acercar el mapa',
        'CooperativeGesturesHandler.MacHelpText': 'Usa ⌘ + desplazamiento para acercar el mapa',
        'CooperativeGesturesHandler.MobileHelpText': 'Usa dos dedos para mover el mapa'
      }
    });

    map.addControl(new window.maplibregl.NavigationControl({
      showCompass: false,
      showZoom: true,
      visualizePitch: false
    }), 'top-right');

    map.on('load', () => {
      const currentButton = selectedButton || initialButton;
      const canvas = map.getCanvas();
      canvas.setAttribute('aria-describedby', 'grid-atlas-map-help');
      canvas.setAttribute('aria-label', `Mapa de infraestructura eléctrica cartografiada en ${currentButton.dataset.region}`);
      mapContainer.removeAttribute('tabindex');
      setPowerRegion(currentButton.dataset.regionKey, { force: true });
      updateMapControls(false);
      setRegion(currentButton, { animate: false, updateHash: false });
    });

    map.on('zoom', updateVisibleLabel);
    map.on('moveend', scheduleOfficialDataLoad);
    map.on('sourcedata', event => {
      if (!event.isSourceLoaded) return;
      if (event.sourceId === 'power') root.dataset.osmPowerReady = 'true';
      refreshDeferredSourceStates(event.sourceId);
    });

    map.on('idle', () => refreshDeferredSourceStates());

    map.on('click', event => {
      const feature = queryFeature(event.point, isNarrow() ? 14 : 10);
      if (!feature) return;
      showFeature(feature, event.lngLat);
    });

    map.on('mousemove', event => {
      if (!hoverAvailable) return;
      hoverPoint = event.point;
      if (hoverFrame) return;
      hoverFrame = window.requestAnimationFrame(() => {
        hoverFrame = 0;
        const feature = hoverPoint ? queryFeature(hoverPoint, 5) : undefined;
        map.getCanvas().style.cursor = feature ? 'pointer' : '';
      });
    });

    map.on('mouseout', () => {
      hoverPoint = undefined;
      map.getCanvas().style.cursor = '';
    });

    map.on('error', event => {
      const errorMessage = String(event.error?.message || '');
      const errorStatus = Number(event.error?.status || event.error?.statusCode || 0);
      const errorSource = String(event.sourceId || event.source?.id || '');
      if (/abort|cancel/i.test(errorMessage)) return;

      if (['power', 'power-centroids'].includes(errorSource)) {
        console.warn('No se pudo cargar la instantánea OSM propia.', event.error);
        mapWarning.textContent = 'La tesela OSM propia de esta región no respondió; las capas oficiales disponibles siguen activas.';
        mapWarning.hidden = false;
        return;
      }

      if (errorStatus === 404 || /\b404\b/.test(errorMessage)) {
        if (['official-taiwan', 'official-us-eia-plants', 'model-corridors', 'kpg193-model'].includes(errorSource)) {
          if (errorSource === 'official-taiwan') {
            taiwanSourceState = 'error';
            root.dataset.taiwanSource = 'error';
          }
          if (errorSource === 'kpg193-model') {
            kpgSourceState = 'error';
            root.dataset.kpgSource = 'error';
          }
          if (errorSource === 'official-us-eia-plants') {
            eiaSourceState = 'error';
            root.dataset.eiaSource = 'error';
          }
          console.warn(`No se pudo cargar la fuente estática ${errorSource}.`, event.error);
          mapWarning.textContent = 'Una capa estática verificada no respondió; la geometría OSM continúa disponible.';
          mapWarning.hidden = false;
          updateSourceSummary();
        }
        return;
      }

      if (errorSource === 'official-japan-gsi') {
        console.warn('No se pudo cargar una tesela oficial GSI.', event.error);
        mapWarning.textContent = 'La tesela oficial GSI no respondió; OSM y las referencias OCCTO siguen disponibles.';
        mapWarning.hidden = false;
        return;
      }

      if (errorSource === 'official-us-eia-plants') {
        eiaSourceState = 'error';
        root.dataset.eiaSource = 'error';
        console.warn('No se pudo cargar el inventario oficial EIA-860M.', event.error);
        mapWarning.textContent = 'El inventario EIA-860M no respondió; HIFLD, CEC, OSM y GEM siguen disponibles.';
        mapWarning.hidden = false;
        updateSourceSummary();
        return;
      }

      if (errorSource === 'gem') {
        console.warn('No se pudo cargar una tesela de Global Energy Monitor.', event.error);
        mapWarning.textContent = 'Una parte de la capa GEM no respondió; la red geográfica continúa disponible.';
        mapWarning.hidden = false;
        return;
      }

      sourceErrorCount += 1;
      console.warn('No se pudo cargar una parte del mapa.', event.error);
      if (
        sourceErrorCount >= 6 &&
        root.dataset.mapReady !== 'true'
      ) {
        showMapError();
      } else if (sourceErrorCount >= 3) {
        mapWarning.textContent = 'Parte de los mosaicos no pudo cargarse. La vista puede estar incompleta.';
        mapWarning.hidden = false;
      }
    });

    window.addEventListener('resize', () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        map.resize();
        updateVisibleLabel();
        if (inventoryPanel && !inventoryPanel.hidden) renderOfficialInventoryList();
      }, 180);
    });
  } catch (error) {
    console.error('No se pudo iniciar el atlas.', error);
    showMapError();
  }
})();
