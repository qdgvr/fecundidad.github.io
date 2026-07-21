(() => {
  'use strict';

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
    const heroSrc = payload.heroPath || payload.heroPreview || '';
    return {
      slug: payload.slug,
      meta: {
        title: `Comunicación | ${payload.title}`,
        description: payload.description,
        canonical: `${baseUrl.replace(/\/$/, '')}/${payload.slug}.html`
      },
      brand: { name: 'Comunicación', motto: 'veritas lux mea', href: '/fecundidad.github.io/main.html' },
      article: {
        section: payload.section || 'Reportaje de datos',
        title: payload.title || '',
        description: payload.description || '',
        author: payload.author || '',
        date: payload.date || '',
        dateLabel: dateLabel(payload.date),
        heroSrc,
        heroAlt: payload.imageAlt || '',
        bodyHtml: payload.bodyHtml || ''
      }
    };
  };

  window.ComunicacionArticleConfig = { fromPayload, dateLabel };
})();
