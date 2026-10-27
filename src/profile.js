import fs from 'node:fs';
import path from 'node:path';
import { userDir } from './config.js';

const file = path.join(userDir, 'profile.json');

// Answers the dashboard asks for because logs can't show them (plan tier, limit pressure, goals),
// plus what the user has already been shown, so new tips can be told apart from old ones.
export const EMPTY_PROFILE = { plans: {}, limitHits: '', overnight: '', goals: [], topics: '', weeklyCapacityUsd: {}, sourcePaths: {}, onboarded: false, seen: { tips: [], prompt: null } };

export function loadProfile() {
  try { return { ...EMPTY_PROFILE, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { return { ...EMPTY_PROFILE }; }
}

const str = (v, max = 400) => String(v ?? '').slice(0, max);
const PROVIDERS = ['anthropic', 'openai', 'google'];

// Partial update: only the keys present in `input` change, so saving the form never erases what was seen.
export function saveProfile(input) {
  const p = loadProfile();
  const has = (k) => input && Object.hasOwn(input, k);
  if (has('plans')) p.plans = Object.fromEntries(PROVIDERS.map((k) => [k, str(input.plans?.[k], 20)]).filter(([, v]) => v));
  if (has('limitHits')) p.limitHits = ['never', 'sometimes', 'often'].includes(input.limitHits) ? input.limitHits : '';
  if (has('overnight')) p.overnight = ['yes', 'sometimes', 'no'].includes(input.overnight) ? input.overnight : '';
  if (has('goals')) p.goals = (Array.isArray(input.goals) ? input.goals : []).map((g) => str(g, 30)).slice(0, 12);
  if (has('topics')) p.topics = str(input.topics);
  if (has('weeklyCapacityUsd')) {
    p.weeklyCapacityUsd = Object.fromEntries(Object.entries(input.weeklyCapacityUsd || {})
      .map(([k, v]) => [k, Number(v)]).filter(([k, v]) => PROVIDERS.includes(k) && v > 0 && v < 1e6));
  }
  if (has('sourcePaths')) {
    p.sourcePaths = Object.fromEntries(Object.entries(input.sourcePaths || {})
      .filter(([k, v]) => ['claude-code', 'codex', 'gemini-cli'].includes(k) && typeof v === 'string' && v.trim())
      .map(([k, v]) => [k, str(v, 500).trim()]));
  }
  if (has('onboarded')) p.onboarded = !!input.onboarded;
  if (has('seen')) {
    p.seen = {
      tips: (Array.isArray(input.seen?.tips) ? input.seen.tips : []).map((t) => str(t, 40)).slice(0, 40),
      prompt: input.seen?.prompt == null ? null : str(input.seen.prompt, 2000),
    };
  }
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(p, null, 2));
  return p;
}
