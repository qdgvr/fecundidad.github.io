(() => {
  'use strict';

  const config = window.COMUNICACION_ADMIN_CONFIG || {};
  const apiBase = String(config.apiBaseUrl || '').replace(/\/$/, '');
  const configured = apiBase && !apiBase.includes('YOUR-WORKER');
  const localMode = location.hostname === '127.0.0.1' || location.hostname === 'localhost' || location.protocol === 'file:';
  const sessionKey = 'comunicacion-admin-session';
  const draftKey = 'comunicacion-article-draft-v2';
  const allowedTags = new Set(['P', 'BR', 'H2', 'H3', 'H4', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'A', 'HR', 'PRE', 'CODE', 'SPAN', 'FONT', 'DIV']);
  const blockedTags = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'SVG', 'MATH', 'META', 'LINK', 'BASE', 'TEMPLATE']);
  let session = sessionStorage.getItem(sessionKey) || '';
  let heroData = null;
  let slugWasEdited = false;
  let savedRange = null;

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
  const linkDialog = document.querySelector('#link-dialog');
  const linkForm = document.querySelector('#link-form');
  const editor = document.querySelector('#rich-editor-canvas');
  const bodyHtml = document.querySelector('#body-html');
  const editorCount = document.querySelector('#editor-count');

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

  const safeStyle = value => String(value || '').split(';').map(item => item.trim()).filter(Boolean).map(item => {
    const separator = item.indexOf(':');
    if (separator < 1) return '';
    const property = item.slice(0, separator).trim().toLowerCase();
    const styleValue = item.slice(separator + 1).trim();
    const allowed = ['text-align', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'line-height', 'color', 'background-color'];
    if (!allowed.includes(property) || /url\s*\(|expression\s*\(|@import|javascript:/i.test(styleValue)) return '';
    return `${property}: ${styleValue}`;
  }).filter(Boolean).join('; ');

  const safeHref = value => {
    const href = String(value || '').trim();
    if (/^(https?:\/\/|mailto:|#)/i.test(href)) return href;
    return '';
  };

  const sanitizeEditorHtml = html => {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    [...template.content.querySelectorAll('*')].forEach(node => {
      if (blockedTags.has(node.tagName)) {
        node.remove();
        return;
      }
      if (!allowedTags.has(node.tagName)) {
        node.replaceWith(...node.childNodes);
        return;
      }
      const href = node.tagName === 'A' ? safeHref(node.getAttribute('href')) : '';
      const title = node.tagName === 'A' ? String(node.getAttribute('title') || '').slice(0, 180) : '';
      const target = node.tagName === 'A' && node.getAttribute('target') === '_blank' ? '_blank' : '';
      const style = safeStyle(node.getAttribute('style'));
      const face = node.tagName === 'FONT' ? String(node.getAttribute('face') || '').replace(/[^\w\s,"'-]/g, '').slice(0, 80) : '';
      const color = node.tagName === 'FONT' && /^#[0-9a-f]{3,8}$/i.test(node.getAttribute('color') || '') ? node.getAttribute('color') : '';
      const size = node.tagName === 'FONT' && /^[1-7]$/.test(node.getAttribute('size') || '') ? node.getAttribute('size') : '';
      [...node.attributes].forEach(attribute => node.removeAttribute(attribute.name));
      if (style) node.setAttribute('style', style);
      if (node.tagName === 'A' && href) {
        node.setAttribute('href', href);
        if (title) node.setAttribute('title', title);
        if (target) {
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        }
      } else if (node.tagName === 'A') {
        node.replaceWith(...node.childNodes);
      }
      if (face) node.setAttribute('face', face);
      if (color) node.setAttribute('color', color);
      if (size) node.setAttribute('size', size);
    });
    return template.innerHTML.trim();
  };

  const syncEditor = () => {
    const html = sanitizeEditorHtml(editor.innerHTML);
    bodyHtml.value = html;
    const plain = editor.textContent.replace(/\u00a0/g, ' ').trim();
    const words = plain ? plain.split(/\s+/).length : 0;
    editorCount.textContent = `${words.toLocaleString('es-ES')} palabras · ${plain.length.toLocaleString('es-ES')} caracteres`;
    editor.dataset.empty = plain ? 'false' : 'true';
    bodyHtml.setCustomValidity(plain ? '' : 'Escriba el cuerpo del artículo.');
    return html;
  };

  const validForm = () => {
    syncEditor();
    if (!form.reportValidity()) return false;
    if (bodyHtml.validationMessage) {
      editor.focus();
      publishDetail.textContent = bodyHtml.validationMessage;
      return false;
    }
    return true;
  };

  const getPayload = () => {
    syncEditor();
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
        if (name === 'bodyHtml' && typeof value === 'string') {
          editor.innerHTML = sanitizeEditorHtml(value) || '<p><br></p>';
          return;
        }
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

  const rangeInsideEditor = range => range && editor.contains(range.commonAncestorContainer);
  const rememberSelection = () => {
    const selection = window.getSelection();
    if (selection.rangeCount && editor.contains(selection.anchorNode)) savedRange = selection.getRangeAt(0).cloneRange();
  };
  const restoreSelection = () => {
    if (!rangeInsideEditor(savedRange)) return;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedRange);
  };
  const command = (name, value = null) => {
    editor.focus();
    restoreSelection();
    document.execCommand(name, false, value);
    rememberSelection();
    syncEditor();
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  };

  document.execCommand('styleWithCSS', false, true);
  document.addEventListener('selectionchange', rememberSelection);
  document.querySelectorAll('[data-editor-command]').forEach(button => {
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => command(button.dataset.editorCommand, button.dataset.editorValue || null));
  });
  document.querySelectorAll('[data-editor-select]').forEach(select => {
    select.addEventListener('change', () => {
      const name = select.dataset.editorSelect;
      const value = name === 'formatBlock' ? `<${select.value}>` : select.value;
      command(name, value);
    });
  });
  document.querySelectorAll('[data-editor-color]').forEach(input => input.addEventListener('input', () => command(input.dataset.editorColor, input.value)));

  document.querySelector('#link-button').addEventListener('mousedown', event => event.preventDefault());
  document.querySelector('#link-button').addEventListener('click', () => {
    rememberSelection();
    document.querySelector('#link-url').value = '';
    linkDialog.showModal();
    document.querySelector('#link-url').focus();
  });
  linkForm.addEventListener('submit', event => {
    event.preventDefault();
    const url = safeHref(document.querySelector('#link-url').value);
    if (!url) {
      document.querySelector('#link-url').setCustomValidity('Use una dirección https://, http://, mailto: o un enlace interno #.');
      document.querySelector('#link-url').reportValidity();
      return;
    }
    document.querySelector('#link-url').setCustomValidity('');
    editor.focus();
    restoreSelection();
    const selection = window.getSelection();
    if (!selection.rangeCount || selection.getRangeAt(0).collapsed) {
      const target = document.querySelector('#link-new-window').checked ? ' target="_blank" rel="noopener noreferrer"' : '';
      document.execCommand('insertHTML', false, `<a href="${url.replace(/"/g, '&quot;')}"${target}>${url}</a>`);
    } else {
      document.execCommand('createLink', false, url);
      const anchor = selection.anchorNode?.parentElement?.closest('a');
      if (anchor && document.querySelector('#link-new-window').checked) {
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
      }
    }
    linkDialog.close();
    syncEditor();
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
  document.querySelector('#link-cancel').addEventListener('click', () => linkDialog.close());
  linkDialog.querySelector('.dialog-close').addEventListener('click', () => linkDialog.close());
  resultDialog.querySelector('.dialog-close').addEventListener('click', () => resultDialog.close());

  field('date').value = today;
  restoreDraft();
  syncEditor();

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

  editor.addEventListener('paste', () => setTimeout(syncEditor));
  editor.addEventListener('input', syncEditor);
  form.addEventListener('input', () => {
    draftState.textContent = 'Cambios sin guardar';
    publishState.textContent = 'Borrador modificado';
  });

  saveButton.addEventListener('click', () => saveDraft());
  previewButton.addEventListener('click', () => {
    if (!validForm()) return;
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

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (localMode || !validForm()) return;
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
