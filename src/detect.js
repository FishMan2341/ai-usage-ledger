// Works out which plan a user is on from what their tools already record, so they aren't asked.
// Only plan labels are read: the Claude account file also holds identity fields, and none of it is kept.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const claudeAccountFile = () => {
  const dir = process.env.CLAUDE_CONFIG_DIR;
  return dir ? path.join(dir, '.claude.json') : path.join(os.homedir(), '.claude.json');
};

export function claudePlanFrom(account) {
  if (!account) return null;
  const tier = String(account.organizationRateLimitTier || account.userRateLimitTier || '').toLowerCase();
  const type = String(account.organizationType || '').toLowerCase();
  if (tier.includes('max_20x')) return { id: 'max20', label: 'Claude Max 20x' };
  if (tier.includes('max_5x') || type === 'claude_max') return { id: 'max5', label: 'Claude Max 5x' };
  if (type === 'claude_pro' || tier.includes('pro')) return { id: 'pro', label: 'Claude Pro' };
  return null;
}

export function codexPlanFrom(planType) {
  const p = String(planType || '').toLowerCase();
  if (p === 'plus') return { id: 'plus', label: 'ChatGPT Plus' };
  if (p === 'pro') return { id: 'pro', label: 'ChatGPT Pro' };
  return null;
}

export function detectPlans(sources = []) {
  const out = {};
  try {
    const account = JSON.parse(fs.readFileSync(claudeAccountFile(), 'utf8')).oauthAccount;
    const plan = claudePlanFrom(account);
    if (plan) out.anthropic = { ...plan, from: 'Claude Code sign-in' };
  } catch { /* not signed in, or no Claude Code */ }
  const plan = codexPlanFrom(sources.find((s) => s.id === 'codex')?.limits?.latest?.planType);
  if (plan) out.openai = { ...plan, from: 'Codex logs' };
  return out;
}
