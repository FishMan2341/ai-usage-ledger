# AI Usage Ledger

A local dashboard that shows how much you use Claude, Codex and Gemini: tokens by category, model, tool and project. It also estimates what that usage costs in money, energy, carbon and water.

It runs on your own machine. Your API keys and prompts never leave it.

## Why

If you use AI coding agents every day, your usage is spread across three companies, two billing models and several dashboards that each show a different slice. A flat-rate plan also hides what your usage would cost at API prices, and no provider shows what it costs in electricity.

The ledger puts all of it on one page so you can answer:

- **How much am I using, and on what?** Tokens by model, by tool (Claude Code, Codex, Gemini CLI, API) and by project folder. Each session is also sorted into a kind of work: coding, web and design, writing, games, research or questions.
- **Is my plan worth it?** API-equivalent cost next to what you actually paid in plan fees and API bills.
- **Which habits drive cost?** In agentic coding, cache reads of long contexts usually dominate. The model table splits input, cache writes, cache reads and output so you can see it.
- **What's the footprint?** Estimated energy, carbon and water, with a low–high range and everyday comparisons.

It's for individual developers on Claude, ChatGPT or Gemini plans, and for small teams that pay for API usage and want one view across providers.

## What you get

- **Totals:** tokens, API-equivalent cost, what you actually paid, energy, CO₂e and water for 7, 30 or 90 days, or all time.
- **Daily chart:** stacked by provider, switchable between tokens, cost and energy.
- **Breakdowns:** by category and by tool as bars; by model and by project as sortable tables.
- **Account status:** each source shows whether it's connected, with links to each provider's own usage pages and a checkbox to leave it out.
- **Methodology:** every rate and factor, the models priced by proxy, and links to references.
- **CLI:** `status` to check connections and `json` to export everything for your own analysis.

## Install with an agent

Tell Claude Code, Codex or any coding agent:

> Install https://github.com/FishMan2341/ai-usage-ledger and run it.

The repo's `AGENTS.md` tells the agent what to do: check Node, run `npx --yes github:FishMan2341/ai-usage-ledger setup`, and report what was detected. Setup needs no keys, plans or paths.

## Quick start

```bash
npx github:FishMan2341/ai-usage-ledger --open
```

Or clone the repo and run `npm start`. You need Node 18.17 or newer. Node 22.15+ can also read Codex's compressed session archives. There are no dependencies and no build step. It's plain JavaScript that Node runs directly.

With no setup at all, it reads the local logs of any coding agents you've used. Add admin keys to include API usage and billing.

## Value left on the table

The home page answers a different question from the full breakdown: how much of your plan are you not using, and what could you run to use it.

- **Chart:** the last 7 days, one line per provider plus a total line, in API-equivalent dollars or tokens.
- **Value left on the table:** your average weekly use over the last 4 weeks against your plan's estimated weekly capacity.
- **Suggestions:** overnight and off-hours jobs (tests, audits, docs, research briefs, drafts, design variations), picked from your top categories, your busiest project, and the hours your machine sits idle. They need no input and are rebuilt on every refresh, so they follow your current work. Each comes with a ready-to-run command (`claude -p`, `codex exec` or `gemini -p`) and a scheduling step for your OS.
- **Sources:** providers are detected automatically and left out of the chart, rings and suggestions when there is no usage. Each can be rescanned on its own, and if something isn't found you can point at its log folder or paste an API key (saved to `~/.ai-usage-ledger/.env`, never sent back to the page).
- **Tune the estimate (optional):** plan overrides, how often you hit limits, whether your computer is on overnight. Plans are detected from your Claude Code sign-in and Codex logs, so most people never touch it. Answers are saved in `~/.ai-usage-ledger/profile.json`.

**Measured limits (Codex).** Codex writes how full each rate-limit window was into its session logs. The ledger divides what it priced in a weekly window by the reported percentage to get your plan's real capacity, takes the median of recent weeks, and shows the plan's current percentage and reset time. Rings marked *Measured* use this. Other providers don't log this, so they fall back to the estimate below.

**Habits and tips.** On first launch, and whenever your habits change, the top of the page shows what the ledger noticed in how you work, with evidence and a trend against the two weeks before. Tips are rules over your own recent sessions, not a fixed list: they appear, change and disappear as your numbers move, and improvements are called out. From the same data it writes a short working-agreement prompt for `CLAUDE.md`, `AGENTS.md` or `GEMINI.md`, regenerated as habits shift. Prompts are read on your machine only to bump counters (opener length, how many follow-ups were corrections, interruptions, context size). The text is never stored or sent. To add a rule, add an entry to `RULES` in `src/habits.js`.

Providers don't publish plan limits as token counts, so where nothing is measured, capacity is an estimate: ten times the monthly fee in API-equivalent dollars, or your best week if that is higher. If you hit limits often, your best week is used as the ceiling. You can set a weekly figure yourself under Advanced. The old dashboard is at `/details.html`.

## What it reads

Each provider exposes usage differently, so the ledger combines two kinds of source.

| Provider | Your account (API billing) | Your plan (subscription) |
| --- | --- | --- |
| **Claude** | Anthropic Usage and Cost Admin API | Claude Code logs in `~/.claude/projects` |
| **Codex / OpenAI** | OpenAI Usage and Costs API | Codex logs in `~/.codex/sessions` |
| **Gemini** | Google Cloud Billing export in BigQuery | Gemini CLI logs in `~/.gemini/tmp` |

Claude Pro/Max, ChatGPT Plus/Pro and Gemini app plans have **no public usage API**. Their usage only shows up here when it comes from a coding agent that writes logs on your machine (Claude Code, Codex, Gemini CLI). Chats in claude.ai, chatgpt.com or the Gemini app are not counted. Each provider's own usage page is linked from the dashboard.

## Connect your accounts

Copy `.env.example` to `.env`, either in the folder you run from or in `~/.ai-usage-ledger/.env`. Then fill in whichever accounts you have. Every source is optional.

### Anthropic

1. In the [Claude Console](https://platform.claude.com/settings/admin-keys), create an **Admin key** (`sk-ant-admin01-…`). Only organization admins can do this.
2. Set `ANTHROPIC_ADMIN_KEY=sk-ant-admin01-…`.

This pulls daily tokens by model from `/v1/organizations/usage_report/messages` and billed cost from `/v1/organizations/cost_report`. Claude Enterprise organizations use a different Analytics API, which isn't supported yet.

### OpenAI

1. In [OpenAI organization settings → Admin keys](https://platform.openai.com/settings/organization/admin-keys), create an **Admin key** (`sk-admin-…`). Only organization owners can do this.
2. Set `OPENAI_ADMIN_KEY=sk-admin-…`.

This pulls daily tokens by model from `/v1/organization/usage/completions` and billed cost from `/v1/organization/costs`.

### Google (Gemini API)

Google has no usage endpoint for Gemini API keys. Use the Cloud Billing export instead:

1. [Export Cloud Billing data to BigQuery](https://cloud.google.com/billing/docs/how-to/export-data-bigquery-setup) (standard usage cost export) for the billing account behind your Gemini API key.
2. Set `GOOGLE_BILLING_TABLE=project.dataset.gcp_billing_export_v1_XXXXXX`. Set `GOOGLE_PROJECT_ID` too if queries should run in a different project.
3. Sign in with `gcloud auth login`, or set `GOOGLE_ACCESS_TOKEN`.

The ledger reads Gemini and Vertex AI SKUs, then works out the model and token type from each SKU name. Rows billed per character or per image add to cost but not to token totals.

### Plans you pay for

To see what you actually paid, list your subscriptions in `ledger.config.json` (see `ledger.config.example.json`):

```json
{
  "subscriptions": [
    { "provider": "anthropic", "name": "Claude Max", "monthlyUsd": 100, "since": "2026-06-01" },
    { "provider": "openai", "name": "ChatGPT Plus", "monthlyUsd": 20 }
  ]
}
```

## Commands

```bash
npx github:FishMan2341/ai-usage-ledger            # start the dashboard on http://localhost:4317
npx github:FishMan2341/ai-usage-ledger --open     # and open it in your browser
npx github:FishMan2341/ai-usage-ledger status     # check which sources are connected
npx github:FishMan2341/ai-usage-ledger json       # print everything as JSON
```

Options: `--port 4317` and `--days 90`, which sets how far back account APIs are queried. Environment variables `PORT` and `LEDGER_DAYS` do the same.

## How the estimates work

**Cash cost.** Every request is priced at the model's list API rate. Uncached input, cache writes, cache reads and output each have their own rate. For plan users, this is what the same work would have cost on the API, not what you were charged. The **Actually paid** figure comes from your accounts' cost reports plus the plan fees you list. Rates live in [`data/pricing.json`](data/pricing.json). When a model has no published price, it's priced like a comparable model and marked ≈ in the dashboard.

**Energy.** Each token is charged a Wh-per-1,000-tokens figure for its model size (frontier, mid or small), separately for input, cached input and output. That's multiplied by data-center overhead (PUE 1.2). The dashboard shows a range from 0.3× to 3× the estimate. Providers don't publish per-model energy, so treat it as an order of magnitude.

**Carbon and water.** kWh × 370 gCO₂e/kWh (global grid average) and × 1.9 L/kWh (cooling plus power generation).

All of these factors are in [`data/impact.json`](data/impact.json), with references. Override them in `ledger.config.json` under `impact`.

**Categories.** Each session gets a category from keywords in its opening request, matched on your machine. The prompt text is never stored or sent anywhere. API usage has no prompt text, so it shows as *API (no prompt data)*.

## Avoiding double counting

If you run Claude Code or Codex with an **API key** instead of a plan, the same requests appear in both the local logs and your account report. The dashboard warns you when both are on; turn one off with its checkbox. To turn a source off permanently, add it to `"disabledSources"` in `ledger.config.json`.

## Privacy

- The server listens on `127.0.0.1` only.
- Keys are read from your environment and used only for requests to the provider's own API.
- Prompt text is read only to pick a category. It is never stored, displayed or sent anywhere.

## Contributing

Each source is one file in [`src/sources/`](src/sources) that exports `read()` and returns `{ rows, billed, sessions, status, message }`. Rows use one shape: `provider, source, day, model, category, project, requests, input, cacheWrite, cacheRead, output`. Price corrections to `data/pricing.json` are welcome; include a link to the price page.

```bash
npm test
```

## License

MIT
