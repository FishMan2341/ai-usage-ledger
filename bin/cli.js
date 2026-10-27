#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { loadConfig, userDir } from '../src/config.js';
import { collect } from '../src/collect.js';
import { startServer } from '../src/server.js';

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith('-')) || 'serve';
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? (args[i + 1] ?? true) : null; };

function open(url) {
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref();
}

const config = loadConfig();
if (flag('port')) config.port = Number(flag('port'));
if (flag('days')) config.days = Number(flag('days'));

if (cmd === 'json') {
  const d = await collect(config);
  process.stdout.write(JSON.stringify(d, null, 2) + '\n');
} else if (cmd === 'status') {
  const d = await collect(config);
  for (const s of d.sources) console.log(`${s.status.padEnd(15)} ${s.label}: ${s.message}`);
} else if (cmd === 'setup') {
  // One command for a fresh install: find what is on this machine, say what was found, then open the dashboard.
  fs.mkdirSync(userDir, { recursive: true });
  const d = await collect(config);
  console.log('AI Usage Ledger setup\n');
  for (const s of d.sources.filter((x) => x.kind === 'local')) console.log(`  ${s.present ? 'found    ' : 'not found'}  ${s.label}${s.present ? ' - ' + s.message : ''}`);
  for (const [provider, plan] of Object.entries(d.detected)) console.log(`  plan       ${provider}: ${plan.label} (from ${plan.from})`);
  if (!d.sources.some((s) => s.present)) console.log('\nNo usage found yet. Use Claude Code, Codex or Gemini CLI for a while and run this again, or add a log folder from the dashboard.');
  console.log('\nNothing else to configure. Starting the dashboard...\n');
  await startServer(config);
  const url = `http://localhost:${config.port}`;
  console.log(`Running at ${url} (Ctrl+C to stop)`);
  open(url);
} else if (cmd === 'serve') {
  await startServer(config);
  const url = `http://localhost:${config.port}`;
  console.log(`AI Usage Ledger running at ${url} (Ctrl+C to stop)`);
  if (flag('open')) open(url);
} else {
  console.log('Usage: ai-usage-ledger [setup|serve|status|json] [--port 4317] [--days 90] [--open]');
  process.exitCode = 1;
}
