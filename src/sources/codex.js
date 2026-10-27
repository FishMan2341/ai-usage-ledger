import path from 'node:path';
import os from 'node:os';
import { walk, readLines, localDay, num, rollup, emptyRow } from '../util.js';
import { categorize, isHumanText } from '../categorize.js';

export const id = 'codex';
export const label = 'Codex (local logs)';

export function defaultRoot() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function userText(payload) {
  if (payload?.type !== 'message' || payload.role !== 'user') return null;
  for (const c of payload.content || []) if (c?.type === 'input_text' && isHumanText(c.text)) return c.text;
  return null;
}

// OpenAI counts cached and cache-write tokens inside input_tokens; split them out.
function toTokens(u) {
  const cached = num(u.cached_input_tokens);
  const write = num(u.cache_write_input_tokens);
  return { input: Math.max(0, num(u.input_tokens) - cached - write), cacheRead: cached, cacheWrite: write, output: num(u.output_tokens) };
}

export async function read({ root = defaultRoot(), billing } = {}) {
  const files = [
    ...walk(path.join(root, 'sessions'), (n) => n.endsWith('.jsonl')),
    ...walk(path.join(root, 'archived_sessions'), (n) => n.endsWith('.jsonl') || n.endsWith('.jsonl.zst')),
  ];
  if (!files.length) return { rows: [], sessions: [], status: 'not_found', message: `No sessions in ${root}` };

  const seen = new Set();
  const sessions = new Map();
  const raw = [];
  let skippedZst = 0;

  for (const file of files) {
    const lines = readLines(file);
    if (!lines.length && file.endsWith('.zst')) { skippedZst++; continue; }
    const hasRecords = lines.some((l) => l.type === 'token_usage_record');
    let sid = null, model = 'unknown', plan = null, lastTotal = null;
    const turnModel = new Map();

    for (const rec of lines) {
      const p = rec.payload || {};
      if (rec.type === 'session_meta') {
        sid = p.id || p.session_id;
        if (!sessions.has(sid)) sessions.set(sid, { id: sid, source: id, start: p.timestamp || rec.timestamp, prompt: null, project: path.basename(p.cwd || '') || 'unknown', models: {} });
      }
      if (!sid) continue;
      const s = sessions.get(sid);
      if (rec.type === 'turn_context' && p.model) { model = p.model; if (p.turn_id) turnModel.set(p.turn_id, p.model); }
      if (rec.type === 'response_item' && !s.prompt) { const t = userText(p); if (t) s.prompt = t; }
      if (p.type === 'token_count' && p.rate_limits?.plan_type) plan = p.rate_limits.plan_type;

      let u = null, m = model;
      if (hasRecords && rec.type === 'token_usage_record') {
        // Forked sessions replay parent history, so the same response can appear in several files.
        const key = p.response_id || `${p.turn_id}:${rec.timestamp}`;
        if (seen.has(key)) continue;
        seen.add(key);
        u = p.usage;
        m = turnModel.get(p.turn_id) || model;
      } else if (!hasRecords && p.type === 'token_count' && p.info?.last_token_usage) {
        // Older Codex builds only emit running totals; skip repeats of the same total.
        const total = p.info.total_token_usage?.total_tokens;
        if (total === lastTotal) continue;
        lastTotal = total;
        const key = `${sid}:${total}`;
        if (seen.has(key)) continue;
        seen.add(key);
        u = p.info.last_token_usage;
      }
      if (!u) continue;
      s.models[m] = (s.models[m] || 0) + 1;
      raw.push({ sid, day: localDay(rec.timestamp), model: m, t: toTokens(u) });
    }
    if (plan && sid) sessions.get(sid).plan = plan;
  }

  for (const s of sessions.values()) s.category = categorize(s.prompt);

  const rows = raw.map(({ sid, day, model, t }) => {
    const s = sessions.get(sid);
    return emptyRow({
      source: id, provider: 'openai', app: 'Codex',
      billing: billing || (s.plan ? 'subscription' : 'unknown'),
      day, model, category: s.category, project: s.project, requests: 1, ...t,
    });
  });

  const sessionList = [...sessions.values()]
    .filter((s) => Object.keys(s.models).length)
    .map(({ id: sid, source, start, category, project, models }) => ({
      id: sid, source, day: localDay(start), category, project,
      model: Object.entries(models).sort((a, b) => b[1] - a[1])[0][0],
    }));

  const note = skippedZst ? `; ${skippedZst} archived files need Node 22.15+ to read` : '';
  return { rows: rollup(rows), sessions: sessionList, status: 'ok', message: `${files.length} session files${note}` };
}
