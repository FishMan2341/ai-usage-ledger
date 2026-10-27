'use strict';

const PROVIDERS = [
  { id: 'anthropic', name: 'Claude', color: 'var(--claude)' },
  { id: 'openai', name: 'Codex / OpenAI', color: 'var(--openai)' },
  { id: 'google', name: 'Gemini', color: 'var(--google)' },
];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = { data: null, metric: 'costUsd', hidden: new Set(), animate: true };
try { state.metric = JSON.parse(localStorage.getItem('ledger.home') || '{}').metric || state.metric; } catch { /* storage unavailable */ }

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const usd = (n) => (n >= 10000 ? '$' + compact.format(n) : '$' + Math.round(n).toLocaleString('en'));
const usdExact = (n) => (n >= 100 ? '$' + Math.round(n) : '$' + n.toFixed(2));
const fmtMetric = (n) => (state.metric === 'tokens' ? compact.format(n) : usdExact(n));
const addDays = (day, n) => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const weekday = (day) => new Date(day + 'T12:00:00').toLocaleDateString('en', { weekday: 'short' });
const longDay = (day) => new Date(day + 'T12:00:00').toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' });
const byId = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

// ---------- collapsibles ----------
// A header button over a body that animates its height. Collapsibles that share a group open and
// close together, so sibling cards in a row never end up at different heights.
const groups = { recs: false, prompts: false };
const groupMembers = new Map();

function setOpen(node, open) {
  node.classList.toggle('open', open);
  node.querySelector(':scope > .clp-btn').setAttribute('aria-expanded', String(open));
}
function toggleClp(node, group) {
  const open = !node.classList.contains('open');
  if (!group) return setOpen(node, open);
  groups[group] = open;
  for (const m of groupMembers.get(group) || []) if (m.isConnected) setOpen(m, open);
}
function wireClp(node, group) {
  node.querySelector(':scope > .clp-btn').addEventListener('click', () => toggleClp(node, group));
}
// Builds a collapsible from a label and body content.
function clp(label, bodyKids, { group, className = '', note } = {}) {
  const node = el('div', { class: `clp ${className}` },
    el('button', { type: 'button', class: 'clp-btn', 'aria-expanded': 'false' }, el('span', { class: 'clp-title' }, label), note ? el('span', { class: 'note' }, note) : null, el('i', { class: 'chev', 'aria-hidden': 'true' })),
    el('div', { class: 'clp-body' }, el('div', { class: 'clp-inner' }, bodyKids)));
  wireClp(node, group);
  if (group) { groupMembers.get(group)?.add(node); setOpen(node, groups[group]); }
  return node;
}
const startGroup = (g) => groupMembers.set(g, new Set());

// Counts a number up with an ease-out curve; jumps straight to the end when motion is reduced.
function countUp(node, to, format, ms = 1400) {
  if (reduceMotion || !state.animate) { node.textContent = format(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    node.textContent = format(to * (1 - (1 - p) ** 4));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- hero and rings ----------
function renderHero() {
  const { analysis: a } = state.data;
  const t = a.totals;
  const known = a.providers.some((p) => p.status === 'ok');
  const present = a.providers.filter((p) => p.present);
  byId('big').setAttribute('aria-label', known ? `${usd(t.headroomWeekUsd)} unused this week` : 'No plan set');
  if (known) {
    countUp(byId('big'), t.headroomWeekUsd, usd);
    byId('hero-sub').replaceChildren(el('b', {}, usd(t.headroomMonthUsd)), ` a month at API prices, from ${usd(t.planFeesMonthUsd)} of plan fees.`);
  } else {
    byId('big').textContent = '—';
    byId('hero-sub').textContent = present.length
      ? 'We couldn’t tell which plan you’re on. Pick it under “Tune the estimate” to see what’s unused.'
      : 'No AI usage found yet. Use Claude Code, Codex or Gemini CLI, or add a source below.';
  }

  const C = 2 * Math.PI * 46;
  byId('rings').replaceChildren(...present.map((p) => {
    const meta = PROVIDERS.find((x) => x.id === p.id);
    const ok = p.status === 'ok';
    const pct = ok ? Math.round(p.utilization * 100) : 0;
    const arc = svgEl('circle', { class: 'arc', cx: 60, cy: 60, r: 46, 'stroke-dasharray': C, 'stroke-dashoffset': ok && (reduceMotion || !state.animate) ? C * (1 - p.utilization) : C });
    arc.style.stroke = meta.color; arc.style.color = meta.color;
    const pctText = svgEl('text', { x: 60, y: 64, class: 'pct' });
    pctText.textContent = ok ? pct + '%' : '—';
    const sub = svgEl('text', { x: 60, y: 80, class: 'pct-sub' });
    sub.textContent = ok ? 'used' : 'no plan';
    const svg = svgEl('svg', { viewBox: '0 0 120 120', role: 'img', 'aria-label': ok ? `${p.name}: ${pct}% of weekly capacity used` : `${p.name}: plan not set` });
    svg.append(svgEl('circle', { class: 'track', cx: 60, cy: 60, r: 46 }), arc, pctText, sub);
    if (ok && !reduceMotion && state.animate) requestAnimationFrame(() => requestAnimationFrame(() => arc.setAttribute('stroke-dashoffset', C * (1 - p.utilization))));
    return el('div', { class: 'ring' + (ok ? '' : ' empty'), title: ok ? `Capacity based on ${p.capacitySource}` : p.note },
      svg, el('span', { class: 'ring-name' }, p.name),
      el('span', { class: 'ring-left' }, ok ? [el('b', {}, usd(p.headroomWeekUsd)), ' unused'] : 'Plan not set'),
      ok && p.reported?.weekly.fresh ? el('span', { class: 'ring-now' }, `Plan says ${Math.round(p.reported.weekly.usedPercent)}% of this week used · resets ${new Date(p.reported.weekly.resetsAt).toLocaleString([], { weekday: 'short', hour: 'numeric' })}`) : null,
      ok && p.measured ? el('span', { class: 'ring-tag' }, 'Measured') : null);
  }));
}

// ---------- habits and working agreement ----------
const TREND_TEXT = { better: 'Improving', worse: 'Getting more common', steady: 'Steady' };

function renderHabits() {
  const h = state.data.analysis.habits;
  const prof = state.data.profile;
  const sec = byId('habits');
  const first = !prof.onboarded;
  const hasNew = h.ready && h.tips.some((t) => t.isNew);
  sec.hidden = !(first || hasNew || (h.ready && h.tips.length) || (h.ready && h.positives.length));
  sec.classList.toggle('welcome', first);
  byId('habits-eyebrow').textContent = first ? 'Welcome · your first read' : hasNew ? 'New since your last visit' : 'Habits';
  byId('habits-h').textContent = first ? 'Here’s what we noticed in how you work' : 'What we noticed in your work';
  byId('habits-ack').hidden = !(first || hasNew);
  byId('habits-ack').textContent = first ? 'Got it' : 'Mark as read';
  if (!h.ready) {
    byId('habits-note').textContent = h.message;
    byId('tips').replaceChildren(); byId('kudos').hidden = true;
    return;
  }
  byId('habits-note').textContent = `Read from your last ${h.sessions} sessions on this machine${h.compared ? ', compared with the two weeks before' : ''}. Your prompts are never stored.`;
  byId('tips').replaceChildren(...h.tips.map((t, k) => el('article', { class: 'tip-card', style: `--k:${k}` },
    el('div', { class: 'tip-top' },
      t.isNew ? el('span', { class: 'badge' }, 'New') : null,
      t.trend ? el('span', { class: `trend ${t.trend}` }, TREND_TEXT[t.trend]) : null),
    el('h3', {}, t.title), el('p', {}, t.body), el('p', { class: 'evidence' }, t.evidence))));
  if (!h.tips.length) byId('tips').replaceChildren(el('p', { class: 'note' }, 'Nothing stands out. Your habits look efficient, so the best next step is putting spare capacity to work below.'));
  const kudos = byId('kudos');
  kudos.hidden = !h.positives.length;
  kudos.replaceChildren(...(h.positives.length ? [el('b', {}, 'Nice: '), h.positives.join(' ')] : []));
}

function renderPrompts() {
  const h = state.data.analysis.habits;
  const card = byId('prompts-card');
  card.hidden = !(h.ready && h.prompts.length);
  if (card.hidden) return;
  const changed = h.prompts.some((p) => p.changed);
  byId('prompts-note').textContent = changed
    ? 'Updated since you last looked, because your habits shifted. Copy it into your instruction file to keep it current.'
    : 'A short instruction file for your AI tools, written from how you work. It is regenerated as your habits change.';
  startGroup('prompts');
  byId('prompts').replaceChildren(...h.prompts.map((p) => {
    const copy = el('button', { type: 'button', class: 'btn small', onclick: async () => {
      try { await navigator.clipboard.writeText(p.text); copy.textContent = 'Copied'; } catch { copy.textContent = 'Copy failed'; }
      setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
    } }, 'Copy');
    return clp([p.tool, el('code', {}, p.file), p.changed ? el('span', { class: 'badge' }, 'Updated') : null], [
      el('pre', {}, el('code', {}, p.text)),
      el('div', { class: 'rec-actions' }, copy, el('span', { class: 'note' }, `Add it to ${p.file} in your project or home folder.`))], { group: 'prompts', className: 'prompt' });
  }));
}

byId('habits-ack').addEventListener('click', async () => {
  const h = state.data.analysis.habits;
  try {
    await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ onboarded: true, seen: { tips: h.tips.map((t) => t.id), prompt: h.prompts[0]?.key ?? null } }) });
    state.animate = false;
    await load(false);
  } catch { /* leave as is; the user can try again */ }
});

// ---------- week chart ----------
function weekSeries() {
  const to = new Date().toLocaleDateString('en-CA');
  const days = Array.from({ length: 7 }, (_, i) => addDays(to, i - 6));
  const f = state.metric;
  const series = PROVIDERS.map((p) => {
    const rows = state.data.rows.filter((r) => r.provider === p.id);
    return { ...p, has: rows.length > 0, values: days.map((d) => rows.reduce((s, r) => s + (r.day === d ? r[f] || 0 : 0), 0)) };
  });
  const total = days.map((_, i) => series.reduce((s, p) => s + p.values[i], 0));
  return { days, series, total };
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

// Monotone cubic through the points so the curve never dips below a real value.
function smooth(pts) {
  const n = pts.length;
  if (n < 3) return 'M' + pts.map((p) => p.join(',')).join('L');
  const dx = [], sl = [];
  for (let i = 0; i < n - 1; i++) { dx.push(pts[i + 1][0] - pts[i][0]); sl.push((pts[i + 1][1] - pts[i][1]) / dx[i]); }
  const m = [sl[0]];
  for (let i = 1; i < n - 1; i++) m.push(sl[i - 1] * sl[i] <= 0 ? 0 : (sl[i - 1] + sl[i]) / 2);
  m.push(sl[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (sl[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / sl[i], b = m[i + 1] / sl[i], h = Math.hypot(a, b);
    if (h > 3) { m[i] = (3 * a / h) * sl[i]; m[i + 1] = (3 * b / h) * sl[i]; }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const k = dx[i] / 3;
    d += `C${pts[i][0] + k},${pts[i][1] + m[i] * k} ${pts[i + 1][0] - k},${pts[i + 1][1] - m[i + 1] * k} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

function renderChart() {
  const { days, series, total } = weekSeries();
  const W = 860, H = 320, m = { l: 50, r: 14, t: 16, b: 28 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const lines = [...series.filter((s) => s.has).map((s) => ({ ...s, width: 2 })), { id: 'total', name: 'Total', color: 'var(--fg)', values: total, width: 3.2 }];
  const shown = lines.filter((s) => !state.hidden.has(s.id));
  const max = niceMax(Math.max(0, ...shown.flatMap((s) => s.values)));
  const x = (i) => m.l + (iw * i) / (days.length - 1);
  const y = (v) => m.t + ih - (ih * v) / max;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Daily usage for the last 7 days by provider with a total line' });
  const defs = svgEl('defs');
  const grad = svgEl('linearGradient', { id: 'areaFill', x1: 0, y1: 0, x2: 0, y2: 1 });
  const s1 = svgEl('stop', { offset: '0%' }); s1.style.cssText = 'stop-color:var(--accent);stop-opacity:.3';
  const s2 = svgEl('stop', { offset: '100%' }); s2.style.cssText = 'stop-color:var(--accent);stop-opacity:0';
  grad.append(s1, s2); defs.append(grad); svg.append(defs);

  for (let i = 0; i <= 4; i++) {
    const v = (max * i) / 4;
    svg.append(svgEl('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'gridline' }));
    const t = svgEl('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' });
    t.textContent = fmtMetric(v);
    svg.append(t);
  }
  days.forEach((d, i) => {
    const t = svgEl('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'axis' });
    t.textContent = weekday(d);
    svg.append(t);
  });

  shown.forEach((s, k) => {
    const pts = s.values.map((v, i) => [x(i), y(v)]);
    const path = smooth(pts);
    if (s.id === 'total') svg.append(svgEl('path', { d: `${path}L${x(days.length - 1)},${y(0)}L${x(0)},${y(0)}Z`, fill: 'url(#areaFill)', class: 'area' }));
    const line = svgEl('path', { d: path, pathLength: 1, class: 'ln draw' });
    line.style.cssText = `stroke:${s.color};stroke-width:${s.width};--d:${k}`;
    svg.append(line);
    pts.forEach(([cx, cy]) => {
      const dot = svgEl('circle', { cx, cy, r: s.id === 'total' ? 4 : 3, class: 'dot' });
      dot.style.cssText = `fill:${s.color};--d:${k}`;
      svg.append(dot);
    });
  });

  const rail = svgEl('line', { y1: m.t, y2: m.t + ih, class: 'rail', visibility: 'hidden' });
  svg.append(rail);
  svg.addEventListener('pointermove', (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(days.length - 1, Math.round(((px - m.l) / iw) * (days.length - 1))));
    rail.setAttribute('x1', x(i)); rail.setAttribute('x2', x(i)); rail.setAttribute('visibility', 'visible');
    showTip(e, longDay(days[i]), shown.slice().reverse().map((s) => [s.name, fmtMetric(s.values[i]), s.color]));
  });
  svg.addEventListener('pointerleave', () => { rail.setAttribute('visibility', 'hidden'); hideTip(); });
  const chart = byId('week-chart');
  chart.classList.toggle('still', !state.animate || reduceMotion);
  chart.replaceChildren(svg);

  const last = days.length - 1;
  byId('week-legend').replaceChildren(...lines.map((s) => el('button', {
    type: 'button', class: 'pill', 'aria-pressed': String(!state.hidden.has(s.id)), title: 'Show or hide this line',
    onclick: () => { state.hidden.has(s.id) ? state.hidden.delete(s.id) : state.hidden.add(s.id); state.animate = false; renderChart(); },
  }, el('i', { style: `background:${s.color}` }), s.name, el('b', {}, fmtMetric(s.values[last])))));
  const missing = series.filter((s) => !s.has).map((s) => s.name);
  byId('week-note').textContent = `${fmtMetric(total.reduce((a, b) => a + b, 0))} this week${missing.length ? ` · no data yet for ${missing.join(' and ')}` : ''}`;
  for (const b of document.querySelectorAll('#metric button')) b.setAttribute('aria-pressed', String(b.dataset.metric === state.metric));
}

const tip = byId('tip');
function showTip(e, title, lines) {
  tip.replaceChildren(el('strong', {}, title), ...lines.map(([k, v, c]) => el('div', { class: 'tip-row' }, el('i', { style: `background:${c}` }), k, el('b', {}, v))));
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(window.innerWidth - r.width - 8, e.clientX + 14) + 'px';
  tip.style.top = Math.max(8, e.clientY - r.height - 10) + 'px';
}
function hideTip() { tip.hidden = true; }

// ---------- suggestions ----------
function renderRecs() {
  const a = state.data.analysis;
  const prof = state.data.profile;
  const bits = [];
  if (a.quietWindow) bits.push(`idle ${a.quietWindow.label}`);
  if (a.topCategories[0]) bits.push(`mostly ${a.topCategories[0].name.toLowerCase()}`);
  byId('rec-note').textContent = bits.length ? `Picked for you: ${bits.join(' · ')}` : '';

  const box = byId('recs');
  byId('cloud-note')?.remove();
  if (!a.recommendations.length) {
    box.replaceChildren(el('p', { class: 'note' }, 'Set your plans under “Tune the estimate” to get suggestions sized to your spare capacity.'));
    return;
  }
  startGroup('recs');
  box.replaceChildren(...a.recommendations.map((r, k) => {
    const meta = PROVIDERS.find((x) => x.id === r.provider);
    const card = el('article', { class: 'rec', style: `--c:${meta.color};--k:${k}` },
      el('h3', {}, r.title), el('p', { class: 'lede' }, r.why[0]),
      el('span', { class: 'chip' }, r.command ? `Runs on ${r.providerName}` : r.providerName));
    if (r.command) {
      const copy = el('button', { type: 'button', class: 'btn small', onclick: async () => {
        try { await navigator.clipboard.writeText(r.command); copy.textContent = 'Copied'; } catch { copy.textContent = 'Copy failed'; }
        setTimeout(() => { copy.textContent = 'Copy command'; }, 1500);
      } }, 'Copy command');
      card.append(clp('Show how', [
        ...r.why.slice(1).map((w) => el('p', { class: 'note' }, w)),
        el('p', { class: 'note' }, `Run from ${r.cwdHint}:`),
        el('pre', {}, el('code', {}, r.command)),
        el('div', { class: 'rec-actions' }, copy),
        el('p', { class: 'note' }, r.schedule),
        el('p', { class: 'note' }, r.safety)], { group: 'recs', className: 'inline' }));
    } else if (r.why.length > 1) {
      card.append(clp('More', r.why.slice(1).map((w) => el('p', { class: 'note' }, w)), { group: 'recs', className: 'inline' }));
    }
    return card;
  }));
  if (prof.overnight === 'no') box.before(el('p', { class: 'warn', id: 'cloud-note' }, 'Your computer is off overnight, so the schedules point to cloud routines.'));
}

// ---------- profile form (all optional) ----------
async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
  return out;
}

function renderProfile() {
  const { profile, plans, analysis, detected = {} } = state.data;
  const present = analysis.providers.filter((p) => p.present);
  const form = byId('profile');
  const select = (name, opts, value) => el('select', { name }, opts.map(([v, l]) => el('option', { value: v, selected: v === value }, l)));
  const field = (label, control) => el('label', { class: 'field' }, el('span', {}, label), control);

  const planFields = present.map((p) => field(`${p.name} plan`,
    select(`plan-${p.id}`, [
      ['', detected[p.id] ? `Auto: ${detected[p.id].label} (from ${detected[p.id].from})` : 'Not set'],
      ...plans.providers[p.id].map((t) => [t.id, t.label + (t.monthlyUsd ? ` ($${t.monthlyUsd}/mo)` : '')])], profile.plans?.[p.id] || '')));
  const override = clp('Set weekly capacity yourself', [
    el('div', { class: 'grid3' }, present.map((p) => {
      const cap = analysis.providers.find((x) => x.id === p.id)?.weeklyCapacityUsd;
      return field(`${p.name} ($/week)`, el('input', { type: 'number', min: '1', step: '1', name: `cap-${p.id}`, placeholder: cap ? String(Math.round(cap)) : 'auto', value: profile.weeklyCapacityUsd?.[p.id] || '' }));
    })),
    el('p', { class: 'note' }, 'API-equivalent dollars. The week you hit a limit is a good guide.')], { className: 'inline' });

  const status = el('span', { class: 'note', role: 'status' });
  form.replaceChildren(
    planFields.length ? el('div', { class: 'grid3' }, planFields) : null,
    el('div', { class: 'grid3' },
      field('How often do you hit usage limits?', select('limitHits', [['', 'Not sure'], ['never', 'Never'], ['sometimes', 'Sometimes'], ['often', 'Often']], profile.limitHits || '')),
      field('Is your computer on overnight?', select('overnight', [['', 'Not sure'], ['yes', 'Yes'], ['sometimes', 'Sometimes'], ['no', 'No']], profile.overnight || '')),
      field('Topics for research briefs', el('input', { type: 'text', name: 'topics', maxlength: '300', placeholder: 'Optional, e.g. AI agents', value: profile.topics || '' }))),
    present.length ? override : null,
    el('div', { class: 'rec-actions' }, el('button', { type: 'submit', class: 'btn primary' }, 'Save and update'), status));

  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const plansOut = { ...profile.plans }, caps = { ...profile.weeklyCapacityUsd };
    for (const p of present) {
      const plan = f.get(`plan-${p.id}`), cap = f.get(`cap-${p.id}`);
      if (plan) plansOut[p.id] = plan; else delete plansOut[p.id];
      if (cap) caps[p.id] = cap; else delete caps[p.id];
    }
    status.textContent = 'Saving…';
    try {
      await post('/api/profile', { plans: plansOut, weeklyCapacityUsd: caps, limitHits: f.get('limitHits'), overnight: f.get('overnight'), topics: f.get('topics') });
      state.animate = true;
      await load(false);
      setOpen(byId('tune'), true);
      byId('profile').querySelector('[role=status]').textContent = 'Saved';
    } catch (err) { status.textContent = 'Could not save: ' + err.message; }
  };
}

// ---------- sources: detection, rescan, manual add ----------
const SOURCE_CHIP = { ok: 'Detected', partial: 'Partly loaded', not_configured: 'Not connected', not_found: 'Not found', error: 'Failed', disabled: 'Off' };

function manualForm({ label, placeholder, type = 'text', button, submit }) {
  const input = el('input', { type, placeholder, required: true, autocomplete: 'off', spellcheck: 'false', 'aria-label': label });
  const out = el('span', { class: 'note', role: 'status' });
  return el('form', { class: 'manual', onsubmit: async (e) => {
    e.preventDefault();
    out.textContent = 'Checking…';
    try { await submit(input.value); input.value = ''; state.animate = false; await load(false, {}); }
    catch (err) { out.textContent = err.message; }
  } }, el('span', { class: 'note' }, label), el('div', { class: 'manual-row' }, input, el('button', { type: 'submit', class: 'btn small' }, button)), out);
}

function renderSources() {
  const d = state.data;
  const blocks = PROVIDERS.map((p) => ({ ...p, sources: d.sources.filter((s) => s.provider === p.id) }));
  const found = blocks.filter((p) => p.sources.some((s) => s.present));
  byId('sources-summary').textContent = found.length ? `${found.map((p) => p.name).join(', ')} detected` : 'Nothing detected yet';

  byId('sources').replaceChildren(...blocks.map((p) => {
    const here = p.sources.some((s) => s.present);
    const scan = el('button', { type: 'button', class: 'btn small', onclick: async (e) => {
      const b = e.currentTarget;
      b.disabled = true; b.textContent = 'Scanning…';
      try { await post('/api/rescan', { provider: p.id }); state.animate = false; await load(false, {}); } catch { b.textContent = 'Failed'; b.disabled = false; }
    } }, 'Rescan');
    const forms = [];
    for (const s of p.sources) {
      if (s.kind === 'local' && !s.present) {
        forms.push(manualForm({ label: `Folder containing ${s.label.replace(/ \(.*\)/, '')} logs`, placeholder: 'Full path, e.g. D:\\tools\\logs', button: 'Use this folder', submit: (v) => post('/api/sources', { id: s.id, path: v }) }));
      }
      if (s.kind === 'account' && s.envKey && s.status === 'not_configured') {
        forms.push(manualForm({ label: `${s.label}: paste ${s.envKey} (saved on this machine only)`, placeholder: s.envKey, type: 'password', button: 'Connect', submit: (v) => post('/api/keys', { name: s.envKey, value: v }) }));
      }
    }
    return el('div', { class: 'prov' },
      el('div', { class: 'prov-head' },
        el('span', { class: 'vname' }, el('i', { style: `background:${p.color}` }), p.name),
        el('span', { class: `chip ${here ? 'ok' : 'off'}` }, here ? 'Detected' : 'Not found'), scan),
      ...p.sources.map((s) => el('p', { class: 'prov-line' }, el('b', {}, SOURCE_CHIP[s.status] || s.status), ' · ', s.label, s.message ? ` · ${s.message}` : '')),
      forms.length ? clp('Add manually', forms, { className: 'inline' }) : null);
  }));
}

byId('rescan-all').addEventListener('click', async (e) => {
  const b = e.currentTarget, out = byId('rescan-status');
  b.disabled = true; out.textContent = 'Scanning…';
  try { await post('/api/rescan', { provider: 'all' }); state.animate = false; await load(false, {}); out.textContent = 'Done'; } catch (err) { out.textContent = err.message; }
  b.disabled = false;
});

// ---------- load ----------
// `quiet` is the background refresh: it updates the numbers and suggestions but leaves forms alone,
// so nothing you are typing is wiped.
async function load(refresh, { quiet = false } = {}) {
  if (!quiet) byId('generated').textContent = 'Reading your usage…';
  try {
    const res = await fetch('/api/usage' + (refresh ? '?refresh=1' : ''));
    const next = await res.json();
    if (next.error || !next.analysis) throw new Error(next.error || 'Unexpected response');
    state.data = next;
  } catch (e) { if (!quiet) byId('generated').textContent = 'Could not load usage: ' + e.message; return; }
  const d = state.data;
  byId('generated').textContent = `Updated ${new Date(d.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  byId('assumptions').textContent = `Weekly capacity is measured where the provider logs its limits, and otherwise estimated at ${d.analysis.assumptions.valueMultiple}x the monthly plan fee in API-equivalent dollars (or your best week if higher). Costs use list API prices.`;
  renderHabits(); renderHero(); renderChart(); renderRecs(); renderPrompts();
  if (!quiet) { renderProfile(); renderSources(); }
  if (!d.sources.some((s) => s.present) && !state.shownEmpty) { state.shownEmpty = true; setOpen(byId('sources-card'), true); }
  state.animate = false;
}

for (const id of ['sources-card', 'tune']) wireClp(byId(id));
byId('refresh').addEventListener('click', () => { state.animate = true; load(true); });
for (const b of document.querySelectorAll('#metric button')) {
  b.addEventListener('click', () => {
    state.metric = b.dataset.metric;
    state.animate = false;
    try { localStorage.setItem('ledger.home', JSON.stringify({ metric: state.metric })); } catch { /* ignore */ }
    renderChart();
  });
}
load(false);
// Habits and suggestions follow your latest sessions, so keep them current without being asked.
setInterval(() => { if (!document.hidden) load(true, { quiet: true }); }, 10 * 60e3);
