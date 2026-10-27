import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES, readAll, readSource, assemble } from './collect.js';
import { analyze } from './analysis.js';
import { analyzeHabits } from './habits.js';
import { loadProfile, saveProfile } from './profile.js';
import { setEnvValue, folderExists, KEY_NAMES } from './connect.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const plans = JSON.parse(fs.readFileSync(path.join(root, 'data', 'plans.json'), 'utf8'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const CACHE_MS = 5 * 60e3;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 20000) { reject(new Error('Too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

export function startServer(config, { host = '127.0.0.1' } = {}) {
  let cache = null; // { at, results } where results holds one entry per source
  let inflight = null;
  const roots = () => loadProfile().sourcePaths || {};

  async function results(force) {
    if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.results;
    inflight ??= readAll(config, roots()).then((r) => { cache = { at: Date.now(), results: r }; return r; }).finally(() => { inflight = null; });
    return inflight;
  }

  // Re-reads only one provider's sources (or all), so a rescan after fixing a path is quick.
  async function rescan(provider) {
    const current = await results(false);
    const fresh = await Promise.all(current.map((r) => (provider === 'all' || r.provider === provider
      ? readSource(SOURCES.find((s) => s.mod.id === r.id), config, roots()) : r)));
    cache = { at: Date.now(), results: fresh };
  }

  const server = http.createServer(async (req, res) => {
    // Keys stay on this machine: the server only answers loopback hosts and never sends them to the page.
    if (!LOCAL_HOST.test(req.headers.host || '')) { res.writeHead(403).end(); return; }
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/api/usage') {
      try {
        const d = assemble(await results(url.searchParams.has('refresh')), config);
        const profile = loadProfile();
        const habits = analyzeHabits(d, profile);
        json(res, 200, { ...d, profile, plans, analysis: { ...analyze(d, profile, plans, new Date(), { habitIds: habits.tips.map((t) => t.id) }), habits } });
      } catch (e) { json(res, 500, { error: e.message }); }
      return;
    }

    if (url.pathname.startsWith('/api/') && req.method === 'POST') {
      // Refuse writes from other websites: a page on another origin can still POST to localhost.
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) { res.writeHead(403).end(); return; }
      try {
        const body = await readBody(req);
        if (url.pathname === '/api/profile') { saveProfile(body); return json(res, 200, { ok: true }); }
        if (url.pathname === '/api/rescan') {
          const provider = String(body.provider || 'all');
          if (provider !== 'all' && !SOURCES.some((s) => s.provider === provider)) throw new Error('Unknown provider');
          await rescan(provider);
          return json(res, 200, { ok: true });
        }
        if (url.pathname === '/api/sources') {
          // Point a local source at a folder when its logs aren't in the usual place.
          const def = SOURCES.find((s) => s.mod.id === body.id && s.kind === 'local');
          if (!def) throw new Error('Unknown source');
          const dir = String(body.path || '').trim();
          if (!path.isAbsolute(dir) || !folderExists(dir)) throw new Error('That folder was not found. Use the full path to an existing folder.');
          saveProfile({ sourcePaths: { ...(loadProfile().sourcePaths || {}), [def.mod.id]: dir } });
          await rescan(def.provider);
          return json(res, 200, { ok: true });
        }
        if (url.pathname === '/api/keys') {
          if (!Object.hasOwn(KEY_NAMES, body.name)) throw new Error('Unknown setting');
          const provider = setEnvValue(body.name, body.value);
          await rescan(provider);
          return json(res, 200, { ok: true });
        }
        res.writeHead(404).end();
      } catch (e) { json(res, 400, { error: e.message }); }
      return;
    }

    const file = path.normalize(path.join(publicDir, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(publicDir)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });

  return new Promise((resolve) => server.listen(config.port, host, () => resolve(server)));
}
