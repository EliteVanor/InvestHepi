# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Product goals, the owner's decisions and working preferences, and open items are in `docs/HANDOFF.md`. Read it at the start of a session.


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

Gotcha: the store is `.data/` locally and `/tmp/invest-helper` when `VERCEL` is set. Caches persist between runs (e.g. `market:*` for 10 min, `px:last`, `vnlist`), so tests that need a clean store set `VERCEL=1` and `rm -rf /tmp/invest-helper` first. Stale `.data/` can make a test fail for reasons unrelated to the code, and some suites (v4btest) delete `.data/`, so re-seed before manual browser checks.

Price-layer modules keep in-memory state (Yahoo cooldown, chart/live caches); tests reset it with `resetYahoo()` and `clearPriceCaches()`. Test fetch mocks must handle Yahoo's batch endpoint (`/v8/finance/spark?symbols=A,B`, flat JSON keyed by symbol) as well as `/v8/finance/chart/`.

For live checks against real APIs from a cloud sandbox, Node's built-in fetch ignores `HTTPS_PROXY` unless run with `NODE_USE_ENV_PROXY=1`. Don't hammer Yahoo while testing: it rate-limits the IP for minutes.

`scripts/i18ntest.ts` enforces that every key in the `en` dictionary in `src/lib/i18n.ts` exists in all 8 languages (en, vi, zh, ja, ko, es, fr, de). Any new UI string needs all 8.

## Architecture

**Pipeline (`src/lib/pipeline.ts`)** is the core. `buildDigest` fetches news (`news.ts`, feeds in `config.ts` `SECTION_FEEDS`), market data (quotes, macro, sectors, technicals, cached 10 min), and the calendar, then calls `analyze()` and returns a `Digest`. What gets priced is decided by `coverage(section, interests)`:
- My Interests: `BENCHMARKS` + the user's tickers, US sectors, mood from SPY.
- World/US/Vietnam: never personal stocks. `config.ts` holds `SECTION_STRIPS` (labeled strip groups, copied onto `Digest.strip`), `SECTION_GROUPS` (`WORLD_GROUPS`/`US_GROUPS`/`VN_GROUPS`: the markets the AI makes calls on, passed to the prompt as "interests"), `SECTION_MACRO`, and `MOOD_BENCH` (SPY / ACWI / ^VNINDEX.VN; the mood breadth set is world indexes or VN large caps instead of US sectors).

Callers:
- `refreshShared(section, lang)` for world/us/vn: one digest per language, stored at `digest:<section>:<lang>`. Calls are recorded and graded per section (`SHARED_CALLS`: `calls:world|us|vn`); `/api/track?section=` serves them.
- `refreshInterestSet(interests, lang, uids)`: one digest per distinct interest set, keyed `ib:<hash>` where hash = sha1(normalized interests + language). Users with identical interests share one briefing.
- `refreshScheduled` is what the cron hits: shared sections in English plus a Vietnamese translation; interests one set per call (`INTEREST_BATCH`, default 1), the admin's first, `scope=admin` for the admin-only slots, returning `pending` so the workflow knows when to stop.

**LLM (`src/lib/llm/`)**: each job has a "route" in `models.ts` with its own model order (Claude first if `ANTHROPIC_API_KEY`): `shared` 120b → Gemini Flash-Lite 3.5 → 3.1 → gpt-oss-20b; `adminAuto`/`adminManual` 120b → 20b → Flash-Lite; `userAuto` 120b (only beyond the reserve) → 20b → Flash-Lite; `userManual` Flash-Lite → 20b; `translate` qwen → Flash-Lite (never the briefing models); `ask` 20b → 120b. Groq limits are per model (200K tokens/day each), Flash-Lite 500 requests/day each. `models.ts` records real token use per model per day (`llm:usage:<model>`), cools a model down after a 429 (longer when the daily quota is gone), and keeps enough 120b tokens for the shared and admin briefings still due (`reserveFor120`, `scheduledPerDay` must match refresh.yml). If every model fails, the caller gets the rule-based analysis (`rules.ts`). Free providers get a "compact" prompt; `fitPrompt` in `index.ts` trims headlines to stay under Groq's ~8k tokens/minute. Output is validated against `schema.ts`. `prompt.ts` holds the analyst rules, per-section focus, and Vietnam-specific rules/clock (`VN_RULES`, `vnMarketPhase`). The historical playbook the model must prefer over memory is `analogs.ts`.

**Keeping the last AI briefing**: a rule-based result never replaces an AI briefing (`storeBriefing` in `pipeline.ts`). It's saved at `<prefix>:rules` and the failed run at `<prefix>:aifail`; `/api/digest` returns `aiFailedAt`, the page shows a banner and readers can switch to the rule-based copy (`?variant=rules`, cached 15 min, rebuilt on demand within `RULES_DAILY_LIMIT`; the choice is saved per device).

**Track record (`track.ts`)**: each digest's outlook calls are recorded and later graded against prices. Calls are keyed by date+ticker+horizon so re-generating in several languages doesn't double-count. Call stores: `calls:<interest hash>` per interest set, `calls:world|us|vn` for shared sections. Grading uses `getQuotes(..., { allowStale: false })`: never the stale fallback.

**Prices** (all unofficial, keyless; verified from a cloud server Nov 2026):
- `yahoo.ts`: every Yahoo call goes through `yahooJson` (max 3 in flight, 90 s cooldown after a 429, no retry on the second host). Prefer `yahooSpark` (20 symbols per request, closes only) over per-symbol charts.
- `vnmarket.ts`: Vietnamese symbols are `CODE.VN` for any listing and `^VNINDEX.VN`/`^VN30.VN`/`^HNX.VN`/`^HNX30.VN`/`^UPCOM.VN` for indexes (`VN_INDEXES` maps each source's code). Order: DNSE (daily + 1/5-min/1H, stocks in thousand VND) → Vietcap (one symbol per POST, full VND) → VNDirect (daily, many codes per request, thousand VND; zero-volume pre-open rows skipped). All normalized to full VND. Yahoo has no usable VN index series.
- `market.ts` `getQuotes`: one spark batch for non-VN symbols, one VNDirect batch for VN ones, bounded per-symbol fallbacks, then the `px:last` last-good blob (quotes flagged `stale`). `chart.ts` `getChart`: VN → DNSE/Vietcap/VNDirect/Yahoo; others → Yahoo/Nasdaq; saved daily history (`chart:<sym>`) as a stale fallback. `getLiveQuotes` batches the same way and is cached 25 s per instance. `technicals.ts` uses spark 1y (close-only bars) and VNDirect.
- `worldmarket.ts`: real world levels when Yahoo refuses the server. VNDirect's public data API (same host as VN prices, Bloomberg-sourced) has daily closes for world indexes (`stock_prices`: S&P 500, Dow, Nasdaq, Nikkei, Hang Seng, Shanghai, DAX, FTSE, CAC, KOSPI, Nifty...), `commodities` (WTI, Brent, COMEX gold...) and `currencies` (USD/VND, EUR/USD, USD/JPY, USD/CNY...); the US Treasury's daily yield-curve CSV gives `^TNX`. Daily only, posted the next day (~03:00-07:00 UTC), so every value carries its date (`dailyOnly`). For US-hours markets with a same-hours ETF (`SAME_HOURS_ETF`: ^GSPC/SPY, ^DJI/DIA, CL=F/USO, GC=F/GLD) a newer ETF session carries the official close forward (`estimatedVia`, shown with ≈); in the same session the ETF only supplies the 1-day chart's shape (`shapeVia`). Never estimate non-US indexes from US-hours ETFs.
- Yahoo-only symbols with no real source (Euro Stoxx 50, DXY, VIX, Bitcoin) fall back to tracking ETFs priced by Nasdaq (`PROXIES` in `symbols.ts`); the quote/chart keeps the original symbol and sets `proxy`, and the prompt gets "level unknown, % moves only". Live overlay rule (`canOverlay` in `v3.tsx`): same basis, or a real level replacing an ETF stand-in; never an ETF price over a real level.
- Live quotes (`getLiveQuotes`) for VN symbols come from the same 1-day chart the chart sheet shows (DNSE's daily series has no bar for today during the session), so the strip and the chart can't disagree. Each live quote has `session` (exchange-local date) and `intraday`; the strip sparkline is that session's path against the previous close, colored like the % chip (daily history is gray).
- TCBS (Cloudflare check), Stooq (JS bot check), CNBC (Akamai) refuse servers; don't reintroduce them. Don't use API keys scraped from websites.

**Languages (`translate.ts`)**: every briefing is generated in English (`currentInterestSet` always returns `lang: "en"`, so the interest hash ignores language and readers of any language share a set); `display` is the person's single chosen language (stored as `settings.briefingLanguage`, kept in sync with the UI language by the page). Readers get translations. `translateLatest` sends only the text fields (`textSlots`), caches `tr:<prefix>:<lang>` per briefing version (`generatedAt`), and dedupes concurrent requests; `/api/translate` is called by the page when a briefing's `language` differs from the UI language. Don't regenerate a briefing just to change its language.

**News times**: some `.vn` feeds stamp Hanoi time as UTC; `fixFeedTimes` in `news.ts` shifts a `.vn` feed back 7 h when its items are in the future and clamps future times elsewhere.

**Search (`search.ts`, `vnlist.ts`)**: merges the VNDirect listing of every VN stock/ETF (cached a day in `vnlist`, built-in fallback list, accent-insensitive via `fold`), index/commodity names from `symbols.ts` `SYMBOL_LABELS`, and Yahoo search; ranked, Vietnamese results boosted for `lang=vi`. Following a stock from search creates a one-ticker interest (`src/lib/follow.ts` builds its news query; VN tickers get Vietnamese Google News in `news.ts`). `src/components/search.tsx` holds the sheet and `useFollow`; the page refreshes the personal briefing once when the sheet closes, not per tap.

**Storage (`store.ts`)**: `getJSON/setJSON` over Upstash Redis (`KV_REST_API_*`) or local JSON files. No database schema; the key layout is the contract.

### Auth and multi-user

Two modes, chosen by env (`src/lib/mode.ts`):
- **Single-user** (default): `APP_PASSWORD` (sent as the `x-app-password` header) for the owner, optional `VIEWER_PASSWORD` for read-only guests.
- **Multi-user**: when `AUTH_SECRET`, `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are all set. Auth.js v5 (`src/auth.ts`, Google, JWT sessions, no DB adapter). Signed-out visitors can read; writes return 401 `{error:"signin"}`, which the client turns into a sign-in sheet (`prefs.tsx` `api()`).

Per-user isolation uses AsyncLocalStorage (`src/lib/context.ts`). Route handlers wrap their work in `gate(req, {user?}, fn)` from `src/lib/users.ts`, which checks access and runs `fn` inside `withUser(uid)`. Any per-user key must go through `ukey(k)`, which returns `k` for the owner and `u:<uid>:k` for everyone else. The owner (`OWNER_EMAIL`, or the single-user owner) keeps the legacy unprefixed keys, so existing data survives the switch to multi-user mode.

Tests and E2E fake the session with `setSessionResolver()` or, outside Vercel, `E2E_FAKE_AUTH=1` plus an `x-test-user: email` header.

### Scheduling and cost controls

Vercel Hobby allows one cron a day (`vercel.json`: the admin's interests at 10:30 UTC), so `.github/workflows/refresh.yml` calls `/api/refresh?section=...` with `Authorization: Bearer $CRON_SECRET` on a fixed UTC schedule. Weekdays: World 4, US 2, Vietnam 5; the admin's interest set 6 times (`scope=admin` slots plus the shared ones), everyone else's 4 (`scope=all` slots, at least 90 min apart). Sunday: each shared section twice, the admin's set 3 times, users none; Saturday nothing. Interests are refreshed one set per call (admin's first) until the app returns `pending: 0`; calls are spaced 65 s apart for Groq's per-minute limits. Shared sections are pre-translated into Vietnamese only; other languages are translated on first read. The "Price alerts" workflow hits `/api/alerts/check` (no AI). Manual refresh: the admin can refresh any section (`REFRESH_DAILY_LIMIT`, default 10, best model); signed-in users can refresh only their own My Interests (`USER_REFRESH_DAILY_LIMIT` 5 a day, `USER_REFRESH_GAP_MIN` 90 min apart, `userManual` route); every press writes a new briefing and the reply carries the quota, which `/api/me` also returns for the button badge. A newly saved interest set gets its first briefing in the background (`ensureInterestBriefing`, via `after()` in `/api/interests`, capped by `AUTOGEN_DAILY_LIMIT`), and the page polls until it appears. Daily caps live in `ratelimit.ts`. Yahoo refuses both Vercel and GitHub's runners (429), so a GitHub-side price relay doesn't work; the workflow keeps a `yahoo_test` dispatch input to re-check. Keep new features inside these free-tier limits.

### Frontend

Single page: `src/app/page.tsx` holds the state (tabs, digests, sheets, account) and composes components from `src/components/`. Files named `v3.tsx`/`v4.tsx` group features by the release that added them, not by type. Client-side preferences (theme, language, password, read state, saved headlines) live in localStorage via `prefs.tsx`, always wrapped in try/catch. Styling is one global stylesheet (`src/app/globals.css`) with CSS variables for light/dark; the mobile layout uses a bottom tab bar (`.tabbar`) and hides `.desktop-only` elements.

- The price strip (`MarketStrip` in `sections.tsx`) takes labeled groups; for shared sections the page builds them from `Digest.strip` (or `SECTION_STRIPS` for older digests) overlaid with live quotes. Mouse users get arrow buttons and drag-to-scroll.
- Background: a fixed `.ambient` layer (drifting radial color fields, dot matrix, grain) whose palette follows `data-section`; colors are `@property`-registered so tab switches morph. Cards/strip use translucent `--material` with backdrop blur; `prefers-reduced-motion` and `prefers-reduced-transparency` are honored.
- Multi-user visitors: My Interests shows `InterestsGate` (sign-in) instead of content; visitors land on World (Vietnam if the UI language is vi). The setup checklist is only for single-user mode or the admin.
- Charts format times in the exchange's time zone (`exchangeTz` in `symbols.ts`); the 1-day header names the session date when it isn't today. The page header date, "Up next" and the calendar follow the tab's market (Vietnam: Hanoi; shared tabs get their market groups' calendar, never personal earnings). Number formatters (`fmtPct`/`fmtPrice`) tolerate missing values; keep it that way, data comes from many free sources. Index levels keep 2 decimals, currency pairs 4 (`priceDigits`).
- Wide screens (≥1280px, `isWide` in `page.tsx`): sections and actions in a left `.sidebar` instead of the top bar, Ask AI docked in `.chat-dock`. Every way of asking goes through `openAsk(q?)` (docked panel when wide, sheet otherwise). The sidebar folds to an icon rail (`[`, saved as `ih-side`) and the dock hides (`]`, `ih-dock`); the sidebar's Headlines item and the header News button jump to `#headlines` (`N`). `components/ask.tsx` holds the chat: conversations saved per account by `/api/ask` (`chatId`) in `lib/chats.ts` (30 chats × 30 messages), listed/deleted via `/api/chats`; suggestions built from the briefing on screen (`suggestionsFor`), follow-up chips after each answer; no extra AI calls.
- Movers' numbers are overwritten from the price snapshot after the model answers (`alignMovers`); tickers not in the snapshot are dropped. A mover's reason survives only if one of its `source_ids` headlines names the stock (`headlineMentions`), otherwise it reads "No clear news".
- Every overlay (sheets, catch-up, password) calls `openOverlay()` from `primitives.tsx`: it locks the page with body `position: fixed` and tracks `visualViewport` into `--app-h`/`--app-top`, because iOS `vh` includes the area behind the browser bars. Sheets keep their header outside the scrolling `.sheet-body`.

## Conventions

- UI copy is plain and direct; the AI is told the same (no hype, specific risks, calibrated confidence).
- The AI only ever sees holding weights and gain %, never amounts (`positionsAsText`).
- Interests: the first ticker is the benchmark used for the outlook and the track record.

## Working with the owner

These are the habits from past sessions. Follow them without being asked.

**Starting a session**
- Read `docs/HANDOFF.md`, then restate the goal and the rules that apply in a few lines before doing anything.
- Before starting, ask every question needed to make the task clear, so the work hits what the owner actually wants: scope, priorities, expected behavior, edge cases, limits, models, schedule, UX, what "done" looks like. Put them in one numbered list. Give lettered options where they help and mark the one you recommend. The owner answers by number ("1 B, 2 yes").
- Then give a plan before running anything: the steps in order, the files and services each touches, how each will be tested, the AI and free-tier cost, the risks, and what will need the owner (accounts, tokens, a merge). Wait for the owner's go. After the go, build without more check-ins, and say so if the plan has to change along the way.
- "Use all of the token" means: keep working through the whole task list without stopping for approval. If the context gets long, write a summary that keeps every decision, file change and open item so nothing is lost.

**Stress testing** ("stress test", "test every detail", "to the last minute")
- Test each goal end to end against real data from the cloud sandbox (`NODE_USE_ENV_PROXY=1`), not only the offline mocks. Go easy on rate-limited sources.
- Prices, charts and timing must agree everywhere. Compare the strip, the chart sheet and the briefing for the same symbol: level, % change, chip and sparkline color, session date, exchange time zone, and stale/estimate/proxy labels.
- Audit at least one real AI briefing line by line. Every level, %, date and reason must trace back to the data the model was given. An invented fact is a bug: fix it with a prompt rule and a code guard (overwrite numbers from data, require source ids, drop what can't be backed).
- Check all 8 languages, phone and wide screens, light and dark. Phone overlays need a check with a short visual viewport (browser bars showing).
- For any change, count the AI calls and tokens per day against the free-tier limits in `models.ts` and the schedule.
- Report each finding with its evidence (the URL, the number, the screenshot), fix it, and add a regression test to that round's `scripts/v<N>test.ts`.

**Research and ideas**
- When a data source or outside service is involved, research before building: find the options, test the real endpoints from the sandbox, and prefer official, keyless, free sources. Write down what was rejected and why (see the Prices section).
- Suggest ideas the owner didn't ask for when they clearly help, ranked by value against effort and free-tier cost. Give one recommendation, not a survey, and separate "do now" from "later".
- Push back on the owner's ideas too: give the other side and the failure cases, and say plainly when something won't work or costs too much.
- Reports for the owner (competitors, research, audits) are published as an artifact with sources linked and unverified figures marked as such.

**Delivering**
- One short-named branch per round (`v12`, `v13`, ...).
- Before pushing: `npm test`, `npm run typecheck`, and `npm run build` both with and without the `AUTH_*` env vars.
- Update this file for architecture changes, and add a section to `docs/HANDOFF.md` for the round: what changed, what was verified and how, what wasn't, and open items.
- Ask before merging to `main` (it deploys) unless the owner said to merge without asking. After a merge, check production with read-only GET requests only.
- On long tasks, post a one-line status now and then.
- End with: what changed, what was verified, what wasn't, open risks, and the one question that decides the next step.

**Lines not to cross**
- Never send write requests to production without credentials, and never probe it with them.
- No scraped API keys, no browser user-agent tricks to get past a site that refuses servers, no bypassing rate limits.
- Keep the owner's personal details out of code, docs, commits and requests to outside services.
