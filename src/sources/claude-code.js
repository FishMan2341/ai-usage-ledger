import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { walk, readLines, localDay, localHour, num, rollup, emptyRow } from '../util.js';
import { categorize, isHumanText } from '../categorize.js';
import { newStats, noteHuman, noteContext, finishStats } from '../stats.js';

export const id = 'claude-code';
export const label = 'Claude Code (local logs)';

export function defaultRoot() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function rawText(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) for (const c of content) if (c?.type === 'text' && typeof c.text === 'string') return c.text.trim();
  return '';
}

function firstText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const c of content) if (c?.type === 'text' && isHumanText(c.text)) return c.text;
  }
  return null;
}

// Signed in with a Claude plan when ~/.claude.json has an OAuth account; otherwise usage may be API-billed.
function detectBilling(root) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(path.dirname(root), '.claude.json'), 'utf8'));
    return cfg.oauthAccount ? 'subscription' : 'unknown';
  } catch { return 'unknown'; }
}

export async function read({ root = defaultRoot(), billing } = {}) {
  const projectsDir = path.join(root, 'projects');
  const files = walk(projectsDir, (n) => n.endsWith('.jsonl'));
  if (!files.length) return { rows: [], sessions: [], status: 'not_found', message: `No transcripts in ${projectsDir}` };

  const seen = new Set();
  const sessions = new Map();
  const raw = [];
  const bill = billing || detectBilling(root);

  for (const file of files) {
    for (const rec of readLines(file)) {
      const sid = rec.sessionId;
      if (!sid) continue;
      let s = sessions.get(sid);
      if (!s) {
        s = { id: sid, source: id, start: rec.timestamp, prompt: null, project: path.basename(rec.cwd || '') || 'unknown', models: {}, stats: newStats() };
        sessions.set(sid, s);
      }
      if (rec.timestamp && rec.timestamp < s.start) s.start = rec.timestamp;
      if (rec.cwd && s.project === 'unknown') s.project = path.basename(rec.cwd);
      if (rec.type === 'user' && !rec.isSidechain) {
        const t = firstText(rec.message?.content);
        if (isHumanText(t)) { if (!s.prompt) s.prompt = t; noteHuman(s.stats, t, rec.timestamp); }
        else if (rawText(rec.message?.content).startsWith('[Request interrupted')) s.stats.interrupts++;
      }
      const msg = rec.message;
      if (rec.type !== 'assistant' || !msg?.usage || !msg.model || msg.model === '<synthetic>') continue;
      // Streaming writes one line per content block with the same message id and usage.
      const key = `${msg.id}:${rec.requestId || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const u = msg.usage;
      noteContext(s.stats, num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens));
      const model = msg.model.replace(/\[.*\]$/, '');
      s.models[model] = (s.models[model] || 0) + 1;
      raw.push({ sid, day: localDay(rec.timestamp), hour: localHour(rec.timestamp), model, u });
    }
  }

  for (const s of sessions.values()) s.category = categorize(s.prompt);

  const rows = raw.map(({ sid, day, hour, model, u }) => {
    const s = sessions.get(sid);
    return emptyRow({
      source: id, provider: 'anthropic', app: 'Claude', billing: bill,
      day, hour, model, category: s.category, project: s.project,
      requests: 1,
      input: num(u.input_tokens),
      cacheWrite: num(u.cache_creation_input_tokens),
      cacheRead: num(u.cache_read_input_tokens),
      output: num(u.output_tokens),
    });
  });

  const sessionList = [...sessions.values()]
    .filter((s) => Object.keys(s.models).length)
    .map(({ id: sid, source, start, category, project, models, stats }) => ({
      id: sid, source, day: localDay(start), category, project, stats: finishStats(stats, start),
      model: Object.entries(models).sort((a, b) => b[1] - a[1])[0][0],
    }));

  return { rows: rollup(rows), sessions: sessionList, status: 'ok', message: `${files.length} transcript files` };
}
