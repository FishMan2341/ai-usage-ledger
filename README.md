# AI Usage Ledger

**Get the most out of your AI subscriptions.** A local dashboard for developers on Claude, ChatGPT/Codex and Gemini plans. It reads the logs your coding agents already write, works out how much of each plan you actually use, and suggests what to run with the capacity you're leaving on the table.

It runs on your machine. Nothing is uploaded, and it needs no account, no keys and no setup to start.

## Why

Flat-rate plans reward people who use them fully and quietly waste money for everyone else. Limits reset every week whether you used them or not, and no provider shows you how much of your plan went unused. The usage that does show up is scattered across three companies' dashboards.

The ledger answers three questions in one place:

- **How much of my plan am I using?** Average weekly use against your plan's capacity, per provider, in API-equivalent dollars.
- **What am I leaving unused?** One number for the week, and what it adds up to over a month.
- **What should I run with it?** Overnight and off-hours jobs picked from your own recent work, plus tips and a tailored instruction file based on how you actually work.

It is for individual developers using Claude Code, Codex or Gemini CLI on a subscription, and for anyone who also pays for API usage and wants one view. A fuller cost, energy and footprint breakdown is on a second page.

## What you get

- **Unused capacity, up front.** A large weekly figure and a ring gauge per provider, showing percent of capacity used and dollars unused.
- **A 7-day chart.** One line per provider plus a total line, switchable between API-equivalent dollars and tokens. Click a legend pill to hide a line.
- **Suggestions that follow your work.** Up to three overnight jobs (tests, audits, docs refresh, refactors, research briefs, batch drafts, design variations) chosen from what you worked on lately, each with a ready-to-run command and scheduling steps for your OS. They are rebuilt on every refresh with no input from you.
- **Habit tips.** On first launch, and whenever your habits shift, a panel shows what the ledger noticed in your sessions, with evidence and a trend against the previous two weeks. Improvements are called out too.
- **A working-agreement prompt.** A short instruction file for `CLAUDE.md`, `AGENTS.md` or `GEMINI.md`, written from your habits and regenerated as they change.
- **Automatic detection.** Providers and plans are detected on their own. A provider with no usage is left out of the chart, rings and suggestions entirely.
- **Sources panel.** Rescan any provider, point at a log folder if yours isn't in the usual place, or paste an API key.
- **Full breakdown** (`/details.html`). Tokens, API-equivalent cost, what you paid, and estimated energy, carbon and water, by category, tool, model and project.

## Install

### With an agent

Tell Claude Code, Codex or any coding agent:

> Install https://github.com/FishMan2341/ai-usage-ledger and run it.

The repo's `AGENTS.md` tells it what to do: check Node, run the setup command below, and report what was detected. Setup asks for no keys, plans or paths.

### Yourself

You need Node 18.17 or newer. There are no dependencies and no build step.

```bash
npx --yes github:FishMan2341/ai-usage-ledger setup
```

`setup` detects your logs and plans, prints what it found, starts the dashboard at http://localhost:4317 and opens it. Or clone the repo and run `node bin/cli.js setup`.

## How "unused capacity" is worked out

Providers don't publish plan limits as token counts, so the ledger measures where it can and estimates where it can't. Everything is in **API-equivalent dollars**: what your usage would cost at list API prices.

| Provider | Capacity comes from |
| --- | --- |
| **Codex / OpenAI** | **Measured.** Codex logs how full each limit window was. The ledger divides what it priced in a weekly window by the reported percentage, takes the median over recent weeks, and also shows your current percentage and reset time. The ring is marked *Measured*. |
| **Claude, Gemini** | **Estimated.** Ten times the monthly plan fee, or your best week so far if that is higher. If you say you hit limits often, your best week is used as the ceiling. |

You can override capacity per provider under **Tune the estimate**.

Limits of this approach, so you can judge the numbers:

- The ten-times figure is a rule of thumb, not a published limit. Treat Claude and Gemini headroom as a guide.
- Measured Codex capacity needs at least one weekly window where you reached 15% or more, and it can come out low if you also use Codex on other devices or in the cloud, since those aren't in your local logs.
- Plan usage from chats in claude.ai, chatgpt.com or the Gemini app isn't visible. There is no public API for it.
- **Unused** is average weekly use over the last four weeks subtracted from capacity. A quiet recent month raises it.

Your plan is detected automatically: Claude from the Claude Code sign-in record (`~/.claude.json`, plan fields only) and OpenAI from the plan type Codex logs. Gemini plans can't be detected, so choose one if you want Gemini included.

## Suggestions

Each job is scored from your category mix over the last 30 days (the last two weeks count double), your habit tips and your busiest project. The best three are shown for the provider with the most room.

Each suggestion includes:

- a command for that provider's CLI (`claude -p`, `codex exec` or `gemini -p`) with a prompt written to work on a branch or read-only;
- scheduling steps for your OS (Task Scheduler on Windows, `crontab` elsewhere, or a cloud routine if you said your computer is off overnight);
- the hour to start, taken from the quiet window found in your own activity.

These are templates. The paths are placeholders to fill in, and an unattended agent can change files, so run them on a branch and review the output before merging. Nothing is scheduled for you.

Other suggestions appear when the data calls for them: shifting routine work to a provider with spare room, capturing a request you keep repeating, or using days you skipped.

## Habits and the working-agreement prompt

For each local session the ledger keeps a few counters: opener length, whether it named a file or code, follow-up messages that look like corrections, interruptions, peak context size, session length, and a short fingerprint of how it opened (to spot repeats). From these it builds tips such as giving the first message more context, asking for a plan first, starting fresh when contexts grow large, or using a lighter model for quick questions.

Tips are rules over your own last 14 days compared with the 14 before, not a fixed list. They appear, change and disappear as your numbers move, new ones are badged, and the prompt shows an *Updated* badge when it changes. To add a rule, add an entry to `RULES` in `src/habits.js`.

Habit analysis uses Claude Code and Codex sessions. Gemini CLI sessions count toward usage but not habits yet.

## What it reads

| Provider | Your plan (subscription), from local logs | Your account (API billing) |
| --- | --- | --- |
| **Claude** | Claude Code logs in `~/.claude/projects` | Anthropic Usage and Cost Admin API |
| **Codex / OpenAI** | Codex logs in `~/.codex/sessions` | OpenAI Usage and Costs API |
| **Gemini** | Gemini CLI logs in `~/.gemini/tmp` | Google Cloud Billing export in BigQuery |

Pro/Max, Plus/Pro and Gemini app plans have no public usage API, so plan usage only shows up when it comes from a coding agent that writes logs on your machine. Node 22.15+ is needed to read Codex's compressed session archives; older versions skip them and say so.

## Connect an API account (optional)

API accounts only matter if you also pay per use. Add a key from the **Sources** panel, or copy `.env.example` to `.env` (in the folder you run from, or in `~/.ai-usage-ledger/.env`). Every source is optional.

### Anthropic

1. In the [Claude Console](https://platform.claude.com/settings/admin-keys), create an **Admin key** (`sk-ant-admin01-…`). Only organization admins can do this.
2. Set `ANTHROPIC_ADMIN_KEY`.

This pulls daily tokens by model from `/v1/organizations/usage_report/messages` and billed cost from `/v1/organizations/cost_report`. Claude Enterprise organizations use a different Analytics API, which isn't supported yet.

### OpenAI

1. In [OpenAI organization settings → Admin keys](https://platform.openai.com/settings/organization/admin-keys), create an **Admin key** (`sk-admin-…`). Only organization owners can do this.
2. Set `OPENAI_ADMIN_KEY`.

This pulls daily tokens by model from `/v1/organization/usage/completions` and billed cost from `/v1/organization/costs`.

### Google (Gemini API)

Google has no usage endpoint for Gemini API keys, so the ledger reads the Cloud Billing export:

1. [Export Cloud Billing data to BigQuery](https://cloud.google.com/billing/docs/how-to/export-data-bigquery-setup) (standard usage cost export) for the billing account behind your Gemini API key.
2. Set `GOOGLE_BILLING_TABLE=project.dataset.gcp_billing_export_v1_XXXXXX`, and `GOOGLE_PROJECT_ID` if queries should run in a different project.
3. Sign in with `gcloud auth login`, or set `GOOGLE_ACCESS_TOKEN`.

Gemini and Vertex AI SKUs are read, and the model and token type come from each SKU name. Rows billed per character or per image add to cost but not to token totals.

### Avoiding double counting

If you run Claude Code or Codex with an **API key** instead of a plan, the same requests appear in both the local logs and your account report. The full breakdown warns you when both are on and lets you turn one off. To turn a source off permanently, add its id to `"disabledSources"` in `ledger.config.json`.

## Configuration

Everything is optional.

| File | What it holds |
| --- | --- |
| `~/.ai-usage-ledger/profile.json` | Answers from the dashboard: plan overrides, limit pressure, overnight availability, research topics, custom log folders, and what tips you've already seen. |
| `~/.ai-usage-ledger/.env` | API keys added from the dashboard (written with owner-only permissions where the OS supports it). |
| `ledger.config.json` (in the folder you run from, or `~/.ai-usage-ledger/config.json`) | `subscriptions` (plan fees, for the "actually paid" figure in the full breakdown), `disabledSources`, `pricing` and `impact` overrides, `days`, `port`. See `ledger.config.example.json`. |

Environment variables: `PORT`, `LEDGER_DAYS`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME`.

## Commands

```bash
npx github:FishMan2341/ai-usage-ledger setup     # detect everything, start the dashboard, open it
npx github:FishMan2341/ai-usage-ledger           # start the dashboard on http://localhost:4317
npx github:FishMan2341/ai-usage-ledger --open    # same, and open the browser
npx github:FishMan2341/ai-usage-ledger status    # show which sources were found
npx github:FishMan2341/ai-usage-ledger json      # print everything as JSON
```

Options: `--port 4317` and `--days 90` (how far back account APIs are queried). The dashboard refreshes itself every ten minutes while it's open.

## The full breakdown

`/details.html` keeps the original cost-and-footprint view: totals for 7, 30, 90 days or all time, a stacked daily chart, breakdowns by category, tool, model and project, and what your accounts were billed.

- **Cash cost.** Every request is priced at the model's list API rate, with separate rates for uncached input, cache writes, cache reads and output. For plan users this is what the same work would have cost on the API, not what you were charged. Rates are in [`data/pricing.json`](data/pricing.json); a model with no published price is priced like a comparable one and marked ≈.
- **Energy, carbon, water.** Wh per 1,000 tokens by model size, times data-center overhead (PUE 1.2), shown as a 0.3× to 3× range, then 370 gCO₂e/kWh and 1.9 L/kWh. Providers don't publish per-model energy, so treat it as an order of magnitude. Factors and references are in [`data/impact.json`](data/impact.json).
- **Categories.** A session's category is chosen from keywords in its opening request, on your machine. API usage has no prompt text and shows as *API (no prompt data)*.

## Privacy and security

- The server listens on `127.0.0.1` only, answers only `localhost` host names, and refuses writes from other websites.
- Prompt text is read on your machine to pick a category and to update the habit counters above. It is not stored, displayed or sent anywhere. Only the counters and a short hash of how a session opened are kept, in memory.
- Keys are used only for requests to the provider's own API. Keys added from the dashboard are saved to `~/.ai-usage-ledger/.env` and are never returned to the page.
- The ledger reads the plan fields of `~/.claude.json` and nothing else from it. It never reads credential or token files.

## Troubleshooting

- **A provider is missing.** Open **Sources**, press **Rescan**, or use **Add manually** to point at its log folder.
- **Everything shows as unused for a provider you do use.** Plan usage from chat apps isn't visible. Only coding-agent logs on this machine count.
- **No plan detected.** Choose it under **Tune the estimate**.
- **Port 4317 is in use.** Run with `--port 4318`.

## Contributing

Each source is one file in [`src/sources/`](src/sources) that exports `read()` and returns `{ rows, billed, sessions, status, message }`. Rows use one shape: `provider, source, day, hour, model, category, project, requests, input, cacheWrite, cacheRead, output`. Sessions can carry a `stats` object (see `src/stats.js`) to feed habit tips. Price corrections to `data/pricing.json` are welcome; include a link to the price page. See `AGENTS.md` for conventions.

```bash
npm test
```

## License

MIT
