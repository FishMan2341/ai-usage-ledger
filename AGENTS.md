# AI Usage Ledger: notes for coding agents

## If the user asks you to install this

It needs Node 18.17 or newer and nothing else. No dependencies, no build step, no accounts, no keys.

1. Check `node --version`. If it is older than 18.17, tell the user and stop.
2. Run one of these, from any folder:
   - `npx --yes github:FishMan2341/ai-usage-ledger setup`
   - or clone the repo, then `node bin/cli.js setup`
3. `setup` detects Claude Code, Codex and Gemini CLI logs and the user's plans, prints what it found, starts the dashboard at http://localhost:4317 and opens it. Pass `--port` if 4317 is taken.
4. Tell the user what was detected and where to look. Do not ask them for API keys, plans or paths: everything is optional and can be added later from the dashboard (Sources and Tune the estimate).

Do not set up autostart, edit shell profiles or add scheduled tasks unless the user asks. Do not read or print anything from `~/.claude/.credentials.json`, `~/.codex/auth.json` or any file holding tokens: the tool never needs them.

## Working on the code

- `npm test` runs everything (Node's built-in test runner).
- `src/sources/*.js`: one reader per provider, each exporting `read()`.
- `src/analysis.js`: plan headroom and overnight suggestions. `src/habits.js`: tips and the working-agreement prompt. Both are rules over the user's recent sessions, so keep them data-driven rather than fixed lists.
- `public/home.js` is the dashboard, written with DOM helpers (`el`, `svgEl`). Never build HTML from strings: use `textContent`.
- Prompt text is read on the user's machine only to bump counters (`src/stats.js`) and is never stored, logged or sent.
