(() => {
  'use strict';

  const regionPresets = {
    europe: { region: 'europe', lat: 47, lon: 8, camera: 4.15 },
    'east-asia': { region: 'east_asia', lat: 36, lon: 115, camera: 4.1 },
    usa: { region: 'united_states', lat: 39, lon: -98, camera: 4.25 },
    world: { region: 'world', lat: 18, lon: 0, camera: 5.7 }
  };

  const paragraphs = value => String(value || '')
    .split(/\n\s*\n/)
    .map(item => item.trim())
    .filter(Boolean);

  const dateLabel = value => {
    if (!value) return '';
    try {
      return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
    } catch (_) {
      return value;
    }
  };

  const fromPayload = (payload, options = {}) => {
    const baseUrl = options.baseUrl || 'https://qdgvr.github.io/fecundidad.github.io';
    const first = regionPresets[payload.globeRegion1] || regionPresets.europe;
    const second = regionPresets[payload.globeRegion2] || regionPresets.usa;
    const imageSrc = payload.heroPath || payload.heroPreview || 'assets/tfg-edition.png';

    return {
      slug: payload.slug,
      meta: {
        title: `Comunicación | ${payload.title}`,
        description: payload.description,
        canonical: `${baseUrl.replace(/\/$/, '')}/${payload.slug}.html`
      },
      brand: { name: 'Comunicación', motto: 'veritas lux mea', href: '/fecundidad.github.io/main.html' },
      globeSteps: [
        { ...first, label: '01', title: payload.globeTitle1 || 'El mapa del cambio', text: payload.globeText1 || '' },
        { ...second, label: '02', title: payload.globeTitle2 || 'La escala del reportaje', text: payload.globeText2 || '' },
        { region: 'title', label: payload.section || 'Reportaje', title: payload.title, text: payload.description, titleCard: true }
      ],
      navigation: [
        { label: '1.', title: payload.nav1 || 'Ocio digital', href: '#ocio-digital' },
        { label: '2.', title: payload.nav2 || 'Tiempo exterior', href: '#tiempo-exterior' },
        { label: '3.', title: payload.nav3 || 'Fecundidad', href: '#fecundidad' }
      ],
      content: {
        text: {
          '#x-block .metric-kicker': `1. ${payload.nav1 || 'Ocio digital'}`,
          '#x-block .metric-heading h2': payload.heading1 || 'Ocio digital diario',
          '#m-block .metric-kicker': `2. ${payload.nav2 || 'Tiempo exterior'}`,
          '#m-block .metric-heading h2': payload.heading2 || 'Horas exteriores diarias',
          '#y-block .metric-kicker': `3. ${payload.nav3 || 'Fecundidad'}`,
          '#y-block .metric-heading h2': payload.heading3 || 'Datos de fecundidad'
        },
        paragraphs: {
          '[data-template-slot="intro-body"]': paragraphs(payload.intro),
          '[data-template-slot="after-ocio-digital"]': paragraphs(payload.afterDigital),
          '[data-template-slot="before-tiempo-exterior"]': paragraphs(payload.beforeExterior),
          '[data-template-slot="after-tiempo-exterior"]': paragraphs(payload.afterExterior),
          '[data-template-slot="after-graph-1"]': paragraphs(payload.afterGraph1),
          '[data-template-slot="after-fecundidad"]': paragraphs(payload.afterFertility),
          '[data-template-slot="after-graph-2"]': paragraphs(payload.afterGraph2),
          '[data-template-slot="closing-body"]': paragraphs(payload.closing)
        },
        html: {}, attributes: {}, remove: [], hide: []
      },
      footer: {
        editionTitle: payload.editionTitle || `De la edición del ${dateLabel(payload.date)}`,
        editionText: payload.editionText || 'Descubra más historias en nuestra portada.',
        editionImage: { src: imageSrc, alt: payload.imageAlt || '' },
        moreTitle: 'Más en Comunicación',
        cards: []
      }
    };
  };

  window.ComunicacionArticleConfig = { fromPayload, paragraphs, dateLabel };
})();
