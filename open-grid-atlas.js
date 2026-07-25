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
  const visibleLabel = root.querySelector('[data-visible-label]');
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
    'power-generator-areas',
    'power-substation-areas',
    'power-plant-areas'
  ];

  const style = {
    version: 8,
    name: 'Comunicación · OpenInfraMap',
    sources: {
      basemap: {
        type: 'vector',
        tiles: ['https://openinframap.org/20250311/{z}/{x}/{y}.mvt'],
        maxzoom: 15
      },
      power: {
        type: 'vector',
        tiles: ['https://openinframap.org/map/power/{z}/{x}/{y}.pbf'],
        maxzoom: 17
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
        'source-layer': 'landcover',
        paint: {
          'fill-color': [
            'match',
            ['get', 'kind'],
            'forest', '#101d19',
            'grass', '#142019',
            'scrub', '#161d18',
            '#151a1d'
          ],
          'fill-opacity': 0.78
        }
      },
      {
        id: 'atlas-landuse',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'landuse',
        paint: {
          'fill-color': [
            'match',
            ['get', 'kind'],
            'residential', '#1b2024',
            'commercial', '#211d20',
            'industrial', '#24201b',
            '#171d20'
          ],
          'fill-opacity': 0.54
        }
      },
      {
        id: 'atlas-water',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'water',
        paint: { 'fill-color': '#071a23' }
      },
      {
        id: 'atlas-buildings',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'buildings',
        minzoom: 9,
        paint: {
          'fill-color': '#252b2e',
          'fill-opacity': 0.72
        }
      },
      {
        id: 'atlas-roads',
        type: 'line',
        source: 'basemap',
        'source-layer': 'roads',
        minzoom: 5,
        paint: {
          'line-color': '#4a5155',
          'line-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5, 0.15,
            11, 0.42
          ],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5, 0.25,
            12, 1.1
          ]
        }
      },
      {
        id: 'atlas-boundaries',
        type: 'line',
        source: 'basemap',
        'source-layer': 'boundaries',
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
        minzoom: 13,
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
        minzoom: 13,
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
        minzoom: 14,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14, 3,
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
        minzoom: 14,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14, 2.4,
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
        minzoom: 14,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14, 2.6,
            16, 4.5
          ],
          'circle-color': '#728de5',
          'circle-stroke-color': '#080b16',
          'circle-stroke-width': 1.1
        },
        layout: { visibility: 'none' }
      }
    ]
  };

  const getLayerState = key => {
    const input = layerToggleInputs.find(item => item.dataset.layerToggle === key);
    return input ? input.checked : true;
  };

  const getMinimumVoltage = () => Number(voltageSelect?.value || 100);

  const voltageGate = () => {
    const minimum = getMinimumVoltage();
    if (minimum <= 0) return ['==', 1, 1];
    return [
      'any',
      ['==', frequency, 0],
      ...voltageValues.map(value => ['>=', value, minimum])
    ];
  };

  const positionGate = mode => {
    if (mode === 'overhead') return ['!', underground];
    if (mode === 'underground') return underground;

    const overheadVisible = getLayerState('overhead');
    const undergroundVisible = getLayerState('underground');
    if (overheadVisible && undergroundVisible) return ['==', 1, 1];
    if (overheadVisible) return ['!', underground];
    if (undergroundVisible) return underground;
    return ['==', 1, 0];
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
    status.textContent = 'No se pudo cargar el mapa. Usa «Abrir mapa».';
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
    if (!getLayerState('overhead') && !getLayerState('underground')) {
      visibleLabel.textContent = 'Líneas ocultas';
      return;
    }

    const userMinimum = getMinimumVoltage();
    const official = map ? officialVoltageThreshold(map.getZoom()) : { value: 199, inclusive: false };
    let value = userMinimum > 0 ? userMinimum : null;
    let inclusive = true;

    if (official && (value === null || official.value > value)) {
      value = official.value;
      inclusive = official.inclusive;
    } else if (official && official.value === value) {
      inclusive = official.inclusive;
    }

    const threshold = value === null
      ? 'todo lo etiquetado'
      : `${inclusive ? '≥' : '>'}${value} kV`;
    const fullLabel = `Líneas visibles · ${threshold} + HVDC etiquetado`;
    visibleLabel.textContent = isNarrow()
      ? `${threshold} + HVDC OSM`
      : fullLabel;
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
    if (!map || !map.isStyleLoaded()) return;

    map.setFilter('power-line-overhead', lineFilter('overhead', 'active'));
    map.setFilter('power-line-underground', lineFilter('underground', 'active'));
    map.setFilter('power-line-construction', lineFilter('either', 'construction'));
    map.setFilter('power-line-disused', lineFilter('either', 'disused'));
    map.setFilter('power-substation-areas', substationAreaFilter());
    map.setFilter('power-substation-points', substationFilter(false));
    map.setFilter('power-converter-points', substationFilter(true));
  };

  const applyLayerVisibility = () => {
    if (!map || !map.isStyleLoaded()) return;
    Object.entries(layerGroups).forEach(([key, layerIds]) => {
      const visibility = getLayerState(key) ? 'visible' : 'none';
      layerIds.forEach(layerId => map.setLayoutProperty(layerId, 'visibility', visibility));
    });
  };

  const updateMapControls = (announce = false) => {
    updateLegend();
    updateVisibleLabel();
    applyFilters();
    applyLayerVisibility();
    root.dataset.minVoltage = String(getMinimumVoltage());
    if (announce) announceFilters();
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

  const featurePopupContent = feature => {
    const properties = feature.properties || {};
    const kind = featureKind(feature);
    const sourceLayer = sourceLayerName(feature);
    const isLine = sourceLayer.includes('line');
    const isSubstation = sourceLayer.includes('substation');
    const isPlant = sourceLayer.includes('plant');
    const isGenerator = sourceLayer.includes('generator');
    const isTransformer = sourceLayer.includes('transformer');
    const isSwitch = sourceLayer.includes('switch');
    const isCompensator = sourceLayer.includes('compensator');
    const isEquipment = isTransformer || isSwitch || isCompensator;
    const name = propertyValue(properties, ['name_es', 'name_en', 'name', 'ref', 'operator']) || 'Sin nombre';

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
        addPopupRow(content, 'Tipo', propertyValue(properties, ['type']) || 'Sin etiqueta');
        addPopupRow(content, 'Aislamiento', trueProperty(properties.gas_insulated) ? 'Gas aislado · etiqueta OSM' : 'Sin etiqueta');
        addPopupRow(content, 'Cables', propertyValue(properties, ['cables']) || 'Sin etiqueta');
      } else {
        addPopupRow(content, 'Tipo', propertyValue(properties, ['type']) || 'Sin etiqueta');
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

    const source = osmUrl(properties, feature.id);
    if (source) {
      const link = document.createElement('a');
      link.className = 'grid-atlas-popup-source';
      link.href = source;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Ver objeto en OpenStreetMap ↗';
      content.append(link);
    } else {
      const sourceText = document.createElement('span');
      sourceText.className = 'grid-atlas-popup-source grid-atlas-popup-source-static';
      sourceText.textContent = 'Objeto cartografiado en OpenStreetMap';
      content.append(sourceText);
    }

    return { content, announcement: `${kind}: ${name}. ${note.textContent}` };
  };

  const showFeature = (feature, lngLat) => {
    if (activePopup) activePopup.remove();
    const popupContent = featurePopupContent(feature);
    root.dataset.popupOpen = 'true';
    featureStatus.textContent = popupContent.announcement;
    activePopup = new window.maplibregl.Popup({
      closeButton: true,
      closeOnClick: true,
      focusAfterOpen: true,
      maxWidth: '330px'
    })
      .setLngLat(lngLat)
      .setDOMContent(popupContent.content)
      .addTo(map);
    activePopup.on('close', () => {
      delete root.dataset.popupOpen;
      activePopup = null;
    });
  };

  const queryFeature = (point, radius = 12) => {
    const box = [
      [point.x - radius, point.y - radius],
      [point.x + radius, point.y + radius]
    ];
    const features = map.queryRenderedFeatures(box, { layers: interactiveLayers });
    return features
      .map((feature, index) => ({ feature, index }))
      .sort((a, b) => {
        const rank = item => {
          if (item.feature.layer?.type === 'circle') return 0;
          if (item.feature.layer?.type === 'line') return 1;
          return 2;
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
    showFeature(feature, map.unproject([point.x, point.y]));
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
    }
  });

  const hashRegion = window.location.hash.slice(1);
  const initialButton = regionButtons.find(button => button.dataset.regionKey === hashRegion) || regionButtons[0];
  updateLegend();
  updateVisibleLabel();
  setRegion(initialButton, { animate: false, updateHash: Boolean(hashRegion) });

  try {
    if (!window.maplibregl) {
      showMapError();
      return;
    }

    const mapSupported = typeof window.maplibregl.supported !== 'function' || window.maplibregl.supported();
    if (!mapSupported) {
      showMapError();
      return;
    }

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
      const canvas = map.getCanvas();
      canvas.setAttribute('aria-describedby', 'grid-atlas-map-help');
      canvas.setAttribute('aria-label', `Mapa de infraestructura eléctrica cartografiada en ${initialButton.dataset.region}`);
      mapContainer.removeAttribute('tabindex');
      updateMapControls(false);
      setRegion(initialButton, { animate: false, updateHash: false });
    });

    map.on('zoom', updateVisibleLabel);

    map.on('click', event => {
      const feature = queryFeature(event.point, isNarrow() ? 14 : 10);
      if (!feature) return;
      showFeature(feature, event.lngLat);
    });

    map.on('mousemove', event => {
      const feature = queryFeature(event.point, 5);
      map.getCanvas().style.cursor = feature ? 'pointer' : '';
    });

    map.on('error', event => {
      const errorMessage = String(event.error?.message || '');
      const errorStatus = Number(event.error?.status || event.error?.statusCode || 0);
      if (
        errorStatus === 404 ||
        /\b404\b|abort|cancel/i.test(errorMessage)
      ) return;

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
      }, 180);
    });
  } catch (error) {
    console.error('No se pudo iniciar el atlas.', error);
    showMapError();
  }
})();
