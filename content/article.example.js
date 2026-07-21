window.REPORTAGE_ARTICLE = {
  slug: '__SLUG__',

  meta: {
    title: 'Comunicación | Título del nuevo reportaje',
    description: 'Descripción breve del nuevo reportaje para buscadores y redes.',
    canonical: 'https://qdgvr.github.io/fecundidad.github.io/__SLUG__.html'
  },

  brand: {
    name: 'Comunicación',
    motto: 'veritas lux mea',
    href: '/fecundidad.github.io/'
  },

  // Sustituya o elimine pasos según el relato del nuevo reportaje.
  globeSteps: [
    {
      region: 'europe',
      label: '01',
      title: 'Primer escenario',
      text: 'Texto del primer paso del prólogo interactivo.',
      lat: 47,
      lon: 2,
      camera: 4.1
    },
    {
      region: 'title',
      label: 'Reportaje de datos',
      title: 'Título del nuevo reportaje',
      text: 'Subtítulo o entradilla breve del nuevo reportaje.',
      titleCard: true
    }
  ],

  navigation: [
    { label: '1.', title: 'Primer capítulo', href: '#ocio-digital' },
    { label: '2.', title: 'Segundo capítulo', href: '#tiempo-exterior' },
    { label: '3.', title: 'Tercer capítulo', href: '#fecundidad' }
  ],

  content: {
    // text sustituye el texto simple de los elementos indicados.
    text: {
      '#x-block .metric-kicker': '1. Primer capítulo',
      '#x-block .metric-heading h2': 'Título del primer bloque',
      '#m-block .metric-kicker': '2. Segundo capítulo',
      '#m-block .metric-heading h2': 'Título del segundo bloque',
      '#y-block .metric-kicker': '3. Tercer capítulo',
      '#y-block .metric-heading h2': 'Título del tercer bloque'
    },

    // paragraphs sustituye únicamente los párrafos narrativos de cada posición.
    paragraphs: {
      '[data-template-slot="intro-body"]': [
        'Primer párrafo de apertura.',
        'Segundo párrafo de apertura.',
        'Tercer párrafo de apertura.'
      ],
      '[data-template-slot="after-ocio-digital"]': [
        'Texto situado después del primer interactivo.'
      ],
      '[data-template-slot="before-tiempo-exterior"]': [
        'Transición situada antes del segundo interactivo.'
      ],
      '[data-template-slot="after-tiempo-exterior"]': [
        'Texto situado después del segundo interactivo.'
      ],
      '[data-template-slot="after-graph-1"]': [
        'Interpretación narrativa situada después del primer gráfico de relación.'
      ],
      '[data-template-slot="after-fecundidad"]': [
        'Texto situado después del tercer interactivo.'
      ],
      '[data-template-slot="after-graph-2"]': [
        'Interpretación narrativa situada después del segundo gráfico de relación.'
      ],
      '[data-template-slot="closing-body"]': [
        'Primer párrafo de cierre.',
        'Segundo párrafo de cierre.'
      ]
    },

    // Use html solo cuando necesite énfasis o enlaces dentro de un bloque.
    html: {},
    attributes: {},
    remove: [],
    hide: []
  },

  footer: {
    editionTitle: 'De la edición del 10 de junio de 2026',
    editionText: 'Descubra historias de esta sección y más en el índice de contenidos.',
    editionImage: {
      src: 'assets/tfg-edition.png',
      alt: 'Ilustración del nuevo reportaje'
    },
    moreTitle: 'Más en Comunicación',
    cards: [
      {
        title: 'Título de otro reportaje',
        description: 'Resumen breve del contenido relacionado.',
        href: 'https://example.com/'
      }
    ]
  }
};
