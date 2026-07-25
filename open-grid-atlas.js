(() => {
  'use strict';

  const root = document.querySelector('[data-grid-atlas]');
  if (!root) return;

  const mapContainer = root.querySelector('[data-grid-map]');
  const status = root.querySelector('[data-map-status]');
  const openMap = root.querySelector('[data-open-map]');
  const scopeButton = root.querySelector('[data-scope-button]');
  const scopePanel = root.querySelector('[data-scope-panel]');
  const regionButtons = [...root.querySelectorAll('[data-region-button]')];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isNarrow = () => window.matchMedia('(max-width: 640px)').matches;
  let map;
  let selectedButton;
  let resizeTimer;
  let loadingTimer;

  const voltage = ['to-number', ['coalesce', ['get', 'voltage'], 0], 0];
  const frequency = ['to-number', ['coalesce', ['get', 'frequency'], 50], 50];
  const output = ['to-number', ['coalesce', ['get', 'output'], 0], 0];
  const zoom = ['zoom'];
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
  const underground = [
    'any',
    ['==', ['get', 'location'], 'underground'],
    ['==', ['get', 'location'], 'underwater'],
    ['==', ['get', 'tunnel'], true],
    [
      'all',
      ['==', ['get', 'type'], 'cable'],
      ['==', ['get', 'location'], '']
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
      ['>', voltage, 200],
      ['all', ['>', voltage, 100], ['>', zoom, 7]],
      ['all', ['>', voltage, 9], ['>', zoom, 10]],
      ['>', zoom, 10.5]
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
    ['all', ['>', output, 750], ['>', zoom, 5]],
    ['all', ['>', output, 250], ['>', zoom, 6]],
    ['all', ['>', output, 100], ['>', zoom, 7]],
    ['all', ['>', output, 10], ['>', zoom, 9]],
    ['>', zoom, 11]
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
        id: 'power-line-underground',
        type: 'line',
        source: 'power',
        'source-layer': 'power_line',
        filter: ['all', underground, powerVisible, ['!', ['coalesce', ['get', 'disused'], false]]],
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
        filter: [
          'all',
          ['!', underground],
          powerVisible,
          ['!', ['coalesce', ['get', 'disused'], false]]
        ],
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
        minzoom: 5.5,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            4, 1.7,
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
        id: 'power-substation-points',
        type: 'circle',
        source: 'power',
        'source-layer': 'power_substation_point',
        filter: substationVisible,
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
      }
    ]
  };

  const setScope = open => {
    scopePanel.hidden = !open;
    scopeButton.setAttribute('aria-expanded', String(open));
  };

  const parseBounds = button => {
    const values = button.dataset.bounds.split(',').map(Number);
    return [[values[0], values[1]], [values[2], values[3]]];
  };

  const setLoading = text => {
    window.clearTimeout(loadingTimer);
    root.dataset.mapReady = 'false';
    status.textContent = text;
    status.hidden = false;
    loadingTimer = window.setTimeout(() => {
      if (root.dataset.mapReady !== 'true') showMapError();
    }, 12000);
  };

  const finishLoading = () => {
    window.clearTimeout(loadingTimer);
    status.hidden = true;
    root.dataset.mapReady = 'true';
  };

  const setRegion = (button, options = {}) => {
    const { animate = !reducedMotion, updateHash = true } = options;
    const region = button.dataset.region;
    const regionKey = button.dataset.regionKey;
    const url = button.dataset.mapUrl;
    if (!region || !regionKey || !url) return;

    selectedButton = button;
    regionButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    mapContainer.setAttribute('aria-label', `Infraestructura eléctrica cartografiada en ${region}`);
    openMap.href = url;
    root.dataset.activeRegion = regionKey;
    setLoading(`Cargando ${region}…`);
    setScope(false);
    button.scrollIntoView({
      behavior: animate ? 'smooth' : 'auto',
      block: 'nearest',
      inline: 'nearest'
    });

    if (updateHash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${regionKey}`);
    }

    if (!map) return;
    map.fitBounds(parseBounds(button), {
      padding: isNarrow() ? 24 : 56,
      maxZoom: Number(button.dataset.maxZoom),
      duration: animate ? 820 : 0,
      essential: false
    });
    map.once('moveend', finishLoading);
  };

  const propertyValue = (properties, keys) => {
    for (const key of keys) {
      const value = properties[key];
      if (value !== undefined && value !== null && String(value).trim()) return String(value);
    }
    return '';
  };

  const featureLabel = feature => {
    const properties = feature.properties || {};
    const sourceLayer = feature.sourceLayer || '';
    const kind = sourceLayer.includes('plant')
      ? 'Central eléctrica'
      : sourceLayer.includes('substation')
        ? 'Subestación'
        : 'Línea eléctrica';
    const name = propertyValue(properties, ['name', 'operator']) || kind;
    const voltageValue = propertyValue(properties, ['voltage']);
    const output = propertyValue(properties, ['output', 'plant:output:electricity']);

    const content = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = name;
    content.append(title);

    const type = document.createElement('span');
    type.textContent = kind;
    content.append(type);

    if (voltageValue) {
      const voltageText = document.createElement('span');
      voltageText.textContent = `Tensión registrada: ${voltageValue} kV`;
      content.append(voltageText);
    }

    if (output) {
      const outputText = document.createElement('span');
      outputText.textContent = `Potencia registrada: ${output}`;
      content.append(outputText);
    }

    const source = document.createElement('span');
    source.textContent = 'Datos cartografiados en OpenStreetMap';
    content.append(source);
    return content;
  };

  const showMapError = () => {
    window.clearTimeout(loadingTimer);
    root.dataset.mapError = 'true';
    status.textContent = 'No se pudo cargar el mapa. Usa «Abrir mapa».';
    status.hidden = false;
  };

  scopeButton.addEventListener('click', () => setScope(scopePanel.hidden));
  regionButtons.forEach(button => button.addEventListener('click', () => setRegion(button)));

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !scopePanel.hidden) {
      setScope(false);
      scopeButton.focus();
    }
  });

  const hashRegion = window.location.hash.slice(1);
  const initialButton = regionButtons.find(button => button.dataset.regionKey === hashRegion) || regionButtons[0];
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
      maxZoom: 14,
      keyboard: true
    });

    map.addControl(new window.maplibregl.NavigationControl({
      showCompass: false,
      showZoom: true,
      visualizePitch: false
    }), 'top-right');

    map.on('load', () => {
      setRegion(initialButton, { animate: false, updateHash: false });
      map.once('idle', finishLoading);
    });

    map.on('click', event => {
      const interactiveLayers = [
        'power-line-overhead',
        'power-line-underground',
        'power-substation-points',
        'power-plant-points',
        'power-substation-areas',
        'power-plant-areas'
      ];
      const [feature] = map.queryRenderedFeatures(event.point, { layers: interactiveLayers });
      if (!feature) return;

      new window.maplibregl.Popup({ closeButton: true, maxWidth: '285px' })
        .setLngLat(event.lngLat)
        .setDOMContent(featureLabel(feature))
        .addTo(map);
    });

    map.on('mousemove', event => {
      const features = map.queryRenderedFeatures(event.point, {
        layers: [
          'power-line-overhead',
          'power-line-underground',
          'power-substation-points',
          'power-plant-points'
        ]
      });
      map.getCanvas().style.cursor = features.length ? 'pointer' : '';
    });

    map.on('error', event => {
      if (!map.isStyleLoaded()) {
        console.warn('No se pudo cargar una parte del mapa.', event.error);
      }
    });

    window.addEventListener('resize', () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        map.resize();
        if (selectedButton) setRegion(selectedButton, { animate: false, updateHash: false });
      }, 180);
    });
  } catch (error) {
    console.error('No se pudo iniciar el atlas.', error);
    showMapError();
  }
})();
