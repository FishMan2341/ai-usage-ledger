import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeHabits } from '../src/habits.js';
import { calibrateFromLimits } from '../src/analysis.js';
import * as codex from '../src/sources/codex.js';

const pricing = JSON.parse(fs.readFileSync(new URL('../data/pricing.json', import.meta.url), 'utf8'));
const now = new Date('2026-10-27T12:00:00');
const day = (n) => new Date(now.getTime() - n * 864e5).toLocaleDateString('en-CA');
const session = (n, stats = {}, extra = {}) => ({
  id: `s${Math.random()}`, source: 'claude-code', day: day(n), category: 'Coding & debugging', project: 'app', model: 'claude-sonnet-5-5',
  stats: { turns: 6, sig: null, corrections: 0, interrupts: 0, firstLen: 300, firstRefs: true, ctxPeak: 50000, spanMin: 30, ...stats }, ...extra,
});
const many = (k, n, stats, extra) => Array.from({ length: k }, () => session(n, stats, extra));
const run = (sessions, profile = {}) => analyzeHabits({ sessions, pricing }, profile, now);

test('asks for more sessions before judging habits', () => {
  const h = run(many(2, 1));
  assert.equal(h.ready, false);
  assert.deepEqual(h.tips, []);
});

test('tips follow the data, and disappear when the habit does', () => {
  const heavy = run(many(8, 2, { ctxPeak: 400000 }));
  assert.ok(heavy.tips.some((t) => t.id === 'fresh-sessions'));
  const light = run(many(8, 2, { ctxPeak: 30000 }));
  assert.ok(!light.tips.some((t) => t.id === 'fresh-sessions'));
});

test('compares against the two weeks before and praises improvement', () => {
  const before = many(8, 20, { turns: 10, corrections: 4 });
  const after = many(8, 3, { turns: 10, corrections: 0 });
  const h = run([...before, ...after]);
  assert.equal(h.compared, true);
  assert.ok(h.positives.some((p) => /Corrections/.test(p)));
});

test('working agreement changes with habits and flags what is new', () => {
  const a = run(many(8, 2, { ctxPeak: 400000 }));
  const b = run(many(8, 2, { ctxPeak: 30000 }), { seen: { tips: [], prompt: a.prompts[0].key } });
  assert.notEqual(a.prompts[0].text, b.prompts[0].text);
  assert.equal(b.prompts[0].changed, true);
  assert.equal(a.prompts[0].file, 'CLAUDE.md');
  const seen = run(many(8, 2, { ctxPeak: 400000 }), { seen: { tips: ['fresh-sessions'] } });
  assert.equal(seen.tips.find((t) => t.id === 'fresh-sessions').isNew, false);
});

test('spots repeated openers without keeping their text', () => {
  const h = run([...many(4, 2, { sig: 'abc' }), ...many(4, 3)]);
  const tip = h.tips.find((t) => t.id === 'repeat');
  assert.ok(tip);
  assert.match(tip.evidence, /4 sessions/);
});

test('calibrates capacity from the percentage a provider reports', () => {
  const end = Date.parse('2026-10-30T00:00:00Z') / 1000;
  const at = Date.parse('2026-10-28T00:00:00Z');
  const d = new Date(at - 3600e3);
  const rows = [{ day: d.toLocaleDateString('en-CA'), hour: d.getHours(), costUsd: 10 }];
  const windows = [{ at, secondary: { usedPercent: 50, windowMinutes: 10080, resetsAt: end } }];
  assert.equal(calibrateFromLimits(rows, windows).capacityUsd, 20);
  assert.equal(calibrateFromLimits(rows, [{ at, secondary: { usedPercent: 5, windowMinutes: 10080, resetsAt: end } }]), null);
});

test('reads Codex rate limits from session logs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-'));
  const dir = path.join(root, 'sessions', '2026', '10', '27');
  fs.mkdirSync(dir, { recursive: true });
  const ts = '2026-10-27T10:00:00.000Z';
  const lines = [
    { type: 'session_meta', timestamp: ts, payload: { id: 'x1', cwd: '/w/app', timestamp: ts } },
    { type: 'response_item', timestamp: ts, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Please fix the failing build in app.js' }] } },
    { type: 'event_msg', timestamp: ts, payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 1000, output_tokens: 10 }, total_token_usage: { total_tokens: 1010 } },
      rate_limits: { plan_type: 'plus', primary: { used_percent: 20, window_minutes: 300, resets_at: 1793086455 }, secondary: { used_percent: 40, window_minutes: 10080, resets_at: 1793631887 } } } },
  ];
  fs.writeFileSync(path.join(dir, 'rollout-x1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n'));
  const r = await codex.read({ root });
  assert.equal(r.limits.latest.secondary.usedPercent, 40);
  assert.equal(r.limits.latest.primary.windowMinutes, 300);
  assert.equal(r.sessions[0].stats.turns, 1);
  assert.equal(r.sessions[0].stats.firstRefs, true);
  fs.rmSync(root, { recursive: true, force: true });
});
