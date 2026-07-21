(() => {
  'use strict';

  const config = window.COMUNICACION_ADMIN_CONFIG || {};
  const apiBase = String(config.apiBaseUrl || '').replace(/\/$/, '');
  const configured = Boolean(apiBase && !apiBase.includes('YOUR-WORKER'));
  const localMode = ['127.0.0.1', 'localhost'].includes(location.hostname) || location.protocol === 'file:';
  const sessionKey = 'comunicacion-admin-session';
  const DB_NAME = 'comunicacion-editor';
  const DB_STORE = 'documents';
  const draftKey = 'article-draft-v3';
  const previewKey = 'article-preview-v3';
  const allowedTags = new Set(['P','BR','H2','H3','H4','STRONG','B','EM','I','U','S','STRIKE','BLOCKQUOTE','UL','OL','LI','A','HR','PRE','CODE','SPAN','FONT','DIV','FIGURE','IMG','FIGCAPTION','TABLE','THEAD','TBODY','TR','TH','TD','SUP','SUB']);
  const blockedTags = new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','TEXTAREA','SELECT','SVG','MATH','META','LINK','BASE','TEMPLATE']);
  const allowedClasses = new Set(['article-media','article-video','article-file','article-table','interactive-chart','interactive-chart-placeholder']);
  const imageTypes = new Set(['image/png','image/jpeg','image/webp','image/gif']);
  let session = sessionStorage.getItem(sessionKey) || '';
  let heroData = null;
  let slugWasEdited = false;
  let savedRange = null;
  let draftTimer = null;

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const loginPanel = $('#login-panel');
  const editorShell = $('#editor-shell');
  const loginButton = $('#login-button');
  const logoutButton = $('#logout-button');
  const setupMessage = $('#setup-message');
  const connectionState = $('#connection-state');
  const form = $('#article-form');
  const draftState = $('#draft-state');
  const saveButton = $('#save-button');
  const previewButton = $('#preview-button');
  const publishButton = $('#publish-button');
  const headerSaveButton = $('#header-save-button');
  const headerPreviewButton = $('#header-preview-button');
  const headerPublishButton = $('#header-publish-button');
  const publishState = $('#publish-state');
  const publishDetail = $('#publish-detail');
  const resultDialog = $('#result-dialog');
  const editor = $('#rich-editor-canvas');
  const bodyHtml = $('#body-html');
  const editorCount = $('#editor-count');
  const mediaCount = $('#editor-media-count');
  const bodyImageInput = $('#body-image-input');
  const blockAddButton = $('#block-add-button');
  const blockAddMenu = $('#block-add-menu');
  const chartDialog = $('#chart-dialog');
  const chartCanvas = $('#chart-preview-canvas');
  const chartTemplateSelect = $('#chart-template');
  const chartStatus = $('#chart-status');
  let chartTemplates = [];
  let chartCatalogPromise = null;
  let chartPreviewReady = false;
  let chartRenderTimer = null;

  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (hashParams.get('session')) {
    session = hashParams.get('session');
    sessionStorage.setItem(sessionKey, session);
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  }

  const slugify = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  const today = new Date().toISOString().slice(0, 10);
  const field = name => form.elements.namedItem(name);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const safeHref = value => {
    const href = String(value || '').trim();
    return /^(https?:\/\/|mailto:|#)/i.test(href) ? href : '';
  };
  const safeImageSrc = value => {
    const src = String(value || '').trim();
    return /^(data:image\/(?:png|jpeg|webp|gif);base64,|https?:\/\/|article-image:\/\/|assets\/articles\/|\.\.\/assets\/articles\/)/i.test(src) ? src : '';
  };
  const safeChartSpec = value => {
    const encoded = String(value || '').trim();
    if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length > 180000) return '';
    try {
      const charts = window.ComunicacionCharts;
      if (!charts) return '';
      return charts.encodeSpec(charts.decodeSpec(encoded));
    } catch (_) { return ''; }
  };
  const safeStyle = value => String(value || '').split(';').map(item => item.trim()).filter(Boolean).map(item => {
    const separator = item.indexOf(':');
    if (separator < 1) return '';
    const property = item.slice(0, separator).trim().toLowerCase();
    const styleValue = item.slice(separator + 1).trim();
    const allowed = ['text-align','font-family','font-size','font-weight','font-style','text-decoration','line-height','margin-top','margin-bottom','color','background-color'];
    if (!allowed.includes(property) || /url\s*\(|expression\s*\(|@import|javascript:/i.test(styleValue)) return '';
    return `${property}: ${styleValue}`;
  }).filter(Boolean).join('; ');

  const openDb = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const dbWrite = async (key, value) => {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  };
  const dbRead = async key => {
    const db = await openDb();
    const value = await new Promise((resolve, reject) => {
      const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value;
  };

  const api = async (path, options = {}) => {
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}`, ...(options.headers || {}) }
    });
    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(responseBody.error || `Error ${response.status}`);
    return responseBody;
  };

  const setEditor = (open, user = null) => {
    loginPanel.hidden = open;
    editorShell.hidden = !open;
    logoutButton.hidden = !open || localMode;
    [headerSaveButton, headerPreviewButton, headerPublishButton].forEach(button => { button.hidden = !open; });
    if (user) connectionState.textContent = user.name || user.login;
    if (localMode) connectionState.textContent = 'Vista previa local';
  };

  const sanitizeEditorHtml = html => {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    [...template.content.querySelectorAll('*')].forEach(node => {
      if (blockedTags.has(node.tagName)) { node.remove(); return; }
      if (!allowedTags.has(node.tagName)) { node.replaceWith(...node.childNodes); return; }

      const values = Object.fromEntries([...node.attributes].map(attribute => [attribute.name, attribute.value]));
      [...node.attributes].forEach(attribute => node.removeAttribute(attribute.name));
      const style = safeStyle(values.style);
      if (style) node.setAttribute('style', style);
      const classNames = String(values.class || '').split(/\s+/).filter(name => allowedClasses.has(name));
      if (classNames.length) node.className = classNames.join(' ');

      if (node.tagName === 'A') {
        const href = safeHref(values.href);
        if (!href) { node.replaceWith(...node.childNodes); return; }
        node.setAttribute('href', href);
        if (values.title) node.setAttribute('title', values.title.slice(0, 180));
        if (values.target === '_blank') {
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        }
      }
      if (node.tagName === 'IMG') {
        const src = safeImageSrc(values.src);
        if (!src) { node.remove(); return; }
        node.setAttribute('src', src);
        node.setAttribute('alt', String(values.alt || '').slice(0, 240));
        if (values['data-image-id']) node.setAttribute('data-image-id', values['data-image-id'].replace(/[^a-z0-9-]/gi, '').slice(0, 80));
      }
      if (node.tagName === 'FIGURE') {
        if (values['data-image-id']) node.setAttribute('data-image-id', values['data-image-id'].replace(/[^a-z0-9-]/gi, '').slice(0, 80));
        const videoUrl = safeHref(values['data-video-url']);
        if (videoUrl) node.setAttribute('data-video-url', videoUrl);
        const chartSpec = safeChartSpec(values['data-chart-spec']);
        if (classNames.includes('interactive-chart') && chartSpec) {
          node.setAttribute('data-chart-spec', chartSpec);
          const chartId = String(values['data-chart-id'] || '').replace(/[^a-z0-9-]/gi, '').slice(0, 80);
          if (chartId) node.setAttribute('data-chart-id', chartId);
          node.setAttribute('aria-label', String(values['aria-label'] || 'Gráfico interactivo').slice(0, 240));
        }
      }
      if (node.tagName === 'FONT') {
        const face = String(values.face || '').replace(/[^\w\s,"'-]/g, '').slice(0, 80);
        if (face) node.setAttribute('face', face);
        if (/^#[0-9a-f]{3,8}$/i.test(values.color || '')) node.setAttribute('color', values.color);
        if (/^[1-7]$/.test(values.size || '')) node.setAttribute('size', values.size);
      }
      if (['TH','TD'].includes(node.tagName)) {
        if (/^[1-9][0-9]?$/.test(values.colspan || '')) node.setAttribute('colspan', values.colspan);
        if (/^[1-9][0-9]?$/.test(values.rowspan || '')) node.setAttribute('rowspan', values.rowspan);
      }
    });
    return template.innerHTML.trim();
  };

  const serializeArticle = () => {
    const clean = sanitizeEditorHtml(editor.innerHTML);
    const template = document.createElement('template');
    template.innerHTML = clean;
    const bodyImages = [];
    template.content.querySelectorAll('img[data-image-id]').forEach((image, index) => {
      const src = image.getAttribute('src') || '';
      if (!src.startsWith('data:image/')) return;
      const id = (image.dataset.imageId || `image-${index + 1}`).replace(/[^a-z0-9-]/gi, '').slice(0, 80);
      const match = src.match(/^data:([^;]+);base64,/i);
      if (!match || !imageTypes.has(match[1].toLowerCase())) return;
      bodyImages.push({ id, type: match[1].toLowerCase(), dataUrl: src });
      image.setAttribute('src', `article-image://${id}`);
    });
    return { bodyHtml: template.innerHTML.trim(), bodyImages };
  };

  const syncEditor = () => {
    const html = sanitizeEditorHtml(editor.innerHTML);
    bodyHtml.value = html;
    const plain = editor.textContent.replace(/\u00a0/g, ' ').trim();
    const words = plain ? plain.split(/\s+/).length : 0;
    const media = editor.querySelectorAll('figure, table, pre').length;
    editorCount.textContent = `${words.toLocaleString('es-ES')} palabras · ${plain.length.toLocaleString('es-ES')} caracteres`;
    mediaCount.textContent = `${media.toLocaleString('es-ES')} elementos multimedia`;
    editor.dataset.empty = plain || editor.querySelector('img,table,.interactive-chart') ? 'false' : 'true';
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
    const article = serializeArticle();
    data.bodyHtml = article.bodyHtml;
    data.bodyImages = article.bodyImages;
    if (heroData) data.heroImage = heroData;
    return data;
  };

  const setBusy = busy => {
    [saveButton, previewButton, publishButton, headerSaveButton, headerPreviewButton, headerPublishButton].forEach(button => {
      button.disabled = busy || ((button === publishButton || button === headerPublishButton) && localMode);
    });
  };

  const saveDraft = async (announce = true) => {
    const payload = getPayload();
    delete payload.heroImage;
    await dbWrite(draftKey, payload);
    const time = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    draftState.textContent = `Borrador guardado · ${time}`;
    if (announce) {
      publishState.textContent = 'Borrador guardado';
      publishDetail.textContent = 'El texto y las imágenes del cuerpo quedan guardados en este navegador.';
    }
  };

  const restoreDraft = async () => {
    try {
      const draft = await dbRead(draftKey);
      if (!draft) return;
      Object.entries(draft).forEach(([name, value]) => {
        if (name === 'bodyHtml' && typeof value === 'string') {
          let restored = value;
          (draft.bodyImages || []).forEach(image => { restored = restored.split(`article-image://${image.id}`).join(image.dataUrl); });
          editor.innerHTML = sanitizeEditorHtml(restored) || '<p><br></p>';
          return;
        }
        if (name === 'bodyImages') return;
        const input = field(name);
        if (input && typeof value === 'string') input.value = value;
      });
      slugWasEdited = Boolean(draft.slug);
      draftState.textContent = 'Borrador local recuperado';
    } catch (error) {
      console.warn('No se pudo recuperar el borrador', error);
    }
  };

  const rangeInsideEditor = range => Boolean(range && editor.contains(range.commonAncestorContainer));
  const blockSelector = 'p,h2,h3,h4,blockquote,pre,li,figcaption,td,th';
  let selectionLocked = false;
  let historyApplying = false;
  let editorHistory = [];
  let editorHistoryIndex = -1;
  const updateHistoryButtons = () => {
    const undo = $('[data-editor-command="undo"]');
    const redo = $('[data-editor-command="redo"]');
    if (undo) undo.disabled = editorHistoryIndex <= 0;
    if (redo) redo.disabled = editorHistoryIndex < 0 || editorHistoryIndex >= editorHistory.length - 1;
  };
  const recordEditorHistory = () => {
    if (historyApplying) return;
    const html = editor.innerHTML;
    if (editorHistory[editorHistoryIndex] === html) return;
    editorHistory.splice(editorHistoryIndex + 1);
    editorHistory.push(html);
    if (editorHistory.length > 100) editorHistory.shift();
    editorHistoryIndex = editorHistory.length - 1;
    updateHistoryButtons();
  };
  const resetEditorHistory = () => {
    editorHistory = [editor.innerHTML];
    editorHistoryIndex = 0;
    updateHistoryButtons();
  };
  const moveEditorHistory = direction => {
    const next = editorHistoryIndex + direction;
    if (next < 0 || next >= editorHistory.length) { selectionLocked = false; return false; }
    historyApplying = true;
    editorHistoryIndex = next;
    editor.innerHTML = editorHistory[editorHistoryIndex];
    syncEditor();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange = range.cloneRange();
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    historyApplying = false;
    selectionLocked = false;
    updateHistoryButtons();
    updateToolbarState();
    return true;
  };
  const rememberSelection = () => {
    if (selectionLocked) return;
    const selection = window.getSelection();
    if (selection.rangeCount && editor.contains(selection.anchorNode)) savedRange = selection.getRangeAt(0).cloneRange();
  };
  const placeCaretAtEnd = () => {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange = range.cloneRange();
  };
  const restoreSelection = () => {
    if (!rangeInsideEditor(savedRange)) { placeCaretAtEnd(); return; }
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedRange);
  };
  const beginToolbarAction = event => {
    selectionLocked = false;
    rememberSelection();
    selectionLocked = true;
    if (event) event.preventDefault();
  };
  const finishToolbarAction = () => {
    selectionLocked = false;
    rememberSelection();
  };
  const announceInput = () => {
    finishToolbarAction();
    syncEditor();
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const currentRange = () => {
    restoreSelection();
    const selection = window.getSelection();
    return selection.rangeCount ? selection.getRangeAt(0) : null;
  };
  const selectedBlocks = (providedRange = null) => {
    const selection = window.getSelection();
    const liveRange = selection.rangeCount && editor.contains(selection.anchorNode) ? selection.getRangeAt(0) : null;
    const range = providedRange || liveRange || (rangeInsideEditor(savedRange) ? savedRange : null);
    if (!range) return [];
    const candidates = [...editor.querySelectorAll(blockSelector)].filter(block => {
      try { return range.intersectsNode(block); } catch (_) { return false; }
    });
    const leaves = candidates.filter(block => !candidates.some(other => other !== block && block.contains(other)));
    if (leaves.length) return leaves;
    const node = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
    const block = node?.closest?.(blockSelector);
    return block && editor.contains(block) ? [block] : [];
  };
  const applyBlockStyle = (property, value) => {
    selectionLocked = true;
    editor.focus({ preventScroll: true });
    restoreSelection();
    const blocks = selectedBlocks();
    blocks.forEach(block => { block.style[property] = value; });
    announceInput();
    updateToolbarState();
    return blocks.length > 0;
  };
  const applyInlineStyle = (property, value) => {
    selectionLocked = true;
    editor.focus({ preventScroll: true });
    restoreSelection();
    const selection = window.getSelection();
    if (!selection.rangeCount) { selectionLocked = false; return false; }
    const range = selection.getRangeAt(0);

    if (range.collapsed) {
      const span = document.createElement('span');
      span.style[property] = value;
      span.appendChild(document.createTextNode('\u200b'));
      range.insertNode(span);
      range.setStart(span.firstChild, 1);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      savedRange = range.cloneRange();
    } else {
      const wrapper = document.createElement('span');
      wrapper.style[property] = value;
      wrapper.appendChild(range.extractContents());
      range.insertNode(wrapper);
      range.selectNodeContents(wrapper);
      selection.removeAllRanges();
      selection.addRange(range);
      savedRange = range.cloneRange();
    }
    announceInput();
    updateToolbarState();
    return true;
  };
  const applyInlineToggle = (property, activeValue, inactiveValue) => {
    selectionLocked = true;
    editor.focus({ preventScroll: true });
    restoreSelection();
    const selection = window.getSelection();
    if (!selection.rangeCount) { selectionLocked = false; return false; }
    const range = selection.getRangeAt(0);
    if (range.collapsed) {
      const commandName = property === 'fontWeight' ? 'bold' : 'italic';
      const result = document.execCommand(commandName, false, null);
      announceInput();
      updateToolbarState();
      return result;
    }

    const startNode = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
    const startStyle = startNode && editor.contains(startNode) ? getComputedStyle(startNode) : null;
    const active = property === 'fontWeight'
      ? Boolean(startStyle && (startStyle.fontWeight === 'bold' || Number.parseInt(startStyle.fontWeight, 10) >= 600))
      : Boolean(startStyle && startStyle.fontStyle === 'italic');
    const wrapper = document.createElement('span');
    wrapper.style[property] = active ? inactiveValue : activeValue;
    wrapper.appendChild(range.extractContents());
    range.insertNode(wrapper);
    range.selectNodeContents(wrapper);
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange = range.cloneRange();
    announceInput();
    updateToolbarState();
    return true;
  };
  const applyDecorationToggle = decoration => {
    selectionLocked = true;
    editor.focus({ preventScroll: true });
    restoreSelection();
    const selection = window.getSelection();
    if (!selection.rangeCount) { selectionLocked = false; return false; }
    const range = selection.getRangeAt(0);
    if (range.collapsed) {
      const result = document.execCommand(decoration === 'underline' ? 'underline' : 'strikeThrough', false, null);
      announceInput();
      updateToolbarState();
      return result;
    }
    const startNode = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
    const current = startNode && editor.contains(startNode) ? getComputedStyle(startNode).textDecorationLine.split(/\s+/) : [];
    const active = current.includes(decoration);
    const next = active ? current.filter(value => value !== decoration) : [...current.filter(value => value !== 'none'), decoration];
    const wrapper = document.createElement('span');
    wrapper.style.textDecoration = next.length ? next.join(' ') : 'none';
    wrapper.appendChild(range.extractContents());
    range.insertNode(wrapper);
    range.selectNodeContents(wrapper);
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange = range.cloneRange();
    announceInput();
    updateToolbarState();
    return true;
  };
  const command = (name, value = null) => {
    selectionLocked = true;
    editor.focus({ preventScroll: true });
    restoreSelection();
    let result = document.execCommand(name, false, value);
    if (!result && name === 'formatBlock' && value) result = document.execCommand(name, false, `<${value}>`);
    announceInput();
    updateToolbarState();
    return result;
  };
  const insertHtml = html => {
    editor.focus();
    restoreSelection();
    const selection = window.getSelection();
    if (!selection.rangeCount) return false;

    const range = selection.getRangeAt(0);
    const template = document.createElement('template');
    template.innerHTML = sanitizeEditorHtml(html);
    const fragment = template.content;
    const lastNode = fragment.lastChild;
    if (!lastNode) return false;

    range.deleteContents();
    range.insertNode(fragment);
    range.setStartAfter(lastNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange = range.cloneRange();
    announceInput();
    updateToolbarState();
    return true;
  };
  const selectedBlock = () => selectedBlocks(rangeInsideEditor(savedRange) ? savedRange : null)[0] || null;
  const inlineState = property => {
    const range = rangeInsideEditor(savedRange) ? savedRange : currentRange();
    if (!range) return false;
    const node = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
    if (!node || !editor.contains(node)) return false;
    const styles = getComputedStyle(node);
    if (property === 'fontWeight') return styles.fontWeight === 'bold' || Number.parseInt(styles.fontWeight, 10) >= 600;
    if (property === 'fontStyle') return styles.fontStyle === 'italic';
    return false;
  };
  const updateToolbarState = () => {
    $$('[data-editor-command]').forEach(button => {
      const stateful = !['undo','redo','indent','outdent','removeFormat'].includes(button.dataset.editorCommand);
      if (!stateful) return;
      let active = false;
      try {
        if (button.dataset.editorCommand === 'bold') active = inlineState('fontWeight');
        else if (button.dataset.editorCommand === 'italic') active = inlineState('fontStyle');
        else active = document.queryCommandState(button.dataset.editorCommand);
      } catch (_) {}
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const block = selectedBlock();
    if (block) {
      const alignment = getComputedStyle(block).textAlign || 'left';
      $$('[data-editor-align]').forEach(button => {
        const active = button.dataset.editorAlign === alignment || (button.dataset.editorAlign === 'left' && alignment === 'start');
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    }
  };

  document.execCommand('styleWithCSS', false, true);
  document.addEventListener('selectionchange', () => { if (!selectionLocked) { rememberSelection(); updateToolbarState(); } });
  $$('[data-editor-command]').forEach(button => {
    button.addEventListener('pointerdown', beginToolbarAction);
    button.addEventListener('click', () => {
      const name = button.dataset.editorCommand;
      if (name === 'undo') moveEditorHistory(-1);
      else if (name === 'redo') moveEditorHistory(1);
      else if (name === 'bold') applyInlineToggle('fontWeight', '700', '400');
      else if (name === 'italic') applyInlineToggle('fontStyle', 'italic', 'normal');
      else if (name === 'underline') applyDecorationToggle('underline');
      else if (name === 'strikeThrough') applyDecorationToggle('line-through');
      else command(name, button.dataset.editorValue || null);
    });
  });
  $$('[data-editor-select]').forEach(select => {
    select.addEventListener('pointerdown', () => { selectionLocked = false; rememberSelection(); });
    select.addEventListener('change', () => command(select.dataset.editorSelect, select.value));
  });
  $$('[data-editor-inline-style]').forEach(select => {
    select.addEventListener('pointerdown', () => { selectionLocked = false; rememberSelection(); });
    select.addEventListener('change', () => applyInlineStyle(select.dataset.editorInlineStyle, select.value));
  });
  $$('[data-editor-inline-number]').forEach(input => {
    input.addEventListener('pointerdown', () => { selectionLocked = false; rememberSelection(); });
    const apply = () => {
      const value = Math.min(Number(input.max), Math.max(Number(input.min), Number(input.value) || 12));
      input.value = String(value);
      applyInlineStyle(input.dataset.editorInlineNumber, `${value}pt`);
    };
    input.addEventListener('change', apply);
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } });
  });
  $$('[data-editor-block-number]').forEach(input => {
    input.addEventListener('pointerdown', () => { selectionLocked = false; rememberSelection(); });
    const apply = () => {
      const fallback = input.dataset.editorBlockNumber === 'lineHeight' ? 1.15 : 0;
      const value = Math.min(Number(input.max), Math.max(Number(input.min), Number(input.value) || fallback));
      input.value = String(value);
      const cssValue = input.dataset.editorBlockNumber === 'lineHeight' ? String(value) : `${value}pt`;
      applyBlockStyle(input.dataset.editorBlockNumber, cssValue);
    };
    input.addEventListener('change', apply);
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } });
  });
  $$('[data-editor-align]').forEach(button => {
    button.addEventListener('pointerdown', beginToolbarAction);
    button.addEventListener('click', () => applyBlockStyle('textAlign', button.dataset.editorAlign));
  });
  $$('[data-paragraph-spacing]').forEach(button => {
    button.addEventListener('pointerdown', beginToolbarAction);
    button.addEventListener('click', () => {
      const [action, position] = button.dataset.paragraphSpacing.split('-');
      const property = position === 'before' ? 'marginTop' : 'marginBottom';
      const amount = position === 'before' ? 6 : 8;
      const block = selectedBlock();
      const current = block ? Number.parseFloat(getComputedStyle(block)[property]) * .75 : 0;
      applyBlockStyle(property, action === 'remove' ? '0pt' : `${Math.round(current + amount)}pt`);
    });
  });
  $$('[data-editor-color]').forEach(input => {
    input.addEventListener('pointerdown', () => { selectionLocked = false; rememberSelection(); });
    input.addEventListener('input', () => command(input.dataset.editorColor, input.value));
  });

  const openDialog = id => {
    const dialog = $(`#${id}`);
    rememberSelection();
    dialog.showModal();
    selectionLocked = false;
    setTimeout(() => dialog.querySelector('input,button:not(.dialog-close)')?.focus(), 0);
  };
  const closeDialog = dialog => { selectionLocked = false; if (dialog?.open) dialog.close(); };
  $$('dialog .dialog-close').forEach(button => button.addEventListener('click', () => closeDialog(button.closest('dialog'))));
  $$('[data-close-dialog]').forEach(button => button.addEventListener('click', () => closeDialog($(`#${button.dataset.closeDialog}`))));

  const chartApi = () => {
    if (!window.ComunicacionCharts) throw new Error('No se pudo iniciar el creador de gráficos.');
    return window.ComunicacionCharts;
  };
  const setChartStatus = (message, error = false) => {
    chartStatus.textContent = message;
    chartStatus.classList.toggle('is-error', error);
  };
  const selectedChartTemplate = () => chartTemplates.find(template => template.id === chartTemplateSelect.value) || null;
  const chartDataText = data => typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const uniqueChartId = requested => {
    const base = String(requested || 'imported').replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'imported';
    let id = base;
    let suffix = 2;
    while (chartTemplates.some(template => template.id === id)) id = `${base}-${suffix++}`;
    return id;
  };
  const populateChartTemplates = selectedId => {
    chartTemplateSelect.replaceChildren(...chartTemplates.map(template => {
      const option = document.createElement('option');
      option.value = template.id;
      option.textContent = template.name;
      return option;
    }));
    if (selectedId && chartTemplates.some(template => template.id === selectedId)) chartTemplateSelect.value = selectedId;
  };
  const applyChartTemplate = (template, includeContent = true) => {
    if (!template) return;
    $('#chart-template-description').textContent = template.description || 'Plantilla de visualización importada.';
    $('#chart-primary-color').value = template.palette[0] || '#36babc';
    $('#chart-legend').checked = template.defaults.legend;
    $('#chart-grid').checked = template.defaults.grid;
    $('#chart-stacked').checked = template.defaults.stacked;
    $('#chart-stacked').disabled = !['bar', 'horizontalBar'].includes(template.type);
    if (includeContent && template.content) {
      if (template.content.title) $('#chart-title').value = template.content.title;
      if (template.content.subtitle) $('#chart-subtitle').value = template.content.subtitle;
      if (template.content.source) $('#chart-source').value = template.content.source;
      if (template.content.xLabel) $('#chart-x-label').value = template.content.xLabel;
      if (template.content.yLabel) $('#chart-y-label').value = template.content.yLabel;
      $('#chart-theme').value = template.content.theme || 'dark';
      if (template.content.data) $('#chart-data').value = chartDataText(template.content.data);
    }
    if (!$('#chart-alt').value.trim()) $('#chart-alt').value = `Gráfico: ${$('#chart-title').value.trim() || template.name}`;
    chartPreviewReady = false;
  };
  const ensureChartCatalog = async () => {
    if (!chartCatalogPromise) {
      chartCatalogPromise = chartApi().loadCatalog('chart-templates.json').then(templates => {
        chartTemplates = templates;
        populateChartTemplates(templates[0]?.id);
        applyChartTemplate(templates[0]);
        return templates;
      }).catch(error => {
        chartCatalogPromise = null;
        setChartStatus(error.message, true);
        throw error;
      });
    }
    return chartCatalogPromise;
  };
  const chartOptions = () => ({
    title: $('#chart-title').value.trim(),
    subtitle: $('#chart-subtitle').value.trim(),
    source: $('#chart-source').value.trim(),
    xLabel: $('#chart-x-label').value.trim(),
    yLabel: $('#chart-y-label').value.trim(),
    theme: $('#chart-theme').value,
    primaryColor: $('#chart-primary-color').value,
    legend: $('#chart-legend').checked,
    grid: $('#chart-grid').checked,
    stacked: $('#chart-stacked').checked
  });
  const renderChartPreview = () => {
    const template = selectedChartTemplate();
    if (!template) { setChartStatus('Seleccione una plantilla.', true); return false; }
    try {
      const result = chartApi().renderChart(chartCanvas, template, $('#chart-data').value, chartOptions());
      chartPreviewReady = true;
      setChartStatus(`${result.data.rows.length} filas · ${result.data.series.length} series · vista previa interactiva`);
      return true;
    } catch (error) {
      chartPreviewReady = false;
      setChartStatus(error.message, true);
      return false;
    }
  };
  const scheduleChartPreview = () => {
    chartPreviewReady = false;
    clearTimeout(chartRenderTimer);
    chartRenderTimer = setTimeout(renderChartPreview, 260);
  };
  const openChartDialog = async () => {
    openDialog('chart-dialog');
    setChartStatus('Cargando plantillas…');
    try {
      await ensureChartCatalog();
      renderChartPreview();
    } catch (_) {}
  };
  const normalizeGithubJsonUrl = value => {
    const raw = String(value || '').trim();
    if (!raw || raw.length > 2048) throw new Error('Añada una URL válida de GitHub.');
    let url;
    try { url = new URL(raw); } catch (_) { throw new Error('La URL de la plantilla no es válida.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('La plantilla debe usar una dirección HTTPS de GitHub.');
    if (url.hostname === 'github.com') {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 5 || parts[2] !== 'blob') throw new Error('Use un enlace de archivo de GitHub con /blob/.');
      url = new URL(`https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts[3]}/${parts.slice(4).join('/')}`);
    }
    if (!['raw.githubusercontent.com', 'gist.githubusercontent.com'].includes(url.hostname)) {
      throw new Error('Solo se admiten archivos JSON de GitHub o GitHub Gist.');
    }
    return url.href;
  };
  const importChartCatalog = input => {
    const imported = chartApi().validateCatalog(input).map(template => ({ ...template, id: uniqueChartId(template.id) }));
    chartTemplates.push(...imported);
    const selected = imported[imported.length - 1];
    populateChartTemplates(selected.id);
    applyChartTemplate(selected, true);
    renderChartPreview();
    setChartStatus(`${imported.length} plantilla${imported.length === 1 ? '' : 's'} importada${imported.length === 1 ? '' : 's'} de forma segura.`);
  };
  const readChartJson = text => {
    if (text.length > chartApi().LIMITS.text) throw new Error('El archivo JSON supera el límite de 500 KB.');
    try { return JSON.parse(text); } catch (_) { throw new Error('El archivo no contiene JSON válido.'); }
  };

  const insertActions = {
    image: () => { rememberSelection(); bodyImageInput.click(); },
    chart: () => openChartDialog(),
    video: () => openDialog('video-dialog'),
    quote: () => insertHtml('<blockquote>Escriba aquí la cita.</blockquote><p><br></p>'),
    divider: () => insertHtml('<hr><p><br></p>'),
    link: () => openDialog('link-dialog'),
    file: () => openDialog('file-dialog'),
    code: () => insertHtml('<pre><code>Escriba aquí el código.</code></pre><p><br></p>'),
    table: () => openDialog('table-dialog'),
    special: () => openDialog('special-dialog')
  };
  $$('[data-insert-action]').forEach(button => {
    button.addEventListener('pointerdown', event => { rememberSelection(); event.preventDefault(); });
    button.addEventListener('click', () => {
      blockAddMenu.hidden = true;
      blockAddButton.setAttribute('aria-expanded', 'false');
      insertActions[button.dataset.insertAction]?.();
    });
  });
  blockAddButton.addEventListener('click', () => {
    blockAddMenu.hidden = !blockAddMenu.hidden;
    blockAddButton.setAttribute('aria-expanded', String(!blockAddMenu.hidden));
  });
  document.addEventListener('click', event => {
    if (!blockAddMenu.hidden && !blockAddMenu.contains(event.target) && event.target !== blockAddButton) {
      blockAddMenu.hidden = true;
      blockAddButton.setAttribute('aria-expanded', 'false');
    }
  });

  const fileToData = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result });
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.readAsDataURL(file);
  });
  const insertImageFiles = async files => {
    for (const file of files) {
      if (!imageTypes.has(file.type) || file.size > 5 * 1024 * 1024) {
        publishDetail.textContent = `${file.name}: use PNG, JPEG, WebP o GIF de hasta 5 MB.`;
        continue;
      }
      const image = await fileToData(file);
      const id = `img-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
      insertHtml(`<figure class="article-media" data-image-id="${escapeHtml(id)}"><img src="${image.dataUrl}" data-image-id="${escapeHtml(id)}" alt="${escapeHtml(alt)}"><figcaption>Escriba aquí el pie de foto y la fuente.</figcaption></figure><p><br></p>`);
    }
    bodyImageInput.value = '';
  };
  bodyImageInput.addEventListener('change', () => insertImageFiles([...bodyImageInput.files]));
  editor.addEventListener('dragover', event => { if ([...event.dataTransfer.types].includes('Files')) event.preventDefault(); });
  editor.addEventListener('drop', event => {
    const images = [...event.dataTransfer.files].filter(file => imageTypes.has(file.type));
    if (!images.length) return;
    event.preventDefault();
    rememberSelection();
    insertImageFiles(images);
  });
  editor.addEventListener('paste', event => {
    const images = [...(event.clipboardData?.files || [])].filter(file => imageTypes.has(file.type));
    if (images.length) {
      event.preventDefault();
      rememberSelection();
      insertImageFiles(images);
      return;
    }
    setTimeout(() => { editor.innerHTML = sanitizeEditorHtml(editor.innerHTML); announceInput(); }, 0);
  });

  const linkUrl = $('#link-url');
  $('#link-button').addEventListener('pointerdown', beginToolbarAction);
  $('#link-button').addEventListener('click', () => openDialog('link-dialog'));
  $('#link-form').addEventListener('submit', event => {
    event.preventDefault();
    const url = safeHref(linkUrl.value);
    if (!url) { linkUrl.setCustomValidity('Use https://, http://, mailto: o un enlace interno #.'); linkUrl.reportValidity(); return; }
    linkUrl.setCustomValidity('');
    closeDialog($('#link-dialog'));
    selectionLocked = true;
    editor.focus({ preventScroll: true });
    restoreSelection();
    const selection = window.getSelection();
    if (!selection.rangeCount || selection.getRangeAt(0).collapsed) {
      const target = $('#link-new-window').checked ? ' target="_blank" rel="noopener noreferrer"' : '';
      insertHtml(`<a href="${escapeHtml(url)}"${target}>${escapeHtml(url)}</a>`);
    } else {
      const range = selection.getRangeAt(0);
      const anchor = document.createElement('a');
      anchor.href = url;
      if ($('#link-new-window').checked) { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
      anchor.appendChild(range.extractContents());
      range.insertNode(anchor);
      range.selectNodeContents(anchor);
      selection.removeAllRanges();
      selection.addRange(range);
      savedRange = range.cloneRange();
      announceInput();
    }
    event.target.reset();
  });
  $('#link-cancel').addEventListener('click', () => closeDialog($('#link-dialog')));

  $('#video-form').addEventListener('submit', event => {
    event.preventDefault();
    const url = safeHref($('#video-url').value);
    if (!url || !/(youtube\.com|youtu\.be|vimeo\.com)/i.test(url)) {
      $('#video-url').setCustomValidity('Use una dirección válida de YouTube o Vimeo.');
      $('#video-url').reportValidity();
      return;
    }
    $('#video-url').setCustomValidity('');
    const caption = $('#video-caption').value.trim() || 'Vídeo enlazado';
    closeDialog($('#video-dialog'));
    insertHtml(`<figure class="article-video" data-video-url="${escapeHtml(url)}"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Reproducir vídeo</a><figcaption>${escapeHtml(caption)}</figcaption></figure><p><br></p>`);
    event.target.reset();
  });
  $('#file-form').addEventListener('submit', event => {
    event.preventDefault();
    const url = safeHref($('#file-url').value);
    if (!url) { $('#file-url').setCustomValidity('Use una dirección web válida.'); $('#file-url').reportValidity(); return; }
    $('#file-url').setCustomValidity('');
    closeDialog($('#file-dialog'));
    insertHtml(`<div class="article-file"><strong>Archivo</strong><br><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml($('#file-label').value)}</a></div><p><br></p>`);
    event.target.reset();
  });
  $('#table-form').addEventListener('submit', event => {
    event.preventDefault();
    const rows = Math.max(1, Math.min(12, Number($('#table-rows').value) || 3));
    const columns = Math.max(1, Math.min(8, Number($('#table-columns').value) || 3));
    const header = $('#table-header').checked;
    let html = '<table class="article-table">';
    for (let row = 0; row < rows; row += 1) {
      html += '<tr>';
      const tag = header && row === 0 ? 'th' : 'td';
      for (let column = 0; column < columns; column += 1) html += `<${tag}>${header && row === 0 ? `Encabezado ${column + 1}` : 'Dato'}</${tag}>`;
      html += '</tr>';
    }
    html += '</table><p><br></p>';
    closeDialog($('#table-dialog'));
    insertHtml(html);
  });
  $$('#special-dialog .special-grid button').forEach(button => button.addEventListener('click', () => {
    closeDialog($('#special-dialog'));
    insertHtml(escapeHtml(button.textContent));
  }));

  chartTemplateSelect.addEventListener('change', () => {
    applyChartTemplate(selectedChartTemplate(), false);
    renderChartPreview();
  });
  $('#chart-preview-button').addEventListener('click', renderChartPreview);
  $$('#chart-form input:not([type="file"]), #chart-form textarea, #chart-form select').forEach(control => {
    if (control === chartTemplateSelect) return;
    control.addEventListener(control.matches('select,input[type="checkbox"],input[type="color"]') ? 'change' : 'input', scheduleChartPreview);
  });
  $('#chart-title').addEventListener('input', () => {
    const alt = $('#chart-alt');
    if (!alt.dataset.edited) alt.value = `Gráfico: ${$('#chart-title').value.trim()}`;
  });
  $('#chart-alt').addEventListener('input', () => { $('#chart-alt').dataset.edited = 'true'; });
  $('#chart-template-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > chartApi().LIMITS.text) throw new Error('El archivo JSON supera el límite de 500 KB.');
      importChartCatalog(readChartJson(await file.text()));
    } catch (error) { setChartStatus(error.message, true); }
    event.target.value = '';
  });
  $('#chart-template-url-button').addEventListener('click', async () => {
    const button = $('#chart-template-url-button');
    let timeout;
    button.disabled = true;
    setChartStatus('Descargando y validando la plantilla…');
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(normalizeGithubJsonUrl($('#chart-template-url').value), { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`GitHub respondió con el error ${response.status}.`);
      const length = Number(response.headers.get('content-length'));
      if (length && length > chartApi().LIMITS.text) throw new Error('El archivo JSON supera el límite de 500 KB.');
      importChartCatalog(readChartJson(await response.text()));
    } catch (error) {
      setChartStatus(error.name === 'AbortError' ? 'GitHub tardó demasiado en responder.' : error.message, true);
    } finally {
      clearTimeout(timeout);
      button.disabled = false;
    }
  });
  $('#chart-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!chartPreviewReady && !renderChartPreview()) return;
    try {
      const id = `chart-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
      const title = $('#chart-title').value.trim();
      const source = $('#chart-source').value.trim();
      const caption = source ? `${title}. Fuente: ${source}.` : title;
      const alt = $('#chart-alt').value.trim();
      if (!alt) { $('#chart-alt').reportValidity(); return; }
      const spec = chartApi().createSpec(selectedChartTemplate(), $('#chart-data').value, chartOptions());
      const encoded = chartApi().encodeSpec(spec);
      closeDialog(chartDialog);
      insertHtml(`<figure class="interactive-chart" data-chart-id="${escapeHtml(id)}" data-chart-spec="${encoded}" aria-label="${escapeHtml(alt)}"><div class="interactive-chart-placeholder"><strong>${escapeHtml(title)}</strong><span>Gráfico interactivo · disponible en la vista previa y en el artículo publicado</span></div><figcaption>${escapeHtml(caption)}</figcaption></figure><p><br></p>`);
      setChartStatus('Gráfico interactivo insertado en el artículo.');
    } catch (error) { setChartStatus(error.message, true); }
  });

  $('#spellcheck-button').addEventListener('click', event => {
    const enabled = editor.spellcheck = !editor.spellcheck;
    event.currentTarget.classList.toggle('is-active', enabled);
    event.currentTarget.setAttribute('aria-pressed', String(enabled));
  });

  field('date').value = today;
  field('title').addEventListener('input', event => { if (!slugWasEdited) field('slug').value = slugify(event.target.value); });
  field('slug').addEventListener('input', event => { slugWasEdited = true; event.target.value = slugify(event.target.value); });
  field('heroImage').addEventListener('change', async event => {
    const file = event.target.files[0];
    heroData = null;
    if (!file) return;
    if (!imageTypes.has(file.type) || file.type === 'image/gif' || file.size > 5 * 1024 * 1024) {
      event.target.value = '';
      event.target.setCustomValidity('Use PNG, JPEG o WebP de hasta 5 MB.');
      event.target.reportValidity();
      return;
    }
    event.target.setCustomValidity('');
    heroData = await fileToData(file);
  });

  editor.addEventListener('input', () => { syncEditor(); recordEditorHistory(); scheduleDraftState(); });
  form.addEventListener('input', scheduleDraftState);
  function scheduleDraftState() {
    draftState.textContent = 'Cambios sin guardar';
    publishState.textContent = 'Borrador modificado';
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { saveDraft(false).catch(() => {}); }, 2000);
  }

  const doSave = async () => {
    try { await saveDraft(); }
    catch (error) { publishState.textContent = 'No se pudo guardar'; publishDetail.textContent = error.message; }
  };
  const doPreview = async () => {
    if (!validForm()) return;
    const payload = getPayload();
    if (heroData) payload.heroPreview = heroData.dataUrl;
    await dbWrite(previewKey, payload);
    window.open('preview.html', '_blank', 'noopener');
  };
  saveButton.addEventListener('click', doSave);
  headerSaveButton.addEventListener('click', doSave);
  previewButton.addEventListener('click', doPreview);
  headerPreviewButton.addEventListener('click', doPreview);
  headerPublishButton.addEventListener('click', () => form.requestSubmit());

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
    publishDetail.textContent = 'Creando el artículo, guardando las imágenes y actualizando la portada.';
    try {
      const result = await api('/api/publish', { method: 'POST', body: JSON.stringify(getPayload()) });
      await saveDraft(false);
      publishState.textContent = 'Publicado';
      publishDetail.textContent = result.commit || 'La actualización se ha enviado a GitHub Pages.';
      $('#result-message').textContent = 'GitHub Pages puede tardar uno o dos minutos en mostrar la nueva versión.';
      $('#result-link').href = result.url;
      resultDialog.showModal();
    } catch (error) {
      publishState.textContent = 'No se pudo publicar';
      publishDetail.textContent = error.message;
    } finally { setBusy(false); }
  });

  const init = async () => {
    await restoreDraft();
    syncEditor();
    resetEditorHistory();
    if (localMode) {
      setEditor(true);
      publishButton.disabled = true;
      headerPublishButton.disabled = true;
      publishDetail.textContent = 'Modo local: edición y vista previa activas; publicar requiere el Worker.';
      return;
    }
    if (!configured) {
      loginButton.hidden = true;
      setupMessage.hidden = false;
      setupMessage.textContent = 'Falta indicar la URL del Worker en admin/config.js.';
      return;
    }
    loginButton.href = `${apiBase}/auth/login`;
    if (!session) return;
    try { const result = await api('/api/me'); setEditor(true, result.user); }
    catch (_) { sessionStorage.removeItem(sessionKey); session = ''; setEditor(false); }
  };

  init();
})();
