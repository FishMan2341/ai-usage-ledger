import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudePlanFrom, codexPlanFrom } from '../src/detect.js';
import { setEnvValue, folderExists } from '../src/connect.js';
import { assemble, readSource, SOURCES } from '../src/collect.js';

test('reads the Claude plan from the sign-in record', () => {
  assert.equal(claudePlanFrom({ organizationRateLimitTier: 'default_claude_max_5x', organizationType: 'claude_max' }).id, 'max5');
  assert.equal(claudePlanFrom({ organizationRateLimitTier: 'default_claude_max_20x' }).id, 'max20');
  assert.equal(claudePlanFrom({ organizationType: 'claude_pro' }).id, 'pro');
  assert.equal(claudePlanFrom({}), null);
  assert.equal(claudePlanFrom(undefined), null);
});

test('reads the Codex plan from its logged plan type', () => {
  assert.equal(codexPlanFrom('plus').id, 'plus');
  assert.equal(codexPlanFrom('PRO').id, 'pro');
  assert.equal(codexPlanFrom('team'), null);
});

test('only known, well-formed keys can be saved from the page', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-')), '.env');
  assert.throws(() => setEnvValue('PATH', 'x', file), /Unknown/);
  assert.throws(() => setEnvValue('OPENAI_ADMIN_KEY', 'sk-admin-x\nEVIL=1', file), /valid/);
  assert.throws(() => setEnvValue('OPENAI_ADMIN_KEY', 'not-a-key', file), /valid/);
  assert.equal(setEnvValue('OPENAI_ADMIN_KEY', 'sk-admin-abcdefghijklmnop', file), 'openai');
  assert.equal(setEnvValue('OPENAI_ADMIN_KEY', 'sk-admin-zzzzzzzzzzzzzzzz', file), 'openai');
  const text = fs.readFileSync(file, 'utf8');
  assert.equal(text.match(/OPENAI_ADMIN_KEY=/g).length, 1);
  assert.match(text, /zzzz/);
  delete process.env.OPENAI_ADMIN_KEY;
});

test('folder check rejects files and missing paths', () => {
  assert.equal(folderExists(os.tmpdir()), true);
  assert.equal(folderExists(path.join(os.tmpdir(), 'definitely-not-here-xyz')), false);
});

test('a source pointed at a custom folder reads from it, and absent sources are not marked present', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'nolog-'));
  const def = SOURCES.find((s) => s.mod.id === 'codex');
  const config = { days: 30, billing: {}, disabled: new Set(), pricing: JSON.parse(fs.readFileSync(new URL('../data/pricing.json', import.meta.url), 'utf8')), impact: JSON.parse(fs.readFileSync(new URL('../data/impact.json', import.meta.url), 'utf8')), subscriptions: [] };
  const r = await readSource(def, config, { codex: empty });
  assert.equal(r.status, 'not_found');
  const d = assemble([r], config);
  assert.equal(d.sources[0].present, false);
});
