# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Product goals, the owner's decisions and working preferences, and open items are in `docs/HANDOFF.md`. Read it at the start of a session.


InvestHepi: a Next.js 15 (App Router, React 19, TypeScript) market-news site deployed on Vercel Hobby. It pulls headlines and prices, has an LLM write a briefing per section (summary, trend, events, movers, scenarios), runs a separate prediction job that makes buy/hold/wait calls twice a weekday per market, and grades those calls at each market's close. Sections are `interests` (per user), `world`, `us`, `vn` (Vietnam). Everything is designed to run on free tiers (Groq/Gemini, Upstash Redis, GitHub Actions), and that constraint drives much of the architecture.

## Project at a glance (Nov 17 2026, v18)

- **Goal:** catch up on market news fast and act on it, on free tiers only; Vietnamese readers matter most.
- **Three jobs:** briefings (explain, no calls; Gemini Flash-Lite first), predictions (graded buy / hold / wait calls, two runs per market per weekday in local time; gpt-oss-120b first), and the track record (grades each call at its market's close, within the hour, then re-checked against the official close; feeds the record back into the prediction prompt).
- **Non-negotiables:** every prediction uses the latest data or says "unavailable"; every number the AI writes must trace to the data it was given (inputs are stored for audits); one timetable; every time labeled with its zone; free-tier budgets counted for every change.
- **Workflow:** HANDOFF first, questions as one numbered list, plan, "go", build, stress test on real data, docs, ask before merging, then scheduled check-ins (never waits) for deploys, closes and ticks.
- The owner's decisions, session summaries and open items are in `docs/HANDOFF.md`. How the code works (pipeline, LLM routing, predictions, track record, prices, scheduling, frontend) and which test suite covers what are in `docs/ARCHITECTURE.md`: read the section for an area before changing it.

## Commands

```bash
npm run dev                    # http://localhost:3000, data in .data/ as JSON
npm run build                  # must pass with AND without the AUTH_* env vars
npm run typecheck              # tsc --noEmit (there is no linter)
npm test                       # all offline suites, chained with &&
npx tsx scripts/vntest.ts      # run one suite (each script is standalone)
npm run refresh -- world       # run the pipeline once from the terminal
```

Tests are plain `tsx` scripts using `node:assert`, not a framework. They mock `globalThis.fetch` (no network), set env vars at the top, then dynamically `import()` modules and route handlers and call `GET/PUT/POST` directly with `Request` objects. A suite prints `<NAME> OK` on success. New suites must be added to the `test` script in `package.json`.

Gotcha: the store is `.data/` locally and `/tmp/invest-helper` when `VERCEL` is set. Caches persist between runs (e.g. `market:*` for 10 min, `px:last`, `vnlist`), so tests that need a clean store set `VERCEL=1` and `rm -rf /tmp/invest-helper` first. Stale `.data/` can make a test fail for reasons unrelated to the code, and some suites (v4btest) delete `.data/`, so re-seed before manual browser checks.

Price-layer modules keep in-memory state (Yahoo cooldown, chart/live caches); tests reset it with `resetYahoo()` and `clearPriceCaches()`. Test fetch mocks must handle Yahoo's batch endpoint (`/v8/finance/spark?symbols=A,B`, flat JSON keyed by symbol) as well as `/v8/finance/chart/`.

Local browser checks: run the production build (`npm run build` then `npx next start -p <port>`); stop it with `pkill -f next-server` (the process isn't named "next start", so an old server can keep the port and serve stale HTML whose chunks 404). Seed data with `npx tsx scripts/selftest.ts` (writes `.data/`). Signed-in views: build with the `AUTH_*` vars, start with `E2E_FAKE_AUTH=1 OWNER_EMAIL=...`, and send `x-test-user: <email>` from Playwright (`extraHTTPHeaders`). The theme is stored JSON-encoded: `localStorage.setItem('ih-theme', JSON.stringify('dark'))`. Freeze time with Playwright's `context.clock.setFixedTime` for repeatable screenshots.

For live checks against real APIs from a cloud sandbox, Node's built-in fetch ignores `HTTPS_PROXY` unless run with `NODE_USE_ENV_PROXY=1`. Don't hammer Yahoo while testing: it rate-limits the IP for minutes.

`scripts/i18ntest.ts` enforces that every key in `src/lib/i18n/en.ts` exists in all 8 language files under `src/lib/i18n/` (en, vi, zh, ja, ko, es, fr, de). Any new UI string needs all 8.

`.env.example` lists every environment variable the code reads, with its default; `v14test` fails if code reads one that isn't listed.

Which test suite covers what, and where a round's regression tests go: see "Test suites" in `docs/ARCHITECTURE.md`.

## Code map

| Where | What |
|---|---|
| `src/lib/interests.ts` | who follows what: interests and settings per user, `interestHash`, the sets the scheduler refreshes |
| `src/lib/briefings.ts` | stored briefings: key layout, reading (translated, rule-based copy, history), saving |
| `src/lib/predictions.ts`, `predictions-view.ts` | the prediction job: one market per run, storage `pred:<scope>`, translation, reading (`-view` is the browser-safe part) |
| `src/lib/markets.ts` | exchange clocks (open/close per zone, `dailyTarget`, `nthWeekday`, `zonedToUtc`) and the prediction markets |
| `src/lib/headlines.ts` | live headline lists (`news:<section>`, `news:ib:<hash>`), refreshed by the tick with no AI |
| `src/lib/zones.ts` | the reader's time zone setting and how times are labeled |
| `src/lib/pipeline.ts` | building a briefing (`coverage`, market data, `buildDigest`) and refreshing one |
| `src/lib/timetable.ts`, `scheduler.ts` | when refreshes happen, and the tick that runs them |
| `src/lib/llm/` | prompts, model routing and budgets, schema, rule-based fallback; `predict.ts` is the prediction prompt and schema |
| `src/lib/market.ts`, `chart.ts`, `yahoo.ts`, `vnmarket.ts`, `worldmarket.ts` | prices (see Prices in `docs/ARCHITECTURE.md`) |
| `src/lib/dates.ts` | `dayIn(timeZone, at)`: calendar dates in a zone; use it instead of a new `Intl` formatter |
| `src/lib/i18n/` | UI strings, one file per language (`en.ts` defines the keys) |
| `src/app/page.tsx` | the single page: loads data, wires actions, lays out a section; its state lives in `components/shell/hooks.ts` (one hook per concern), the frame (top bar, sidebar, tab bar) in `shell/chrome.tsx`, the strip logic in `shell/strip.ts` |
| `src/lib/track.ts` | the track record: recording, grading, stats, calibration, the prompt text |
| `src/components/` | `sections` (briefing parts), `predictions` (the Predictions card), `sheets` (settings, track, ticker, history), `live` (live prices), `cards` (chart, heatmap, scenarios, mood), `catchup`, `portfolio`, `track`, `alerts-tab`, `palette`, `setup`, `toast`, `ask`, `search`, `primitives` |

## Conventions

- UI copy is plain and direct; the AI is told the same (no hype, specific risks, calibrated confidence).
- The AI only ever sees holding weights and gain %, never amounts (`positionsAsText`).
- Interests: the first ticker is the benchmark used for the outlook and the track record.

## Working with the owner

The owner's general working habits are in the `how-i-work` and `how-i-think` skills in their account. In short: read `docs/HANDOFF.md` and restate the goal and the rules that apply; ask every question in one numbered list with lettered options and a recommendation (the owner answers "1 B, 2 yes"); give a plan (steps, files and services, tests, AI and free-tier cost, risks, what needs the owner) and wait for "go"; then build without check-ins and say so if the plan changes; push back on ideas and give one recommendation. "Use all of the token" means: keep working through the whole task list without stopping for approval. If those skills aren't loaded, follow this paragraph. Where a rule in this file differs from those skills, this file wins.

In this repo, always ask the question list before a round, even when the task looks clear, and cover models, schedule and UX as well as scope, behavior, edge cases, limits and what "done" looks like.

**Stress testing** ("stress test", "test every detail", "to the last minute")
- Test each goal end to end against real data from the cloud sandbox (`NODE_USE_ENV_PROXY=1`), not only the offline mocks. Go easy on rate-limited sources.
- Prices, charts and timing must agree everywhere. Compare the strip, the chart sheet and the briefing for the same symbol: level, % change, chip and sparkline color, session date, exchange time zone, and stale/estimate/proxy labels.
- Audit at least one real AI briefing line by line. Every level, %, date and reason must trace back to the data the model was given. An invented fact is a bug: fix it with a prompt rule and a code guard (overwrite numbers from data, require source ids, drop what can't be backed).
- Check all 8 languages, phone and wide screens, light and dark. Phone overlays need a check with a short visual viewport (browser bars showing).
- For any change, count the AI calls and tokens per day against the free-tier limits in `models.ts` and the schedule.
- Report each finding with its evidence (the URL, the number, the screenshot), fix it, and add a regression test to that round's `scripts/v<N>test.ts`.

**Research and ideas**
- When a data source or outside service is involved, research before building: find the options, test the real endpoints from the sandbox, and prefer official, keyless, free sources. Write down what was rejected and why (see Prices in `docs/ARCHITECTURE.md`).
- Rank ideas the owner didn't ask for by value against effort and free-tier cost, and separate "do now" from "later".
- Reports for the owner (competitors, research, audits) are published as an artifact with sources linked and unverified figures marked as such.

**Delivering**
- One short-named branch per round (`v12`, `v13`, ...).
- Before pushing: `npm test`, `npm run typecheck`, and `npm run build` both with and without the `AUTH_*` env vars.
- Update `docs/ARCHITECTURE.md` (and the code map in this file) for architecture changes, and add a section to `docs/HANDOFF.md` for the round: what changed, what was verified and how, what wasn't, and open items.
- Ask before merging to `main` (it deploys) unless the owner said to merge without asking. After a merge, check production with read-only GET requests only. Don't wait for the build inside the session (no polling loops, no background waits): schedule a check-in (`send_later`) about 5 minutes after the push and end the turn. The check-in confirms the new build is live (something only it has: a new CSS rule, UI string or API field), then checks the endpoints, then does a real-browser pass (wide and phone, no console errors). If the build isn't live yet, it schedules itself again rather than waiting.
- Refactors that must not change the UI: screenshot the views before and after with the same seeded data and a frozen clock, and compare pixel by pixel (`compare -metric AE`); report the counts.
- When a result can only be checked later (a deploy, a market close, an hourly job, the next scheduler tick), schedule a check-in (`send_later`) instead of holding the session or polling.
- On long tasks, post a one-line status now and then.
- End with: what changed, what was verified, what wasn't, open risks, and the one question that decides the next step.

**Context**
- When compacting, keep the branch name, the list of modified files, the test commands run and their results, and every open decision.

**Lines not to cross** (also in `how-i-work`; repeated here because this file always loads)
- Never send write requests to production without credentials, and never probe it with them.
- No scraped API keys, no browser user-agent tricks to get past a site that refuses servers, no bypassing rate limits.
- Keep the owner's personal details out of code, docs, commits and requests to outside services.
