(() => {
  'use strict';
  try {
    const payload = window.COMUNICACION_PREVIEW_PAYLOAD || JSON.parse(localStorage.getItem('comunicacion-preview') || 'null');
    if (payload && window.ComunicacionArticleConfig) {
      window.COMUNICACION_POST = window.ComunicacionArticleConfig.fromPayload(payload, { baseUrl: location.origin });
    }
  } catch (_) {}
})();
