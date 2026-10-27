import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { analyze } from '../src/analysis.js';

const plans = JSON.parse(fs.readFileSync(new URL('../data/plans.json', import.meta.url), 'utf8'));
const now = new Date('2026-10-27T12:00:00');
const row = (day, hour, costUsd, extra = {}) => ({ provider: 'anthropic', source: 'claude-code', billing: 'subscription', day, hour, costUsd, tokens: 1000, category: 'Coding & debugging', project: 'app', ...extra });
const data = { rows: [row('2026-10-26', 10, 20), row('2026-10-20', 14, 20), row('2026-10-13', 15, 20), row('2026-10-07', 11, 20)], sessions: [{ source: 'claude-code', day: '2026-10-26' }] };

test('headroom is capacity minus the 4-week average', () => {
  const a = analyze(data, { plans: { anthropic: 'max5' }, goals: [] }, plans, now);
  const p = a.providers.find((x) => x.id === 'anthropic');
  assert.equal(p.avgWeekUsd, 20);
  assert.ok(Math.abs(p.weeklyCapacityUsd - 100 * 10 / 4.345) < 0.01);
  assert.ok(Math.abs(p.headroomWeekUsd - (p.weeklyCapacityUsd - 20)) < 0.01);
});

test('API-only and unset plans have no headroom', () => {
  const a = analyze(data, { plans: { anthropic: 'api' } }, plans, now);
  assert.equal(a.providers[0].status, 'metered');
  assert.equal(a.providers[1].status, 'absent');
  assert.equal(a.totals.headroomWeekUsd, 0);
  assert.deepEqual(a.recommendations, []);
});

test('providers with no usage are left out entirely', () => {
  const a = analyze(data, { plans: { anthropic: 'max5', google: 'pro' } }, plans, now);
  assert.deepEqual(a.providers.filter((p) => p.present).map((p) => p.id), ['anthropic']);
  assert.equal(a.providers.find((p) => p.id === 'google').status, 'absent');
});

test('a manual override beats the estimate', () => {
  const a = analyze(data, { plans: { anthropic: 'pro' }, weeklyCapacityUsd: { anthropic: 500 } }, plans, now);
  assert.equal(a.providers[0].weeklyCapacityUsd, 500);
  assert.match(a.recommendations[0].command, /^claude -p /);
});

test('suggestions come from recent work with no input, and shift when the work does', () => {
  const rowsOf = (category) => [row('2026-10-26', 10, 20, { category }), row('2026-10-20', 14, 20, { category })];
  const sugg = (category) => analyze({ rows: rowsOf(category), sessions: [] }, { plans: { anthropic: 'max5' } }, plans, now).recommendations.map((r) => r.id);
  assert.ok(sugg('Writing').includes('writing'));
  assert.ok(!sugg('Writing').includes('tests'));
  assert.ok(sugg('Coding & debugging').includes('tests'));
  assert.ok(sugg('Web & design').includes('design'));
});

test('uses the plan detected from local sign-in when none is chosen', () => {
  const a = analyze({ ...data, detected: { anthropic: { id: 'max20', label: 'Claude Max 20x', from: 'Claude Code sign-in' } } }, {}, plans, now);
  assert.equal(a.providers[0].planId, 'max20');
  assert.equal(a.providers[0].planAuto, true);
  const manual = analyze({ ...data, detected: { anthropic: { id: 'max20' } } }, { plans: { anthropic: 'pro' } }, plans, now);
  assert.equal(manual.providers[0].planId, 'pro');
});

test('finds a quiet window away from active hours', () => {
  const a = analyze(data, { plans: { anthropic: 'max5' } }, plans, now);
  assert.ok(a.quietWindow.hours >= 3);
  for (const h of [10, 14, 15]) assert.ok(!(h >= a.quietWindow.start && h < a.quietWindow.start + a.quietWindow.hours));
});
