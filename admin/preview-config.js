(() => {
  'use strict';
  try {
    const payload = JSON.parse(localStorage.getItem('comunicacion-preview') || 'null');
    if (payload && window.ComunicacionArticleConfig) {
      window.COMUNICACION_POST = window.ComunicacionArticleConfig.fromPayload(payload, { baseUrl: location.origin });
    }
  } catch (_) {}
})();
