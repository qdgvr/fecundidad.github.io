(() => {
  'use strict';

  const config = window.COMUNICACION_POST;
  if (!config || !config.article) return;
  const article = config.article;
  const text = (selector, value) => {
    const node = document.querySelector(selector);
    if (node) node.textContent = value || '';
  };

  document.title = config.meta?.title || `Comunicación | ${article.title}`;
  const description = document.querySelector('meta[name="description"]');
  if (description) description.content = config.meta?.description || article.description || '';
  if (config.meta?.canonical) {
    const canonical = document.createElement('link');
    canonical.rel = 'canonical';
    canonical.href = config.meta.canonical;
    document.head.append(canonical);
  }

  const brand = document.querySelector('[data-post-brand]');
  if (brand && config.brand) {
    brand.href = config.brand.href || 'main.html';
    text('[data-post-brand] strong', config.brand.name || 'Comunicación');
    text('[data-post-brand] em', config.brand.motto || 'veritas lux mea');
  }
  text('[data-post-section]', article.section);
  text('[data-post-title]', article.title);
  text('[data-post-description]', article.description);
  text('[data-post-author]', article.author);
  text('[data-post-date]', article.dateLabel);

  const time = document.querySelector('[data-post-date]');
  if (time && article.date) time.dateTime = article.date;
  const body = document.querySelector('[data-post-body]');
  if (body) {
    body.innerHTML = article.bodyHtml || '';
    body.querySelectorAll('.article-video[data-video-url]').forEach(figure => {
      const raw = figure.dataset.videoUrl || '';
      let embed = '';
      try {
        const url = new URL(raw);
        if (url.hostname === 'youtu.be') embed = `https://www.youtube-nocookie.com/embed/${url.pathname.slice(1).replace(/[^a-zA-Z0-9_-]/g, '')}`;
        if (url.hostname.endsWith('youtube.com')) embed = `https://www.youtube-nocookie.com/embed/${String(url.searchParams.get('v') || '').replace(/[^a-zA-Z0-9_-]/g, '')}`;
        if (url.hostname.endsWith('vimeo.com')) embed = `https://player.vimeo.com/video/${url.pathname.split('/').filter(Boolean).pop()?.replace(/\D/g, '') || ''}`;
      } catch (_) {}
      if (!embed || embed.endsWith('/embed/') || embed.endsWith('/video/')) return;
      const frame = document.createElement('iframe');
      frame.src = embed;
      frame.title = figure.querySelector('figcaption')?.textContent || 'Vídeo del artículo';
      frame.loading = 'lazy';
      frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      frame.allowFullscreen = true;
      figure.querySelector('a')?.replaceWith(frame);
    });
  }

  const figure = document.querySelector('[data-post-hero]');
  const image = document.querySelector('[data-post-image]');
  if (figure && image && article.heroSrc) {
    figure.hidden = false;
    image.src = article.heroSrc;
    image.alt = article.heroAlt || '';
    text('[data-post-caption]', article.heroAlt);
  }
})();
