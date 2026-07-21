(() => {
  'use strict';

  const readPreview = () => new Promise((resolve, reject) => {
    const request = indexedDB.open('comunicacion-editor', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('documents')) request.result.createObjectStore('documents');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction('documents', 'readonly').objectStore('documents').get('article-preview-v3');
      get.onsuccess = () => { resolve(get.result || null); db.close(); };
      get.onerror = () => { reject(get.error); db.close(); };
    };
  });

  const render = async () => {
    const status = document.querySelector('#preview-status');
    try {
      const payload = await readPreview();
      if (!payload) throw new Error('No hay un borrador para previsualizar.');
      window.COMUNICACION_PREVIEW_PAYLOAD = payload;
      const response = await fetch('../post-template.html', { cache: 'no-store' });
      if (!response.ok) throw new Error(`No se pudo cargar la plantilla (${response.status}).`);
      let html = await response.text();
      const scripts = '<script src="admin/article-config.js"></script><script src="admin/preview-config.js"></script>';
      html = html.replace('<head>', '<head><base href="../">').replace('<!-- POST_TEMPLATE_RUNTIME -->', scripts);
      document.open();
      document.write(html);
      document.close();
    } catch (error) {
      status.textContent = error.message;
    }
  };

  render();
})();
