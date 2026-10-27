// Manual connection helpers for when auto-detection finds nothing: a custom log folder, or an API key.
// Keys are written to ~/.ai-usage-ledger/.env on this machine and are never sent back to the page.
import fs from 'node:fs';
import path from 'node:path';
import { userDir } from './config.js';

// Only these variables can be set from the page, and only the matching source reads them.
export const KEY_NAMES = {
  ANTHROPIC_ADMIN_KEY: { provider: 'anthropic', pattern: /^sk-ant-admin[\w-]{10,}$/ },
  OPENAI_ADMIN_KEY: { provider: 'openai', pattern: /^sk-admin-[\w-]{10,}$/ },
  GOOGLE_BILLING_TABLE: { provider: 'google', pattern: /^[\w-]+\.[\w-]+\.[\w-]+$/ },
  GOOGLE_PROJECT_ID: { provider: 'google', pattern: /^[a-z][a-z0-9-]{4,}$/ },
};

export function setEnvValue(name, value, file = path.join(userDir, '.env')) {
  const spec = KEY_NAMES[name];
  if (!spec) throw new Error('Unknown setting');
  const v = String(value ?? '').trim();
  if (!spec.pattern.test(v)) throw new Error('That does not look like a valid value for ' + name);
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { /* new file */ }
  lines = lines.filter((l) => l.trim() && !new RegExp(`^\\s*${name}\\s*=`).test(l));
  lines.push(`${name}=${v}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
  process.env[name] = v;
  return spec.provider;
}

export function folderExists(dir) {
  try { return fs.statSync(dir).isDirectory(); } catch { return false; }
}
