import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const userDir = path.join(os.homedir(), '.ai-usage-ledger');

// Minimal .env reader: KEY=value lines, # comments, optional quotes. Existing env vars win.
function loadEnv(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function loadConfig(cwd = process.cwd()) {
  loadEnv(path.join(cwd, '.env'));
  loadEnv(path.join(userDir, '.env'));
  const user = readJson(path.join(cwd, 'ledger.config.json')) || readJson(path.join(userDir, 'config.json')) || {};
  const pricing = readJson(path.join(here, '..', 'data', 'pricing.json'));
  const impact = readJson(path.join(here, '..', 'data', 'impact.json'));
  Object.assign(pricing.models, user.pricing || {});
  if (user.impact) Object.assign(impact, user.impact);
  return {
    days: Number(process.env.LEDGER_DAYS || user.days || 90),
    port: Number(process.env.PORT || user.port || 4317),
    subscriptions: user.subscriptions || [],
    billing: user.billing || {},
    disabled: new Set(user.disabledSources || []),
    pricing,
    impact,
  };
}
