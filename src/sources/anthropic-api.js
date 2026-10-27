import { utcDay, num, rollup, emptyRow } from '../util.js';

export const id = 'anthropic-api';
export const label = 'Anthropic API account';
export const envKey = 'ANTHROPIC_ADMIN_KEY';

const BASE = 'https://api.anthropic.com/v1/organizations';

async function getAll(path, params, key, fetchImpl) {
  const out = [];
  let page = null;
  for (let i = 0; i < 50; i++) {
    const qs = new URLSearchParams(params);
    if (page) qs.set('page', page);
    const res = await fetchImpl(`${BASE}${path}?${qs}`, {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    });
    if (!res.ok) throw new Error(`${path} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    out.push(...(body.data || []));
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return out;
}

// Usage and Cost Admin API: needs an Admin key (sk-ant-admin01-...) from an API (Console) organization.
export async function read({ key = process.env[envKey], days = 90, fetchImpl = fetch } = {}) {
  if (!key) return { rows: [], billed: [], status: 'not_configured', message: `Set ${envKey} to connect` };
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400e3);
  const range = { starting_at: start.toISOString().slice(0, 10) + 'T00:00:00Z', ending_at: end.toISOString() };

  const usage = await getAll('/usage_report/messages', [
    ...Object.entries(range), ['bucket_width', '1d'], ['limit', '31'], ['group_by[]', 'model'],
  ], key, fetchImpl);

  const rows = [];
  for (const bucket of usage) {
    for (const r of bucket.results || []) {
      const cc = r.cache_creation || {};
      rows.push(emptyRow({
        source: id, provider: 'anthropic', app: 'Claude', billing: 'api',
        day: utcDay(bucket.starting_at), model: r.model || 'unknown',
        category: 'API (no prompt data)', project: r.workspace_id || 'Default workspace',
        input: num(r.uncached_input_tokens),
        cacheWrite: num(cc.ephemeral_5m_input_tokens) + num(cc.ephemeral_1h_input_tokens),
        cacheRead: num(r.cache_read_input_tokens),
        output: num(r.output_tokens),
      }));
    }
  }

  // Costs come back in cents as decimal strings.
  let billed = [];
  try {
    const cost = await getAll('/cost_report', [...Object.entries(range), ['limit', '31'], ['group_by[]', 'description']], key, fetchImpl);
    billed = cost.flatMap((b) => (b.results || []).map((r) => ({
      source: id, provider: 'anthropic', day: utcDay(b.starting_at),
      model: r.model || null, item: r.description || r.cost_type || 'usage', usd: num(r.amount) / 100,
    })));
  } catch (e) {
    return { rows: rollup(rows), billed, status: 'partial', message: `Usage loaded; cost report failed: ${e.message}` };
  }
  return { rows: rollup(rows), billed, status: 'ok', message: `${usage.length} days of usage` };
}
