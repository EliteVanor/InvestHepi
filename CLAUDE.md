# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

InvestHepi: a Next.js 15 (App Router, React 19, TypeScript) market-news site deployed on Vercel Hobby. It pulls headlines and prices, has an LLM write a briefing per section with buy/hold/wait calls, and grades those calls over time. Sections are `interests` (per user), `world`, `us`, `vn` (Vietnam). Everything is designed to run on free tiers (Groq/Gemini, Upstash Redis, GitHub Actions), and that constraint drives much of the architecture.

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

Gotcha: the store is `.data/` locally and `/tmp/invest-helper` when `VERCEL` is set. Caches persist between runs (e.g. `market:*` for 10 min), so tests that need a clean store set `VERCEL=1` and `rm -rf /tmp/invest-helper` first. Stale `.data/` can make a test fail for reasons unrelated to the code.

`scripts/i18ntest.ts` enforces that every key in the `en` dictionary in `src/lib/i18n.ts` exists in all 8 languages (en, vi, zh, ja, ko, es, fr, de). Any new UI string needs all 8.

## Architecture

**Pipeline (`src/lib/pipeline.ts`)** is the core. `buildDigest` fetches news (`news.ts`, feeds in `config.ts` `SECTION_FEEDS`), market data (quotes, macro, sectors, technicals, cached 10 min), and the calendar, then calls `analyze()` and returns a `Digest`. Callers:
- `refreshShared(section, lang)` for world/us/vn: one digest per language, stored at `digest:<section>:<lang>`.
- `refreshInterestSet(interests, lang, uids)`: one digest per distinct interest set, keyed `ib:<hash>` where hash = sha1(normalized interests + language). Users with identical interests share one briefing.
- `refreshScheduled` is what the cron hits: refreshes the stalest interest sets in small batches (`INTEREST_BATCH`), and shared sections only for languages active users read.

**LLM (`src/lib/llm/`)**: provider chain Claude → Groq → Gemini → rule-based (`rules.ts`), first that works. Free providers get a "compact" prompt; `fitPrompt` in `index.ts` trims headlines to stay under Groq's ~8k tokens/minute. Output is validated against `schema.ts`. `prompt.ts` holds the analyst rules, per-section focus, and Vietnam-specific rules/clock (`VN_RULES`, `vnMarketPhase`). The historical playbook the model must prefer over memory is `analogs.ts`.

**Track record (`track.ts`)**: each digest's outlook calls are recorded and later graded against prices. Calls are keyed by date+ticker+horizon so re-generating in several languages doesn't double-count. Call stores: `calls:<interest hash>` per interest set, `calls:vn` for Vietnam.

**Prices**: `market.ts` (quotes) and `chart.ts` (charts) try sources in order and aggregate the errors. US: Yahoo → Nasdaq public API → Stooq. Vietnamese symbols (`*.VN`, indexes `^VNINDEX.VN`, `^VN30.VN`): Yahoo → TCBS → VNDirect (`vnmarket.ts`; VNDirect stock prices come in thousand VND and are normalized to VND). All of these are unofficial, keyless endpoints that may block cloud IPs.

**Storage (`store.ts`)**: `getJSON/setJSON` over Upstash Redis (`KV_REST_API_*`) or local JSON files. No database schema; the key layout is the contract.

### Auth and multi-user

Two modes, chosen by env (`src/lib/mode.ts`):
- **Single-user** (default): `APP_PASSWORD` (sent as the `x-app-password` header) for the owner, optional `VIEWER_PASSWORD` for read-only guests.
- **Multi-user**: when `AUTH_SECRET`, `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are all set. Auth.js v5 (`src/auth.ts`, Google, JWT sessions, no DB adapter). Signed-out visitors can read; writes return 401 `{error:"signin"}`, which the client turns into a sign-in sheet (`prefs.tsx` `api()`).

Per-user isolation uses AsyncLocalStorage (`src/lib/context.ts`). Route handlers wrap their work in `gate(req, {user?}, fn)` from `src/lib/users.ts`, which checks access and runs `fn` inside `withUser(uid)`. Any per-user key must go through `ukey(k)`, which returns `k` for the owner and `u:<uid>:k` for everyone else. The owner (`OWNER_EMAIL`, or the single-user owner) keeps the legacy unprefixed keys, so existing data survives the switch to multi-user mode.

Tests and E2E fake the session with `setSessionResolver()` or, outside Vercel, `E2E_FAKE_AUTH=1` plus an `x-test-user: email` header.

### Scheduling and cost controls

Vercel Hobby allows one cron a day (`vercel.json`), so `.github/workflows/refresh.yml` calls `/api/refresh?section=...` with `Authorization: Bearer $CRON_SECRET` several times a day (US hours, plus two Vietnam-only runs). Calls are spaced 65 s apart for the LLM per-minute limits. The "Price alerts" workflow hits `/api/alerts/check` (no AI). Manual refreshes have cooldowns (30 min for shared sections, 5 min for a user's own set; the admin bypasses them) and daily caps (`ratelimit.ts`). Keep new features inside these free-tier limits.

### Frontend

Single page: `src/app/page.tsx` holds the state (tabs, digests, sheets, account) and composes components from `src/components/`. Files named `v3.tsx`/`v4.tsx` group features by the release that added them, not by type. Client-side preferences (theme, language, password, read state, saved headlines) live in localStorage via `prefs.tsx`, always wrapped in try/catch. Styling is one global stylesheet (`src/app/globals.css`) with CSS variables for light/dark; the mobile layout uses a bottom tab bar (`.tabbar`) and hides `.desktop-only` elements.

## Conventions

- UI copy is plain and direct; the AI is told the same (no hype, specific risks, calibrated confidence).
- The AI only ever sees holding weights and gain %, never amounts (`positionsAsText`).
- Interests: the first ticker is the benchmark used for the outlook and the track record.
