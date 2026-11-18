# Handoff: goals, rules and state (Nov 2026)

Read this with `CLAUDE.md` (summary, commands, code map, working rules) and `docs/ARCHITECTURE.md` (how the code works). This file holds the *why*: product goals, decisions the owner made, how they like to work, and what's open.

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

The general working habits are in the owner's `how-i-work` and `how-i-think` skills; the InvestHepi-specific rules (stress testing, research, delivering, lines not to cross) are in `CLAUDE.md` under "Working with the owner", so they load in every session. The owner answers questions by number ("1 A, 2 yes"), says "go" to start a planned round and "merge" to merge it; anything that can only be checked later (a deploy, a close, the next tick) is a scheduled check-in, never a wait inside the session (owner, Nov 17); when busy they ask for the plan and then the whole job without check-ins. In short: direct, concise writing with no em dashes or jargon; stress-test ideas and give other perspectives; research before building; short branch names; ask before merging to `main`.

## Current state

- `main` = v18, deployed on Vercel at `investhepi.vercel.app` (Nov 17 ~02:52 UTC).
- Scheduler fully set up (Nov 16): Vercel Schedules from `vercel.json`, the owner's cron-job.org job (`TICK_SECRET` in Vercel, failure emails on), GitHub backup every 3 h. Watch it at `/api/status?schedule=1`.
- Multi-user mode is on (Google sign-in via Auth.js). Vercel env vars in use: AI keys (`GROQ_API_KEY`, `GEMINI_API_KEY`), Upstash (`KV_REST_API_*`), `APP_PASSWORD`, `CRON_SECRET`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `OWNER_EMAIL`, optionally `CONTACT_EMAIL` (shown on `/privacy` and `/terms`). GitHub repo secrets `APP_URL`, `CRON_SECRET` drive the GitHub backup poker.
- Optional knobs: `TRANSLATE_DAILY_LIMIT` (80), `AUTOGEN_DAILY_LIMIT` (6), `REFRESH_DAILY_LIMIT` (admin, 10), `USER_REFRESH_DAILY_LIMIT` (5), `USER_REFRESH_GAP_MIN` (90), `RULES_DAILY_LIMIT` (30), `ASK_DAILY_LIMIT`, `TICK_SECRET` (lets cron-job.org poke the scheduler and nothing else), model overrides `GROQ_MODEL`, `GROQ_SMALL_MODEL`, `GROQ_TRANSLATE_MODEL`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, limits `GROQ_TPD`, `GEMINI_RPD`.
- Google OAuth consent screen: branding filled in, privacy/terms pages exist; publishing needs no logo (a logo triggers brand verification).
- A personal Claude cloud environment named `invest-helper` exists with network access to the market-data hosts (Yahoo, Nasdaq, DNSE, Vietcap, VNDirect, ...) for live testing. Node needs `NODE_USE_ENV_PROXY=1` there.
- Tests: 19 offline suites (`npm test`), all passing (v18test added Nov 17).

## Session summary, Nov 17 2026 (v18)

One long session; the details are in the v18 section below.

**Goal (unchanged):** catch up on market news fast and act on it, on free tiers only. Briefings explain; predictions make the graded buy / hold / wait calls; the track record grades every call at its market's close and feeds the record back to the model.

**Rules set this session (owner)**
- Predictions are a separate AI job; briefings make no calls. Two runs per market per weekday (before market, mid-day), each run predicts only its own market (World split into Japan, China & HK, Europe, US stocks, oil, gold); interest sets split into US and Vietnam parts. Weekly calls only from the before-market run. No predictions on weekends.
- Grading: daily at that day's close on the ticker's own exchange (mid-day from the price at that moment); weekly at the 5th trading day's close (holiday: the previous session); holiday weekday = "market closed, not graded"; graded within the hour (provisional), re-checked against the official close.
- Every prediction uses the latest data (latest close; live price during the session); otherwise "unavailable" with the reason, never stale. Calls on a non-benchmark ticker need a headline naming it.
- Prediction times are in each market's local time, starting 75-120 min before the open; briefings every day (US 5 a day, weekends at the weekday rate).
- Models: predictions on gpt-oss-120b (falls back to Flash-Lite and 20b, then one retry; never invented), briefings on Gemini Flash-Lite first.
- Headlines: shared sections every 15 min without AI; an interest set every 30 min only while someone reads it, and at once when they sign in or come back.
- Time zone setting (device default, every time labeled; charts stay in exchange time).
- Workflow: anything that can only be checked later (a deploy, a close, the next tick) is a scheduled check-in, never a wait or poll inside the session.

**What changed:** v18-docs merged; v18 built (predictions job, local-time timetable with per-item deadlines and two lanes, track record phases/weekly/closed/provisional/by-day stats, live headlines, time zones, Predictions card, AI use in the Status panel); latest-data layer (Eastmoney intraday for Nikkei, Hang Seng, DAX, FTSE, Euro Stoxx, S&P, Dow, oil; `freshenQuotes` for late closes; same-hours ETF moves for US-hours mid-day starts); stress-test fixes (Nasdaq fills, caps, Eastmoney reliability, futures dating, provisional grades); production fixes (phantom late slots, stored audit inputs, headline guard for extra tickers).

**State at the end:** `main` = v18 (c0b9d72) live; headlines refresh every 15 min; first real predictions ran (Japan, China & HK, Vietnam mid-day) from live prices; scheduled check-ins at 08:35 UTC (first graded closes, Europe's before-market run) and 22:20 UTC (US runs and grading). Open items are listed at the end of this file.

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


## Docs reorganized, Nov 17 2026 (branch `setup`)

- **Changed:** `CLAUDE.md` went from about 40 KB to 12 KB. The architecture section and the test-suite map moved unchanged to `docs/ARCHITECTURE.md`; the generic working habits now point to the owner's `how-i-work` and `how-i-think` skills, with the InvestHepi-specific rules kept in full; a line on what to keep when compacting was added. Round sections v11 and v13-v17 (and the Nov 16 rounds) moved unchanged to `docs/HANDOFF-archive.md`. The repo copy of the `product-rounds` skill was removed: the owner's account copy has all of it plus a section on picking the next round, and two skills with one name made routing unpredictable.
- **Verified:** every line of the old `CLAUDE.md` and `HANDOFF.md` exists in the new files except the reworded pointers (checked by script); cross-references to moved sections updated. Typecheck and both builds pass; every suite passes except `vntest`, which fails the same way on `main` (Nov 18 06:58 UTC): "Japan unavailable without Tuesday's close" depends on the day it runs. Only a comment in `v15test.ts` changed in code.
- **Not verified:** how a fresh Claude Code session on this repo behaves with the shorter file (watch the first session).
- **Open:** `vntest` line ~238 assumes a Tuesday close; make it date-independent (freeze the clock) in the next round.

Older round sections (stress test, budget, prices, v11, v13-v17 and their session summary) are in `docs/HANDOFF-archive.md`.

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
