const encoder = new TextEncoder();
const decoder = new TextDecoder();
const API_VERSION = '2022-11-28';
const MAX_BODY_BYTES = 8 * 1024 * 1024;
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

function validatePayload(input) {
  const slug = cleanText(input.slug, 80, true).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug) || ['index', 'main', 'admin', 'content', 'worker'].includes(slug)) fail(400, 'El slug no es válido o está reservado.');
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
    globeRegion1: cleanText(input.globeRegion1, 30) || 'europe',
    globeTitle1: cleanText(input.globeTitle1, 100),
    globeText1: cleanText(input.globeText1, 700),
    globeRegion2: cleanText(input.globeRegion2, 30) || 'usa',
    globeTitle2: cleanText(input.globeTitle2, 100),
    globeText2: cleanText(input.globeText2, 700),
    nav1: cleanText(input.nav1, 80), heading1: cleanText(input.heading1, 120),
    nav2: cleanText(input.nav2, 80), heading2: cleanText(input.heading2, 120),
    nav3: cleanText(input.nav3, 80), heading3: cleanText(input.heading3, 120),
    intro: cleanText(input.intro, 15000, true),
    afterDigital: cleanText(input.afterDigital, 12000), beforeExterior: cleanText(input.beforeExterior, 12000),
    afterExterior: cleanText(input.afterExterior, 12000), afterGraph1: cleanText(input.afterGraph1, 12000),
    afterFertility: cleanText(input.afterFertility, 12000), afterGraph2: cleanText(input.afterGraph2, 12000),
    closing: cleanText(input.closing, 15000, true),
    editionTitle: cleanText(input.editionTitle, 140), editionText: cleanText(input.editionText, 240)
  };
  if (input.heroImage) fields.heroImage = validateImage(input.heroImage);
  return fields;
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

function splitParagraphs(value) {
  return String(value || '').split(/\n\s*\n/).map(item => item.trim()).filter(Boolean);
}

function dateLabel(value) {
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

function articleConfig(payload, env, heroPath, cards) {
  const presets = {
    europe: { region: 'europe', lat: 47, lon: 8, camera: 4.15 },
    'east-asia': { region: 'east_asia', lat: 36, lon: 115, camera: 4.1 },
    usa: { region: 'united_states', lat: 39, lon: -98, camera: 4.25 },
    world: { region: 'world', lat: 18, lon: 0, camera: 5.7 }
  };
  const first = presets[payload.globeRegion1] || presets.europe;
  const second = presets[payload.globeRegion2] || presets.usa;
  return {
    slug: payload.slug,
    meta: { title: `Comunicación | ${payload.title}`, description: payload.description, canonical: `${env.SITE_URL.replace(/\/$/, '')}/${payload.slug}.html` },
    brand: { name: 'Comunicación', motto: 'veritas lux mea', href: '/fecundidad.github.io/main.html' },
    globeSteps: [
      { ...first, label: '01', title: payload.globeTitle1 || 'El mapa del cambio', text: payload.globeText1 },
      { ...second, label: '02', title: payload.globeTitle2 || 'La escala del reportaje', text: payload.globeText2 },
      { region: 'title', label: payload.section, title: payload.title, text: payload.description, titleCard: true }
    ],
    navigation: [
      { label: '1.', title: payload.nav1 || 'Ocio digital', href: '#ocio-digital' },
      { label: '2.', title: payload.nav2 || 'Tiempo exterior', href: '#tiempo-exterior' },
      { label: '3.', title: payload.nav3 || 'Fecundidad', href: '#fecundidad' }
    ],
    content: {
      text: {
        '#x-block .metric-kicker': `1. ${payload.nav1 || 'Ocio digital'}`, '#x-block .metric-heading h2': payload.heading1 || 'Ocio digital diario',
        '#m-block .metric-kicker': `2. ${payload.nav2 || 'Tiempo exterior'}`, '#m-block .metric-heading h2': payload.heading2 || 'Horas exteriores diarias',
        '#y-block .metric-kicker': `3. ${payload.nav3 || 'Fecundidad'}`, '#y-block .metric-heading h2': payload.heading3 || 'Datos de fecundidad'
      },
      paragraphs: {
        '[data-template-slot="intro-body"]': splitParagraphs(payload.intro),
        '[data-template-slot="after-ocio-digital"]': splitParagraphs(payload.afterDigital),
        '[data-template-slot="before-tiempo-exterior"]': splitParagraphs(payload.beforeExterior),
        '[data-template-slot="after-tiempo-exterior"]': splitParagraphs(payload.afterExterior),
        '[data-template-slot="after-graph-1"]': splitParagraphs(payload.afterGraph1),
        '[data-template-slot="after-fecundidad"]': splitParagraphs(payload.afterFertility),
        '[data-template-slot="after-graph-2"]': splitParagraphs(payload.afterGraph2),
        '[data-template-slot="closing-body"]': splitParagraphs(payload.closing)
      },
      html: {}, attributes: {}, remove: [], hide: []
    },
    footer: {
      editionTitle: payload.editionTitle || `De la edición del ${dateLabel(payload.date)}`,
      editionText: payload.editionText || 'Descubra más historias en nuestra portada.',
      editionImage: { src: heroPath, alt: payload.imageAlt },
      moreTitle: 'Más en Comunicación',
      cards
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
  const payload = validatePayload(input);
  const branch = env.GITHUB_BRANCH || 'main';

  const existing = await github(env, githubToken, `/contents/${encodeURIComponent(payload.slug)}.html?ref=${encodeURIComponent(branch)}`, { optional: true });
  if (existing) fail(409, 'Ya existe un artículo con ese slug.');

  const [template, manifestText, ref] = await Promise.all([
    github(env, githubToken, `/contents/index.html?ref=${encodeURIComponent(branch)}`, { raw: true }),
    github(env, githubToken, `/contents/content/articles.json?ref=${encodeURIComponent(branch)}`, { raw: true, optional: true }),
    github(env, githubToken, `/git/ref/heads/${encodeURIComponent(branch)}`)
  ]);
  if (!template.includes('<!-- REPORTAGE_TEMPLATE_RUNTIME -->')) fail(500, 'La plantilla maestra no contiene el marcador editorial.');

  const headSha = ref.object.sha;
  const parent = await github(env, githubToken, `/git/commits/${headSha}`);
  const baseTree = parent.tree.sha;
  let manifest = [];
  try { manifest = JSON.parse(manifestText || '[]'); } catch (_) { manifest = []; }

  let heroPath = 'assets/tfg-edition.png';
  let imageEntry = null;
  if (payload.heroImage) {
    heroPath = `assets/articles/${payload.slug}/hero.${payload.heroImage.extension}`;
    const blob = await github(env, githubToken, '/git/blobs', { method: 'POST', body: JSON.stringify({ content: payload.heroImage.base64, encoding: 'base64' }) });
    imageEntry = { path: heroPath, mode: '100644', type: 'blob', sha: blob.sha };
  }

  const related = manifest.slice(0, 5).map(item => ({ title: item.title, description: item.description, href: item.url || `${item.slug}.html`, external: false }));
  const config = articleConfig(payload, env, heroPath, related);
  const configSource = `window.REPORTAGE_ARTICLE = ${JSON.stringify(config, null, 2).replace(/</g, '\\u003c')};\n`;
  const scripts = `<script src="content/${payload.slug}.js"></script>\n  <script src="article-template.js?v=editor-1"></script>`;
  const pageSource = template.replace('<!-- REPORTAGE_TEMPLATE_RUNTIME -->', scripts);

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

  const newTree = await github(env, githubToken, '/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: baseTree, tree }) });
  const commit = await github(env, githubToken, '/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message: `Publish report: ${payload.title}`, tree: newTree.sha, parents: [headSha], author: { name: payload.author, email: `${user.login}@users.noreply.github.com` } })
  });
  await github(env, githubToken, `/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });

  return json({ ok: true, url: `${env.SITE_URL.replace(/\/$/, '')}/${payload.slug}.html`, commit: commit.html_url || commit.sha });
}
