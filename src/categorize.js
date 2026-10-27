// Assigns a session to a task category from its opening request.
// Runs locally; prompt text never leaves the machine and is not stored in the output.
const RULES = [
  ['Writing', /\b(essay|paper|draft|rewrite|proofread|cover letter|resume|email|blog|article|story|voice|docx|word doc|thesis)\b/i],
  ['Games', /\b(game|level|player|sprite|unity|godot|gameplay)\b/i],
  ['Web & design', /\b(website|landing|web ?page|homepage|css|tailwind|ui|ux|design|hero|layout|figma|animation|3d|three\.?js|spline|blender|video|logo)\b/i],
  ['Data & research', /\b(research|analy[sz]e|compare|dashboard|chart|data|spreadsheet|csv|report|summari[sz]e|statistics)\b/i],
  ['Coding & debugging', /\b(fix|bug|error|debug|code|script|function|api|test|build|implement|refactor|deploy|install|repo|app|server|database|python|javascript|typescript|node)\b/i],
  ['Questions & learning', /\b(explain|what is|how do|why does|teach|learn|help me understand)\b|\?$/i],
];

export function categorize(text) {
  if (!text) return 'Other';
  const sample = String(text).slice(0, 2000);
  for (const [name, re] of RULES) if (re.test(sample)) return name;
  return 'Other';
}

export const CATEGORIES = [...RULES.map(([n]) => n), 'Other', 'API (no prompt data)'];

// Skips harness-injected blocks (system reminders, command wrappers) to find what the person typed.
export function isHumanText(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  return t.length > 0 && !/^(<|Caveat:|\[Request interrupted|# AGENTS\.md|# CLAUDE\.md|# GEMINI\.md)/.test(t);
}
