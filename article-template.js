(() => {
  'use strict';

  const config = window.REPORTAGE_ARTICLE;
  if (!config) return;

  const warn = (message) => console.warn(`[reportage-template] ${message}`);
  const selectAll = (selector) => {
    try {
      return [...document.querySelectorAll(selector)];
    } catch (error) {
      warn(`Selector no válido: ${selector}`);
      return [];
    }
  };

  const forEachMatch = (selector, callback) => {
    const matches = selectAll(selector);
    if (!matches.length) warn(`No se encontró: ${selector}`);
    matches.forEach(callback);
  };

  const setMeta = (name, value) => {
    if (!value) return;
    let node = document.head.querySelector(`meta[name="${name}"]`);
    if (!node) {
      node = document.createElement('meta');
      node.name = name;
      document.head.appendChild(node);
    }
    node.content = value;
  };

  const meta = config.meta || {};
  if (meta.title) document.title = meta.title;
  setMeta('description', meta.description);

  if (meta.canonical) {
    let canonical = document.head.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = meta.canonical;
    window.REPORTAGE_CANONICAL_URL = meta.canonical;
  } else {
    window.REPORTAGE_CANONICAL_URL = window.location.href.split('#')[0];
  }

  if (config.slug) document.documentElement.dataset.articleSlug = config.slug;
  if (config.bodyClass) document.body.classList.add(...config.bodyClass.split(/\s+/).filter(Boolean));

  if (config.brand) {
    const brand = document.querySelector('.site-header .brand');
    if (brand) {
      if (config.brand.href) brand.href = config.brand.href;
      const name = brand.querySelector('span');
      const motto = brand.querySelector('em');
      if (name && config.brand.name) name.textContent = config.brand.name;
      if (motto && config.brand.motto) motto.textContent = config.brand.motto;
    }
  }

  if (Array.isArray(config.globeSteps)) {
    const container = document.querySelector('.globe-scroll-chapters');
    if (container) {
      const fragment = document.createDocumentFragment();
      config.globeSteps.forEach((step, index) => {
        const section = document.createElement('section');
        section.className = `globe-chapter${step.titleCard ? ' globe-title-chapter' : ''}`;
        section.dataset.region = step.region || 'title';
        ['lat', 'lon', 'camera'].forEach((key) => {
          if (step[key] !== undefined && step[key] !== null) section.dataset[key] = String(step[key]);
        });

        const label = document.createElement('span');
        label.textContent = step.label || String(index + 1).padStart(2, '0');
        const title = document.createElement('h2');
        title.textContent = step.title || '';
        const text = document.createElement('p');
        text.textContent = step.text || '';
        section.append(label, title, text);
        fragment.appendChild(section);
      });
      container.replaceChildren(fragment);
    }
  }

  if (Array.isArray(config.navigation)) {
    const nav = document.querySelector('.chapter-nav');
    if (nav) {
      const fragment = document.createDocumentFragment();
      config.navigation.forEach((item, index) => {
        const link = document.createElement('a');
        link.href = item.href || '#';
        const number = document.createElement('span');
        number.textContent = item.label || `${index + 1}.`;
        const title = document.createElement('strong');
        title.textContent = item.title || '';
        link.append(number, title);
        fragment.appendChild(link);
      });
      nav.replaceChildren(fragment);
    }
  }

  const content = config.content || {};

  Object.entries(content.text || {}).forEach(([selector, value]) => {
    forEachMatch(selector, (element) => { element.textContent = value; });
  });

  Object.entries(content.html || {}).forEach(([selector, value]) => {
    forEachMatch(selector, (element) => { element.innerHTML = value; });
  });

  Object.entries(content.paragraphs || {}).forEach(([selector, paragraphs]) => {
    forEachMatch(selector, (element) => {
      const fragment = document.createDocumentFragment();
      paragraphs.forEach((paragraph) => {
        const node = document.createElement('p');
        if (typeof paragraph === 'string') node.textContent = paragraph;
        else if (paragraph && paragraph.html !== undefined) node.innerHTML = paragraph.html;
        else node.textContent = paragraph?.text || '';
        fragment.appendChild(node);
      });
      element.replaceChildren(fragment);
    });
  });

  Object.entries(content.attributes || {}).forEach(([selector, attributes]) => {
    forEachMatch(selector, (element) => {
      Object.entries(attributes).forEach(([name, value]) => {
        if (value === null || value === false) element.removeAttribute(name);
        else element.setAttribute(name, String(value));
      });
    });
  });

  (content.remove || []).forEach((selector) => {
    forEachMatch(selector, (element) => element.remove());
  });

  (content.hide || []).forEach((selector) => {
    forEachMatch(selector, (element) => { element.hidden = true; });
  });

  if (config.footer) {
    const footer = config.footer;
    if (footer.editionTitle) {
      const node = document.querySelector('.article-tail-meta h4');
      if (node) node.textContent = footer.editionTitle;
    }
    if (footer.editionText) {
      const node = document.querySelector('.article-tail-meta p');
      if (node) node.textContent = footer.editionText;
    }
    if (footer.editionImage) {
      const image = document.querySelector('.article-tail-thumb img');
      if (image) {
        image.src = footer.editionImage.src || image.src;
        image.alt = footer.editionImage.alt || '';
      }
    }
    if (footer.moreTitle) {
      const node = document.querySelector('.article-tail-more-title');
      if (node) node.textContent = footer.moreTitle;
    }
    if (Array.isArray(footer.cards)) {
      const grid = document.querySelector('.article-tail-grid');
      if (grid) {
        const fragment = document.createDocumentFragment();
        footer.cards.forEach((card) => {
          const article = document.createElement('article');
          article.className = 'article-tail-card';
          const wrapper = card.href ? document.createElement('a') : document.createElement('div');
          if (card.href) {
            wrapper.href = card.href;
            if (card.external !== false) {
              wrapper.target = '_blank';
              wrapper.rel = 'noopener';
            }
          }
          const title = document.createElement('h5');
          title.textContent = card.title || '';
          const description = document.createElement('p');
          description.textContent = card.description || '';
          wrapper.append(title, description);
          article.appendChild(wrapper);
          fragment.appendChild(article);
        });
        grid.replaceChildren(fragment);
      }
    }
  }

  document.dispatchEvent(new CustomEvent('reportage:content-ready', { detail: { config } }));
})();
