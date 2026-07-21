(() => {
  'use strict';

  const render = async () => {
    const status = document.querySelector('#preview-status');
    try {
      const payload = JSON.parse(localStorage.getItem('comunicacion-preview') || 'null');
      if (!payload) throw new Error('No hay un borrador para previsualizar.');
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
