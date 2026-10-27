import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './collect.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const CACHE_MS = 5 * 60e3;

export function startServer(config, { host = '127.0.0.1' } = {}) {
  let cache = null;
  let inflight = null;

  async function data(force) {
    if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.body;
    inflight ??= collect(config).then((d) => { cache = { at: Date.now(), body: JSON.stringify(d) }; return cache.body; }).finally(() => { inflight = null; });
    return inflight;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    // Keys stay on this machine: the server only listens on loopback and never sends them to the page.
    if (url.pathname === '/api/usage') {
      try {
        const body = await data(url.searchParams.has('refresh'));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(body);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
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
