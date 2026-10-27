import * as claudeCode from './sources/claude-code.js';
import * as codex from './sources/codex.js';
import * as geminiCli from './sources/gemini-cli.js';
import * as anthropicApi from './sources/anthropic-api.js';
import * as openaiApi from './sources/openai-api.js';
import * as googleBilling from './sources/google-billing.js';
import { estimateRow } from './estimate.js';

export const SOURCES = [
  { mod: claudeCode, provider: 'anthropic', kind: 'local' },
  { mod: anthropicApi, provider: 'anthropic', kind: 'account' },
  { mod: codex, provider: 'openai', kind: 'local' },
  { mod: openaiApi, provider: 'openai', kind: 'account' },
  { mod: geminiCli, provider: 'google', kind: 'local' },
  { mod: googleBilling, provider: 'google', kind: 'account' },
];

// Runs every source independently so one failing connection never blanks the dashboard.
export async function collect(config) {
  const results = await Promise.all(SOURCES.map(async ({ mod, provider, kind }) => {
    const base = { id: mod.id, label: mod.label, provider, kind, envKey: mod.envKey || null };
    if (config.disabled.has(mod.id)) return { ...base, status: 'disabled', message: 'Turned off in config', rows: [], billed: [], sessions: [] };
    try {
      const r = await mod.read({ days: config.days, billing: config.billing[mod.id] });
      return { ...base, ...r, billed: r.billed || [], sessions: r.sessions || [] };
    } catch (e) {
      return { ...base, status: 'error', message: e.message, rows: [], billed: [], sessions: [] };
    }
  }));

  return {
    generatedAt: new Date().toISOString(),
    days: config.days,
    sources: results.map(({ rows, billed, sessions, ...s }) => ({ ...s, rowCount: rows.length })),
    rows: results.flatMap((r) => r.rows).filter((r) => r.day).map((r) => estimateRow(r, config.pricing, config.impact)),
    billed: results.flatMap((r) => r.billed),
    sessions: results.flatMap((r) => r.sessions),
    subscriptions: config.subscriptions,
    pricing: config.pricing,
    impact: config.impact,
  };
}
