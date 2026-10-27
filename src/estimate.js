// Turns token rows into API-equivalent dollars and estimated energy, carbon and water.
export function normalizeModel(model) {
  return String(model || '').toLowerCase().replace(/\[.*\]$/, '').replace(/-\d{8}$/, '').replace(/@.*$/, '');
}

export function findRate(model, provider, pricing) {
  const m = normalizeModel(model);
  let best = null;
  for (const key of Object.keys(pricing.models)) {
    if (m.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  if (best) return { key: best, ...pricing.models[best], matched: true };
  const fb = pricing.fallback[provider];
  return fb ? { key: fb, ...pricing.models[fb], matched: false } : null;
}

export function estimateRow(row, pricing, impact) {
  const rate = findRate(row.model, row.provider, pricing);
  const M = 1e6;
  const costUsd = rate
    ? (row.input * rate.input + row.cacheWrite * rate.cacheWrite + row.cacheRead * rate.cacheRead + row.output * rate.output) / M
    : 0;
  const tier = impact.whPer1kTokens[rate?.tier || 'mid'];
  const wh = ((row.input + row.cacheWrite) * tier.input + row.cacheRead * tier.cached + row.output * tier.output) / 1000 * impact.pue;
  return {
    ...row,
    tokens: row.input + row.cacheWrite + row.cacheRead + row.output,
    costUsd,
    rateKey: rate?.key || null,
    rateMatched: !!rate?.matched,
    rateIsProxy: !rate || !rate.matched || /^proxy/i.test(rate.basis || ''),
    wh,
    co2eGrams: (wh / 1000) * impact.gridGramsCo2ePerKWh,
    waterLitres: (wh / 1000) * impact.waterLitresPerKWh,
  };
}
