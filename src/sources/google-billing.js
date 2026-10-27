import { execFileSync } from 'node:child_process';
import { num, rollup, emptyRow } from '../util.js';

export const id = 'google-billing';
export const label = 'Google Cloud (Gemini API billing)';
export const envKey = 'GOOGLE_BILLING_TABLE';

// Google has no usage endpoint for Gemini API keys. The reliable account-level record is the
// Cloud Billing export to BigQuery, which lists Gemini SKUs with token amounts and cost per day.
function accessToken() {
  if (process.env.GOOGLE_ACCESS_TOKEN) return process.env.GOOGLE_ACCESS_TOKEN;
  return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim();
}

// SKU descriptions look like "Gemini 2.5 Flash Input Tokens" or "Generate content output token count Gemini 3 Pro".
export function parseSku(sku) {
  const s = String(sku || '');
  const m = s.match(/gemini[\s-]*([\d.]+)?[\s-]*(pro|flash[\s-]*lite|flash|ultra|nano)?/i);
  const model = m ? ['gemini', m[1], m[2] && m[2].toLowerCase().replace(/\s+/g, '-')].filter(Boolean).join('-') : 'google-other';
  const kind = /cach/i.test(s) ? 'cacheRead' : /output|thinking|response/i.test(s) ? 'output' : /input|prompt/i.test(s) ? 'input' : null;
  return { model, kind };
}

export async function read({ table = process.env[envKey], project = process.env.GOOGLE_PROJECT_ID, days = 90, fetchImpl = fetch } = {}) {
  if (!table) return { rows: [], billed: [], status: 'not_configured', message: `Set ${envKey} (and GOOGLE_PROJECT_ID) to connect` };
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(table)) throw new Error(`${envKey} must look like project.dataset.table`);
  const billingProject = project || table.split('.')[0];
  const sql = `
    SELECT FORMAT_DATE('%Y-%m-%d', DATE(usage_start_time)) AS day,
           sku.description AS sku, usage.unit AS unit,
           SUM(usage.amount) AS amount,
           SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS cost
    FROM \`${table}\`
    WHERE usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${Math.round(days)} DAY)
      AND (LOWER(service.description) LIKE '%gemini%' OR service.description IN ('Vertex AI', 'Generative Language API'))
    GROUP BY day, sku, unit`;

  const res = await fetchImpl(`https://bigquery.googleapis.com/bigquery/v2/projects/${billingProject}/queries`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 30000 }),
  });
  if (!res.ok) throw new Error(`BigQuery returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const names = (body.schema?.fields || []).map((f) => f.name);
  const records = (body.rows || []).map((r) => Object.fromEntries(r.f.map((c, i) => [names[i], c.v])));

  const rows = [];
  const billed = [];
  for (const r of records) {
    const { model, kind } = parseSku(r.sku);
    billed.push({ source: id, provider: 'google', day: r.day, model, item: r.sku, usd: num(r.cost) });
    // Some SKUs bill per character or per image; only token SKUs add to token totals.
    if (!kind || !/token|count/i.test(`${r.unit} ${r.sku}`)) continue;
    rows.push(emptyRow({
      source: id, provider: 'google', app: 'Gemini API', billing: 'api',
      day: r.day, model, category: 'API (no prompt data)', project: billingProject,
      [kind]: num(r.amount),
    }));
  }
  return { rows: rollup(rows), billed, status: 'ok', message: `${records.length} billing lines` };
}
