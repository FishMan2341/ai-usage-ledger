// Works out how much plan capacity goes unused and what to run to use it.
// Plan limits aren't public as token counts, so capacity is an estimate the user can override
// (or, for Codex, a measurement taken from the limits it logs).
const PROVIDERS = ['anthropic', 'openai', 'google'];
const NAMES = { anthropic: 'Claude', openai: 'Codex / OpenAI', google: 'Gemini' };
const CLI = {
  anthropic: (p) => `claude -p "${p}" --permission-mode acceptEdits`,
  openai: (p) => `codex exec "${p}"`,
  google: (p) => `gemini -p "${p}"`,
};
const WEEKS_PER_MONTH = 4.345;

const dayStr = (d) => d.toLocaleDateString('en-CA');
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sum = (rows, f) => rows.reduce((s, r) => s + (r[f] || 0), 0);

// Subscription limits apply to plan usage, not to pay-per-use API rows.
const planRows = (rows) => rows.filter((r) => r.billing !== 'api');

function weeklyTotals(rows, now, weeks) {
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const to = dayStr(addDays(now, -7 * w)), from = dayStr(addDays(now, -7 * w - 6));
    out.push(sum(rows.filter((r) => r.day >= from && r.day <= to), 'costUsd'));
  }
  return out; // index 0 = the 7 days ending today
}

function hourProfile(rows, now, days = 30) {
  const from = dayStr(addDays(now, -(days - 1)));
  const byHour = Array(24).fill(0);
  for (const r of rows) if (r.hour != null && r.day >= from) byHour[r.hour] += r.costUsd || 0;
  const total = byHour.reduce((a, b) => a + b, 0);
  return { byHour, total };
}

// Longest run of quiet hours (circular), where "quiet" means under 2% of the busiest hour's share.
function quietWindow({ byHour, total }) {
  if (!total) return null;
  const peak = Math.max(...byHour);
  const quiet = byHour.map((v) => v <= peak * 0.02);
  let best = { start: 0, len: 0 };
  for (let s = 0; s < 24; s++) {
    let len = 0;
    while (len < 24 && quiet[(s + len) % 24]) len++;
    if (len > best.len) best = { start: s, len };
  }
  return best.len >= 3 ? { start: best.start, end: (best.start + best.len) % 24, hours: best.len } : null;
}

// Codex logs how full each weekly limit window was. Dividing what we priced in that window by the
// reported percentage gives the plan's real capacity in API-equivalent dollars. Median over recent windows.
export function calibrateFromLimits(rows, windows) {
  const rowTs = (r) => Date.parse(`${r.day}T${String(r.hour ?? 0).padStart(2, '0')}:00:00`);
  const samples = [];
  for (const w of (windows || []).slice(-8)) {
    const u = w.secondary?.usedPercent;
    if (!(u >= 15)) continue;
    const end = w.secondary.resetsAt * 1000, start = end - w.secondary.windowMinutes * 60000;
    const cost = sum(rows.filter((r) => r.hour != null && rowTs(r) + 3600e3 > start && rowTs(r) <= w.at), 'costUsd');
    if (cost > 0) samples.push(cost / (u / 100));
  }
  if (!samples.length) return null;
  samples.sort((a, b) => a - b);
  return { capacityUsd: samples[Math.floor(samples.length / 2)], weeks: samples.length };
}

function reportedNow(limits, now) {
  const l = limits?.latest;
  if (!l?.secondary) return null;
  const weekFresh = l.secondary.resetsAt * 1000 > now.getTime();
  const fiveFresh = l.primary && l.primary.resetsAt * 1000 > now.getTime();
  return {
    asOf: l.at,
    weekly: { usedPercent: l.secondary.usedPercent, resetsAt: l.secondary.resetsAt * 1000, fresh: weekFresh },
    fiveHour: l.primary ? { usedPercent: l.primary.usedPercent, resetsAt: l.primary.resetsAt * 1000, fresh: !!fiveFresh } : null,
  };
}

const hh = (h) => String(h).padStart(2, '0') + ':00';

// ctx.habitIds: ids of the habit tips currently showing, so suggestions can respond to them.
export function analyze(data, profile, plans, now = new Date(), ctx = {}) {
  const all = planRows(data.rows);
  const last28From = dayStr(addDays(now, -27));
  const last30From = dayStr(addDays(now, -29));
  const multiple = plans.valueMultiple;
  // A provider is "present" when one of its sources actually returned usage. Absent ones are left out.
  const isPresent = (id) => (data.sources
    ? data.sources.some((s) => s.provider === id && s.present)
    : data.rows.some((r) => r.provider === id));

  const providers = PROVIDERS.map((id) => {
    const rows = all.filter((r) => r.provider === id);
    const detected = data.detected?.[id];
    const tierId = profile.plans?.[id] || detected?.id;
    const tier = plans.providers[id].find((p) => p.id === tierId);
    const weekly = weeklyTotals(rows, now, 13);
    const peakWeek = Math.max(0, ...weekly);
    const avgWeek = sum(rows.filter((r) => r.day >= last28From), 'costUsd') / 4;
    const base = {
      id, name: NAMES[id], present: isPresent(id), plan: tier?.label || null, planId: tier?.id || null,
      planAuto: !profile.plans?.[id] && !!detected, planFrom: !profile.plans?.[id] ? detected?.from || null : null,
      monthlyUsd: tier?.monthlyUsd || 0, thisWeekUsd: weekly[0], avgWeekUsd: avgWeek, peakWeekUsd: peakWeek,
    };
    if (!base.present) return { ...base, status: 'absent', note: 'No usage found.' };
    if (!tier) return { ...base, status: 'unknown', note: 'Choose your plan under "Tune the estimate" to size the headroom.' };
    if (tier.metered || tier.id === 'none') return { ...base, status: 'metered', note: tier.id === 'none' ? 'No plan, nothing unused.' : 'Pay-per-use, so there is no cap to leave unused.' };
    const estimate = tier.monthlyUsd * multiple / WEEKS_PER_MONTH;
    const override = profile.weeklyCapacityUsd?.[id];
    const codexSrc = data.sources?.find((s) => s.id === 'codex');
    const cal = id === 'openai' ? calibrateFromLimits(rows, codexSrc?.limits?.windows) : null;
    const reported = id === 'openai' ? reportedNow(codexSrc?.limits, now) : null;
    // A week you actually completed is proof of capacity; if you often hit limits, that week is the ceiling.
    const capacity = override || (cal ? Math.max(cal.capacityUsd, peakWeek) : profile.limitHits === 'often' && peakWeek > 0 ? peakWeek : Math.max(estimate, peakWeek));
    const source = override ? 'your override' : cal ? `Codex's own reported limits (${cal.weeks} week${cal.weeks > 1 ? 's' : ''} measured)` : profile.limitHits === 'often' && peakWeek > 0 ? 'your best week (you hit limits often)' : peakWeek > estimate ? 'your best week (above the estimate)' : `${multiple}x the plan fee`;
    const headroom = Math.max(0, capacity - avgWeek);
    return {
      ...base, status: 'ok', weeklyCapacityUsd: capacity, capacitySource: source, measured: !!cal && !override, reported,
      utilization: capacity ? Math.min(1, avgWeek / capacity) : 0,
      headroomWeekUsd: headroom, headroomMonthUsd: headroom * WEEKS_PER_MONTH,
      avgSessionUsd: avgSession(data, id, last30From),
    };
  });

  const ok = providers.filter((p) => p.status === 'ok');
  const hours = hourProfile(all, now);
  const window = quietWindow(hours);
  const cats = top(all.filter((r) => r.day >= last30From), (r) => r.category, ['Other', 'API (no prompt data)']);
  const projects = top(all.filter((r) => r.day >= last30From), (r) => r.project, ['unknown']);
  const activeDays = new Set(all.filter((r) => r.day >= dayStr(addDays(now, -13))).map((r) => r.day)).size;
  const mix = categoryMix(all, now);

  return {
    providers,
    totals: {
      headroomWeekUsd: sum(ok, 'headroomWeekUsd'),
      headroomMonthUsd: sum(ok, 'headroomMonthUsd'),
      planFeesMonthUsd: sum(ok, 'monthlyUsd'),
      avgWeekUsd: sum(ok, 'avgWeekUsd'),
      capacityWeekUsd: sum(ok, 'weeklyCapacityUsd'),
    },
    hours: hours.byHour,
    quietWindow: window && { ...window, label: `${hh(window.start)}–${hh(window.end)}` },
    activeDaysLast14: activeDays,
    topCategories: cats,
    topProjects: projects,
    recommendations: recommend({ providers: ok, window, cats, mix, projects, profile, activeDays, habitIds: new Set(ctx.habitIds || []) }),
    assumptions: { valueMultiple: multiple, note: plans._note },
  };
}

function avgSession(data, provider, from) {
  const sessions = data.sessions.filter((s) => s.day >= from && data.rows.some((r) => r.provider === provider && r.source === s.source));
  const cost = sum(planRows(data.rows).filter((r) => r.provider === provider && r.day >= from), 'costUsd');
  return sessions.length ? cost / sessions.length : 0;
}

function top(rows, keyFn, skip) {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (!skip.includes(k)) m.set(k, (m.get(k) || 0) + (r.costUsd || 0)); }
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, costUsd]) => ({ name, costUsd, share: total ? costUsd / total : 0 }));
}

// What you work on, weighting the last two weeks double so the mix follows your current focus.
function categoryMix(rows, now) {
  const recentFrom = dayStr(addDays(now, -13)), fromDay = dayStr(addDays(now, -29));
  const w = new Map();
  let total = 0;
  for (const r of rows) {
    if (r.day < fromDay || ['Other', 'API (no prompt data)'].includes(r.category)) continue;
    const v = (r.costUsd || 0) * (r.day >= recentFrom ? 2 : 1);
    w.set(r.category, (w.get(r.category) || 0) + v);
    total += v;
  }
  return Object.fromEntries([...w].map(([k, v]) => [k, total ? v / total : 0]));
}

// Each job scores from your recent work, not from anything you have to tell us.
const TEMPLATES = [
  { id: 'tests', title: 'Overnight test sweep', score: (m, c) => (m['Coding & debugging'] || 0) * 1.2,
    prompt: 'Find untested or weakly tested modules, write tests for them, run the suite, and commit working tests to a new branch named overnight/tests. Never touch main. Write a summary of what you added to OVERNIGHT.md.' },
  { id: 'audit', title: 'Security and dead-code audit', score: (m, c) => (m['Coding & debugging'] || 0) * 0.9 + (c.projectCount >= 3 ? 0.2 : 0),
    prompt: 'Audit this repository for security issues, dead code and risky dependencies. Do not edit any code. Write a prioritized findings report to AUDIT.md with file paths and suggested fixes.' },
  { id: 'docs', title: 'Docs and README refresh', score: (m, c) => (m['Coding & debugging'] || 0) * 0.8 + (c.habitIds.has('repeat') ? 0.15 : 0),
    prompt: 'Read this repository and bring the README and inline docs up to date with what the code does now. Work on a branch named overnight/docs and list every change in OVERNIGHT.md.' },
  { id: 'refactor', title: 'Refactor proposals on a branch', score: (m, c) => (m['Coding & debugging'] || 0) * 0.7 + (c.habitIds.has('fresh-sessions') ? 0.25 : 0),
    prompt: 'Find the three biggest maintainability problems here and implement the safest fix for each on a branch named overnight/refactor. Run the tests after each change and revert any that break them.' },
  { id: 'research', title: 'Morning research brief', score: (m) => (m['Data & research'] || 0) * 2,
    prompt: (p) => (p.topics
      ? `Research the latest developments on: ${p.topics}. Compare sources, flag disagreements, and write a one-page brief with links to BRIEF.md.`
      : 'Read the README and recent notes in this folder, identify the open questions behind the current work, research them, and write a one-page brief with links to BRIEF.md.') },
  { id: 'writing', title: 'Batch first drafts', score: (m) => (m.Writing || 0) * 2,
    prompt: 'Read the notes and outlines in this folder and write a full first draft for each, saved as separate files in drafts/. Match the tone of the existing documents here.' },
  { id: 'design', title: 'Design variations on branches', score: (m) => (m['Web & design'] || 0) * 2,
    prompt: 'Build three distinct visual variations of the main page, each on its own branch named overnight/design-1, -2 and -3. Include a screenshot of each in OVERNIGHT.md.' },
];

const CAT_OF = { tests: 'Coding & debugging', audit: 'Coding & debugging', docs: 'Coding & debugging', refactor: 'Coding & debugging', research: 'Data & research', writing: 'Writing', design: 'Web & design' };

function recommend({ providers, window, cats, mix, projects, profile, activeDays, habitIds }) {
  if (!providers.length) return [];
  const best = [...providers].sort((a, b) => b.headroomWeekUsd - a.headroomWeekUsd)[0];
  const goals = new Set(profile.goals || []); // optional nudge, never required
  const project = projects[0]?.name;
  const start = window ? (window.start + 1) % 24 : 1; // an hour into the quiet window
  const when = window ? hh(start) : '01:00';
  const runs = (p) => (p.avgSessionUsd > 0 ? Math.max(1, Math.floor(p.headroomWeekUsd / p.avgSessionUsd)) : null);
  const pathHint = project ? `<path to ${project}>` : '<path to your project>';
  const noMachine = profile.overnight === 'no';
  const win = process.platform === 'win32';
  const c = { habitIds, projectCount: projects.length };

  const scored = TEMPLATES
    .map((t) => ({ t, score: t.score(mix, c) + (goals.has(t.id) ? 0.4 : 0) }))
    .filter((x) => x.score >= 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const recs = scored.map(({ t }) => {
    const p = best;
    const prompt = typeof t.prompt === 'function' ? t.prompt(profile) : t.prompt;
    const command = CLI[p.id](prompt);
    const n = runs(p);
    const share = Math.round((mix[CAT_OF[t.id]] || 0) * 100);
    return {
      id: t.id, title: t.title, provider: p.id, providerName: p.name,
      why: [
        share >= 5 ? `About ${share}% of your recent work is ${CAT_OF[t.id].toLowerCase()}.` : 'A low-risk job that suits your recent work.',
        `${p.name} has about $${Math.round(p.headroomWeekUsd)} of API-equivalent capacity unused each week${n ? `, roughly ${n} sessions like your average` : ''}.`,
        window ? `Your machine is quiet ${window.hours} hours a night (${hh(window.start)} to ${hh(window.end)}).` : 'No clear quiet window yet, so any off-hours slot works.',
      ],
      command, cwdHint: pathHint,
      schedule: noMachine
        ? 'Your computer is off overnight, so schedule this as a cloud routine instead (in Claude Code, the /schedule command).'
        : win
          ? `Task Scheduler → Create Basic Task → daily at ${when} → Start a program: powershell, arguments: -NoProfile -Command "Set-Location '${pathHint}'; ${command.replace(/"/g, '`"')}"`
          : `crontab -e, then add: 0 ${start} * * * cd ${pathHint} && ${command}`,
      safety: 'Run it on a branch or read-only, and check the output in the morning before merging anything.',
    };
  });

  if (habitIds.has('repeat')) recs.push({
    id: 'make-command', title: 'Capture your repeat request', provider: best.id, providerName: best.name,
    why: ['You keep opening sessions with nearly the same request. Save it once as a custom command or skill, then run it on a schedule.'],
    command: null, schedule: null, safety: null,
  });
  if (providers.length > 1) {
    const byUse = [...providers].sort((a, b) => a.utilization - b.utilization);
    const lo = byUse[0], hi = byUse[byUse.length - 1];
    if (hi.utilization - lo.utilization > 0.3) recs.push({
      id: 'shift', title: `Shift routine work to ${lo.name}`, provider: lo.id, providerName: lo.name,
      why: [`${lo.name} is ${Math.round(lo.utilization * 100)}% used while ${hi.name} is ${Math.round(hi.utilization * 100)}%. Boilerplate, summaries and first drafts can go to the plan with room.`],
      command: null, schedule: null, safety: null,
    });
  }
  if (activeDays <= 9) recs.push({
    id: 'weekend', title: 'Use the days you skip', provider: best.id, providerName: best.name,
    why: [`You used AI on ${activeDays} of the last 14 days. Weekly limits reset whether you use them or not, so a light weekend job is free capacity.`],
    command: null, schedule: null, safety: null,
  });
  return recs;
}
