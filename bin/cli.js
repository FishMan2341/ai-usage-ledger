#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { loadConfig } from '../src/config.js';
import { collect } from '../src/collect.js';
import { startServer } from '../src/server.js';

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith('-')) || 'serve';
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? (args[i + 1] ?? true) : null; };

const config = loadConfig();
if (flag('port')) config.port = Number(flag('port'));
if (flag('days')) config.days = Number(flag('days'));

if (cmd === 'json') {
  const d = await collect(config);
  process.stdout.write(JSON.stringify(d, null, 2) + '\n');
} else if (cmd === 'status') {
  const d = await collect(config);
  for (const s of d.sources) console.log(`${s.status.padEnd(15)} ${s.label}: ${s.message}`);
} else if (cmd === 'serve') {
  await startServer(config);
  const url = `http://localhost:${config.port}`;
  console.log(`AI Usage Ledger running at ${url} (Ctrl+C to stop)`);
  if (flag('open')) {
    const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
    spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref();
  }
} else {
  console.log('Usage: ai-usage-ledger [serve|status|json] [--port 4317] [--days 90] [--open]');
  process.exitCode = 1;
}
