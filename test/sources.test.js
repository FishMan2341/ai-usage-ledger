import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as claudeCode from '../src/sources/claude-code.js';
import * as codex from '../src/sources/codex.js';
import * as geminiCli from '../src/sources/gemini-cli.js';
import * as anthropicApi from '../src/sources/anthropic-api.js';
import * as openaiApi from '../src/sources/openai-api.js';
import { parseSku } from '../src/sources/google-billing.js';
import { estimateRow, findRate } from '../src/estimate.js';
import { categorize } from '../src/categorize.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
const jsonl = (...recs) => recs.map((r) => JSON.stringify(r)).join('\n');
const total = (rows, f) => rows.reduce((s, r) => s + r[f], 0);

test('claude-code counts each streamed message once and categorizes the session', async () => {
  const root = tmp();
  const dir = path.join(root, 'projects', 'proj');
  fs.mkdirSync(dir, { recursive: true });
  const usage = { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 };
  const base = { sessionId: 's1', cwd: '/work/site', timestamp: '2026-10-01T12:00:00Z' };
  fs.writeFileSync(path.join(dir, 's1.jsonl'), jsonl(
    { ...base, type: 'user', message: { content: '<system-reminder>ignore</system-reminder>' } },
    { ...base, type: 'user', message: { content: 'Build a landing page for my bakery' } },
    { ...base, type: 'assistant', requestId: 'r1', message: { id: 'm1', model: 'claude-opus-5-5', usage } },
    { ...base, type: 'assistant', requestId: 'r1', message: { id: 'm1', model: 'claude-opus-5-5', usage } },
    { ...base, type: 'assistant', requestId: 'r2', message: { id: 'm2', model: '<synthetic>', usage } },
  ));
  const r = await claudeCode.read({ root, billing: 'subscription' });
  assert.equal(r.status, 'ok');
  assert.equal(total(r.rows, 'requests'), 1);
  assert.equal(total(r.rows, 'cacheRead'), 1000);
  assert.equal(r.rows[0].category, 'Web & design');
  assert.equal(r.rows[0].project, 'site');
});

test('codex splits cached tokens out of input and dedupes replayed responses', async () => {
  const root = tmp();
  const dir = path.join(root, 'sessions', '2026', '10', '01');
  fs.mkdirSync(dir, { recursive: true });
  const recs = [
    { type: 'session_meta', timestamp: '2026-10-01T10:00:00Z', payload: { id: 'c1', cwd: '/x/game', timestamp: '2026-10-01T10:00:00Z' } },
    { type: 'turn_context', payload: { turn_id: 't1', model: 'gpt-6.1-sol' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions' }, { type: 'input_text', text: 'make my platformer game jump higher' }] } },
    { type: 'token_usage_record', timestamp: '2026-10-01T10:01:00Z', payload: { turn_id: 't1', response_id: 'resp1', usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 40 } } },
  ];
  fs.writeFileSync(path.join(dir, 'a.jsonl'), jsonl(...recs));
  fs.writeFileSync(path.join(dir, 'b.jsonl'), jsonl(...recs)); // a fork that replays the same response
  const r = await codex.read({ root });
  assert.equal(total(r.rows, 'requests'), 1);
  assert.equal(total(r.rows, 'input'), 200);
  assert.equal(total(r.rows, 'cacheRead'), 800);
  assert.equal(r.rows[0].model, 'gpt-6.1-sol');
  assert.equal(r.rows[0].category, 'Games');
});

test('gemini-cli bills thinking tokens as output', async () => {
  const root = tmp();
  const dir = path.join(root, 'tmp', 'abc123', 'chats');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'session-1.json'), JSON.stringify({
    sessionId: 'g1', projectHash: 'abc123', startTime: '2026-10-02T09:00:00Z',
    messages: [
      { type: 'user', content: 'explain how recursion works', timestamp: '2026-10-02T09:00:00Z' },
      { type: 'gemini', model: 'gemini-3.8-flash', timestamp: '2026-10-02T09:00:05Z', tokens: { input: 500, cached: 100, output: 20, thoughts: 30 } },
    ],
  }));
  const r = await geminiCli.read({ root });
  assert.equal(total(r.rows, 'input'), 400);
  assert.equal(total(r.rows, 'output'), 50);
});

const fakeFetch = (routes) => async (url) => {
  const hit = Object.keys(routes).find((k) => url.includes(k));
  return { ok: !!hit, status: hit ? 200 : 404, json: async () => routes[hit], text: async () => 'not found' };
};

test('anthropic-api maps usage and converts cents to dollars', async () => {
  const r = await anthropicApi.read({
    key: 'k', days: 7,
    fetchImpl: fakeFetch({
      '/usage_report/messages': { data: [{ starting_at: '2026-10-01T00:00:00Z', results: [{ model: 'claude-sonnet-5-5', uncached_input_tokens: 5, cache_creation: { ephemeral_5m_input_tokens: 2, ephemeral_1h_input_tokens: 3 }, cache_read_input_tokens: 7, output_tokens: 11 }] }], has_more: false },
      '/cost_report': { data: [{ starting_at: '2026-10-01T00:00:00Z', results: [{ amount: '1234.5', description: 'Claude Sonnet usage', model: 'claude-sonnet-5-5' }] }], has_more: false },
    }),
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.rows[0].cacheWrite, 5);
  assert.equal(r.billed[0].usd, 12.345);
});

test('openai-api reads usage and cost line items', async () => {
  const r = await openaiApi.read({
    key: 'k', days: 7,
    fetchImpl: fakeFetch({
      '/usage/completions': { data: [{ start_time: 1790000000, results: [{ model: 'gpt-5.5', input_tokens: 100, input_cached_tokens: 60, output_tokens: 9, num_model_requests: 2 }] }], has_more: false },
      '/costs': { data: [{ start_time: 1790000000, results: [{ amount: { value: 0.42, currency: 'usd' }, line_item: 'gpt-5.5, input' }] }], has_more: false },
    }),
  });
  assert.equal(r.rows[0].input, 40);
  assert.equal(r.rows[0].requests, 2);
  assert.equal(r.billed[0].model, 'gpt-5.5');
});

test('unconfigured accounts report not_configured instead of failing', async () => {
  const r = await anthropicApi.read({ key: '' });
  assert.equal(r.status, 'not_configured');
});

test('parseSku pulls model and token kind from Google SKU names', () => {
  assert.deepEqual(parseSku('Gemini 2.5 Flash Input Tokens'), { model: 'gemini-2.5-flash', kind: 'input' });
  assert.deepEqual(parseSku('Generate content output token count Gemini 3 Pro'), { model: 'gemini-3-pro', kind: 'output' });
  assert.equal(parseSku('Gemini 2.5 Pro Cached Input').kind, 'cacheRead');
});

test('estimates use the longest matching price and flag proxies', () => {
  const pricing = JSON.parse(fs.readFileSync(new URL('../data/pricing.json', import.meta.url)));
  const impact = JSON.parse(fs.readFileSync(new URL('../data/impact.json', import.meta.url)));
  assert.equal(findRate('gpt-5.6-terra', 'openai', pricing).key, 'gpt-5.6-terra');
  assert.equal(findRate('claude-opus-5-5-20261001', 'anthropic', pricing).key, 'claude-opus-5-5');
  const e = estimateRow({ provider: 'anthropic', model: 'claude-opus-5-5', input: 1e6, cacheWrite: 0, cacheRead: 0, output: 1e6 }, pricing, impact);
  assert.equal(e.costUsd, 24);
  assert.equal(e.rateIsProxy, false);
  assert.ok(Math.abs(e.wh - (1000 * 0.1 + 1000 * 1.0) * 1.2) < 1e-9);
  assert.equal(estimateRow({ provider: 'openai', model: 'mystery-1', input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }, pricing, impact).rateIsProxy, true);
});

test('categorize falls back to Other', () => {
  assert.equal(categorize('fix the failing test in auth.js'), 'Coding & debugging');
  assert.equal(categorize(''), 'Other');
});
