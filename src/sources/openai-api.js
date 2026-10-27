import { utcDay, num, rollup, emptyRow } from '../util.js';

export const id = 'openai-api';
export const label = 'OpenAI API account';
export const envKey = 'OPENAI_ADMIN_KEY';

const BASE = 'https://api.openai.com/v1/organization';

async function getAll(path, params, key, fetchImpl) {
  const out = [];
  let page = null;
  for (let i = 0; i < 50; i++) {
    const qs = new URLSearchParams(params);
    if (page) qs.set('page', page);
    const res = await fetchImpl(`${BASE}${path}?${qs}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`${path} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    out.push(...(body.data || []));
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return out;
}

// Usage and Costs API: needs an organization Admin key (sk-admin-...), created by an org owner.
// ChatGPT and Codex plan usage is not exposed here; the Codex reader covers that from local logs.
export async function read({ key = process.env[envKey], days = 90, fetchImpl = fetch } = {}) {
  if (!key) return { rows: [], billed: [], status: 'not_configured', message: `Set ${envKey} to connect` };
  const start = Math.floor(Date.now() / 1000 - days * 86400);

  const usage = await getAll('/usage/completions', [
    ['start_time', String(start)], ['bucket_width', '1d'], ['limit', '31'], ['group_by', 'model'],
  ], key, fetchImpl);

  const rows = [];
  for (const bucket of usage) {
    for (const r of bucket.results || []) {
      const cached = num(r.input_cached_tokens);
      const write = num(r.input_cache_write_tokens);
      const uncached = r.input_uncached_tokens != null ? num(r.input_uncached_tokens) : Math.max(0, num(r.input_tokens) - cached - write);
      rows.push(emptyRow({
        source: id, provider: 'openai', app: 'OpenAI API', billing: 'api',
        day: utcDay(bucket.start_time), model: r.model || 'unknown',
        category: 'API (no prompt data)', project: r.project_id || 'Default project',
        requests: num(r.num_model_requests),
        input: uncached, cacheWrite: write, cacheRead: cached, output: num(r.output_tokens),
      }));
    }
  }

  let billed = [];
  try {
    const cost = await getAll('/costs', [['start_time', String(start)], ['bucket_width', '1d'], ['limit', '31'], ['group_by', 'line_item']], key, fetchImpl);
    billed = cost.flatMap((b) => (b.results || []).map((r) => ({
      source: id, provider: 'openai', day: utcDay(b.start_time),
      // Line items read like "gpt-5.5, input"; the model is the part before the comma.
      model: r.line_item ? r.line_item.split(',')[0].trim() : null,
      item: r.line_item || 'usage', usd: num(r.amount?.value),
    })));
  } catch (e) {
    return { rows: rollup(rows), billed, status: 'partial', message: `Usage loaded; costs failed: ${e.message}` };
  }
  return { rows: rollup(rows), billed, status: 'ok', message: `${usage.length} days of usage` };
}
