// Per-session habit counters. Prompt text is inspected on this machine only to bump these numbers;
// none of it is stored or sent anywhere.
const CORRECTION = /^\s*(no\b|nope|wait\b|stop\b|actually\b|undo\b|revert\b|wrong\b|not what\b|don'?t\b|instead\b)|\b(didn'?t work|doesn'?t work|not working|still (broken|not|failing|wrong)|try again|that'?s (not|wrong)|you (broke|missed|forgot))\b/i;
const REFS = /(```|`[^`]+`|\b[\w./-]+\.(js|ts|tsx|jsx|py|css|html|json|md|cs|go|rs|java|cpp|mjs)\b|[A-Za-z]:\\|\/\w+\/\w+)/i;

export function newStats() {
  return { turns: 0, sig: null, corrections: 0, interrupts: 0, firstLen: 0, firstRefs: false, ctxPeak: 0, lastTs: null };
}

export function noteHuman(st, text, ts) {
  st.turns++;
  if (st.turns === 1) { st.firstLen = text.length; st.firstRefs = REFS.test(text.slice(0, 2000)); st.sig = signature(text); }
  else if (CORRECTION.test(text.slice(0, 400))) st.corrections++;
  if (ts) st.lastTs = ts;
}

// A short fingerprint of how a session opened, so repeated requests can be counted without keeping the text.
function signature(text) {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 6);
  if (words.length < 4) return null;
  let h = 5381;
  for (const ch of words.join(' ')) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

export function noteContext(st, tokens) {
  if (tokens > st.ctxPeak) st.ctxPeak = tokens;
}

export function finishStats(st, startTs) {
  const span = st.lastTs && startTs ? Math.max(0, (Date.parse(st.lastTs) - Date.parse(startTs)) / 60000) : 0;
  const { lastTs, ...rest } = st;
  return { ...rest, spanMin: Math.round(span) };
}
