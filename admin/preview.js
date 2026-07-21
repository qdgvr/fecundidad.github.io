(() => {
  'use strict';

  const render = async () => {
    const status = document.querySelector('#preview-status');
    try {
      const payload = JSON.parse(localStorage.getItem('comunicacion-preview') || 'null');
      if (!payload) throw new Error('No hay un borrador para previsualizar.');
      const config = window.ComunicacionArticleConfig.fromPayload(payload, { baseUrl: location.origin });
      const response = await fetch('../index.html', { cache: 'no-store' });
      if (!response.ok) throw new Error(`No se pudo cargar la plantilla (${response.status}).`);
      let html = await response.text();
      const safeConfig = JSON.stringify(config).replace(/</g, '\\u003c');
      const closeScript = '</' + 'script>';
      const scripts = `<script>window.REPORTAGE_ARTICLE=${safeConfig};${closeScript}<script src="article-template.js?v=editor-1">${closeScript}`;
      html = html.replace('<head>', '<head><base href="../">').replace('<!-- REPORTAGE_TEMPLATE_RUNTIME -->', scripts);
      document.open();
      document.write(html);
      document.close();
    } catch (error) {
      status.textContent = error.message;
    }
  };

  render();
})();
