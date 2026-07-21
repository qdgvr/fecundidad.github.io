(() => {
  'use strict';

  const config = window.COMUNICACION_ADMIN_CONFIG || {};
  const apiBase = String(config.apiBaseUrl || '').replace(/\/$/, '');
  const configured = apiBase && !apiBase.includes('YOUR-WORKER');
  const localMode = !configured && (location.hostname === '127.0.0.1' || location.hostname === 'localhost' || location.protocol === 'file:');
  const sessionKey = 'comunicacion-admin-session';
  const draftKey = 'comunicacion-article-draft';
  let session = sessionStorage.getItem(sessionKey) || '';
  let heroData = null;
  let slugWasEdited = false;

  const loginPanel = document.querySelector('#login-panel');
  const editorShell = document.querySelector('#editor-shell');
  const loginButton = document.querySelector('#login-button');
  const logoutButton = document.querySelector('#logout-button');
  const setupMessage = document.querySelector('#setup-message');
  const connectionState = document.querySelector('#connection-state');
  const form = document.querySelector('#article-form');
  const draftState = document.querySelector('#draft-state');
  const saveButton = document.querySelector('#save-button');
  const previewButton = document.querySelector('#preview-button');
  const publishButton = document.querySelector('#publish-button');
  const publishState = document.querySelector('#publish-state');
  const publishDetail = document.querySelector('#publish-detail');
  const resultDialog = document.querySelector('#result-dialog');

  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (hashParams.get('session')) {
    session = hashParams.get('session');
    sessionStorage.setItem(sessionKey, session);
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  }

  const slugify = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  const today = new Date().toISOString().slice(0, 10);
  const field = name => form.elements.namedItem(name);

  const setEditor = (open, user = null) => {
    loginPanel.hidden = open;
    editorShell.hidden = !open;
    logoutButton.hidden = !open || localMode;
    if (user) connectionState.textContent = user.name || user.login;
    if (localMode) connectionState.textContent = 'Vista previa local';
  };

  const api = async (path, options = {}) => {
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}`, ...(options.headers || {}) }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Error ${response.status}`);
    return body;
  };

  const getPayload = () => {
    const data = Object.fromEntries(new FormData(form).entries());
    delete data.heroImage;
    if (heroData) data.heroImage = heroData;
    return data;
  };

  const saveDraft = (announce = true) => {
    const payload = getPayload();
    delete payload.heroImage;
    localStorage.setItem(draftKey, JSON.stringify(payload));
    draftState.textContent = `Borrador guardado · ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
    if (announce) {
      publishState.textContent = 'Borrador guardado';
      publishDetail.textContent = 'La imagen debe seleccionarse de nuevo al volver a esta página.';
    }
  };

  const restoreDraft = () => {
    const raw = localStorage.getItem(draftKey);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      Object.entries(draft).forEach(([name, value]) => {
        const input = field(name);
        if (input && typeof value === 'string') input.value = value;
      });
      slugWasEdited = Boolean(draft.slug);
      draftState.textContent = 'Borrador local recuperado';
    } catch (_) {}
  };

  const setBusy = busy => {
    publishButton.disabled = busy || localMode;
    saveButton.disabled = busy;
    previewButton.disabled = busy;
  };

  field('date').value = today;
  restoreDraft();

  field('title').addEventListener('input', event => {
    if (!slugWasEdited) field('slug').value = slugify(event.target.value);
  });
  field('slug').addEventListener('input', event => {
    slugWasEdited = true;
    event.target.value = slugify(event.target.value);
  });

  field('heroImage').addEventListener('change', async event => {
    const file = event.target.files[0];
    heroData = null;
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      event.target.value = '';
      event.target.setCustomValidity('La imagen no puede superar 5 MB.');
      event.target.reportValidity();
      return;
    }
    event.target.setCustomValidity('');
    heroData = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result });
      reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
      reader.readAsDataURL(file);
    });
  });

  form.addEventListener('input', () => {
    draftState.textContent = 'Cambios sin guardar';
    publishState.textContent = 'Borrador modificado';
  });

  saveButton.addEventListener('click', () => saveDraft());
  previewButton.addEventListener('click', () => {
    if (!form.reportValidity()) return;
    const payload = getPayload();
    if (heroData) payload.heroPreview = heroData.dataUrl;
    localStorage.setItem('comunicacion-preview', JSON.stringify(payload));
    window.open('preview.html', '_blank', 'noopener');
  });

  logoutButton.addEventListener('click', () => {
    sessionStorage.removeItem(sessionKey);
    session = '';
    setEditor(false);
    if (configured) loginButton.href = `${apiBase}/auth/login`;
  });

  document.querySelector('.dialog-close').addEventListener('click', () => resultDialog.close());

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (localMode || !form.reportValidity()) return;
    setBusy(true);
    publishState.textContent = 'Publicando…';
    publishDetail.textContent = 'Creando el artículo y actualizando la portada en un único commit.';
    try {
      const result = await api('/api/publish', { method: 'POST', body: JSON.stringify(getPayload()) });
      saveDraft(false);
      publishState.textContent = 'Publicado';
      publishDetail.textContent = result.commit || 'La actualización se ha enviado a GitHub Pages.';
      document.querySelector('#result-message').textContent = 'GitHub Pages puede tardar uno o dos minutos en mostrar la nueva versión.';
      const resultLink = document.querySelector('#result-link');
      resultLink.href = result.url;
      resultDialog.showModal();
    } catch (error) {
      publishState.textContent = 'No se pudo publicar';
      publishDetail.textContent = error.message;
    } finally {
      setBusy(false);
    }
  });

  const init = async () => {
    if (localMode) {
      setEditor(true);
      publishButton.disabled = true;
      publishDetail.textContent = 'Modo local: la vista previa funciona; la publicación requiere configurar el Worker.';
      return;
    }
    if (!configured) {
      loginButton.hidden = true;
      setupMessage.hidden = false;
      setupMessage.textContent = 'Falta indicar la URL del Worker en admin/config.js. Consulte worker/README.md para completar la instalación.';
      return;
    }
    loginButton.href = `${apiBase}/auth/login`;
    if (!session) return;
    try {
      const result = await api('/api/me');
      setEditor(true, result.user);
    } catch (_) {
      sessionStorage.removeItem(sessionKey);
      session = '';
      setEditor(false);
    }
  };

  init();
})();
