# Handoff: goals, rules and state (Nov 2026)

Read this with `CLAUDE.md` (architecture, commands, technical rules). This file holds the *why*: product goals, decisions the owner made, how they like to work, and what's open.

## Goal

**Changed Nov 19 2026 (owner, v19): news is the main goal.** InvestHepi helps a curious reader (with or without a finance background, Vietnamese first) catch up on important and interesting news, understand it, see its effect on markets and the world, and learn general knowledge along the way. Price predictions stay as a side goal: they are the "impact" part of a story. The description below is the v18 product, which v19 reshapes (see the v19 section).

v18 product: InvestHepi helps someone catch up on market news fast and act on it: a short AI briefing per section (summary, trend, events, movers, scenarios), separate AI predictions with buy / hold / wait calls, confidence, triggers and risks (twice a weekday per market), plus a track record that grades every call at its market's close. Audience: the owner first, then Vietnamese investors (the UI is in 8 languages, Vietnamese matters most).

Hard constraint: **free plans only** (Vercel Hobby, Upstash free, Groq/Gemini free tiers, GitHub Actions). Every feature must keep AI token use and request volume low.

Design: Apple-like and quietly futuristic. Ambient light background tinted per section, translucent cards, clean type, works on phones.

## Product rules the owner decided

- **Sections:** My Interests (personal), World, US, Vietnam.
- **Shared sections never show personal stocks.** World = world indexes + global giants + macro. US = S&P 500, Dow, Nasdaq 100, Russell 2000 + mega caps. Vietnam = VN-Index, VN30, HNX, UPCoM + banks + large caps. The AI's calls in shared sections are on market groups, not users' stocks.
- **World has no market open/closed pill** (it spans many exchanges).
- **Refreshing (decided Nov 16, mechanism changed in v13):** briefings refresh on the app's own timetable (`src/lib/timetable.ts`), run by a tick that Vercel Schedules, cron-job.org and GitHub poke on a plain interval; a run that's late or duplicated never spends AI twice, and a slot more than an hour late is reported. Users' interest sets refresh automatically 5 times a day (01:15, 04:35, 08:10, 12:30, 21:20 UTC; 04:35 = 11:35 Hanoi added in v19), the admin's 6 times, **but only for users seen in the last day** (decided Nov 16, v14); someone back after longer gets one catch-up briefing in the background when they open the app (if theirs is over 12 h old). Signed-in users can also refresh their own My Interests by hand: 5 a day, 90 minutes apart, on a lighter model (Gemini Flash-Lite); every press writes a new briefing and tells them how many presses are left. The admin can refresh any section, 10 a day, on the best model. Shared sections can't be refreshed by users. A newly saved interest set gets its first briefing automatically, once.
- **Schedule (v18):** briefings every day (weekends at the weekday rate): World 4, US 5 (02:15, 12:30, 15:30, 17:00, 21:20 UTC), Vietnam 5; the admin's set 6, users' sets 5 (04:35 added in v19: 01:15, 04:35, 08:10, 12:30, 21:20 UTC). Predictions on weekdays only, two per market in the market's own local time (Japan 07:30/11:45 Tokyo, China & HK 08:00/12:15 HK, Vietnam 07:45/11:35 Hanoi, Europe 06:30/12:00 London (the source of truth is `src/lib/timetable.ts`), US, US stocks, oil and gold 07:30/12:00 New York; interest sets split into US and Vietnam parts on those clocks).
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

## v19 (branch `v19-overhaul`, started Nov 19 2026): full overhaul, news first

**Status (Nov 21): v19a built, reviewed and stress-tested on `v19-overhaul`; waiting for the owner's merge decision. v19b next.**

**Owner decisions (Nov 19)**
- Overhaul scope: code health plus product direction (1B); deep audit (2B); Claude builds each fix itself, `plans/` optional as a record (3A); product rules are open to change (4B); split sessions at handoff points (5A); branch `v19-overhaul` (6); no reference apps (8).
- Reported problems (7): (a) iPhone Safari home-screen app hides sign-in and the top bar; (b) stock prices disagree between screens; (c) briefings feel stale or slow to appear.
- **New goal: news first** (see Goal). Story cards, all accepted as recommended:
  1. A story is a group of headlines about one event from several outlets, explained once.
  2. Explanations use titles and snippets from every outlet in the group plus our price and macro data; no full-article fetching; each part may say "not clear from the reports".
  3. Ranking: outlet count + whether a touched market moved + the model's importance score; about 1 in 5 slots for "interesting" (science, culture).
  4. Written for a curious reader with or without finance background; terms defined or linked.
  5. Card: title + outlet count, what happened, why it matters, effect on markets (today's moves from our data), effect on the world, similar past events, concepts, sources.
  6. Past events only from a curated library: expand `analogs.ts` to ~50 researched entries (date, what happened, measured market move, source link), owner reviews the list; the model cites only from it or says "no close precedent", and says what is different this time.
  7. 6 stories per shared section per run (5 important, 1 interesting); My Interests up to 6 about followed stocks.
  8. Cards at each briefing slot, plus a big new story (many outlets at once) gets a card within ~15-30 min via the headline tick, max 6 extra AI calls per section per day.
  9. Page order: "The big picture" (3 lines), story cards, markets (strip, movers, mood), predictions. Summary/trend/events merge into cards; scenarios become a "what to watch" line in a card.
  10. Concept cards: up to 3 concepts per story, written right after the story in the same tick (readers never wait), max 10 new a day, cached forever, translated once per language. Recall questions and a weekly recap are a later round.
  11. Predictions keep running unchanged this round; the card moves below the news; each call links to the stories behind it.
  12. News may use up to about half of the Flash-Lite and qwen free allowance.
  13. Shared-section story and concept cards pre-translated into Vietnamese; other languages on first read.
- v19 includes audit rows 1-29; row 30 (splitting large files) goes through the design step. Holidays: a holiday and early-close table for 2026-2027 (US, Vietnam, Japan, Hong Kong, Europe), dates checked on each exchange's official calendar. FOMC 2027 dates too.

**Fix-plan decisions (owner, Nov 19, second grilling round, all as recommended)**
1. Two merges: **v19a** = phases A-C (tests and CI, the three reported problems, bugs, security); **v19b** = phases D-E (news-first build, cleanup). Ask before each merge.
2. After the US close, the strip and chart show the regular-session close, with a small separate "after hours" figure.
3. The page reloads the briefing when the reader comes back after 5+ min and every 10 min while open; only the visible tab polls news and predictions.
4. Add the 04:35 UTC slot (11:35 Hanoi) to every user's My Interests (5 a day; +1 Flash-Lite request per active user per day).
5. Pre-translate each My Interests refresh into the languages of that set's followers seen in the last day.
6. Alert emails go only to the Google account's own address (the owner may set any).
7. Daily AI ceiling: when a model passes ~70% of its free allowance, user-triggered AI work (catch-ups, manual refreshes, first briefings) pauses until the next day; shared and admin runs continue; users see "busy today".
8. Predictions on phones sit below the markets, folded by default to each market's main call.
9. Holiday dates live in a table in code; a test fails from Dec 1 if next year's dates are missing.
10. v18 briefings keep showing until the first v19 run replaces them; history shows both formats.

**Design decisions (owner, Nov 20, architecture grilling round 1, all as recommended unless noted)**
- Architecture report: 6 candidates (current-quote module, story clustering, story explainer + past-event library, section data module, story job + store, file splits). Order: 1 (quote), then 2+3 (stories) for v19b; 4 and 6 built as described; story cards stored beside `Digest.analysis` so v18 briefings stay readable.
- Quote module (row 4, also rows 6, 7, 15): Q1 one server module (`src/lib/quote.ts`) returns, per symbol, the regular-session price (the close once the session ends), previous close, day change, session date and state, a separate after-hours or pre-market figure, basis (real level / ETF stand-in / estimate), currency, stale + as-of, source; every screen reads only it. Q2 pre-market treated like after hours. Q3 the chart header always shows the current quote and day change, with the selected range's change beside it. Q4 stale = live price 15 min without an update during its session, or a daily-only price older than the latest finished session; the label is never dropped by an overlay. Q5 an ETF stand-in price is never shown as a level (its % with "via <ETF>"); alerts on stand-ins are % only, existing level alerts on them are paused with a note. Q6 portfolio: separate subtotals per currency, no conversion. Q7 (owner condition: must handle holidays across up to a month) 5D = the close 5 sessions back (holidays have no bar); 1M = the last close on or before the same calendar date one month earlier on the exchange's calendar (not 21 sessions, which drifts over Tet). Q8 live polling follows each symbol's exchange hours (FX, futures, Bitcoin near-24h). Q9 pin the untested behaviours first, then build the module, then move callers one commit at a time.
- Q10 pre-translation of My Interests capped at `PRETRANSLATE_DAILY_TOKENS` (default 50K qwen tokens/day, 25%): admin's set first, then sets with most followers; the rest translates on read (built, row 5).
- Q11 My Interests headlines also polled every 30 min while its tab isn't visible (2 small requests per reader per hour) so its list and dots stay fresh.

**Progress (Nov 20)**: on `v19-overhaul`: phase A (clock-pinned tests, one runner `scripts/run-tests.ts`, CI `.github/workflows/ci.yml`, v19 parts in `scripts/v19/`), row 2 (safe areas), row 3 (`shell/section-data.ts`), row 5 + fix-plan items 4, 5 (translations, 04:35 slot). Each reviewed with review-code + thermo-nuclear; findings fixed before merge. Not verified yet: real iPhone, Upstash lock-release script, real translation token counts.

**Handoff (Nov 21, end of the v19a session)**
- Goal: v19 overhaul, news first, on `v19-overhaul`. v19a (phases A-C) is done there; v19b (phases D-E) is next.
- Decisions: this section (fix plan 1-10, design Q1-Q11, stories Q12-Q19 with 5 important + 2 interesting, Q20 verify by opened pages, Q21 analogs fixed). Owner approved merging v19a to `main` on Nov 21; the push was blocked by the session's permission guard, so it is NOT merged yet.
- Changed: see "v19a summary" above (79 commits on `v19-overhaul`).
- Ruled out: Next 16 this round, Upstash changes before measuring, full-article fetching, past events from model memory, cross-language grouping, one AI call per story, a strict script-src CSP without nonces.
- Open items: (1) merge v19a to `main` (owner's approval stands; needs a push the guard allows, or the owner merges), then a check-in ~5 min later: new build live when `/api/status?schedule=1` returns a `holidayGaps` field, then read-only endpoint checks and a browser pass (wide + phone); (2) owner reviews the verified past-event list (64 entries; scratchpad copy `past-events-verified.md/json` may be gone in a new session: re-run the verification or ask the owner for the reviewed list); (3) cleanup leftovers for row 30: duplicated 45/30 headline defaults (prompt.ts / llm/index.ts), repeated id parsing in schema.ts.
- Next step: v19b. Design the story modules with codebase-design (story clustering, story explainer + past-event library, story job + store; interfaces, seams, tests), count AI calls/tokens per day against the free limits, then build D (rows 21-22 news foundation, 24 live headline translation, story cards, concept cards, big-story trigger, new feeds, page order: big picture, stories, markets, predictions folded on phones) and E (rows 25-27, 29-30), one fix per commit, pinned tests first, review-code + thermo-nuclear per fix, stress test, ask before merging v19b.
- Working pattern that worked: builders in worktrees (Sonnet for scoped fixes, Opus only for the hardest design work and big reviews), reviews before every merge, cherry-pick onto `v19-overhaul`, `npm test` twice + typecheck + both builds before push.
- Skills to load next: how-i-work, how-i-think, codebase-design, review-code, thermo-nuclear-code-quality-review; grilling for new decisions.

**v19a summary (Nov 20-21, branch `v19-overhaul`, not merged to `main`)**
- Changed (each fix reviewed with review-code + thermo-nuclear before merge, findings fixed, regression tests in `scripts/v19/`): phase A (clock-pinned suites, one runner, CI, per-run `STORE_DIR`); rows 2, 3, 5 (safe areas, `shell/section-data.ts`, translations + 04:35 slot + pre-translation cap); rows 4/6/7/15 (`src/lib/quote.ts` + `quote-view.ts`: one current quote everywhere, regular close vs after hours, lunch breaks, early closes, per-symbol polling, per-currency portfolio, ETF stand-ins never shown as levels, same-hours ETF estimate only one session ahead); row 9 (`holidays.ts` 2026-2027 incl. CME, year guard); rows 8/10/12/13/14 + Q11 (grading failures visible, failed runs reported, outages expire instead of "closed", 120b hold-off); rows 11, 16-20 (empty AI replies rejected, alert emails to own address, AI ceiling per model, per-IP limits, headers, generic errors); row 23 partial (`analogs.ts` figures without an opened source removed); row 28 tests.
- Verified: `npm test` (20 suites) twice per merge, typecheck, both builds; stress test on real prices (10 symbols agree across strip, chart 1D/5D/1M, watchlist; production agrees), fresh-briefing timing, injected iPhone safe areas, Thanksgiving / Nov 27 / Japan Nov 23 clocks, 6 of 8 languages in the UI (all 8 have the keys), phone + wide, light + dark, no console errors; production World briefing audited line by line (no invented numbers).
- Not verified: a real iPhone; Upstash-specific paths (Lua lock release, pipelined counters) against live Redis; real AI calls and translation token counts (no keys in the sandbox); multi-user UI (blocked-email note, busy toast, expired label); official exchange holiday pages (unreachable; dates from search results quoting them, provisional ones flagged); when Nasdaq corrects its evening daily row.
- Open: owner reviews the verified past-event list (64 entries) before story cards cite it; owner decides the v19a merge to `main`; then v19b (rows 21-22, 24-27, 29-30, story pipeline Q12-Q19, page order).

**v19b progress (Nov 25, branch `claude/brave-cerf-ccrvoy`, based on `v19-overhaul`; not merged)**
- Owner answers (Nov 25): v19a goes to `main` by PR #1 (open, CI green, waiting for the owner's merge); past-event list re-verified by opened pages (2 Sonnet agents) and published for review (https://claude.ai/artifact/Tg7zPxNLwYbEFdpfgmfuq2, data `docs/research/past-events-v19b.json`: 80 entries, 16 dropped); until approved, cards say "no close precedent"; the Vietnam section is written in Vietnamese; no big-story trigger for My Interests; budget from estimates; design done in-session (`docs/DESIGN-v19b.md`).
- Built, each reviewed (review-code + thermo-nuclear from D6 on; D1-D5 and D9 reviewed in-session without the skills loaded) and merged with `npm test` twice + typecheck + both builds: D1 row 21 clustering (review: opposite moves, dates, unique ids); D2 row 23 feed text (caps, undated items, headlines-are-data rule); D5 explain call (row 22 folded in: Gemini gets the full prompt); D6 story job + pipeline + per-card translation (review: one AI call per run, Q14); D7 concept cards; D8 big-story trigger (review: one try/finally in the tick); D9 interesting feeds; D10 news-first page (review: card % follows the strip's current quote). D11 row 24 live headline translation (cached per headline, 40 a request); E1 rows 25-26 (Flash-Lite reserve for scheduled runs: 33 requests at 09:00 UTC on a weekday; locks on catch-up, headline and concept translation; review: a headline request that loses the lock returns at once, no Redis polling); E2 rows 27, 29, 30 (sheets, palette and chat lazy-loaded: first-load JS 231 → 222 kB; docs drift; one constant for the 45/30 defaults; sections.tsx and sheets.tsx split by feature, 16 screenshot pairs pixel-identical (one 2 px pair is noise); globals.css left whole because a test reads it by path).
- Stress test (Nov 25, real feeds, no AI keys): clustering + picking + prompt on World, US, Vietnam. Found: Taiwan's elections in three clusters took 3 of 5 important slots. A merge pass was tried and rejected (it merged two different Ukraine war events, Nvidia's fall with gold's, Belize with Taiwan's elections); fixed instead in the picker (one card per subject). Prompt size about 2.0-3.3K tokens (estimate, chars/3) for 7 stories, inside Groq's ~5K input room, so the Groq fallback should rarely drop stories. Google News rate-limited the sandbox and BBC/Al Jazeera/NPR/CNBC are unreachable from it, so US was empty on one run.
- Verified on real feeds: Vietnam clustering (216 headlines → 137 stories; real duplicates grouped, daily columns kept apart). Feeds checked from the sandbox: VnExpress Khoa học công nghệ and Giải trí, Google News Science/Health (en) and Khoa học (vi); BBC/Guardian/NPR/NASA/ScienceDaily/Smithsonian/Tuoi Tre/Thanh Nien unreachable from the sandbox, not added.
- Not verified: a real AI-written story run (no keys in the sandbox), real token counts, translated cards in the UI, a real iPhone.
- Known limits: one event can split into several clusters (Jensen Huang: 3); story prompts no longer get holding weights, technicals or the mood gauge; concepts are translated on read, not pre-translated; `sections.tsx` 644 lines (row 30); circular import pipeline ↔ stories (alignMovers/headlineMentions; `mentions.ts` now holds the browser-safe matcher).
- Nov 25 (later): PR #1 (v19a) merged by Claude at the owner's request (7275715); deploy check passed (holidayGaps live, endpoints 200, ticks and grading running, no console errors at 1440/390). Found on production: every visitor saw the briefing's provider note ("Fell back after: gemini-3.5-flash-lite ... cooling down"); since D6 it could carry an error message, so it is now admin-only (`providerNoteFor`). D4: the 80 verified entries are in `src/lib/stories/past-events.ts`, `LIBRARY_APPROVED` still false (owner gate, Q19). Owner then said "build everything till the end, do as you think best": v19b merged via PR #2 without the preview AI run (needs an admin Refresh Claude can't send); a real story run is audited on production after the 08:10 UTC slot instead (read-only).
- F (Nov 25): catch-up, the morning email and Ask AI read story cards on v19 digests (`newsItemsOf`; they read the empty `events` before); World/US concept cards pre-translated into Vietnamese (decision 13); `alignMovers`/`headlineMentions` moved to `movers.ts` (no pipeline ↔ stories cycle). Merging PR #2 was blocked by the session's permission guard; the owner merges it.

**Handoff (Nov 25, end of the v19b session)**
- Goal: v19 news first. v19a is live on `main` (PR #1). v19b is complete on `claude/brave-cerf-ccrvoy` as PR #2 (CI green), waiting for the owner's merge.
- Decisions: this section (Nov 25 answers above; owner: "build everything till the end, do as you think best"; past-event citations stay off until the owner approves the list).
- Open items: (1) owner merges PR #2; then a deploy check (read-only: endpoints, browser pass) and, after the next shared briefing slot (08:10, 12:30 or 21:20 UTC), a line-by-line audit of the first real World and Vietnam story runs (cards, numbers vs input, Vietnamese text, provider, request count); (2) owner reviews the past-event list (https://claude.ai/artifact/Tg7zPxNLwYbEFdpfgmfuq2), then set `LIBRARY_APPROVED = true` in `src/lib/stories/past.ts` (drop any ids the owner names from `past-events.ts`); (3) watch Flash-Lite 3.5 rate limits (seen cooling down on Nov 25) and the gold before-market prediction (failed Nov 24).
- Not verified: a real AI story run, real token counts, translated cards in the UI, a real iPhone, feeds unreachable from the sandbox.
- Skills to load next: how-i-work, how-i-think, review-code, thermo-nuclear-code-quality-review; debugging if the first real run misbehaves.
- Next (superseded, kept for the record): the owner merges PR #1 (v19a), then a deploy check-in; the owner reviews the past-event list, then D4 (data into `past.ts`, flip `LIBRARY_APPROVED`); a real AI story run audited line by line once keys are available (production after merge, read-only); ask before merging v19b (PR from `claude/brave-cerf-ccrvoy`, which contains v19a, into `main` after PR #1).

**Story design decisions (owner, Nov 20, grilling round 2, all as recommended unless noted)**
- Q12 grouping: word matching with no AI, Unicode-aware (Vietnamese accents) plus character trigrams, within one language only.
- Q13 a story keeps its id while it shares headlines with the previous tick's story (id from its earliest headline); re-explained only when it gains 3+ new outlets or its card is over 12 h old.
- Q14 one AI call per briefing run writes the story cards, "The big picture" (3 lines), movers' reasons and the "what to watch" line, replacing today's briefing call (no extra requests per slot); stories with a fresh cached card are left out. On a fallback to Groq (~8k tokens/minute) the lowest-ranked stories are left out whole (e.g. 7, 5, 3), never single headlines inside a story; left-out stories keep their previous card or wait for the next run.
- Q15 concept cards: a second small call right after, same tick; max 10 new a day app-wide; cached for good.
- Q16 ranking: outlet count + today's move of a market it mentions (our data), top 10 to the model for an importance score. **Owner: keep 2 interesting stories (Q16b A): 5 important + 2 interesting = 7 per shared section per run** (replaces decision 7's 6).
- Q17 add 2-3 free science/culture RSS feeds per section, each checked from the cloud first.
- Q18 big story: a new story reaching 4+ outlets within 30 min with no card gets one at the next 15-min headline tick, max 6 extra calls per section per day.
- Q19 past-event library: a research draft of ~50 entries (date, what happened, measured move + source link, what's different) is being written now; the owner reviews it before any card can cite it.

**Handoff (Nov 20)**
- Goal: v19 overhaul, news first, on `v19-overhaul`.
- Decisions: this section (fix plan, Q1-Q11 design, Q12-Q19 stories).
- Done and merged on the branch: phase A, rows 2, 3, 5 (see Progress). Being built in worktrees (each reviewed with review-code + thermo-nuclear before merge): row 4 quote module (also 6, 7, 15); row 9 holidays 2026-2027 + FOMC 2027; rows 8, 10, 12, 13, 14 + Q11; rows 16-20 security incl. the AI ceiling. Past-event library draft in research.
- Ruled out: Next 16 this round, Upstash changes before measuring, full-article fetching, past events from model memory, cross-language grouping (Q12), one AI call per story (Q14).
- Open items: owner reviews the past-event draft; after v19a merges are reviewed, ask the owner before merging v19a to `main`.
- Next step: merge the four builders' work after review, stress test v19a on real data, ask to merge v19a; then design the story module interfaces (clustering, explainer + library, story job + store) and build v19b (D then E: rows 21-24, story cards, page order, rows 25-30).
- Skills to load next: how-i-work, how-i-think, codebase-design, review-code, thermo-nuclear-code-quality-review; grilling for any new decision.

**Audit (Nov 19)**: report https://claude.ai/artifact/PHWikthAG3dygy7usaAzEy (private), working notes with file:line in `docs/AUDIT-v19.md`. Baseline: typecheck passes; `selftest` and `vntest` fail on the real clock (test bugs), and `npm test` stops at the first failure so 17 suites don't run; no CI; `npm audit` highs not reachable (postcss build-time, nodemailer in an unused Auth.js provider).
- Causes of the reported problems: (a) `black-translucent` + `viewport-fit: cover` in `layout.tsx` with no `env(safe-area-inset-top)` on `.topbar` (`globals.css:171-178`); (b) Nasdaq 1-day uses after-hours `lastSalePrice` and an unreliable previous close (`chart.ts:157-158`), the chart header follows the selected range (`LiveChart.tsx:342`), the strip overlay drops `stale` (`strip.ts:36`); (c) the page loads briefings only on mount (`page.tsx:126`), My Interests is never pre-translated (`scheduler.ts:205`).

**Row 5 (translations, fix-plan items 4-5): what runs and what it costs (estimates, not measured on real briefings)**
- My Interests briefings are pre-translated after each refresh into the languages of the set's followers seen in the last day (never English); the first 04:35 UTC slot reaches every user's set (5 a day).
- Budget (recommended, owner decision pending): pre-translation may use `PRETRANSLATE_DAILY_TOKENS` (default 50,000, 25% of qwen's 200K) a day, counted from the models' real usage; the admin's set goes first, then the sets with the most followers; beyond it, the briefing is translated on first read. One translation is about 4 chunks, about 6.7k tokens and 4 requests, so the cap is about 7 translations (about 28 requests) a day. Shared sections' Vietnamese is about 14 translations (about 94k tokens, 56 requests) a day, so qwen runs at about 72% with the cap fully used; the rest spills to Flash-Lite only when qwen is cooled down.
- Pacing: chunks are paced by reserved tokens per minute (`GROQ_TPM` x 0.94: two chunks of about 3k fit). The scheduler's pre-translation waits for the next minute (it has 120 s and no reader). A reader waiting on `/api/translate` never waits: a chunk over the minute's tokens goes to Flash-Lite at once (3.5, then 3.1; counted in their request usage), so a 4-chunk briefing finishes in one call: 2 chunks on qwen (about 3.3k tokens) and 2 Flash-Lite requests per on-read translation (when `GEMINI_API_KEY` is set; without it the reader path waits like the scheduler). The route stops starting chunks after 50 s (finished chunks are kept, retry after 2 min).

**Handoff**
- Goal: v19 overhaul, news first, on `v19-overhaul`.
- Decisions: above.
- Changed files: `CLAUDE.md` (goal line, compaction note), `docs/HANDOFF.md` (goal, prediction times fixed, this section), `docs/AUDIT-v19.md` (new). No code changed.
- Ruled out: Next 16 upgrade this round (own round after CI); acting on the Upstash quota before measuring; timing-safe password compares; full-article fetching; past events from model memory.
- Open items: none from the owner (grilling finished: two rounds on the news design, one on the fix plan). The owner reviews the past-event library when it is drafted.
- Next step: run `improve-codebase-architecture` (with `codebase-design`) to design module shapes for the story pipeline (group, rank, explain, concept cards, analog library) and for row 30, then build v19a (phases A → B → C, see the report), ask to merge, then v19b (D → E), one fix per commit, pin behavior first, regression tests in `scripts/v19test.ts`, `review-code` + thermo-nuclear per fix. Count AI tokens and calls per day for the story and concept cards before building them. Stress test on real data (`invest-helper` environment for market hosts), docs, ask before merging.
- Skills to load next: how-i-work, how-i-think, improve-codebase-architecture, codebase-design, review-code, thermo-nuclear-code-quality-review; debugging for bugs; better-interface for UI.

## v19 row 9 (holidays and early closes, Nov 20 2026)

What changed: one table, `src/lib/holidays.ts` (per exchange and year: closed weekdays, early closes with local time, `provisional` dates, source URLs). Wired into `markets.ts` (trading days, `dailyTarget`, `nthWeekday(date, n, tz)`, `closeUtc`/`sessionClosed` with early closes, `preDeadline`, `lastFinishedSession`), `timetable.ts` (a prediction slot does not exist on its market's holiday), `track.ts` (holiday daily call closed at once; weekly end skips holidays), `predictions.ts` (weekEnd and gradeDate), `market.ts` (`freshenQuotes`: an early close ends the session at that time, so an after-hours print can't be the close; previous session skips holidays), `marketTime.ts` (the open/closed clocks) and `llm/prompt.ts` (market phase text). FOMC 2027 added to `calendar.ts` (decision days from the Fed's revised schedule of Nov 12 2026: Jan 27, Mar 17, Apr 28, Jun 9, Jul 28, Sep 15, Nov 17; Oct 26-27 is strategy-only). Test: `scripts/v19/row09-holidays.ts`, including the year guard (`holidayGaps`): from Dec 1 2027 it fails until 2028 tables exist.

How the dates were checked: the exchanges' own sites were not reachable from the build sandbox, so every date comes from search results that quote the official pages (NYSE Group's Dec 2025 release, JPX calendar, HKEX circulars CT/075/25 and CT/077/2026, gov.hk gazette lists, Deutsche Boerse's 2026 calendar, Euronext's calendar pages), cross-checked where a second source existed. **Someone should open each source URL (listed in the table's comments) and tick off the provisional dates.**

Provisional (treated as closed or early, but not confirmed on the exchange's own notice):
- HOSE 2027, all but Jan 1: Tet Feb 4, 5, 8, 9, 10 (government 7-day break Feb 4-10; some sites still show a longer variant to Feb 14), Hung Kings Fri Apr 16, Apr 30 and Mon May 3, National Day Thu Sep 2 and Fri Sep 3. HOSE/HNX normally publish these about a month ahead.
- HKEX 2026 half days Feb 16, Dec 24, Dec 31 (usual pattern; only seen on third-party calendars). 2027 half days (Feb 5, Dec 24, Dec 31) are in HKEX's circular.
- LSE Dec 24 and Dec 31 12:30 early closes (2026 and 2027): LSE's business-days page was not readable; two calendar sites and Cboe Europe agree.
- Xetra 2027 closures (Jan 1, Mar 26, Mar 29, Dec 24, Dec 31): Deutsche Boerse's standing rule; its 2027 PDF was not seen. Euronext Dec 24 close time 14:05 Paris (the usual time, not read from the calendar).
- JPX Sep 23 2027 (autumn equinox, by the Act on National Holidays).
- Also unchecked: NYSE option-only hours (13:15), FOMC Nov 17 2027 having projections (the code adds them by month, so it doesn't).

Review fixes (same day): the year guard now tests the real clock (the test pins the clock after capturing it) and `/api/status` carries `holidayGaps`; mid-day runs are dropped when under 2 h of session remain (HK half days, US Nov 27/Dec 24) and a mid-day deadline never passes the close; Europe runs when London or Frankfurt trades and calls on a closed exchange's ticker are dropped; oil and gold use a CME calendar (Thanksgiving is an early close, not a closure; CME's early times are third-party, provisional); Euronext Dec 31 half days added (provisional); catalyst reminders skip NYSE holidays and no morning email on one. Price alerts still run on holidays (no AI).

Known limits: calls stored before this change keep their stored `endDate` (a weekly call made Nov 23 before the table was deployed ends Nov 27, not Nov 30). The US mid-day prediction slot still runs at 12:00 ET on Nov 27 and Dec 24 (one hour before the early close). Oil and gold use New York's calendar although CME has its own holiday hours. The price-alert window is still weekday-based (a wasted tick on a holiday, no AI).

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
- Holidays (v19 row 9): `src/lib/holidays.ts` covers NYSE, HOSE, JPX, HKEX, LSE, Xetra and Euronext for 2026-2027; Seoul, Shanghai and Mumbai have no table (weekends only; Shanghai's 000001.SS is the one benchmark that matters). A closure the table lacks still falls back to the old rule (closed once a later bar exists or 48 h pass). Still weekday-based: price-alert window (13:00-22:00 UTC weekdays), `predictionAlerts` date, VN30 expiry. See the v19 row 9 note for provisional dates.
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
