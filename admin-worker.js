/**
 * Server-side admin API for the GitHub Pages Pixel Desk.
 * Secrets are configured with `wrangler secret put`; never add them to this file.
 */
const encoder = new TextEncoder();
const PROJECTS_PATH = 'projects.json';
const SESSION_TTL_SECONDS = 30 * 60;

function responseJson(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value.replace(/\s/g, ''));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function base64Url(bytes) {
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function safeEqual(left, right) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function signPayload(payload, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return base64Url(new Uint8Array(signature));
}

async function makeSession(env) {
  const payload = base64Url(encoder.encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS })));
  return `${payload}.${await signPayload(payload, env.SESSION_SECRET)}`;
}

async function isAuthenticated(request, env) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  if (!safeEqual(signature, await signPayload(payload, env.SESSION_SECRET))) return false;
  try {
    const decoded = new TextDecoder().decode(base64ToBytes(payload.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - payload.length % 4) % 4)));
    return JSON.parse(decoded).exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function repoConfig(env) {
  if (!env.GITHUB_TOKEN || !env.REPO_OWNER || !env.REPO_NAME || !env.REPO_BRANCH) {
    throw new Error('Chybí serverová konfigurace GitHubu.');
  }
  return `https://api.github.com/repos/${encodeURIComponent(env.REPO_OWNER)}/${encodeURIComponent(env.REPO_NAME)}/contents/${PROJECTS_PATH}`;
}

async function githubRequest(url, env, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Pixel-Desk-admin-worker',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
}

async function readProjects(env) {
  const url = `${repoConfig(env)}?ref=${encodeURIComponent(env.REPO_BRANCH)}`;
  const response = await githubRequest(url, env);
  if (response.status === 404) return { projects: [], sha: null };
  if (!response.ok) throw new Error(`Čtení projektů z GitHubu selhalo (${response.status}).`);
  const file = await response.json();
  const projects = JSON.parse(new TextDecoder().decode(base64ToBytes(file.content || '')));
  if (!Array.isArray(projects)) throw new Error('projects.json musí obsahovat JSON pole.');
  return { projects, sha: file.sha };
}

async function writeProjects(env, projects, sha) {
  const body = {
    message: 'Update Pixel Desk projects',
    content: bytesToBase64(encoder.encode(`${JSON.stringify(projects, null, 2)}\n`)),
    branch: env.REPO_BRANCH,
    ...(sha ? { sha } : {}),
  };
  const response = await githubRequest(repoConfig(env), env, { method: 'PUT', body: JSON.stringify(body) });
  if (response.status === 409 || response.status === 422) throw new Error('Soubor změnil někdo další. Obnov stránku a zkus akci znovu.');
  if (!response.ok) throw new Error(`Zápis do GitHubu selhal (${response.status}).`);
}

function cleanProject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const id = typeof input.id === 'string' ? input.id : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  const category = input.category;
  const parentId = typeof input.parentId === 'string' ? input.parentId : undefined;
  const iconUrl = typeof input.iconUrl === 'string' ? input.iconUrl : '';
  const webUrl = /^https?:\/\//i.test(url);
  const relativeUrl = /^(?!\/)(?!.*\.\.)([\w./-]+)$/i.test(url);
  if (!/^[\w-]{1,100}$/.test(id) || !name || name.length > 48 || description.length > 110 || !url || url.length > 500) return null;
  if (!['web', 'design', 'code', 'other'].includes(category) || (!webUrl && !relativeUrl)) return null;
  let safeIconUrl = '';
  if (iconUrl) {
    try {
      const parsedIcon = new URL(iconUrl);
      if (parsedIcon.protocol === 'https:' && parsedIcon.hostname === 'www.google.com' && parsedIcon.pathname === '/s2/favicons') safeIconUrl = parsedIcon.href;
      else return null;
    } catch { return null; }
  }
  return { id, name, description, url, category, favorite: Boolean(input.favorite), ...(safeIconUrl ? { iconUrl: safeIconUrl } : {}), ...(parentId ? { parentId } : {}) };
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || 'https://mrlugr1.github.io').split(',').map(value => value.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : '';
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (!origin) return responseJson({ error: 'Tento web nemá k API přístup.' }, 403);
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Vary': 'Origin',
      'X-Content-Type-Options': 'nosniff',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return responseJson({ ok: true }, 200, cors);
      }
      if (url.pathname === '/api/projects' && request.method === 'GET') {
        const { projects } = await readProjects(env);
        return responseJson({ projects }, 200, cors);
      }
      if (url.pathname === '/api/login' && request.method === 'POST') {
        if (!env.ADMIN_PASSWORD_SHA256 || !env.SESSION_SECRET) throw new Error('Chybí serverová konfigurace přihlášení.');
        const body = await request.json();
        const password = typeof body.password === 'string' ? body.password : '';
        const digest = await sha256Hex(password);
        if (!safeEqual(digest, env.ADMIN_PASSWORD_SHA256.toLowerCase())) return responseJson({ error: 'Heslo není správné.' }, 401, cors);
        return responseJson({ token: await makeSession(env), expiresIn: SESSION_TTL_SECONDS }, 200, cors);
      }
      if (url.pathname === '/api/logout' && request.method === 'POST') {
        return responseJson({ ok: true }, 200, cors);
      }
      if (!await isAuthenticated(request, env)) return responseJson({ error: 'Přihlášení vypršelo. Přihlas se znovu.' }, 401, cors);

      if (url.pathname === '/api/projects' && request.method === 'POST') {
        const project = cleanProject(await request.json());
        if (!project) return responseJson({ error: 'Projekt obsahuje neplatné údaje.' }, 400, cors);
        const state = await readProjects(env);
        if (state.projects.some(item => item.id === project.id)) return responseJson({ error: 'Projekt s tímto ID už existuje.' }, 409, cors);
        await writeProjects(env, [...state.projects, project], state.sha);
        return responseJson({ ok: true, project }, 201, cors);
      }
      const deleteMatch = url.pathname.match(/^\/api\/projects\/([\w-]{1,100})$/);
      if (deleteMatch && request.method === 'DELETE') {
        const state = await readProjects(env);
        const projects = state.projects.filter(project => project.id !== deleteMatch[1]);
        if (projects.length === state.projects.length) return responseJson({ error: 'Projekt nebyl nalezen.' }, 404, cors);
        await writeProjects(env, projects, state.sha);
        return responseJson({ ok: true }, 200, cors);
      }
      if (deleteMatch && request.method === 'PUT') {
        const project = cleanProject(await request.json());
        if (!project || project.id !== deleteMatch[1]) return responseJson({ error: 'Projekt obsahuje neplatné údaje.' }, 400, cors);
        const state = await readProjects(env);
        const index = state.projects.findIndex(item => item.id === deleteMatch[1]);
        if (index < 0) return responseJson({ error: 'Projekt nebyl nalezen.' }, 404, cors);
        const projects = [...state.projects];
        projects[index] = project;
        await writeProjects(env, projects, state.sha);
        return responseJson({ ok: true, project }, 200, cors);
      }
      return responseJson({ error: 'Neznámý API endpoint.' }, 404, cors);
    } catch (error) {
      return responseJson({ error: error.message || 'Interní chyba serveru.' }, 500, cors);
    }
  },
};

