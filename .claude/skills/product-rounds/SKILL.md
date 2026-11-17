---
name: product-rounds
description: Playbook for building and growing a product with an AI coding agent in short rounds (v1, v2, ...), learned from InvestHepi's v1-v17. Use when starting a new project, planning the next round, deciding what to build next, or reviewing how a project is going. Covers the order to build things in, the round template, definition of done, and the traps that cost the most time.
---

# Product rounds: build the loop first, then measure, then grow

Distilled from InvestHepi (an AI market-news app built in 17 rounds over ~34 hours on free tiers). The expensive lessons, in order of cost.

## 1. Order of work (the biggest lesson)

Build in this order, and don't start a later step until the earlier one works on production:

1. **Day-0 spike of the platform's hard limits** (one hour, before any feature). From the real deployment target, prove each external dependency answers: data sources (InvestHepi: Yahoo refused cloud servers, found only in v6-v10), schedulers (GitHub cron silently dropped runs, found in v13), plan limits (function duration, cron frequency, AI tokens per minute and per day). Write each result down with its date.
2. **The core loop, end to end, ugly.** Input → processing → output → stored → measured. For InvestHepi: news + prices → AI briefing → call recorded → call graded. Ship it with no polish.
3. **Measurement of the core promise, with a baseline.** If the product claims something ("these calls are good"), grade it from day one against a naive baseline ("always up"), with sample-size honesty (ranges, "early data"). A metric without a baseline misleads.
4. **Operations**: the scheduler or jobs that keep it alive, plus a watchdog outside the app that tells the owner when it stops. Without this, step 3 collects no data.
5. **Breadth**: more sections, languages, UI polish, extra features. Only now.

InvestHepi did 5 first (v1-v4: 8 languages, live charts, catch-up mode, command palette) and 3-4 last (v13, v16). The cost: the track record existed from v2 but had no reliable data until v16, and the scheduler was broken without anyone noticing until v13.

## 2. Round template (every round)

1. Read the handoff doc. Restate the goal and the rules.
2. Ask every clarifying question in one numbered list with lettered options and a recommendation. The owner answers "1 A, 2 B".
3. Plan: steps, files, tests, cost (AI calls/tokens per day against free tiers), risks, what needs the owner. Wait for "go".
4. **Pin behavior before changing it**: golden tests for invariants (hashes, key layouts, API surface), pixel screenshots before a UI refactor.
5. Build. One concern per commit. No mixed UI + logic refactor in the same round if avoidable.
6. Verify: unit tests, typecheck, both build modes, a local production build in a real browser (wide + phone, light + dark, all languages touched), and real endpoints from the sandbox.
7. Docs in the same round: a handoff section (changed / verified / not verified / open items) and the architecture file.
8. Ask before merging. After merging: wait for the new build (poll for a marker only it has), then read-only checks on production, then a browser pass.
9. If a result can only be checked later (a market close, an hourly job), schedule a check-in instead of holding the session.

## 3. Definition of done

- The feature works on production, not just in tests, and someone checked it there.
- The docs say what was not verified.
- A regression test exists for every bug found.
- Free-tier cost counted.
- No new duplicate of something that already exists (dates, defaults, timetables: one source of truth).

## 4. Traps that cost the most

- **Time zones.** Every "today", "session", "close" must name its zone. Bugs found: grading on New York's clock for Hanoi, a test that failed only between 17:00-24:00 UTC (Hanoi midnight), session dates for ETFs vs the index they track.
- **Silent failure.** Schedulers, cron jobs, background work: assume they fail silently. Record every run, expose a status, and have something outside the app alert on a late run.
- **Duplicated truth.** Schedule times in three files, model defaults in two, eight copies of one date formatter: each copy eventually drifts. Centralize, and add a test that fails on drift (InvestHepi: `.env.example` vs env reads).
- **Metrics without baselines or sample sizes.** "42% right" means nothing without "always up was right 52%" and "n=31, likely 29-57%".
- **Numbers the AI invents.** Overwrite every number from data after the model answers; require cited sources; drop what can't be backed; check that actions agree with directions.
- **Files named after releases** (`v3.tsx`, `v4.tsx`). Name by feature from the start; release history belongs in the handoff doc and git.
- **Shipping to main with no soak time.** Many merges a day hides problems that only show over hours (cron, quotas, daily resets). Let the core loop run a full day before the next big round.
- **Tooling slips.** Test scripts and servers can lie: a stale server on the same port served old HTML; a shell quoting error skipped doc edits while the commit still went through. Check the result, not the command's exit.

## 5. Habits that worked (keep them)

- A handoff file with goals, the owner's decisions, how they like to work, current state, and open items; updated every round.
- Free-tier discipline: count calls and tokens per day for every change; per-model budgets and reserves.
- Research before building, with rejected options written down and why.
- Tests from the start (plain scripts, mocked network), one suite per round, a map of what each covers.
- Honest reporting: what wasn't verified, findings with evidence, pushing back on the owner's ideas when they won't work.
- Production checks read-only only; secrets never in the repo or chat.

## 6. Still missing in InvestHepi (do these early next time)

- Real users and feedback before breadth (who uses it, what they open, what they ignore).
- A staging step: a preview deployment checked before production.
- Legal check for anything that looks like advice in its market (Vietnam's SSC warned about unlicensed recommendations).
- Product analytics beyond page views: which sections and features get used.
