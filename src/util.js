import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Local calendar day, so a late-night session lands on the day the user remembers.
export function localDay(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA');
}

// Local hour of day (0-23), used to find when the user is active and when the machine sits idle.
export function localHour(ts) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.getHours();
}

export function utcDay(ts) {
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function walk(dir, test, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, test, out);
    else if (test(e.name)) out.push(p);
  }
  return out;
}

// Reads .jsonl and, on Node versions with zstd support, .jsonl.zst archives.
export function readLines(file) {
  let buf = fs.readFileSync(file);
  if (file.endsWith('.zst')) {
    if (typeof zlib.zstdDecompressSync !== 'function') return [];
    buf = zlib.zstdDecompressSync(buf);
  }
  const lines = [];
  for (const line of buf.toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    try { lines.push(JSON.parse(line)); } catch { /* partial line from a live session */ }
  }
  return lines;
}

export const num = (v) => (Number.isFinite(+v) ? +v : 0);

// Collapses rows that share every key field, summing the token columns.
const SUM_FIELDS = ['requests', 'input', 'cacheWrite', 'cacheRead', 'output'];
export function rollup(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = [r.source, r.day, r.hour, r.model, r.category, r.project].join('\u0000');
    const cur = map.get(key);
    if (!cur) { map.set(key, { ...r }); continue; }
    for (const f of SUM_FIELDS) cur[f] += r[f] || 0;
  }
  return [...map.values()];
}

export function emptyRow(fields) {
  return { requests: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, ...fields };
}
