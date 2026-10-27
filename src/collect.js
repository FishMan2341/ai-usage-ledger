import * as claudeCode from './sources/claude-code.js';
import * as codex from './sources/codex.js';
import * as geminiCli from './sources/gemini-cli.js';
import * as anthropicApi from './sources/anthropic-api.js';
import * as openaiApi from './sources/openai-api.js';
import * as googleBilling from './sources/google-billing.js';
import { estimateRow } from './estimate.js';
import { detectPlans } from './detect.js';

export const SOURCES = [
  { mod: claudeCode, provider: 'anthropic', kind: 'local' },
  { mod: anthropicApi, provider: 'anthropic', kind: 'account' },
  { mod: codex, provider: 'openai', kind: 'local' },
  { mod: openaiApi, provider: 'openai', kind: 'account' },
  { mod: geminiCli, provider: 'google', kind: 'local' },
  { mod: googleBilling, provider: 'google', kind: 'account' },
];

// Reads one source on its own so one failing connection never blanks the dashboard.
// `roots` holds folders the user pointed us at when a log directory wasn't found automatically.
export async function readSource({ mod, provider, kind }, config, roots = {}) {
  const base = { id: mod.id, label: mod.label, provider, kind, envKey: mod.envKey || null };
  if (config.disabled.has(mod.id)) return { ...base, status: 'disabled', message: 'Turned off in config', rows: [], billed: [], sessions: [] };
  try {
    const r = await mod.read({ days: config.days, billing: config.billing[mod.id], root: roots[mod.id] });
    return { ...base, ...r, billed: r.billed || [], sessions: r.sessions || [] };
  } catch (e) {
    return { ...base, status: 'error', message: e.message, rows: [], billed: [], sessions: [] };
  }
}

export const readAll = (config, roots) => Promise.all(SOURCES.map((def) => readSource(def, config, roots)));

// Turns raw per-source results into the shape the dashboard uses.
export function assemble(results, config) {
  const sources = results.map(({ rows, billed, sessions, ...s }) => ({
    ...s, rowCount: rows.length, present: (s.status === 'ok' || s.status === 'partial') && rows.length > 0,
  }));
  return {
    generatedAt: new Date().toISOString(),
    days: config.days,
    sources,
    detected: detectPlans(sources),
    rows: results.flatMap((r) => r.rows).filter((r) => r.day).map((r) => estimateRow(r, config.pricing, config.impact)),
    billed: results.flatMap((r) => r.billed),
    sessions: results.flatMap((r) => r.sessions),
    subscriptions: config.subscriptions,
    pricing: config.pricing,
    impact: config.impact,
  };
}

export async function collect(config, roots) {
  return assemble(await readAll(config, roots), config);
}
