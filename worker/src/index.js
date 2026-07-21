const encoder = new TextEncoder();
const decoder = new TextDecoder();
const API_VERSION = '2022-11-28';
const MAX_BODY_BYTES = 48 * 1024 * 1024;
const SESSION_SECONDS = 2 * 60 * 60;

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), request, env);

      if (url.pathname === '/auth/login' && request.method === 'GET') return login(request, env);
      if (url.pathname === '/auth/callback' && request.method === 'GET') return callback(request, env);

      if (url.pathname.startsWith('/api/')) {
        enforceOrigin(request, env);
        if (url.pathname === '/api/me' && request.method === 'GET') return cors(await me(request, env), request, env);
        if (url.pathname === '/api/publish' && request.method === 'POST') return cors(await publish(request, env), request, env);
      }

      return cors(json({ error: 'Ruta no encontrada.' }, 404), request, env);
    } catch (error) {
      const status = Number(error.status) || 500;
      const message = status >= 500 ? 'Error interno del servicio editorial.' : error.message;
      console.error('Worker request failed', { status, name: error.name || 'Error' });
      return cors(json({ error: message }, status), request, env);
    }
  }
};

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

function redirect(location, cookie) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}

function cookieValue(request, name) {
  const cookies = String(request.headers.get('Cookie') || '').split(';');
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function cors(response, request, env) {
  const origin = request.headers.get('Origin');
  if (origin && origin === env.SITE_ORIGIN) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Vary', 'Origin');
    response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.headers.set('Access-Control-Max-Age', '86400');
  }
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

function enforceOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (origin !== env.SITE_ORIGIN) fail(403, 'Origen no autorizado.');
}

function bytesToBase64Url(bytes) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function encryptionKey(secret) {
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(`github-oauth:${secret}`));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function sealAccessToken(token, secret) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret), encoder.encode(token));
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`;
}

async function openAccessToken(value, secret) {
  const [iv, encrypted] = String(value || '').split('.');
  if (!iv || !encrypted) fail(401, 'La sesión debe renovarse.');
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlToBytes(iv) },
      await encryptionKey(secret),
      base64UrlToBytes(encrypted)
    );
    return decoder.decode(decrypted);
  } catch (_) {
    fail(401, 'La sesión debe renovarse.');
  }
}

async function sign(payload, secret) {
  const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function verify(token, secret, type) {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) fail(401, 'Sesión no válida.');
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), base64UrlToBytes(signature), encoder.encode(body));
  if (!valid) fail(401, 'Sesión no válida.');
  let payload;
  try {
    payload = JSON.parse(decoder.decode(base64UrlToBytes(body)));
  } catch (_) {
    fail(401, 'Sesión no válida.');
  }
  if (payload.type !== type || payload.exp < Math.floor(Date.now() / 1000)) fail(401, 'La sesión ha caducado.');
  return payload;
}

function randomId() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function login(request, env) {
  const now = Math.floor(Date.now() / 1000);
  const state = await sign({ type: 'oauth', nonce: randomId(), iat: now, exp: now + 600 }, env.SESSION_SECRET);
  const callbackUrl = `${new URL(request.url).origin}/auth/callback`;
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', callbackUrl);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('scope', 'read:user public_repo');
  authorize.searchParams.set('prompt', 'select_account');
  const cookie = `comunicacion_oauth=${encodeURIComponent(state)}; Path=/auth/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
  return redirect(authorize.toString(), cookie);
}

async function callback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) fail(400, 'GitHub no devolvió una autorización válida.');
  if (cookieValue(request, 'comunicacion_oauth') !== state) fail(401, 'El inicio de sesión no coincide con este navegador.');
  await verify(state, env.SESSION_SECRET, 'oauth');

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/auth/callback`
    })
  });
  const tokenBody = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenBody.access_token) fail(401, 'No se pudo verificar la cuenta de GitHub.');

  const userResponse = await fetch('https://api.github.com/user', {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${tokenBody.access_token}`, 'User-Agent': 'Comunicacion-Publisher', 'X-GitHub-Api-Version': API_VERSION }
  });
  const user = await userResponse.json();
  if (!userResponse.ok || !user.login) fail(401, 'No se pudo leer la identidad de GitHub.');
  const grantedScopes = String(userResponse.headers.get('x-oauth-scopes') || '').split(',').map(item => item.trim());
  if (!grantedScopes.includes('public_repo') && !grantedScopes.includes('repo')) {
    fail(403, 'Debe autorizar el acceso de publicación al repositorio público.');
  }

  const allowed = String(env.ALLOWED_GITHUB_LOGINS || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(user.login.toLowerCase())) fail(403, 'Esta cuenta no tiene permisos de publicación.');

  const now = Math.floor(Date.now() / 1000);
  const github = await sealAccessToken(tokenBody.access_token, env.SESSION_SECRET);
  const session = await sign({ type: 'session', login: user.login, name: user.name || user.login, avatar: user.avatar_url || '', github, iat: now, exp: now + SESSION_SECONDS }, env.SESSION_SECRET);
  return redirect(
    `${env.SITE_URL.replace(/\/$/, '')}/admin/#session=${encodeURIComponent(session)}`,
    'comunicacion_oauth=; Path=/auth/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
  );
}

async function authenticated(request, env) {
  const match = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i);
  if (!match) fail(401, 'Debe iniciar sesión.');
  const user = await verify(match[1], env.SESSION_SECRET, 'session');
  const allowed = String(env.ALLOWED_GITHUB_LOGINS || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(user.login.toLowerCase())) fail(403, 'La cuenta ya no tiene permisos.');
  return user;
}

async function me(request, env) {
  const user = await authenticated(request, env);
  return json({ user: { login: user.login, name: user.name, avatar: user.avatar } });
}

function cleanText(value, max, required = false) {
  const text = String(value || '').replace(/\r\n/g, '\n').trim();
  if (required && !text) fail(400, 'Faltan campos obligatorios.');
  if (text.length > max) fail(400, 'Uno de los campos supera la longitud permitida.');
  return text;
}

async function validatePayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'El formulario no contiene un artículo válido.');
  const slug = cleanText(input.slug, 80, true).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug) || ['index', 'main', 'admin', 'content', 'worker', 'post', 'post-template'].includes(slug)) fail(400, 'El slug no es válido o está reservado.');
  const date = cleanText(input.date, 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, 'La fecha no es válida.');
  const fields = {
    slug,
    title: cleanText(input.title, 180, true),
    description: cleanText(input.description, 320, true),
    author: cleanText(input.author, 100, true),
    section: cleanText(input.section, 60, true),
    date,
    imageAlt: cleanText(input.imageAlt, 180),
    bodyHtml: await sanitizeBodyHtml(input.bodyHtml),
    bodyImages: validateBodyImages(input.bodyImages)
  };
  if (input.heroImage) fields.heroImage = validateImage(input.heroImage);
  return fields;
}

function sanitizeStyle(value) {
  const allowed = new Set(['text-align', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'line-height', 'margin-top', 'margin-bottom', 'color', 'background-color']);
  return String(value || '').split(';').map(item => item.trim()).filter(Boolean).map(item => {
    const separator = item.indexOf(':');
    if (separator < 1) return '';
    const property = item.slice(0, separator).trim().toLowerCase();
    const styleValue = item.slice(separator + 1).trim();
    if (!allowed.has(property) || /url\s*\(|expression\s*\(|@import|javascript:/i.test(styleValue)) return '';
    return `${property}: ${styleValue}`;
  }).filter(Boolean).join('; ');
}

function sanitizeHref(value) {
  const href = String(value || '').trim();
  return /^(https?:\/\/|mailto:|#)/i.test(href) ? href : '';
}

function sanitizeChartSpec(value) {
  const encoded = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length > 180000) fail(400, 'El gráfico interactivo no contiene una especificación válida.');
  let input;
  try { input = JSON.parse(decoder.decode(base64UrlToBytes(encoded))); }
  catch (_) { fail(400, 'El gráfico interactivo no contiene JSON válido.'); }
  const types = new Set(['bar', 'horizontalBar', 'line', 'area', 'scatter', 'donut']);
  if (!input || input.version !== 1 || !input.template || !input.data || !types.has(input.template.type)) fail(400, 'El gráfico interactivo no tiene una estructura válida.');
  const cleanChartText = (item, max) => String(item ?? '').trim().slice(0, max);
  const defaultPalette = ['#36babc', '#75a8e8', '#e9b44c', '#ef8354', '#9b87d1', '#8fcf72'];
  const palette = Array.isArray(input.template.palette)
    ? input.template.palette.slice(0, 8).map((item, index) => /^#[0-9a-f]{6}$/i.test(String(item || '')) ? String(item) : defaultPalette[index % defaultPalette.length])
    : defaultPalette;
  const series = Array.isArray(input.data.series) ? input.data.series.slice(0, 8).map(item => cleanChartText(item, 80)).filter(Boolean) : [];
  if (!series.length || new Set(series).size !== series.length) fail(400, 'Las series del gráfico interactivo no son válidas.');
  if (!Array.isArray(input.data.rows) || !input.data.rows.length || input.data.rows.length > 250) fail(400, 'Las filas del gráfico interactivo no son válidas.');
  let numericValues = 0;
  const rows = input.data.rows.map((row, index) => ({
    label: cleanChartText(row?.label ?? `Fila ${index + 1}`, 80),
    values: Object.fromEntries(series.map(key => {
      const value = row?.values?.[key];
      if (typeof value === 'number' && Number.isFinite(value)) { numericValues += 1; return [key, value]; }
      return [key, null];
    }))
  }));
  if (!numericValues) fail(400, 'El gráfico interactivo no contiene valores numéricos.');
  const options = input.options && typeof input.options === 'object' ? input.options : {};
  const canonical = {
    version: 1,
    template: {
      id: cleanChartText(input.template.id || 'interactive-chart', 60).replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
      name: cleanChartText(input.template.name || 'Gráfico interactivo', 80),
      type: input.template.type,
      palette,
      defaults: {
        legend: input.template.defaults?.legend !== false,
        grid: input.template.defaults?.grid !== false,
        stacked: Boolean(input.template.defaults?.stacked)
      }
    },
    data: { labelKey: cleanChartText(input.data.labelKey || 'Etiqueta', 80), series, rows },
    options: {
      title: cleanChartText(options.title, 180),
      subtitle: cleanChartText(options.subtitle, 260),
      source: cleanChartText(options.source, 220),
      xLabel: cleanChartText(options.xLabel, 100),
      yLabel: cleanChartText(options.yLabel, 100),
      theme: options.theme === 'light' ? 'light' : 'dark',
      primaryColor: /^#[0-9a-f]{6}$/i.test(String(options.primaryColor || '')) ? options.primaryColor : defaultPalette[0],
      legend: options.legend !== false,
      grid: options.grid !== false,
      stacked: Boolean(options.stacked)
    }
  };
  const result = bytesToBase64Url(encoder.encode(JSON.stringify(canonical)));
  if (result.length > 180000) fail(400, 'El gráfico interactivo contiene demasiados datos.');
  return result;
}

async function sanitizeBodyHtml(value) {
  const html = cleanText(value, 2000000, true);
  const allowed = new Set(['p', 'br', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'blockquote', 'ul', 'ol', 'li', 'a', 'hr', 'pre', 'code', 'span', 'font', 'div', 'figure', 'img', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub']);
  const blocked = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'svg', 'math', 'meta', 'link', 'base', 'template']);
  const allowedClasses = new Set(['article-media', 'article-video', 'article-file', 'article-table', 'interactive-chart', 'interactive-chart-placeholder']);
  const handler = {
    element(element) {
      const tag = element.tagName.toLowerCase();
      if (blocked.has(tag)) {
        element.remove();
        return;
      }
      if (!allowed.has(tag)) {
        element.removeAndKeepContent();
        return;
      }

      const values = Object.fromEntries([...element.attributes]);
      [...element.attributes].forEach(([name]) => element.removeAttribute(name));
      const style = sanitizeStyle(values.style);
      if (style) element.setAttribute('style', style);
      const classes = String(values.class || '').split(/\s+/).filter(name => allowedClasses.has(name));
      if (classes.length) element.setAttribute('class', classes.join(' '));
      if (tag === 'a') {
        const href = sanitizeHref(values.href);
        if (!href) {
          element.removeAndKeepContent();
          return;
        }
        element.setAttribute('href', href);
        if (values.title) element.setAttribute('title', String(values.title).slice(0, 180));
        if (values.target === '_blank') {
          element.setAttribute('target', '_blank');
          element.setAttribute('rel', 'noopener noreferrer');
        }
      }
      if (tag === 'img') {
        const src = String(values.src || '').trim();
        if (!/^article-image:\/\/[a-z0-9-]{1,80}$/i.test(src) && !/^(?:\.\.\/)?assets\/articles\/[a-z0-9/-]+\.(?:png|jpe?g|webp|gif)$/i.test(src)) {
          element.remove();
          return;
        }
        element.setAttribute('src', src);
        element.setAttribute('alt', String(values.alt || '').slice(0, 240));
        if (/^[a-z0-9-]{1,80}$/i.test(values['data-image-id'] || '')) element.setAttribute('data-image-id', values['data-image-id']);
      }
      if (tag === 'figure') {
        if (/^[a-z0-9-]{1,80}$/i.test(values['data-image-id'] || '')) element.setAttribute('data-image-id', values['data-image-id']);
        const videoUrl = sanitizeHref(values['data-video-url']);
        if (videoUrl && /(youtube\.com|youtu\.be|vimeo\.com)/i.test(videoUrl)) element.setAttribute('data-video-url', videoUrl);
        if (classes.includes('interactive-chart')) {
          element.setAttribute('data-chart-spec', sanitizeChartSpec(values['data-chart-spec']));
          if (/^[a-z0-9-]{1,80}$/i.test(values['data-chart-id'] || '')) element.setAttribute('data-chart-id', values['data-chart-id']);
          element.setAttribute('aria-label', cleanChartTextAttribute(values['aria-label'], 240) || 'Gráfico interactivo');
        }
      }
      if (tag === 'th' || tag === 'td') {
        if (/^[1-9][0-9]?$/.test(values.colspan || '')) element.setAttribute('colspan', values.colspan);
        if (/^[1-9][0-9]?$/.test(values.rowspan || '')) element.setAttribute('rowspan', values.rowspan);
      }
      if (tag === 'font') {
        const face = String(values.face || '').replace(/[^\w\s,"'-]/g, '').slice(0, 80);
        if (face) element.setAttribute('face', face);
        if (/^#[0-9a-f]{3,8}$/i.test(values.color || '')) element.setAttribute('color', values.color);
        if (/^[1-7]$/.test(values.size || '')) element.setAttribute('size', values.size);
      }
    }
  };
  const response = new HTMLRewriter().on('*', handler).transform(new Response(`<template-root>${html}</template-root>`));
  const sanitized = (await response.text()).trim();
  const plainText = sanitized.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ').trim();
  if (!plainText) fail(400, 'El cuerpo del artículo está vacío.');
  return sanitized;
}

function cleanChartTextAttribute(value, max) {
  return String(value || '').replace(/[<>]/g, '').trim().slice(0, max);
}

function validateImage(image) {
  const type = String(image.type || '');
  const allowed = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  if (!allowed[type]) fail(400, 'El formato de imagen no está permitido.');
  const match = String(image.dataUrl || '').match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[1] !== type) fail(400, 'La imagen no es válida.');
  const approxSize = Math.floor(match[2].length * 3 / 4);
  if (approxSize > 5 * 1024 * 1024) fail(400, 'La imagen supera 5 MB.');
  return { type, extension: allowed[type], base64: match[2] };
}

function validateBodyImages(images) {
  if (images == null) return [];
  if (!Array.isArray(images) || images.length > 8) fail(400, 'Puede publicar hasta 8 imágenes dentro del artículo.');
  const seen = new Set();
  return images.map(image => {
    const id = cleanText(image?.id, 80, true).toLowerCase();
    if (!/^[a-z0-9-]+$/.test(id) || seen.has(id)) fail(400, 'Una imagen del cuerpo no tiene un identificador válido.');
    seen.add(id);
    const type = String(image?.type || '');
    const allowed = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
    if (!allowed[type]) fail(400, 'El formato de una imagen del cuerpo no está permitido.');
    const match = String(image?.dataUrl || '').match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!match || match[1] !== type) fail(400, 'Una imagen del cuerpo no es válida.');
    const approxSize = Math.floor(match[2].length * 3 / 4);
    if (approxSize > 5 * 1024 * 1024) fail(400, 'Una imagen del cuerpo supera 5 MB.');
    return { id, type, extension: allowed[type], base64: match[2] };
  });
}

function dateLabel(value) {
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

function articleConfig(payload, env, heroPath) {
  return {
    slug: payload.slug,
    meta: { title: `Comunicación | ${payload.title}`, description: payload.description, canonical: `${env.SITE_URL.replace(/\/$/, '')}/${payload.slug}.html` },
    brand: { name: 'Comunicación', motto: 'veritas lux mea', href: '/fecundidad.github.io/main.html' },
    article: {
      section: payload.section,
      title: payload.title,
      description: payload.description,
      author: payload.author,
      date: payload.date,
      dateLabel: dateLabel(payload.date),
      heroSrc: heroPath,
      heroAlt: payload.imageAlt,
      bodyHtml: payload.bodyHtml
    }
  };
}

async function github(env, token, path, options = {}) {
  const { raw = false, optional = false, headers = {}, ...fetchOptions } = options;
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}${path}`, {
    ...fetchOptions,
    headers: {
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Comunicacion-Publisher',
      'X-GitHub-Api-Version': API_VERSION,
      ...headers
    }
  });
  if (optional && response.status === 404) return null;
  if (!response.ok) {
    console.error('GitHub request failed', {
      status: response.status,
      requestId: response.headers.get('x-github-request-id') || 'unknown'
    });
    fail(response.status === 409 ? 409 : 502, 'GitHub rechazó la actualización del reportaje.');
  }
  return raw ? response.text() : response.json();
}

async function publish(request, env) {
  const user = await authenticated(request, env);
  const githubToken = await openAccessToken(user.github, env.SESSION_SECRET);
  const contentType = String(request.headers.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') fail(415, 'La publicación debe enviarse como JSON.');
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_BODY_BYTES) fail(413, 'La publicación es demasiado grande.');
  const rawBody = await request.arrayBuffer();
  if (rawBody.byteLength > MAX_BODY_BYTES) fail(413, 'La publicación es demasiado grande.');
  let input;
  try {
    input = JSON.parse(decoder.decode(rawBody));
  } catch (_) {
    fail(400, 'El formulario no contiene JSON válido.');
  }
  const payload = await validatePayload(input);
  const branch = env.GITHUB_BRANCH || 'main';

  const existing = await github(env, githubToken, `/contents/${encodeURIComponent(payload.slug)}.html?ref=${encodeURIComponent(branch)}`, { optional: true });
  if (existing) fail(409, 'Ya existe un artículo con ese slug.');

  const [template, manifestText, ref] = await Promise.all([
    github(env, githubToken, `/contents/post-template.html?ref=${encodeURIComponent(branch)}`, { raw: true }),
    github(env, githubToken, `/contents/content/articles.json?ref=${encodeURIComponent(branch)}`, { raw: true, optional: true }),
    github(env, githubToken, `/git/ref/heads/${encodeURIComponent(branch)}`)
  ]);
  if (!template.includes('<!-- POST_TEMPLATE_RUNTIME -->')) fail(500, 'La plantilla de artículos no contiene el marcador editorial.');

  const headSha = ref.object.sha;
  const parent = await github(env, githubToken, `/git/commits/${headSha}`);
  const baseTree = parent.tree.sha;
  let manifest = [];
  try { manifest = JSON.parse(manifestText || '[]'); } catch (_) { manifest = []; }

  let heroPath = '';
  let imageEntry = null;
  if (payload.heroImage) {
    heroPath = `assets/articles/${payload.slug}/hero.${payload.heroImage.extension}`;
    const blob = await github(env, githubToken, '/git/blobs', { method: 'POST', body: JSON.stringify({ content: payload.heroImage.base64, encoding: 'base64' }) });
    imageEntry = { path: heroPath, mode: '100644', type: 'blob', sha: blob.sha };
  }

  const bodyImageEntries = await Promise.all(payload.bodyImages.map(async image => {
    const path = `assets/articles/${payload.slug}/${image.id}.${image.extension}`;
    const blob = await github(env, githubToken, '/git/blobs', { method: 'POST', body: JSON.stringify({ content: image.base64, encoding: 'base64' }) });
    payload.bodyHtml = payload.bodyHtml.split(`article-image://${image.id}`).join(path);
    return { path, mode: '100644', type: 'blob', sha: blob.sha };
  }));
  if (/article-image:\/\//i.test(payload.bodyHtml)) fail(400, 'El artículo contiene una imagen que no se ha podido guardar.');

  const config = articleConfig(payload, env, heroPath);
  const configSource = `window.COMUNICACION_POST = ${JSON.stringify(config, null, 2).replace(/</g, '\\u003c')};\n`;
  const scripts = `<script src="content/${payload.slug}.js"></script>`;
  const pageSource = template.replace('<!-- POST_TEMPLATE_RUNTIME -->', scripts);

  const entry = {
    slug: payload.slug, url: `${payload.slug}.html`, title: payload.title, description: payload.description,
    section: payload.section, author: payload.author, date: payload.date, dateLabel: dateLabel(payload.date),
    thumbnail: heroPath, imageAlt: payload.imageAlt
  };
  manifest = [entry, ...manifest.filter(item => item.slug !== payload.slug)].slice(0, 100);

  const tree = [
    { path: `${payload.slug}.html`, mode: '100644', type: 'blob', content: pageSource },
    { path: `content/${payload.slug}.js`, mode: '100644', type: 'blob', content: configSource },
    { path: 'content/articles.json', mode: '100644', type: 'blob', content: `${JSON.stringify(manifest, null, 2)}\n` }
  ];
  if (imageEntry) tree.push(imageEntry);
  tree.push(...bodyImageEntries);

  const newTree = await github(env, githubToken, '/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: baseTree, tree }) });
  const commit = await github(env, githubToken, '/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message: `Publish report: ${payload.title}`, tree: newTree.sha, parents: [headSha], author: { name: payload.author, email: `${user.login}@users.noreply.github.com` } })
  });
  await github(env, githubToken, `/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });

  return json({ ok: true, url: `${env.SITE_URL.replace(/\/$/, '')}/${payload.slug}.html`, commit: commit.html_url || commit.sha });
}
