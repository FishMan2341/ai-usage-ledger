import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { walk, localDay, localHour, num, rollup, emptyRow } from '../util.js';
import { categorize, isHumanText } from '../categorize.js';

export const id = 'gemini-cli';
export const label = 'Gemini CLI (local logs)';

export function defaultRoot() {
  return process.env.GEMINI_CLI_HOME || path.join(os.homedir(), '.gemini');
}

function text(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => p?.text || '').join(' ');
  return null;
}

// Gemini CLI saves each chat as tmp/<project-hash>/chats/session-*.json with per-message token counts.
export async function read({ root = defaultRoot(), billing = 'unknown' } = {}) {
  const files = walk(path.join(root, 'tmp'), (n) => n.startsWith('session-') && n.endsWith('.json'));
  if (!files.length) return { rows: [], sessions: [], status: 'not_found', message: `No Gemini CLI chats in ${path.join(root, 'tmp')}` };

  const rows = [];
  const sessions = [];
  const seen = new Set();
  for (const file of files) {
    let chat;
    try { chat = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    const sid = chat.sessionId || path.basename(file);
    if (seen.has(sid)) continue;
    seen.add(sid);
    const project = (chat.projectHash || path.basename(path.dirname(path.dirname(file)))).slice(0, 8);
    const prompt = (chat.messages || []).map((m) => (m.type === 'user' ? text(m.content) : null)).find(isHumanText);
    const category = categorize(prompt);
    const models = {};
    for (const m of chat.messages || []) {
      const t = m.tokens;
      if (!t || m.type === 'user') continue;
      const model = m.model || 'gemini-unknown';
      models[model] = (models[model] || 0) + 1;
      // Gemini's prompt count includes cached tokens; thinking tokens bill as output.
      const cached = num(t.cached);
      rows.push(emptyRow({
        source: id, provider: 'google', app: 'Gemini', billing,
        day: localDay(m.timestamp || chat.startTime), hour: localHour(m.timestamp || chat.startTime), model, category, project, requests: 1,
        input: Math.max(0, num(t.input) - cached), cacheRead: cached,
        output: num(t.output) + num(t.thoughts),
      }));
    }
    if (Object.keys(models).length) {
      sessions.push({ id: sid, source: id, day: localDay(chat.startTime), category, project, model: Object.entries(models).sort((a, b) => b[1] - a[1])[0][0] });
    }
  }
  return { rows: rollup(rows), sessions, status: 'ok', message: `${files.length} chat files` };
}
