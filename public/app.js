'use strict';

const PROVIDERS = {
  anthropic: {
    name: 'Claude', color: 'var(--claude)',
    links: [['Plan usage', 'https://claude.ai/settings/usage'], ['API usage', 'https://platform.claude.com/usage'], ['API cost', 'https://platform.claude.com/cost']],
  },
  openai: {
    name: 'Codex and OpenAI', color: 'var(--openai)',
    links: [['Codex usage', 'https://chatgpt.com/codex/settings/usage'], ['API usage', 'https://platform.openai.com/usage']],
  },
  google: {
    name: 'Gemini', color: 'var(--google)',
    links: [['AI Studio usage', 'https://aistudio.google.com/usage'], ['Cloud billing', 'https://console.cloud.google.com/billing']],
  },
};
const ORDER = ['anthropic', 'openai', 'google'];
const STATUS_TEXT = { ok: 'Connected', partial: 'Partly loaded', not_configured: 'Not connected', not_found: 'No logs found', error: 'Failed', disabled: 'Off' };

const state = { data: null, days: 30, metric: 'tokens', off: new Set(), sort: { models: ['costUsd', -1], projects: ['costUsd', -1] } };
try {
  const saved = JSON.parse(localStorage.getItem('ledger.prefs') || '{}');
  if (saved.days != null) state.days = saved.days;
  if (saved.metric) state.metric = saved.metric;
  state.off = new Set(saved.off || []);
} catch { /* storage unavailable */ }
function savePrefs() {
  try { localStorage.setItem('ledger.prefs', JSON.stringify({ days: state.days, metric: state.metric, off: [...state.off] })); } catch { /* ignore */ }
}

// ---------- formatting ----------
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en');
const fmt = {
  tokens: (n) => (n >= 10000 ? compact.format(n) : whole.format(Math.round(n))),
  usd: (n) => (n >= 10000 ? '$' + compact.format(n) : n >= 100 ? '$' + whole.format(Math.round(n)) : '$' + n.toFixed(2)),
  wh: (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + ' kWh' : Math.round(n) + ' Wh'),
  co2: (g) => (g >= 1000 ? (g / 1000).toFixed(1) + ' kg' : Math.round(g) + ' g'),
  water: (l) => (l >= 1 ? l.toFixed(1) + ' L' : Math.round(l * 1000) + ' mL'),
  int: (n) => whole.format(Math.round(n)),
};
const metricFmt = { tokens: fmt.tokens, costUsd: fmt.usd, wh: fmt.wh };
const metricName = { tokens: 'tokens', costUsd: 'API-equivalent cost', wh: 'estimated energy' };
const today = () => new Date().toLocaleDateString('en-CA');
const addDays = (day, n) => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const shortDate = (day) => new Date(day + 'T12:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' });

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

// ---------- data selection ----------
function window_() {
  const to = today();
  if (state.days) return { from: addDays(to, -(state.days - 1)), to };
  const days = state.data.rows.map((r) => r.day).sort();
  return { from: days[0] || to, to };
}
const included = (r) => !state.off.has(r.source);
function selected() {
  const { from, to } = window_();
  const inRange = (r) => r.day >= from && r.day <= to;
  return {
    from, to,
    rows: state.data.rows.filter((r) => included(r) && inRange(r)),
    billed: state.data.billed.filter((r) => included(r) && inRange(r)),
    sessions: state.data.sessions.filter((r) => included(r) && r.day && inRange(r)),
  };
}
function sum(rows, f) { let s = 0; for (const r of rows) s += r[f] || 0; return s; }
function group(rows, keyFn) {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
}
function subscriptionCost(subs, from, to) {
  const span = (Date.parse(to) - Date.parse(from)) / 864e5 + 1;
  return (subs || []).reduce((total, s) => {
    const start = s.since ? Math.max(Date.parse(from), Date.parse(s.since)) : Date.parse(from);
    const active = Math.max(0, (Date.parse(to) - start) / 864e5 + 1);
    return total + (Number(s.monthlyUsd) || 0) * Math.min(active, span) / 30.437;
  }, 0);
}

// ---------- render ----------
function render() {
  const d = state.data;
  if (!d) return;
  const sel = selected();
  const imp = d.impact;
  document.getElementById('generated').textContent = `Updated ${new Date(d.generatedAt).toLocaleString()} · ${sel.from === sel.to ? shortDate(sel.from) : `${shortDate(sel.from)} – ${shortDate(sel.to)}`}`;
  for (const b of document.querySelectorAll('#range button')) b.setAttribute('aria-pressed', String(Number(b.dataset.days) === state.days));
  for (const b of document.querySelectorAll('#metric button')) b.setAttribute('aria-pressed', String(b.dataset.metric === state.metric));

  const tokens = sum(sel.rows, 'tokens'), cost = sum(sel.rows, 'costUsd'), wh = sum(sel.rows, 'wh');
  const co2 = sum(sel.rows, 'co2eGrams'), water = sum(sel.rows, 'waterLitres');
  const billedUsd = sum(sel.billed, 'usd');
  const subsUsd = subscriptionCost(d.subscriptions, sel.from, sel.to);
  const { low, high } = imp.uncertainty;

  setText('k-tokens', fmt.tokens(tokens));
  setText('k-tokens-note', `${fmt.int(sel.sessions.length)} sessions · ${fmt.int(sum(sel.rows, 'requests'))} requests`);
  setText('k-cost', fmt.usd(cost));
  setText('k-cost-note', 'at list API prices');
  const paidKnown = d.subscriptions.length || sel.billed.length;
  setText('k-paid', paidKnown ? fmt.usd(billedUsd + subsUsd) : '—');
  setText('k-paid-note', paidKnown ? `API bills ${fmt.usd(billedUsd)} + plans ${fmt.usd(subsUsd)}` : 'Add plan fees or connect an account');
  setText('k-energy', fmt.wh(wh));
  setText('k-energy-note', `likely ${fmt.wh(wh * low)} – ${fmt.wh(wh * high)}`);
  setText('k-co2', fmt.co2(co2));
  setText('k-co2-note', `≈ ${fmt.int(co2 / imp.equivalents.gramsCo2ePerCarKm)} km in a petrol car`);
  setText('k-water', fmt.water(water));
  setText('k-water-note', `≈ ${fmt.int(water / 0.25)} glasses of water`);
  document.getElementById('k-energy').title = `≈ ${fmt.int(wh / imp.equivalents.whPerPhoneCharge)} phone charges`;

  renderTakeaway(sel, tokens, cost, wh);
  renderProviders();
  renderDaily(sel);
  renderHbars('categories', sel.rows, (r) => r.category);
  const labels = Object.fromEntries(d.sources.map((s) => [s.id, s.label]));
  renderHbars('apps', sel.rows, (r) => labels[r.source] || r.source);
  renderModels(sel);
  renderProjects(sel);
  renderBilled(sel, subsUsd);
  renderMethod();
}
const setText = (id, t) => { document.getElementById(id).textContent = t; };

function renderTakeaway(sel, tokens, cost, wh) {
  const box = document.getElementById('takeaway');
  box.replaceChildren();
  if (!sel.rows.length) { box.textContent = 'No usage in this range from the sources that are on. Pick a longer range or connect an account below.'; return; }
  const byModel = [...group(sel.rows, (r) => r.model)].map(([m, rs]) => [m, sum(rs, state.metric)]).sort((a, b) => b[1] - a[1]);
  const total = sum(sel.rows, state.metric) || 1;
  const [topModel, topVal] = byModel[0];
  const span = state.days ? `In the last ${state.days} days` : 'Across all recorded history';
  const km = sum(sel.rows, 'co2eGrams') / state.data.impact.equivalents.gramsCo2ePerCarKm;
  box.append(
    `${span} you used `, el('b', {}, fmt.tokens(tokens) + ' tokens'),
    `, led by ${topModel} (${Math.round((topVal / total) * 100)}% of ${metricName[state.metric]}). At API list prices that is `, el('b', {}, fmt.usd(cost)),
    `, using an estimated `, el('b', {}, fmt.wh(wh)), ` of electricity, about as much carbon as driving ${fmt.int(km)} km.`,
  );
}

function renderProviders() {
  const box = document.getElementById('providers');
  box.replaceChildren();
  const byProv = group(state.data.sources, (s) => s.provider);
  for (const p of ORDER) {
    const meta = PROVIDERS[p];
    const card = el('div', { class: 'prov', style: `--c:${meta.color}` },
      el('div', { class: 'prov-head' },
        el('span', { class: 'prov-name' }, meta.name),
        el('span', { class: 'prov-links' }, meta.links.map(([t, href]) => el('a', { href, target: '_blank', rel: 'noopener' }, t + ' ↗')))));
    for (const s of byProv.get(p) || []) {
      const usable = s.status === 'ok' || s.status === 'partial';
      const idc = `src-${s.id}`;
      const msg = s.status === 'not_configured' && s.envKey
        ? el('span', { class: 'src-msg' }, 'Add ', el('code', {}, s.envKey), ' to your .env file. See the README for how to get it.')
        : el('span', { class: 'src-msg' }, s.message || '');
      card.append(el('div', { class: 'src' },
        el('input', {
          type: 'checkbox', id: idc, checked: usable && !state.off.has(s.id), disabled: !usable,
          onchange: (e) => { e.target.checked ? state.off.delete(s.id) : state.off.add(s.id); savePrefs(); render(); },
        }),
        el('label', { for: idc, class: 'src-label' }, s.label, el('span', { class: `pill ${s.status}` }, STATUS_TEXT[s.status] || s.status)),
        msg));
    }
    box.append(card);
  }
  const live = (id) => { const s = state.data.sources.find((x) => x.id === id); return s && (s.status === 'ok' || s.status === 'partial') && !state.off.has(id); };
  const overlaps = [];
  if (live('claude-code') && live('anthropic-api')) overlaps.push('Claude Code');
  if (live('codex') && live('openai-api')) overlaps.push('Codex');
  const warn = document.getElementById('overlap');
  warn.hidden = !overlaps.length;
  warn.textContent = overlaps.length ? `If you run ${overlaps.join(' or ')} with an API key, that usage appears in both the local logs and your account. Turn one of them off to avoid counting it twice.` : '';
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function renderDaily(sel) {
  const box = document.getElementById('daily');
  const legend = document.getElementById('daily-legend');
  box.replaceChildren(); legend.replaceChildren();
  const m = state.metric;
  const days = [];
  for (let d = sel.from; d <= sel.to; d = addDays(d, 1)) days.push(d);
  const byDay = group(sel.rows, (r) => r.day);
  const stacks = days.map((day) => {
    const rs = byDay.get(day) || [];
    return { day, parts: ORDER.map((p) => ({ p, v: sum(rs.filter((r) => r.provider === p), m) })) };
  });
  const maxV = Math.max(0, ...stacks.map((s) => s.parts.reduce((a, b) => a + b.v, 0)));
  const active = sel.rows.length ? ORDER.filter((p) => sel.rows.some((r) => r.provider === p)) : [];
  document.getElementById('daily-note').textContent = `${metricName[m][0].toUpperCase() + metricName[m].slice(1)} per day, stacked by provider.`;
  if (!maxV) { box.append(el('p', { class: 'empty' }, 'Nothing recorded in this range.')); return; }

  const W = Math.max(300, box.clientWidth), H = 260;
  const top = niceMax(maxV);
  const ticks = [0, top / 4, top / 2, (3 * top) / 4, top];
  const labelW = Math.max(...ticks.map((t) => metricFmt[m](t).length)) * 6.6 + 10;
  const M = { l: labelW, r: 8, t: 10, b: 26 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const step = iw / days.length;
  const bw = Math.min(28, Math.max(1, step * 0.72));
  const y = (v) => M.t + ih - (v / top) * ih;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': `Daily ${metricName[m]} chart` });

  for (const t of ticks) {
    svg.append(svgEl('line', { x1: M.l, x2: W - M.r, y1: y(t), y2: y(t), stroke: 'var(--grid)', 'stroke-width': 1 }));
    const tx = svgEl('text', { x: M.l - 8, y: y(t) + 4, 'text-anchor': 'end' }); tx.textContent = metricFmt[m](t); svg.append(tx);
  }
  const every = Math.ceil(days.length / Math.max(2, Math.floor(iw / 70)));
  stacks.forEach((s, i) => {
    const cx = M.l + step * i + step / 2;
    let acc = 0;
    const nonzero = s.parts.filter((pt) => pt.v > 0);
    s.parts.forEach((pt) => {
      if (!pt.v) return;
      const y0 = y(acc), y1 = y(acc + pt.v);
      const isTop = pt === nonzero[nonzero.length - 1];
      svg.append(svgEl('rect', { x: cx - bw / 2, y: y1, width: bw, height: Math.max(0.5, y0 - y1), rx: isTop ? Math.min(3, bw / 2) : 0, fill: PROVIDERS[pt.p].color }));
      acc += pt.v;
    });
    if (i % every === 0) {
      const tx = svgEl('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }); tx.textContent = shortDate(s.day); svg.append(tx);
    }
    const hit = svgEl('rect', { x: M.l + step * i, y: M.t, width: step, height: ih, fill: 'transparent' });
    hit.addEventListener('mousemove', (e) => showTip(e, shortDate(s.day), s.parts.filter((pt) => pt.v).map((pt) => [PROVIDERS[pt.p].name, metricFmt[m](pt.v), PROVIDERS[pt.p].color])));
    hit.addEventListener('mouseleave', hideTip);
    svg.append(hit);
  });
  svg.append(svgEl('line', { x1: M.l, x2: W - M.r, y1: y(0), y2: y(0), stroke: 'var(--line)', 'stroke-width': 1 }));
  box.append(svg);
  for (const p of active) legend.append(el('span', {}, el('span', { class: 'sw', style: `--c:${PROVIDERS[p].color}` }), PROVIDERS[p].name));
}

function renderHbars(id, rows, keyFn) {
  const box = document.getElementById(id);
  box.replaceChildren();
  const m = state.metric;
  const groups = [...group(rows, keyFn)].map(([k, rs]) => ({ k, total: sum(rs, m), parts: ORDER.map((p) => [p, sum(rs.filter((r) => r.provider === p), m)]) }))
    .filter((g) => g.total > 0).sort((a, b) => b.total - a.total);
  if (!groups.length) { box.append(el('p', { class: 'empty' }, 'Nothing recorded in this range.')); return; }
  const max = groups[0].total;
  for (const g of groups) {
    const track = el('div', { class: 'hbar-track', style: `width:${Math.max(2, (g.total / max) * 100)}%` });
    for (const [p, v] of g.parts) if (v) track.append(el('span', { style: `width:${(v / g.total) * 100}%;--c:${PROVIDERS[p].color}` }));
    track.addEventListener('mousemove', (e) => showTip(e, g.k, g.parts.filter(([, v]) => v).map(([p, v]) => [PROVIDERS[p].name, metricFmt[m](v), PROVIDERS[p].color])));
    track.addEventListener('mouseleave', hideTip);
    box.append(el('div', { class: 'hbar' }, el('span', { class: 'hbar-name', title: g.k }, g.k), el('div', {}, track), el('span', { class: 'hbar-val' }, metricFmt[m](g.total))));
  }
}

function sortable(tableId, cols, rows, barKey) {
  const table = document.getElementById(tableId);
  const [key, dir] = state.sort[tableId];
  rows.sort((a, b) => (typeof a[key] === 'string' ? a[key].localeCompare(b[key]) : a[key] - b[key]) * dir);
  const max = Math.max(1e-9, ...rows.map((r) => r[barKey] || 0));
  const head = el('tr', {}, cols.map((c) => el('th', {
    scope: 'col', class: c.cls || false, 'aria-sort': c.key === key ? (dir > 0 ? 'ascending' : 'descending') : 'none',
  }, el('button', { type: 'button', onclick: () => { state.sort[tableId] = [c.key, c.key === key ? -dir : (c.text ? 1 : -1)]; render(); } }, c.label + (c.key === key ? (dir > 0 ? ' ↑' : ' ↓') : '')))));
  const body = rows.map((r) => el('tr', {}, cols.map((c) => el('td', { class: [c.cls, c.name && 'name'].filter(Boolean).join(' ') || false }, c.render ? c.render(r, max) : c.fmt(r[c.key])))));
  table.replaceChildren(el('thead', {}, head), el('tbody', {}, body.length ? body : el('tr', {}, el('td', { colspan: cols.length, class: 'empty' }, 'Nothing recorded in this range.'))));
}

function renderModels(sel) {
  const labels = Object.fromEntries(state.data.sources.map((s) => [s.id, s.label.replace(/ \(.*\)$/, '')]));
  const rows = [...group(sel.rows, (r) => r.model)].map(([model, rs]) => ({
    model, provider: rs[0].provider,
    tool: [...new Set(rs.map((r) => labels[r.source]))].join(', '),
    requests: sum(rs, 'requests'), input: sum(rs, 'input'), cacheWrite: sum(rs, 'cacheWrite'), cacheRead: sum(rs, 'cacheRead'),
    output: sum(rs, 'output'), tokens: sum(rs, 'tokens'), costUsd: sum(rs, 'costUsd'), wh: sum(rs, 'wh'),
    proxy: rs.some((r) => r.rateIsProxy), basis: (state.data.pricing.models[rs[0].rateKey] || {}).basis || 'No rate found',
  }));
  sortable('models', [
    { key: 'model', label: 'Model', text: true, name: true, render: (r) => [el('span', { class: 'dot', style: `--c:${PROVIDERS[r.provider]?.color}` }), r.model] },
    { key: 'tool', label: 'Tool', text: true, cls: 'hide-narrow', fmt: (v) => v },
    { key: 'requests', label: 'Requests', cls: 'hide-narrow', fmt: fmt.int },
    { key: 'input', label: 'Input', fmt: fmt.tokens },
    { key: 'cacheWrite', label: 'Cache write', cls: 'hide-narrow', fmt: fmt.tokens },
    { key: 'cacheRead', label: 'Cache read', fmt: fmt.tokens },
    { key: 'output', label: 'Output', fmt: fmt.tokens },
    { key: 'costUsd', label: 'Est. cost', render: (r, max) => [r.proxy ? el('span', { class: 'proxy-mark', title: r.basis }, '≈ ') : null, fmt.usd(r.costUsd), el('span', { class: 'cellbar hide-narrow', style: `width:${Math.max(2, (r.costUsd / max) * 60)}px;--c:${PROVIDERS[r.provider]?.color}` })] },
    { key: 'wh', label: 'Energy', fmt: fmt.wh },
  ], rows, 'costUsd');
}

function renderProjects(sel) {
  const sessionsBy = group(sel.sessions, (s) => s.project);
  const rows = [...group(sel.rows, (r) => r.project)].map(([project, rs]) => {
    const cats = [...group(rs, (r) => r.category)].map(([c, x]) => [c, sum(x, 'tokens')]).sort((a, b) => b[1] - a[1]);
    return { project, sessions: (sessionsBy.get(project) || []).length, tokens: sum(rs, 'tokens'), costUsd: sum(rs, 'costUsd'), wh: sum(rs, 'wh'), category: cats[0][0] };
  });
  sortable('projects', [
    { key: 'project', label: 'Project', text: true, name: true, fmt: (v) => v },
    { key: 'category', label: 'Main category', text: true, cls: 'hide-narrow', fmt: (v) => v },
    { key: 'sessions', label: 'Sessions', fmt: fmt.int },
    { key: 'tokens', label: 'Tokens', fmt: fmt.tokens },
    { key: 'costUsd', label: 'Est. cost', render: (r, max) => [fmt.usd(r.costUsd), el('span', { class: 'cellbar hide-narrow', style: `width:${Math.max(2, (r.costUsd / max) * 60)}px` })] },
    { key: 'wh', label: 'Energy', fmt: fmt.wh },
  ], rows, 'costUsd');
}

function renderBilled(sel, subsUsd) {
  const box = document.getElementById('billed');
  box.replaceChildren();
  const subs = state.data.subscriptions;
  if (!sel.billed.length && !subs.length) {
    box.append(el('div', { class: 'note' },
      el('p', {}, 'No billing data yet. Two ways to add it:'),
      el('ul', {},
        el('li', {}, 'Connect an API account (Anthropic or OpenAI admin key, or a Google Cloud billing export) to pull what you were actually charged.'),
        el('li', {}, 'List your plans, such as Claude Max or ChatGPT Plus, under ', el('code', {}, 'subscriptions'), ' in ', el('code', {}, 'ledger.config.json'), '. Fees are spread evenly across the days in the range.'))));
    return;
  }
  const rows = [...group(sel.billed, (b) => `${b.provider}\u0000${b.model || b.item}`)].map(([k, bs]) => ({ provider: bs[0].provider, item: k.split('\u0000')[1], usd: sum(bs, 'usd') }));
  for (const s of subs) rows.push({ provider: s.provider, item: `${s.name || 'Plan'} (plan, ${fmt.usd(Number(s.monthlyUsd) || 0)}/month)`, usd: subscriptionCost([s], sel.from, sel.to) });
  rows.sort((a, b) => b.usd - a.usd);
  const t = el('table', { class: 'data' },
    el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Charge'), el('th', { scope: 'col' }, 'Provider'), el('th', { scope: 'col' }, 'Amount'))),
    el('tbody', {}, rows.map((r) => el('tr', {}, el('td', { class: 'name' }, r.item), el('td', {}, PROVIDERS[r.provider]?.name || r.provider), el('td', {}, fmt.usd(r.usd))))));
  box.append(el('div', { class: 'table-wrap' }, t));
}

function renderMethod() {
  const { impact, pricing } = state.data;
  const box = document.getElementById('method');
  const tiers = Object.entries(impact.whPer1kTokens);
  const proxies = Object.entries(pricing.models).filter(([, v]) => /^proxy/i.test(v.basis || ''));
  box.replaceChildren(
    el('div', {},
      el('h3', {}, 'Cash cost'),
      el('p', {}, 'Each request is priced at the provider\'s list API rate for its model: uncached input, cache writes, cache reads and output each at their own rate. For plan users this is what the same work would cost on the API, not what you were charged.'),
      el('p', {}, `Rates last checked ${pricing.checked}. Models without a published price are priced like a comparable model:`),
      el('ul', {}, proxies.map(([k, v]) => el('li', {}, el('code', {}, k), ` – ${v.basis.replace(/^proxy:\s*/i, 'like ')}`)))),
    el('div', {},
      el('h3', {}, 'Energy'),
      el('p', {}, `Energy per 1,000 tokens by model size, then × ${impact.pue} for data-center overhead (PUE). Cache reads cost about a tenth of fresh input.`),
      el('ul', {}, tiers.map(([t, v]) => el('li', {}, `${t[0].toUpperCase() + t.slice(1)}: ${v.input} Wh input, ${v.cached} Wh cached, ${v.output} Wh output`))),
      el('p', {}, `The likely range runs from ${impact.uncertainty.low}× to ${impact.uncertainty.high}× the estimate. Providers don't publish per-model energy, so this is an order-of-magnitude figure.`)),
    el('div', {},
      el('h3', {}, 'Carbon and water'),
      el('p', {}, `Carbon uses ${impact.gridGramsCo2ePerKWh} gCO₂e per kWh, a global grid average. Water uses ${impact.waterLitresPerKWh} L per kWh for cooling and power generation. A petrol car emits about ${impact.equivalents.gramsCo2ePerCarKm} g per km.`),
      el('p', {}, 'Edit data/impact.json or ledger.config.json to use your own factors.')),
    el('div', {},
      el('h3', {}, 'References'),
      el('ul', {}, impact.references.map((r) => el('li', {}, el('a', { href: r.url, target: '_blank', rel: 'noopener' }, r.label))))),
  );
}

// ---------- tooltip ----------
const tip = document.getElementById('tip');
function showTip(e, title, lines) {
  tip.replaceChildren(el('div', { class: 'tip-date' }, title), ...lines.map(([n, v, c]) => el('div', { class: 'tip-row' }, el('span', {}, el('span', { class: 'sw', style: `--c:${c}` }), n), el('span', {}, v))));
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 14, yy = e.clientY + 14;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (yy + r.height > innerHeight - 8) yy = e.clientY - r.height - 14;
  tip.style.left = `${Math.max(8, x)}px`; tip.style.top = `${Math.max(8, yy)}px`;
}
function hideTip() { tip.hidden = true; }

// ---------- boot ----------
async function load(refresh) {
  const btn = document.getElementById('refresh');
  btn.disabled = true; btn.textContent = 'Loading…';
  try {
    const res = await fetch('/api/usage' + (refresh ? '?refresh=1' : ''));
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    state.data = await res.json();
    render();
  } catch (e) {
    document.getElementById('takeaway').textContent = `Couldn't read usage: ${e.message}. Check the terminal running the ledger.`;
  } finally {
    btn.disabled = false; btn.textContent = 'Refresh';
  }
}
document.getElementById('range').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.days = Number(b.dataset.days); savePrefs(); render(); });
document.getElementById('metric').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.metric = b.dataset.metric; savePrefs(); render(); });
document.getElementById('refresh').addEventListener('click', () => load(true));
let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 150); });
load(false);
