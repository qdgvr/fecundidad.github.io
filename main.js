(() => {
  const body = document.body;
  const menuButton = document.querySelector('#menu-button');
  const drawer = document.querySelector('#site-drawer');
  const drawerClose = document.querySelector('#drawer-close');
  const drawerScrim = document.querySelector('#drawer-scrim');
  const notificationButton = document.querySelector('#notification-button');
  const notificationPanel = document.querySelector('#notification-panel');
  const editionDate = document.querySelector('#edition-date');
  const publishedGrid = document.querySelector('#published-grid');
  const publishedStatus = document.querySelector('#published-status');

  const setDrawer = open => {
    drawer.classList.toggle('is-open', open);
    drawerScrim.classList.toggle('is-open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    menuButton.setAttribute('aria-expanded', String(open));
    body.classList.toggle('drawer-open', open);
    if (open) drawerClose.focus();
    else menuButton.focus();
  };

  const setNotifications = open => {
    notificationPanel.classList.toggle('is-open', open);
    notificationPanel.setAttribute('aria-hidden', String(!open));
    notificationButton.setAttribute('aria-expanded', String(open));
  };

  menuButton.addEventListener('click', () => setDrawer(true));
  drawerClose.addEventListener('click', () => setDrawer(false));
  drawerScrim.addEventListener('click', () => setDrawer(false));

  notificationButton.addEventListener('click', event => {
    event.stopPropagation();
    setNotifications(!notificationPanel.classList.contains('is-open'));
  });

  notificationPanel.addEventListener('click', event => event.stopPropagation());
  document.addEventListener('click', () => setNotifications(false));

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (drawer.classList.contains('is-open')) setDrawer(false);
    setNotifications(false);
  });

  document.querySelector('.drawer-search').addEventListener('submit', event => {
    event.preventDefault();
    const input = document.querySelector('#site-search');
    const query = input.value.trim();
    if (!query) return;
    input.setCustomValidity('La búsqueda estará disponible al conectar el sistema editorial.');
    input.reportValidity();
    input.addEventListener('input', () => input.setCustomValidity(''), { once: true });
  });

  try {
    editionDate.textContent = new Intl.DateTimeFormat('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(new Date()).replace(/^./, value => value.toUpperCase());
  } catch (_) {
    editionDate.textContent = 'Comunicación · Edición digital';
  }

  const renderPublications = articles => {
    if (!publishedGrid || !Array.isArray(articles) || !articles.length) return;
    const fragment = document.createDocumentFragment();

    articles.slice(0, 6).forEach((item, index) => {
      const article = document.createElement('article');
      article.className = `published-card${index === 0 ? ' published-card-featured' : ''}`;

      const media = document.createElement('a');
      media.className = 'published-card-media';
      media.href = item.url || `${item.slug}.html`;
      const image = document.createElement('img');
      image.src = item.thumbnail || 'assets/tfg-edition.png';
      image.alt = item.imageAlt || '';
      image.loading = index === 0 ? 'eager' : 'lazy';
      media.appendChild(image);

      const copy = document.createElement('div');
      copy.className = 'published-card-copy';
      const tag = document.createElement('span');
      tag.className = 'story-tag';
      tag.textContent = item.section || 'Reportaje';
      const title = document.createElement('h3');
      const titleLink = document.createElement('a');
      titleLink.href = media.href;
      titleLink.textContent = item.title || 'Nuevo reportaje';
      title.appendChild(titleLink);
      const description = document.createElement('p');
      description.textContent = item.description || '';
      const meta = document.createElement('p');
      meta.className = 'published-meta';
      meta.textContent = [item.author, item.dateLabel].filter(Boolean).join(' · ');
      copy.append(tag, title, description, meta);
      article.append(media, copy);
      fragment.appendChild(article);
    });

    publishedGrid.replaceChildren(fragment);
  };

  if (publishedGrid) {
    fetch('content/articles.json', { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(renderPublications)
      .catch(() => {
        if (publishedStatus) {
          publishedStatus.hidden = false;
          publishedStatus.textContent = 'Se muestra la selección editorial disponible.';
        }
      });
  }
})();
