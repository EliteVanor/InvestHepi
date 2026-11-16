# Handoff: goals, rules and state (Nov 2026)

Read this with `CLAUDE.md` (architecture, commands, technical rules). This file holds the *why*: product goals, decisions the owner made, how they like to work, and what's open.

## Goal

InvestHepi helps someone catch up on market news fast and act on it: a short AI briefing per section with buy / hold / wait calls, confidence, triggers, risks and past examples, plus a track record that grades every call. Audience: the owner first, then Vietnamese investors (the UI is in 8 languages, Vietnamese matters most).

Hard constraint: **free plans only** (Vercel Hobby, Upstash free, Groq/Gemini free tiers, GitHub Actions). Every feature must keep AI token use and request volume low.

Design: Apple-like and quietly futuristic. Ambient light background tinted per section, translucent cards, clean type, works on phones.

## Product rules the owner decided

- **Sections:** My Interests (personal), World, US, Vietnam.
- **Shared sections never show personal stocks.** World = world indexes + global giants + macro. US = S&P 500, Dow, Nasdaq 100, Russell 2000 + mega caps. Vietnam = VN-Index, VN30, HNX, UPCoM + banks + large caps. The AI's calls in shared sections are on market groups, not users' stocks.
- **World has no market open/closed pill** (it spans many exchanges).
- **Refreshing (decided Nov 16):** briefings refresh on the GitHub Actions schedule. Users' interest sets refresh automatically 4 times a weekday (01:15, 08:10, 12:30, 21:20 UTC), the admin's 6 times. Signed-in users can also refresh their own My Interests by hand: 5 a day, 90 minutes apart, on a lighter model (Gemini Flash-Lite); every press writes a new briefing and tells them how many presses are left. The admin can refresh any section, 10 a day, on the best model. Shared sections can't be refreshed by users. A newly saved interest set gets its first briefing automatically, once.
- **Schedule:** weekdays World 4, US 2 (12:30 UTC pre-open is the graded call), Vietnam 5 (01:15 UTC pre-HOSE is the graded call). Sunday: each shared section twice, the admin's set 3 times, users none. Saturday: nothing.
- **Models:** shared on gpt-oss-120b (budget reserved), personal overflow on gpt-oss-20b, translation on qwen, Gemini Flash-Lite as backup; Ask AI on 20b. Shared sections use 20b only as the very last resort.
- **When no AI model works:** keep the last AI briefing and explain it in a banner; readers can switch to a rule-based summary of the latest news (only they see it; cached).
- **One language setting per person**, used for the app, briefings and alert emails. **Every briefing is generated in English and translated** (cached per briefing version). Never regenerate a briefing to change its language.
- **Signed-out visitors** can read World / US / Vietnam; My Interests shows a sign-in invitation. Visitors land on World (Vietnam if their language is Vietnamese).
- **Search like Apple Stocks:** find any US, Vietnamese or global stock / ETF / index (accents optional), tap + to follow. Following creates a one-ticker interest.
- **Prices must never just disappear:** Vietnamese prices come from Vietnamese brokers (DNSE, Vietcap, VNDirect); Yahoo is batched and backs off; Yahoo-only symbols fall back to tracking ETFs (tagged); last good prices fill gaps (dimmed). Grading never uses stale prices.
- **No scraped API keys** and no bypassing rate limits (an automated permission check blocked both; respect that).

## How the owner likes to work

- Direct, concise, natural writing. No em dashes, buzzwords or jargon. Explain decisions plainly.
- Wants ideas stress-tested and different perspectives; first-principles reasoning; propose the cheaper option when token cost is involved.
- Wants research before building when data sources are involved (test real endpoints from a cloud server).
- **Git:** work on a short-named branch (`v11`, `v12`, ...; the owner asked for these, not long auto names), run `npm test` + `npm run build`, push, then **ask before merging to `main`** (merging deploys to production) unless the owner says to merge right away.
- Commits end with the `Co-Authored-By` / `Claude-Session` lines the session provides.
- Keep the owner's personal details (email) out of code, docs and requests to outside services.

## Current state

- `main` = v8, deployed on Vercel at `investhepi.vercel.app`.
- Multi-user mode is on (Google sign-in via Auth.js). Vercel env vars in use: AI keys (`GROQ_API_KEY`, `GEMINI_API_KEY`), Upstash (`KV_REST_API_*`), `APP_PASSWORD`, `CRON_SECRET`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `OWNER_EMAIL`, optionally `CONTACT_EMAIL` (shown on `/privacy` and `/terms`). GitHub repo secrets `APP_URL`, `CRON_SECRET` drive the scheduler.
- Optional knobs: `TRANSLATE_DAILY_LIMIT` (80), `AUTOGEN_DAILY_LIMIT` (6), `REFRESH_DAILY_LIMIT` (admin, 10), `USER_REFRESH_DAILY_LIMIT` (5), `USER_REFRESH_GAP_MIN` (90), `RULES_DAILY_LIMIT` (30), `ASK_DAILY_LIMIT`, `INTEREST_BATCH` (1), repo variable `INTEREST_ROUNDS` (15 calls per run), model overrides `GROQ_MODEL`, `GROQ_SMALL_MODEL`, `GROQ_TRANSLATE_MODEL`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, limits `GROQ_TPD`, `GEMINI_RPD`.
- Google OAuth consent screen: branding filled in, privacy/terms pages exist; publishing needs no logo (a logo triggers brand verification).
- A personal Claude cloud environment named `invest-helper` exists with network access to the market-data hosts (Yahoo, Nasdaq, DNSE, Vietcap, VNDirect, ...) for live testing. Node needs `NODE_USE_ENV_PROXY=1` there.
- Tests: 13 offline suites (`npm test`), all passing (v9test, budgettest, v10test added Nov 16).

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
- When Yahoo refuses Vercel, US 10Y and USD/VND have no ETF stand-in and only show their last known value.
- Track-record grading uses the US trading calendar; Vietnamese holidays (Tet) aren't modeled. The HOSE market clock doesn't model holidays either.
- Interest sets saved in Vietnamese before v8 get their first English briefing on the next scheduled run.
- README screenshots in `docs/screenshots` still show the old name "Invest Helper".
- Alert emails to other users need a verified Resend domain or Gmail SMTP (Resend's test sender only reaches the account owner).
