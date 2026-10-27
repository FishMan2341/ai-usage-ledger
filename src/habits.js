// Reads how you actually work (from per-session counters, never prompt text) and turns it into
// tips and a working-agreement prompt. Nothing here is fixed: every tip is a rule over your own recent
// sessions, compared with the 14 days before, so the advice moves as your habits do.
import { findRate } from './estimate.js';

const PROVIDER_OF = { 'claude-code': 'anthropic', codex: 'openai', 'gemini-cli': 'google' };
const FILE_OF = { 'claude-code': 'CLAUDE.md', codex: 'AGENTS.md', 'gemini-cli': 'GEMINI.md' };
const TOOL_NAME = { 'claude-code': 'Claude Code', codex: 'Codex', 'gemini-cli': 'Gemini CLI' };
const MIN_SESSIONS = 5;

const dayStr = (d) => d.toLocaleDateString('en-CA');
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const pct = (x) => Math.round(x * 100);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

function measure(sessions, tierOf) {
  const n = sessions.length;
  if (!n) return { n: 0 };
  const share = (f) => sessions.filter(f).length / n;
  const followups = sessions.reduce((s, x) => s + Math.max(0, x.stats.turns - 1), 0);
  const quick = sessions.filter((x) => x.stats.turns <= 3 && x.stats.ctxPeak < 60000);
  return {
    n,
    medTurns: median(sessions.map((x) => x.stats.turns)),
    medContext: median(sessions.map((x) => x.stats.ctxPeak)),
    correctionRate: followups ? sessions.reduce((s, x) => s + x.stats.corrections, 0) / followups : 0,
    interruptShare: share((x) => x.stats.interrupts > 0),
    thinOpenShare: share((x) => x.stats.firstLen < 120 && !x.stats.firstRefs),
    heavyContextShare: share((x) => x.stats.ctxPeak > 200000),
    marathonShare: share((x) => x.stats.turns >= 25 || x.stats.spanMin >= 240),
    quickCount: quick.length,
    quickOnBigShare: quick.length ? quick.filter((x) => tierOf(x) === 'frontier').length / quick.length : 0,
  };
}

// Whether a lower number is better, so a trend can be worded as improving or slipping.
const trend = (now, before, minDelta = 0.05) => {
  if (before == null || !Number.isFinite(before) || !Number.isFinite(now)) return null;
  const d = now - before;
  if (Math.abs(d) < minDelta) return 'steady';
  return d < 0 ? 'better' : 'worse';
};

// Each rule returns null or { score (0-1, how strongly it applies), evidence, promptKey }.
const RULES = [
  {
    id: 'context-first', title: 'Give the first message more to work with',
    body: 'Short openers with no file, error or example tend to need a second pass. Naming the target and what done looks like up front usually saves a round trip.',
    rule: (m, p) => m.thinOpenShare >= 0.4 && m.correctionRate >= 0.08 && {
      score: Math.min(1, m.thinOpenShare), t: trend(m.thinOpenShare, p.thinOpenShare),
      evidence: `${pct(m.thinOpenShare)}% of your recent sessions opened with a short, reference-free request, and ${pct(m.correctionRate)}% of follow-ups were corrections.` },
  },
  {
    id: 'plan-first', title: 'Ask for a plan before the changes',
    body: 'When a lot of follow-ups are corrections, the assistant is usually guessing at intent. A quick outline you can approve costs less than undoing a wrong turn.',
    rule: (m, p) => m.correctionRate >= 0.15 && {
      score: Math.min(1, m.correctionRate * 3), t: trend(m.correctionRate, p.correctionRate),
      evidence: `About ${pct(m.correctionRate)}% of your follow-up messages redirect or undo something.` },
  },
  {
    id: 'smaller-steps', title: 'Break big asks into steps you can check',
    body: 'Stopping a run mid-way means the work so far is spent without a result. Smaller steps make each stop cheaper and each result easier to judge.',
    rule: (m, p) => m.interruptShare >= 0.2 && m.n >= MIN_SESSIONS && {
      score: Math.min(1, m.interruptShare * 2), t: trend(m.interruptShare, p.interruptShare),
      evidence: `You interrupted ${pct(m.interruptShare)}% of recent sessions before they finished.` },
  },
  {
    id: 'fresh-sessions', title: 'Start fresh when the task changes',
    body: 'Every message re-reads the whole conversation, so long contexts use your limit fastest. A new session for a new task, or a summary-and-restart partway through, stretches the same plan further.',
    rule: (m, p) => m.heavyContextShare >= 0.3 && {
      score: Math.min(1, m.heavyContextShare), t: trend(m.heavyContextShare, p.heavyContextShare),
      evidence: `${pct(m.heavyContextShare)}% of recent sessions grew past 200k tokens of context (typical session: ${Math.round(m.medContext / 1000)}k).` },
  },
  {
    id: 'checkpoint', title: 'Checkpoint the long sessions',
    body: 'Marathon sessions drift. Asking for a short state summary every so often, then continuing in a fresh session, keeps quality up and cost down.',
    rule: (m, p) => m.marathonShare >= 0.25 && {
      score: Math.min(1, m.marathonShare * 1.5), t: trend(m.marathonShare, p.marathonShare),
      evidence: `${pct(m.marathonShare)}% of recent sessions ran 25+ messages or over four hours.` },
  },
  {
    id: 'right-size', title: 'Match the model to the question',
    body: 'Quick lookups and small edits rarely need the biggest model. Using a lighter one for them leaves more of your limit for the work that does.',
    rule: (m, p) => m.quickCount >= 4 && m.quickOnBigShare >= 0.5 && {
      score: Math.min(1, m.quickOnBigShare), t: trend(m.quickOnBigShare, p.quickOnBigShare),
      evidence: `${pct(m.quickOnBigShare)}% of your ${m.quickCount} quick sessions ran on a top-tier model.` },
  },
];

function repeatedOpeners(sessions) {
  const groups = new Map();
  for (const s of sessions) if (s.stats.sig) groups.set(s.stats.sig, [...(groups.get(s.stats.sig) || []), s]);
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  if (!best || best.length < 3) return null;
  const projects = new Map();
  for (const s of best) projects.set(s.project, (projects.get(s.project) || 0) + 1);
  const [project] = [...projects].sort((a, b) => b[1] - a[1])[0];
  return { count: best.length, project, category: best[0].category };
}

// Working-agreement fragments. Included only when your sessions call for them.
const FRAGMENTS = {
  base: 'Be concise. Say what you changed and what you did not check.',
  'context-first': 'If a request is short or names no target, look through the repository for conventions and similar existing code first, then state what you inferred before acting.',
  'plan-first': 'For changes that touch several places, outline the plan in a few bullets before editing, and ask only if the request is genuinely ambiguous.',
  'smaller-steps': 'Work in small, verifiable steps. After each one, say what changed and what comes next so the user can stop or redirect cheaply.',
  'fresh-sessions': 'Avoid pulling whole files or broad search results into the conversation when a targeted lookup answers the question.',
  checkpoint: 'When a session has run long, summarize the current state, decisions and open questions so a fresh session can pick up cleanly.',
  'right-size': 'Prefer the lightest approach that answers the question; do not spin up heavy analysis for a quick lookup.',
  repeat: 'If the user repeats the same kind of request, offer to turn it into a reusable command, template or skill.',
  'cat:Web & design': 'Check UI changes by viewing them before saying they are done.',
  'cat:Coding & debugging': 'After changing code, run the project\'s tests or build and report any failure as it appeared.',
  'cat:Writing': 'Match the voice and structure of the existing documents; do not add boilerplate.',
  'cat:Data & research': 'Keep sourced facts apart from inference, and name the source for each claim.',
};

export function analyzeHabits(data, profile, now = new Date()) {
  const pricing = data.pricing;
  const tierOf = (s) => findRate(s.model, PROVIDER_OF[s.source], pricing)?.tier;
  const local = data.sessions.filter((s) => s.stats && s.stats.turns > 0 && s.day);
  const recentFrom = dayStr(addDays(now, -13)), priorFrom = dayStr(addDays(now, -27)), monthFrom = dayStr(addDays(now, -29));
  const recent = local.filter((s) => s.day >= recentFrom);
  const prior = local.filter((s) => s.day >= priorFrom && s.day < recentFrom);
  const M = measure(recent, tierOf), P = measure(prior, tierOf);
  const seen = new Set(profile.seen?.tips || []);

  if (M.n < MIN_SESSIONS) {
    return { ready: false, sessions: M.n, message: `We need at least ${MIN_SESSIONS} sessions from the last two weeks to spot habits. Keep working and check back.`, tips: [], prompts: [], positives: [] };
  }

  const tips = [];
  for (const r of RULES) {
    const hit = r.rule(M, P.n >= MIN_SESSIONS ? P : {});
    if (hit) tips.push({ id: r.id, title: r.title, body: r.body, evidence: hit.evidence, trend: P.n >= MIN_SESSIONS ? hit.t : null, score: hit.score, isNew: !seen.has(r.id) });
  }
  const rep = repeatedOpeners(local.filter((s) => s.day >= monthFrom));
  if (rep) tips.push({
    id: 'repeat', title: 'Turn your repeat requests into a shortcut',
    body: 'You keep opening sessions with nearly the same request. Saving it as a reusable command, template or skill means typing it once and getting a more consistent result.',
    evidence: `${rep.count} sessions in the last month started with almost the same request, mostly in ${rep.project} (${rep.category.toLowerCase()}).`,
    trend: null, score: Math.min(1, rep.count / 8), isNew: !seen.has('repeat'),
  });
  tips.sort((a, b) => b.score - a.score);

  // Praise what improved, so changes in habit show up as well as problems.
  const positives = [];
  if (P.n >= MIN_SESSIONS) {
    const better = (label, now_, before) => { if (before > 0.05 && now_ <= before * 0.7) positives.push(`${label} dropped from ${pct(before)}% to ${pct(now_)}% compared with the two weeks before.`); };
    better('Corrections in follow-ups', M.correctionRate, P.correctionRate);
    better('Interrupted sessions', M.interruptShare, P.interruptShare);
    better('Very long contexts', M.heavyContextShare, P.heavyContextShare);
  }

  return {
    ready: true, sessions: M.n, compared: P.n >= MIN_SESSIONS,
    tips: tips.slice(0, 4), positives, prompts: buildPrompts(local, recent, tips, rep, seen, profile, now),
  };
}

function buildPrompts(local, recent, tips, rep, seen, profile, now) {
  const ids = new Set(tips.map((t) => t.id));
  const cats = new Map();
  for (const s of recent) cats.set(s.category, (cats.get(s.category) || 0) + 1);
  const topCats = [...cats].filter(([c]) => FRAGMENTS['cat:' + c]).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c);

  const lines = [FRAGMENTS.base];
  for (const k of ['context-first', 'plan-first', 'smaller-steps', 'fresh-sessions', 'checkpoint', 'right-size']) if (ids.has(k)) lines.push(FRAGMENTS[k]);
  if (rep) lines.push(FRAGMENTS.repeat);
  for (const c of topCats) lines.push(FRAGMENTS['cat:' + c]);

  const tools = [...new Set(recent.map((s) => s.source))].filter((s) => FILE_OF[s]);
  const key = lines.join('|');
  const stamp = now.toLocaleDateString('en-CA');
  return tools.map((source) => ({
    tool: TOOL_NAME[source], file: FILE_OF[source], changed: profile.seen?.prompt != null && profile.seen.prompt !== key, key,
    text: `# Working agreements\n<!-- Generated by AI Usage Ledger from your last ${recent.length} sessions on ${stamp}. Regenerate it when your habits change. -->\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`,
  }));
}
