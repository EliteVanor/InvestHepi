# Handoff: goals, rules and state (Nov 2026)

Read this with `CLAUDE.md` (architecture, commands, technical rules). This file holds the *why*: product goals, decisions the owner made, how they like to work, and what's open.

## Goal

InvestHepi helps someone catch up on market news fast and act on it: a short AI briefing per section (summary, trend, events, movers, scenarios), separate AI predictions with buy / hold / wait calls, confidence, triggers and risks (twice a weekday per market), plus a track record that grades every call at its market's close. Audience: the owner first, then Vietnamese investors (the UI is in 8 languages, Vietnamese matters most).

Hard constraint: **free plans only** (Vercel Hobby, Upstash free, Groq/Gemini free tiers, GitHub Actions). Every feature must keep AI token use and request volume low.

Design: Apple-like and quietly futuristic. Ambient light background tinted per section, translucent cards, clean type, works on phones.

## Product rules the owner decided

- **Sections:** My Interests (personal), World, US, Vietnam.
- **Shared sections never show personal stocks.** World = world indexes + global giants + macro. US = S&P 500, Dow, Nasdaq 100, Russell 2000 + mega caps. Vietnam = VN-Index, VN30, HNX, UPCoM + banks + large caps. The AI's calls in shared sections are on market groups, not users' stocks.
- **World has no market open/closed pill** (it spans many exchanges).
- **Refreshing (decided Nov 16, mechanism changed in v13):** briefings refresh on the app's own timetable (`src/lib/timetable.ts`), run by a tick that Vercel Schedules, cron-job.org and GitHub poke on a plain interval; a run that's late or duplicated never spends AI twice, and a slot more than an hour late is reported. Users' interest sets refresh automatically 4 times a weekday (01:15, 08:10, 12:30, 21:20 UTC), the admin's 6 times, **but only for users seen in the last day** (decided Nov 16, v14); someone back after longer gets one catch-up briefing in the background when they open the app (if theirs is over 12 h old). Signed-in users can also refresh their own My Interests by hand: 5 a day, 90 minutes apart, on a lighter model (Gemini Flash-Lite); every press writes a new briefing and tells them how many presses are left. The admin can refresh any section, 10 a day, on the best model. Shared sections can't be refreshed by users. A newly saved interest set gets its first briefing automatically, once.
- **Schedule (v18):** briefings every day (weekends at the weekday rate): World 4, US 5 (02:15, 12:30, 15:30, 17:00, 21:20 UTC), Vietnam 5; the admin's set 6, users' sets 4. Predictions on weekdays only, two per market in the market's own local time (Japan 08:30/11:45 Tokyo, China & HK 09:00/12:15 HK, Vietnam 08:15/11:35 Hanoi, Europe 07:30/12:00 London, US, US stocks, oil and gold 07:30/12:00 New York; interest sets split into US and Vietnam parts on those clocks).
- **Predictions (decided Nov 17, v18):** a separate AI job from briefings; briefings make no calls. Daily calls before market and at mid-day, graded at that day's close on the ticker's own exchange (mid-day from the price at that moment); weekly calls only in the before-market run, graded at the 5th trading day's close counting the prediction day (holiday: the previous full session); a holiday weekday is "market closed, not graded"; no predictions on weekends; each run predicts only its own market (owner, Nov 17: "each market got 2 predictions and only predict its market"). A failed run is retried once, then missed: no rule-based predictions.
- **Headlines (v18):** World, US and Vietnam refresh every 15 minutes with no AI. An interest set's headlines refresh every 30 minutes only while someone who follows it has the page open, and right away when a user signs in or comes back to a stale list (owner, Nov 17); nobody reading, no fetches.
- **Latest data (owner, Nov 17):** every prediction must work from the latest data. A market whose benchmark lacks the latest close (or, during its session, a live price) gets "unavailable" instead of a prediction; no prediction is made from older prices, and none is kept as "not counted". Before-market runs must not be missed for lack of a poke: they start 75-120 minutes before each open.
- **Prediction fallback (owner asked Nov 17):** predictions do fall back across models (120b → Gemini Flash-Lite 3.5 → 3.1 → gpt-oss-20b; admin and users' sets: 120b → 20b → Flash-Lite), then one retry 20 min later; only if all of that fails is the run missed. No rule-based predictions (decided in the plan: they would pollute the track record); the card keeps showing the last run with its time.
- **Time zone (v18):** one setting per person (default: the device's), every time labeled with its zone; charts and the open/closed pill stay in exchange time.
- **Models (v18):** predictions on gpt-oss-120b (budget reserved for the shared and admin runs; users' runs use it only beyond the reserve, then 20b, then Flash-Lite); briefings on Gemini Flash-Lite first, 120b as fallback; translation on qwen; Ask AI on 20b.
- **When no AI model works:** keep the last AI briefing and explain it in a banner; readers can switch to a rule-based summary of the latest news (only they see it; cached).
- **One language setting per person**, used for the app, briefings and alert emails. **Every briefing is generated in English and translated** (cached per briefing version). Never regenerate a briefing to change its language.
- **Signed-out visitors** can read World / US / Vietnam; My Interests shows a sign-in invitation. Visitors land on World (Vietnam if their language is Vietnamese).
- **Track record (v18 additions):** each record shows when it was made ("Before market", "Mid-day", or "Week from <day>") and when it's graded; the likely range and the "always up" baseline count each ticker and day once; records from before v18 are labeled "Before market" with their grades unchanged.
- **Track record (decided Nov 16, v16-v17):** it must make predictions better over time. The headline is the up/down hit rate next to the "always up" baseline, with a likely range and an "Early data" label under 30 calls; flat calls are judged against each ticker's usual daily move; Hold/Wait are scored apart (result by action); moves inside the band are "no result"; each call shows its record at that confidence, and from 20 graded calls at a level the shown confidence moves toward the real hit rate (the AI's own number stays visible and is what gets recorded); grading happens within the hour after each market closes; an action must agree with its direction.
- **Wide-screen panels (decided Nov 16, v16):** macOS-style. The sidebar folds to an icon rail with its toggle top-left; Ask AI folds to a slim rail with its toggle top-right in the same spot as the close button; both slide; refined glass look, minimal, Apple-like.
- **Search like Apple Stocks:** find any US, Vietnamese or global stock / ETF / index (accents optional), tap + to follow. Following creates a one-ticker interest.
- **Prices must never just disappear:** Vietnamese prices come from Vietnamese brokers (DNSE, Vietcap, VNDirect); Yahoo is batched and backs off; Yahoo-only symbols fall back to tracking ETFs (tagged); last good prices fill gaps (dimmed). Grading never uses stale prices.
- **No scraped API keys** and no bypassing rate limits (an automated permission check blocked both; respect that).

## How the owner likes to work

The working rules (session start, stress testing, research and ideas, delivering, lines not to cross) are in `CLAUDE.md` under "Working with the owner", so they load in every session. The owner answers questions by number ("1 A, 2 yes"), says "go" to start a planned round and "merge" to merge it; anything that can only be checked later (a deploy, a close, the next tick) is a scheduled check-in, never a wait inside the session (owner, Nov 17); when busy they ask for the plan and then the whole job without check-ins. In short: direct, concise writing with no em dashes or jargon; stress-test ideas and give other perspectives; research before building; short branch names; ask before merging to `main`.

## Current state

- `main` = v18, deployed on Vercel at `investhepi.vercel.app` (Nov 17 ~02:52 UTC).
- Scheduler fully set up (Nov 16): Vercel Schedules from `vercel.json`, the owner's cron-job.org job (`TICK_SECRET` in Vercel, failure emails on), GitHub backup every 3 h. Watch it at `/api/status?schedule=1`.
- Multi-user mode is on (Google sign-in via Auth.js). Vercel env vars in use: AI keys (`GROQ_API_KEY`, `GEMINI_API_KEY`), Upstash (`KV_REST_API_*`), `APP_PASSWORD`, `CRON_SECRET`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `OWNER_EMAIL`, optionally `CONTACT_EMAIL` (shown on `/privacy` and `/terms`). GitHub repo secrets `APP_URL`, `CRON_SECRET` drive the GitHub backup poker.
- Optional knobs: `TRANSLATE_DAILY_LIMIT` (80), `AUTOGEN_DAILY_LIMIT` (6), `REFRESH_DAILY_LIMIT` (admin, 10), `USER_REFRESH_DAILY_LIMIT` (5), `USER_REFRESH_GAP_MIN` (90), `RULES_DAILY_LIMIT` (30), `ASK_DAILY_LIMIT`, `TICK_SECRET` (lets cron-job.org poke the scheduler and nothing else), model overrides `GROQ_MODEL`, `GROQ_SMALL_MODEL`, `GROQ_TRANSLATE_MODEL`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, limits `GROQ_TPD`, `GEMINI_RPD`.
- Google OAuth consent screen: branding filled in, privacy/terms pages exist; publishing needs no logo (a logo triggers brand verification).
- A personal Claude cloud environment named `invest-helper` exists with network access to the market-data hosts (Yahoo, Nasdaq, DNSE, Vietcap, VNDirect, ...) for live testing. Node needs `NODE_USE_ENV_PROXY=1` there.
- Tests: 19 offline suites (`npm test`), all passing (v18test added Nov 17).

## Stress test, Nov 16 2026 (branch `claude/stoic-davinci-nncgqw`)

Checked against production. Fixed on the branch (not deployed yet):
- Vietnam briefing could not be translated into Vietnamese (reply cut off at 1,500 tokens). Translation is now chunked with a per-chunk output budget, falls through to the next provider on a malformed reply, and a failed briefing isn't retried for 10 minutes (it was burning the daily cap).
- Yahoo refuses Vercel, so indexes, oil, gold, dollar and VIX are ETF stand-ins in production. The AI was given those ETF prices as levels and wrote "oil below $144", "Hang Seng support 22.8", "USD/VND above 29.6". The prompt now gets "level unknown, % moves only" for proxied rows, distances instead of levels in technicals, and "unavailable" for missing macro rows. The mood gauge no longer scores the VIXY price as the VIX.
- VNDirect history used unadjusted prices (FPT's stock dividend looked like a crash). Now uses the adjusted columns.
- US/global search found only a built-in list in production (no Coca-Cola, Costco, Walmart, Berkshire). Falls back to Nasdaq's autocomplete when Yahoo fails; Yahoo-only symbols (Tencent HK, Samsung, LVMH, US 10Y) aren't offered then. BRK-B style share classes now chart via Nasdaq.
- Nasdaq intraday charts were 4-5 hours off (Nasdaq sends New York wall time as UTC).
- Track record graded Vietnam and Asian calls on sessions that were already open or closed when the call was made. Calls now target the next session on their own exchange.
- Analogs: the prompt padded every day with three US entries, so a China slowdown got "hot CPI 2022" and the raw tag showed in the UI. Only matching entries now, plain descriptions, China and Vietnam entries added, Vietnamese keywords added.
- Untranslated UI: market group names, calendar titles and notes, mood details, macro labels, a few aria labels. VN30 futures expiry (third Thursday) added to the calendar.

## Budget round, Nov 16 2026 (same branch)

- Groq limits are per model (gpt-oss-120b, gpt-oss-20b, qwen3.8-27b: 200K tokens/day each). Gemini free tier on this project: Flash models 20 requests/day (the old default `gemini-flash-latest` was at 23/20), Flash-Lite 3.5 and 3.1 500/day each. Defaults now use Flash-Lite.
- Translation now includes headlines (cited ones + top 20, skipping ones already in the reader's language) and runs on qwen, so it no longer competes with briefings.
- Yahoo returns 429 to GitHub Actions runners too (tested Nov 16 with a Yahoo-only workflow run), so the planned price relay was dropped.
- The admin can see per-model use today in `/api/status` (`aiUsage`).

## Prices and layout round, Nov 16 2026 (same branch)

- Owner reported the Vietnam strip disagreeing with the chart (UPCoM green +0.12% on the strip, red on the chart). Cause: DNSE's daily series has no bar for today during the session, so live quotes showed Friday's close and change all day. Live VN quotes now come from the chart's own 1-day data; strip and chart match by construction (verified live for all symbols).
- The HNX/UPCoM spikes and steps in the 1-day charts are real exchange prints (DNSE and Vietcap identical to the minute); HNX's 52-week high of 339.91 (Jun 18 2026) is confirmed by three sources.
- Real world levels without Yahoo: VNDirect's public data API (world indexes, commodities, FX) and the US Treasury's daily yield file. Briefings now quote real levels with dates; ETF stand-ins remain only for Euro Stoxx 50, DXY, VIX and Bitcoin. World strip: Sensex replaced by Nifty 50 (real data available).
- Owner's idea of asking Yahoo in small chunks doesn't help (Yahoo refuses Vercel and GitHub on the first request) and would be rate-limit dodging, which the rules exclude.
- Wide-screen layout (left sidebar, Ask AI docked right), saved chat history per account, briefing-based suggestions.

## v11 (branch `v11`, Nov 16 2026)

- Phone sheets fit the visible screen (iOS `vh` counted the area behind the browser bars, so the stock sheet's title/close/follow slid off the top). Overlays track `visualViewport` (`--app-h`), keep the header outside the scrolling body, and lock the page the iOS way (`openOverlay` in `primitives.tsx`).
- Wide sidebar: "Headlines" item jumps to the news list (also `N`), top-5 headlines open articles; sidebar folds to an icon rail (`[`), Ask AI dock hides (`]`), both saved per device.
- Feeds from `.vn` sites that stamp Hanoi time as UTC (Tuổi Trẻ, 7 h in the future) are shifted back (`fixFeedTimes` in `news.ts`).
- Audit of the first v10 briefing (VN, 07:20 UTC, Groq 120b): levels, RSI, ranges and movers' numbers all matched the data. Fixed: movers' reasons now need a cited headline that names the company (`alignMovers`/`headlineMentions`), Vietnam rules explain SBV dollar buying/selling, names copied exactly. Gemini 3.5/3.1 Flash-Lite model ids confirmed working (they wrote World/US when Groq 120b hit its daily limit).
- Design polish: header News button (phones too), the briefing's story count links to the headlines, sidebar accent bar, focus rings, card hover only on pointer devices; jumping to `#headlines` lands below the sticky bar.
- Movers carry `source_ids` (schema + prompt); a mover's reason is kept only if a cited headline names the stock.
- GitHub's scheduler is unreliable: since Nov 15 only one scheduled run fired (01:15 slot ran at 02:22); the Sunday 22:35 slot never ran; the Monday 08:10 slot hadn't started by 08:41. **Most urgent fix:** move the timetable to an external free scheduler (cron-job.org or Upstash QStash) calling `/api/refresh` with `Authorization: Bearer $CRON_SECRET`, keep GitHub as backup.
- Competitor and AI-for-stocks report (private artifact, owner's account): https://claude.ai/artifact/KNXDbKGgFtLiGQ7iBVHw1S. Main takeaways: make the graded track record the front door (with a do-nothing baseline), get a Vietnamese legal read on publishing buy/hold/wait calls (the SSC warned about unlicensed recommendations in 2026), add fundamentals and foreign flows for VN tickers, web push; don't build order books, screeners, community or trading.

## Session summary, Nov 16 2026 (v13 to v17)

One long session; each round has its own section below.

| Round | What it did | Key files |
|---|---|---|
| v13 | Scheduled refreshes didn't run (GitHub dropped the schedules; the legacy Vercel cron never fired). Replaced by one timetable in code and a tick endpoint that any poker can call; Vercel Schedules (every 15 min), cron-job.org (every 30 min, emails on a late slot) and GitHub (every 3 h) poke it. Idempotent slots, late-slot 503s, public schedule report. | `timetable.ts`, `scheduler.ts`, `api/cron/tick`, `vercel.json`, `refresh.yml` |
| v14 | Scheduled interest refreshes only for users seen in the last day, with a catch-up briefing for returning users. Refactor for readers: `pipeline.ts` split into `interests.ts` / `briefings.ts` / `pipeline.ts`, `v3.tsx`/`v4.tsx` into feature files, `i18n.ts` into one file per language, one date helper, dead code removed, `.env.example` rewritten and guarded by a test. | `interests.ts`, `briefings.ts`, `dates.ts`, `i18n/`, `.env.example` |
| v15 | `page.tsx` (883 lines) split into hooks and frame components, pixel-identical to before; README rewritten with fresh production screenshots; stock-page range tiles fixed. | `components/shell/*`, `README.md` |
| v16 | Track record that teaches the model: grading on each exchange's own close (hourly in the tick), volatility-scaled flat band, skill vs "always up" with a Wilson range, Brier, results by action, calibrated confidence with the raw number recorded, redesigned sheet. Sidebar and Ask AI dock slide and fold to rails; dark-mode native controls; account menu no longer clipped. | `track.ts`, `components/track.tsx`, `globals.css` |
| v17 | Up/down moves inside the band are "no result" (also retroactively); actions must agree with directions (prompt rule + `alignAction`). | `track.ts`, `pipeline.ts`, `prompt.ts` |

Production at the end of the session: v17 live; the scheduler ran every slot since the v13 deploy (Vercel ticks every ~15 min, cron-job.org every 30 min); the first real grades came in (7 Vietnam calls for Nov 16: up/down 2/5, "always up" 2/5, flat 1/2).

## v13 (branch `v13`, Nov 16 2026): a scheduler that runs

**Why scheduled refreshes didn't run.** GitHub dropped them: since Nov 15 only one of about 12 refresh slots fired (67 min late) and the price-alert workflow never ran (0 of 8 weekday slots by 15:25 UTC Nov 16), although both workflows were "active", the cron lines were valid and manual runs worked. Not a bot-actor issue (alerts.yml was last edited by the owner; the one scheduled run's actor was the owner) and not billing. It matches many 2026 GitHub community reports of schedules never or rarely firing on new private repos on the Free plan; GitHub documents that scheduled runs can be delayed or dropped under load. The legacy Vercel cron (10:30 admin interests) showed no invocations either, and Vercel now marks Cron Jobs "Legacy" in favor of Schedules.

**What changed (and what was removed).**
- One timetable in code (`timetable.ts`); `scheduledPerDay` counts from it, so the 120b reserve can't drift from the schedule again.
- `GET /api/cron/tick` (`scheduler.ts`): lock, alerts if due, one unit, chain to the next tick. Idempotent (skip anything written since 30 min before the slot, manual refreshes included), one retry 20 min after an AI failure, slots open until the next slot (max 6 h). 503 for an hour after a slot goes late.
- Pokers only poke on an interval: Vercel Schedules every 15 min Sun-Fri (`vercel.json`, about 2,500 of Hobby's 5,000 runs a month), cron-job.org every 30 min (owner sets it up, it's also the watchdog that emails), GitHub every 3 h (about 200 Action minutes a month instead of about 1,500).
- Removed: `refreshScheduled`, `AUTO_MIN_AGE_MIN`, `INTEREST_BATCH`, `INTEREST_ROUNDS`, the shell loop in refresh.yml, alerts.yml and `/api/alerts/check` (alerts run in the tick), the cron branch of `/api/refresh`, the legacy `crons` entry.
- Monitoring: `/api/status?schedule=1` (public, no secrets: last tick and its source, last 24 h of slots as done / partial / running / late / missed); a "Scheduler" row in the admin's Status panel (8 languages).

**Rejected:** an external cron dispatching the GitHub workflow (a third party holding a repo-write token, still GitHub's queue and minutes); QStash (works, but no failure emails and an unverified free schedule count, and Vercel Schedules does the same without a new account); one Vercel schedule per slot (15-min jitter would collide sections on Groq's per-minute limit, and the times would be duplicated); making the repo public (doesn't make GitHub's scheduler reliable, would publish the prompts and these notes).

**Verified on production (Nov 16):** the first Vercel Schedule tick fired at 16:35:02 UTC (the 16:30 run, 5 min of jitter) and, through the chain alone, wrote US 16:35:14, World 16:36:20, Vietnam 16:37:25 (all 120b, 65 s apart), then the interest set(s); the slot was marked done at 16:38:43. Only one set ran there (others fresh or not active); the report now shows set counts to confirm on the next slot.

**Verified offline:** `npm test` (new `v13test.ts`: timetable math, order, 65 s gap, skip rules, retry and give-up, lock, late/missed, alerts window, route auth and 503, public report), v5test now runs the multi-user grouping through the tick; typecheck; build with and without `AUTH_*`. A production build run locally: the tick answered in 36 ms, then one poke ran a whole slot (us, world, vn, the interest set) 65 s apart through the self-chain and stopped on its own.

**Not verified yet:** Vercel accepting the `schedules` block on Hobby and the chain on Vercel (checked after the merge with `/api/status?schedule=1`); cron-job.org until the owner sets it up.

**Owner setup (once):**
1. Make a long random secret (e.g. a password manager's generator, 40+ characters). This is `TICK_SECRET`. Don't reuse `CRON_SECRET`: `TICK_SECRET` can only poke the scheduler, which never spends AI twice.
2. Vercel → the project → Settings → Environment Variables → add `TICK_SECRET` (Production) → Save. Then Deployments → the latest production deployment → ⋯ → Redeploy (env vars apply on the next deploy).
3. cron-job.org → sign up (free) → Create cronjob:
   - URL: `https://investhepi.vercel.app/api/cron/tick?src=cron-job.org`
   - Schedule: every 30 minutes
   - Advanced → Headers → add `Authorization` with the value `Bearer ` followed by the secret (one space after Bearer). Method GET.
   - Notifications: on for "execution fails" and "succeeds after failure".
   - Save, then "Test run": expect HTTP 200 and `{"ok":true,"late":[]}`. 401 means the header or the Vercel variable doesn't match (or the redeploy hasn't happened).
4. Vercel → the project → Schedules: `tick` should be listed and active; the old Cron Jobs entry is gone. Its history shows each run.
5. Optional clean-up: delete the GitHub repo variable `INTEREST_ROUNDS` and any `INTEREST_BATCH` env var (both unused now). GitHub secrets `APP_URL` and `CRON_SECRET` stay.

## v14 (branch `v14`, Nov 16 2026): 1-day cutoff, refactor for readers

**Owner decision:** scheduled interest refreshes only for users seen in the last day (was 14). The failure case is a user back after 2+ days seeing an old briefing, so `/api/me` now refreshes it in the background when it's over 12 h old (one AI call, counted against `AUTOGEN_DAILY_LIMIT`) and the page waits for the new version. Price alerts still reach users seen in the last 30 days (no AI).

**Refactor (behavior unchanged, pinned by `v14test` first):**
- `pipeline.ts` (576 lines, four jobs) split into `interests.ts` (who follows what), `briefings.ts` (key layout, reading, saving) and `pipeline.ts` (build and refresh). Moved by declaration with a script; dependencies go one way (interests → briefings → pipeline).
- `v3.tsx`/`v4.tsx` (named after releases) split into feature files: `live`, `cards`, `alerts-tab`, `palette`, `setup`, `toast`, `catchup`, `portfolio`, `track`; `Toggle` joined `primitives`.
- `i18n.ts` (3,941 lines) became `i18n/<lang>.ts`; `en.ts` defines the keys.
- One `dayIn(timeZone, at)` in `dates.ts` replaced 8 copies of the same formatter (cached per zone). `ictDay` stays as a fast fixed-offset shortcut, and a test proves it agrees.
- One `background()` helper (run after the response) replaced two copies; model defaults live only in `models.ts` (`openai-compat.ts` had dead copies).
- Removed dead code: unused exports (`IconClock`, `IconInfo`, `playbookFor`, `isCron`, `vnPriceName`, `VN_CALLS`, `SECTIONS`, `getQuote`, `sharedLanguages`), unused imports, the unused language parameter of `currentInterestSet`/`currentCallsKey`/`loadHistory`, the legacy `lastRefresh:<s>` read.
- `.env.example` rewritten from the code (it still listed removed knobs and a wrong default, and missed 12 variables); `v14test` fails if code reads an undocumented variable (checked by removing one).
- CLAUDE.md: code map and a map of what each test suite covers.

**Bugs found on the way:** `vntest` failed every evening between 17:00 and 24:00 UTC: its mock put "today's session" in the 30 minutes before now, which crosses Hanoi midnight. Real sessions never do; the mock now ends sessions at 07:00 UTC. The setup checklist still told admins to add GitHub secrets for the scheduler (8 languages fixed). The Status panel showed slot ids (`wd-0115`); it shows times now.

**Verified:** `npm test` (15 suites), typecheck, `tsc --noUnusedLocals` clean, build with and without `AUTH_*`; local production build in Chromium (wide and phone): home, command palette, Settings → Alerts / Holdings / Status, tab switches, no console errors (the only 404 is Vercel Analytics' script, which exists only on Vercel).

**Not verified:** the catch-up on production (needs a signed-in user who was away); the new files on Vercel until merged.

**Later (not done, ranked):** split `page.tsx` state (878 lines) into hooks (high UI risk, wants a visual check with the owner); split `chart.ts` (554 lines) by source; rename test suites by feature instead of round (the test map covers it for now).

## v15 (branch `v15`, Nov 16 2026): page.tsx split, README rewritten

**page.tsx (883 → 518 lines).** Its ~30 pieces of state and 20 effects now live in named hooks in `src/components/shell/hooks.ts` (viewport and wide layout, saved tab, collapsing title, briefing polling, rule-based copies, translate-on-read, new-headline dots, refresh-button state, shortcuts). The frame (top bar, sidebar, tab bar, footer, skeleton) moved to `shell/chrome.tsx`, the price strip's merge logic to `shell/strip.ts`. Removed duplication: the section-icon mapping (2×), the "99+" badge (5×), the refresh button (2×), the side cards (written once for phones, once for the desktop rail). Shortcuts read the latest handlers through a ref instead of a 12-item dependency list.

**Verified:**
- Pixel comparison against the old page: 15 views (phone: 4 sections; wide: 4 sections, track record, palette, folded sidebar, hidden dock, shortcuts), same seeded data, frozen clock, animations off. 14 identical, 1 differs by 4 pixels, the same as two runs of the old code.
- Interactions in a real browser: theme toggle (D), dock hide/reopen (] and A), catch-up (C), "/" focuses the headline search, the phone's Ask tab, the phone title collapsing to the section name on scroll. No console errors.
- `v15test` pins the extracted logic: which symbols the strip shows, live vs snapshot (an ETF's live price never replaces a real index level), chart symbols, who sees Refresh and what it says (left, limit, wait).
- `npm test` (16 suites), typecheck, unused-code check, both builds.

**README** rewritten around what the app does instead of release history. Corrected stale facts: the scheduler (was GitHub calling `/api/refresh`), per-job model routing (was "Claude → Groq → Gemini"), real world levels from VNDirect and the Treasury (said indexes fall back to ETFs and US 10Y had no source), Nifty 50 (said Sensex), one language setting (said a separate briefing language), 5 Vietnam runs (said 2). New screenshots taken from production as a signed-out visitor (real AI briefings); the four that need sign-in (alerts, Ask AI, morning email, watchlist) were removed rather than kept with the old "Invest Helper" name.

**Bug found and fixed:** the stock page's 52-week (and day) range overflowed its tile into "Volume" on wide screens (a `white-space: nowrap` rule from v4). Ranges may now wrap at the dash; previewed on the production page with the rule injected.

Signed-in views checked too (multi-user build, fake sessions): the admin and a regular user on wide and phone get My Interests, the holdings card, Ask AI and the Refresh button (the user's shows 5 presses left), no console errors.

**Not verified:** a real Google sign-in after the refactor (production, after merge).

## v16 (branch `v16`, Nov 16 2026): track record that teaches the model, panels that slide, dark-safe controls

**Owner decisions:** macOS-style toggles (sidebar top-left, chat top-right, always in the same place), keep the icon rail, refine the glass look; flat calls graded on a band from each ticker's typical move; the track record must improve predictions over time (richer prompt record, "right x of y" on each call, confidence pulled toward the record once a level has 20+ graded calls, the model's own number kept); Hold/Wait scored apart from the up/down hit rate; grade within the hour after each close.

**Why everything showed Pending:** no session had closed since calls started on Nov 16 (US calls for Nov 16 need the official close VNDirect posts the next morning; the VN calls on screen were for Nov 17). Fixed on the way: grading used New York's clock for every market, so a HOSE close was graded ~12 h late; now each exchange's own close (+15 min), and the tick grades hourly.

**Track record:**
- Grading: exchange closes, ETF stand-ins on New York hours (grading one at the European close would have used a live price), volatility-scaled flat band, `band` stored.
- Stats: up/down hit rate with a 90% Wilson range, "always up" baseline and skill (research: directional accuracy alone overstates skill because markets rise more often than not), flat calls apart, Brier score, per horizon, per action (positive = the action paid off; Wait/Sell/Trim/Avoid earn the drop avoided), per ticker, pending with "graded in ...".
- Learning loop: the prompt gets all of the above plus an instruction to lower confidence where the record is weak; each call card shows "Right x of y at this confidence"; from 20 graded calls at a level the shown confidence moves toward the real hit rate (n/(n+20)), "AI said 75%, adjusted by its record"; the model's raw number is recorded so calibration keeps learning from the model.
- Sheet redesigned (summary card with range, skill and "Early data" under 30 calls; tiles; faded thin calibration buckets; result by action; waiting list; graded list). CSV export filename fixed (it was literally `investhepi-calls${...}.csv`).

**UI:** both side panels slide with a spring (0.45 s, off with reduced motion): the shell keeps three columns, the dock stays mounted and folds to a 56px rail with its reopen button where the close button was, the sidebar's toggle moved top-left and icons don't move while labels fade; no floating Ask button on wide screens. Dark-mode native controls: `<option>` colors (the owner's white language menu), themed thin scrollbars (the sidebar's light Windows scrollbar), autofill. The sidebar account menu opens upward and floats above the page (it was cut off).

**Verified:** `npm test` (17 suites, new `v16test`), typecheck, unused-code check, both builds; in Chromium: dark mode on a light system (option colors computed as #1C1C1E / #F5F5F7, scrollbar color), a sidebar mid-animation frame, both rails folded, the dock reopen button in place and working, the account menu inside the window, the track sheet with seeded calls in English and Vietnamese, wide and phone, light and dark; the CSV header.

**Not verified:** Windows' native select popup itself (headless Chromium can't screenshot OS popups; the computed option colors are what Chrome on Windows uses); real graded calls (the first arrive after the Nov 16 US close is posted and the Nov 17 HOSE close).

## v17 (branch `v17`, Nov 16 2026): no-result moves, actions that match the call

From the first real grades (7 Vietnam calls, Nov 16): HPG "up" moved exactly 0.00% and was marked wrong; VHM was called "down" with the action "Hold".
- An up/down call whose move stays inside the ticker's flat band is now graded as **no result** (`noResult`): not a hit, not a miss, not pending. The sheet shows "–" and "{n} moved less than the ticker's usual range: not counted"; the prompt is told the count. Calls graded before v17 are converted on the next grading pass (production's HPG call included).
- **Actions must agree with the direction.** Prompt rule: up → Buy/Add/Hold/Wait, down → Sell/Trim/Avoid/Wait (Hold only for a position the investor holds), flat → Hold/Wait. Code backstop `alignAction` in `pipeline.ts`: up + Sell/Trim/Avoid → Hold, down + Buy/Add → Wait, down + Hold → Wait unless positions were given; the model's own action is kept in `aiAction`, and the shown action is what gets recorded and graded.

**Verified:** `npm test` (18 suites, new `v17test`: no result for a 0.00% move, the retroactive fix, never stuck pending, stats and prompt text, `alignAction` cases, a full refresh where the mocked model answers "down + Buy" and readers see Wait), typecheck, unused-code check, both builds.

**Not verified:** on production until merged (the HPG call should flip to no result at the first hourly grading after deploy).

## v18 (branch `v18`, Nov 17 2026): predictions apart from briefings, time zones, weekend briefings, live headlines

Plan and decisions: `docs/PLAN-v18.md`. One change during the round: the owner asked (Nov 17) for each market to have its own two predictions that predict only that market, after I flagged that Europe's 07:30 UTC run lands after London's open in summer. So World runs per market (Japan, China & HK, Europe, US stocks, oil, gold: 12 runs a weekday instead of 8) and prediction times are written in each market's local time, so summer time can't move a before-market run past the open.

**What changed**
- **Predictions** (`predictions.ts`, `llm/predict.ts`, `markets.ts`): their own prompt and schema, one market per run, the live price at the time for mid-day runs, `pred:<scope>` storage, translations on read (Vietnam pre-translated into Vietnamese), alerts after interest-set runs, `/api/predictions`. Briefings lost their calls and the track record in their prompt (smaller prompts, Flash-Lite first).
- **Timetable and scheduler**: briefing slots every day; prediction slots in local time with `tz`; each item has its own deadline (before market: the open; mid-day: 90 min; briefings: the next run of the same briefing); two lanes (predictions, briefings) each 65 s apart; headline refresh in the tick. `vercel.json` and refresh.yml now poke every day (Saturday briefings).
- **Track record**: phases (`:d` before market, `:m` mid-day, `:w` weekly), weekly end date and holiday rule, `closed`, mid-day calls measured from the price then (`baseChg`) or kept out of the headline without one (`noLiveBase`), stats by independent ticker-day (`rateByDay`), by phase; rows show when made and when graded.
- **Headlines**: `news:<section>` refreshed every 15 min; `news:ib:<hash>` every 30 min only while the set is being read (`news:active`, marked by the page's 5-minute `/api/news` polls), and at once for a reader back to a stale list; per-host 30-min rest after a 429/503; the page shows the live list with "Key" by id.
- **AI use in the Status panel** (admin): per model, today's tokens or requests against the free allowance, what it's for, and any cooldown (it was only in `/api/status` before).
- **Time zone setting**: Settings → Appearance & language → Time zone (Automatic, Hanoi, New York, UTC, then every zone with its offset), saved per account and device; briefing, history, prediction, track-record, status and banner times follow it with the zone named, plus "your time" next to market times when they differ.
- **UI**: the Predictions card under the briefing; catch-up, "since your last visit", Ask AI (suggestions and context), the stock page and the watchlist read predictions; the morning email lists them.

**Free-tier cost (counted)**
- gpt-oss-120b: 16 shared + up to 4 admin prediction runs a weekday. Real prompts built from live data on Nov 17: 2.3K-2.8K input tokens + 0.6K-1.8K reserved output (US before market, 8 calls, is the largest at ~4.6K). About 60-80K of the ~194K usable a day; the reserve (`reserveFor120`) keeps that much for them.
- Gemini Flash-Lite: briefings now start there: 14 shared + 6 admin a day, every day, plus 4 per active user; with 10 active users ~60 requests a day per model, of 500.
- qwen (translations): Vietnamese pre-translations of shared briefings rose from 11 a weekday (6 Sunday) to 14 every day, plus 2 Vietnam prediction translations a weekday (small). Other languages translate on first read; a section's predictions translate in one call.
- Headlines: ~1,350 feed requests a day for World/US/Vietnam, plus ~24 per hour (12 feeds every 30 min) for each interest set only while someone is reading it.
- Vercel Schedules: every 15 min every day = ~2,980 runs a month of Hobby's 5,000.

**Verified**
- `npm test` (19 suites, new `v18test`), typecheck, build with and without `AUTH_*`.
- Real data from the sandbox (`NODE_USE_ENV_PROXY=1`), fake AI only: every market's prompt built from live prices, technicals and headlines (VN prompt audited line by line: levels, dates and headlines all trace to the sources); prompt sizes as above; calls recorded with the right sessions (VN before the open → today; Tokyo after its close → next session; Hang Seng before 09:30 HK → counted from the previous close).
- Browser (production build, seeded data, frozen clock): wide and phone, light and dark, Vietnamese and the other 6 languages on World; the Predictions card, the track sheet (made/graded labels, closed, uncounted), the time zone setting; no console errors except the expected translate 502 (no AI key here) and Vercel Analytics' 404.

**Found and fixed on the way**
- Nasdaq's daily history lags by hours (at 01:30 UTC Tuesday SPY's history still ended Friday while Monday was -2.3%); the prediction prompt now says "the <date> session's close isn't in the data yet" instead of passing an older close off as the latest.
- Graded-at labels showed close + 15 min of settling (15:00 for HOSE); they show the close (14:45) now.
- An expanded prediction stretched the card next to it; World's six markets now sit in a grid on wide screens without repeating the market name.

**Follow-up the same day (owner's notes)**
- **Latest data everywhere:** `freshenQuotes` fills a close the daily source hasn't posted yet from an intraday series (Eastmoney for indexes and WTI, the 1-day chart's last regular-session bar for US stocks/ETFs), checked against our previous close; briefings and predictions use it, grading doesn't (official closes only).
- **Intraday for Japan, China/HK and Europe:** new `eastmoney.ts` (researched from the sandbox: Eastmoney's trends2 answered for Nikkei, Hang Seng, DAX, FTSE, Euro Stoxx 50, S&P 500, Dow, WTI, with previous closes matching ours exactly for S&P, Dow, DAX, FTSE; its "NDX" is the Nasdaq Composite; Shanghai and KOSPI timed out; gold unreliable). It's a 1-day chart source, so the strip, live quotes and the chart sheet show the same live level. Rejected or not tested: Yahoo (refuses Vercel), Stooq/CNBC/Investing (bot checks), Nikkei's official CSV and stoxx.com files (couldn't be tested this session).
- **"Unavailable" instead of stale predictions:** a run whose benchmark lacks the latest close or a live price makes no AI call; the card says what was missing ("no live price for Hang Seng", "DAX's close for Mon isn't out yet"); retried once 20 min later. Calls on other tickers without fresh data are dropped. `noLiveBase` calls no longer come from mid-day runs.
- **Wider before-market windows:** Japan 07:30 Tokyo, China & HK 08:00 HK, Vietnam 07:45 Hanoi, Europe 06:30 London (75-120 min before the open; was 30-45).
- **Interest-set headlines** only while someone reads the set (see Product rules), **AI use per model** in the admin's Status panel.
- Network: the `invest-helper` environment got six market-data hosts (Eastmoney x2, Nikkei, HSI, STOXX, FT) for research; an automated check then blocked further outside requests from the sandbox, so Nikkei/STOXX/HSI/FT weren't tested.

**Stress test before the merge (Nov 17, 02:40 UTC, real data from the sandbox, fake AI only)**
- Freshness audit of every symbol each section shows (75): found 24 with Friday's close on Tuesday morning and 7 missing in a big batch. Causes and fixes: Nasdaq's intraday "previous close" field is unreliable (SPY read 754.37 at 01:30 and 757.12 at 02:45), so the check rejected good closes: Nasdaq fills now take the same provider's regular-hours bars without that check, plus a 25% sanity bound; a 24-symbol cap in the fill and a 30-symbol cap in the fallbacks were too low (now 48 and 40); Eastmoney failed intermittently, so requests go one at a time with one retry on network errors/5xx and the last good answer is saved; oil's futures session was dated wrong (a CME day starts 18:00 New York the evening before), which the previous-close check had caught. After the fixes: Vietnam, US and interest sets fully current except gold (no intraday source; VNDirect posts it by ~07:00 UTC, before the 12:30 run); World current except Shanghai, KOSPI, Nifty and FX pairs (dated daily closes).
- Every market's prediction run at that moment: Vietnam (mid-day, live from DNSE), Japan and China & HK (mid-day, live from Eastmoney), Europe and US (before market, Monday's closes filled) ran; gold was "unavailable" (no Monday close yet), as intended.
- Track record on production's real records (public CSV for VN, US, World) through v18 grading with real prices: old grades unchanged, all labeled before market; Monday's US and World calls had been pending 5+ hours after the close (daily sources post late), breaking "graded within the hour". Fixed: provisional grades from the intraday close (S&P, Nasdaq 100, Dow, SPY, QQQ, DIA, Nikkei, Hang Seng, oil graded at once), re-graded from the official close when it posts. Only Shanghai and gold wait for the official close.
- Mid-day for US-hours benchmarks without a live level (e.g. gold): the same-hours ETF's move today (GLD, SPY, DIA, QQQ, IWM, USO).

**Verified on production after the merge (read-only, Nov 17 02:52 UTC)**
- The new build answered `/api/predictions` 2 minutes after the push.
- Eastmoney reaches Vercel: `/api/chart?range=1d` for Nikkei, Hang Seng, DAX, S&P 500 and WTI all came back with `"source":"eastmoney"`, live levels and the right previous closes (e.g. Nikkei 58,956.67 vs 59,662.02).
- Found: the schedule report listed the past 24 h of new slot ids as late/missed (they never existed) and the tick would answer 503 for an hour; fixed with `TIMETABLE_SINCE` (slots before the cut-over aren't reported).

**Check-in 1 (Nov 17, 03:36 UTC, read-only)**
- Ticks run on v18: headlines refreshed at 03:30 (World, US, Vietnam: 60 each); the 02:15 US briefing ran at 03:01 on Gemini Flash-Lite.
- First real AI prediction: Japan mid-day at 03:01 UTC (12:01 Tokyo) on gpt-oss-120b, measured from the live Nikkei (58,956.67 = Eastmoney's live level), recorded as `2026-11-17:^N225:m` with `baseChg` -1.182; graded at Tokyo's 15:30 close.
- Audit: start point and "±2.8%" (typical day) trace to the data; the "20-day range high 66,929" couldn't be checked (production's technicals come from a different source than the sandbox's 65,712). Fixed for next time: each run's data block is stored and served at `/api/predictions?section=&inputs=1`; the track CSV gained phase, base_chg, no_result, provisional, closed and graded_on columns.

**Audit check-in (Nov 17, 04:51 UTC, read-only)**
- China & HK mid-day (04:16 UTC, 120b): start point 23,571.61 (-0.8%), downtrend and range trace to the data; Shanghai skipped (no live price), as designed. "RSI near 50" for 46 is loose but not invented.
- Vietnam mid-day (04:46 UTC, 120b): every start point, "≈1% below" level, RSI (32, 29) and the ±2.4% band trace to the data; track rows have phase=mid and base_chg.
- Found: the model added calls on BID, VND and PNJ "following the sector", though the prompt allows extra tickers only with a headline about them. Fixed with a code guard: a non-benchmark call is kept only if a headline the run saw names the ticker (BIDV and Novaland had one; VNDirect and PNJ didn't). Also: the stored audit input now includes the headlines, so headline-based reasons can be checked too.

**Not verified (at merge time)**
- ~~Eastmoney from Vercel~~ (works, see above). If Vercel can't reach it, Japan, China/HK and Europe before-market runs will mostly show "unavailable" (VNDirect posts their closes the next morning, after those runs), and their mid-day runs will too. Check right after the merge: `/api/chart?symbol=%5EN225&range=1d` should say `"source":"eastmoney"`.
- A real AI prediction (no AI keys in the sandbox): check the first production runs (prompt rules, calls per market, the action/direction fix) at the first slot after the merge.
- Mid-day live prices in production: Vietnam (DNSE 1-day chart), US ETFs (Nasdaq intraday), and Japan/China/Europe/S&P/Dow/WTI through Eastmoney if Vercel reaches it; otherwise those runs are "unavailable".
- The tick's headline refresh and the two lanes on Vercel (check `/api/status?schedule=1` and that `news:*` lists move every 15 min).
- Real graded weekly calls (the first weekly grades come 5 trading days after the merge).

## Open items / known gaps

- BLS release dates (CPI, jobs) return 403 to Vercel, so the calendar has no US macro releases; the AI was inventing dates (now told not to). Options: hardcode the BLS schedule yearly like FOMC (needs dates checked on bls.gov), or fetch it from GitHub Actions.
- FOMC 2027 dates aren't in `calendar.ts`; needed before mid-December 2026.
- Yahoo is blocked from Vercel and from GitHub's runners. Real daily levels now come from VNDirect and the US Treasury (see above); still missing: intraday for non-US indexes, Euro Stoxx 50, DXY, VIX, non-US listings (Samsung, Tencent, LVMH). The Treasury file hasn't been confirmed reachable from Vercel yet (BLS, another .gov site, refuses Vercel); check `/api/quotes?symbols=%5ETNX` after deploy.
- VNDirect's world closes are posted the next day, so Asian indexes in the 01:15 UTC run are one session old (labeled with their date).
- Nasdaq has no intraday data for share classes (BRK-B): those get no 1-day chart while Yahoo is blocked.
- Usage counters aren't atomic (two calls at once can undercount slightly); the 3% headroom absorbs it. Groq's daily reset time isn't documented; the tracker assumes UTC midnight.
- Gemini model ids `gemini-3.5-flash-lite` / `gemini-3.1-flash-lite` are assumed from AI Studio's names; override with `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` if the API names differ (a 404 just falls through to the next model; check `aiUsage.lastError`).
- `/api/status` tells anonymous visitors which AI providers and services are configured (no secrets).

- Translations are covered by tests with a fake AI but haven't been checked with a real AI key; verify output quality on the live site.
- No holiday calendars: a daily call on a holiday is marked "market closed, not graded" once a later bar exists or two days pass; a weekly call whose 5th day is a holiday grades on the previous session. The timetable still runs prediction slots on holidays (cost: one wasted run per market) and the open/closed pill doesn't know them.
- Nasdaq's 1-day series includes extended hours (04:00-20:00 New York), so the strip's evening "live" price for US ETFs is an after-hours print (briefing and prediction data now take the regular-session close; the strip itself doesn't yet).
- Shanghai (000001.SS) has no intraday source from the cloud: China & HK's benchmark is the Hang Seng, so Shanghai calls are dropped when its data isn't current.
- cron-job.org: if the owner's job runs on weekdays only, set it to every day (briefings run on weekends now). Vercel Schedules and GitHub were changed in the repo.
- Time zones: calendar event times ("14:00 ET") stay in their source's zone, labeled; converting them is a later step.
- Interest sets saved in Vietnamese before v8 get their first English briefing on the next scheduled run.
- Alert emails to other users need a verified Resend domain or Gmail SMTP (Resend's test sender only reaches the account owner).
- After v17's deploy: HPG's Nov 16 "up, 0.00%" call should flip to "no result" at the first hourly grading pass (~20:26 UTC Nov 16); check `/api/track?section=vn` (`direction.noResult` >= 1, up/down 2/4). VHM's old "down + Hold" keeps its action (the fix applies to new briefings only).
- First US grades: the Nov 16 calls need VNDirect's posted official closes (next morning, Asian time), then the next hourly pass.
- Not verified with real users: a real Google sign-in after the v15 refactor; the Windows native `<select>` popup in dark mode (computed option colors were checked, the OS-drawn popup can't be screenshotted headless).
- `docs/PLAN.md`, `PLAN-v3.md`, `PLAN-v4.md` are historical design notes from early versions; some details there are out of date (the README and this file are current).
