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
- **Refreshing (decided Nov 16, mechanism changed in v13):** briefings refresh on the app's own timetable (`src/lib/timetable.ts`), run by a tick that Vercel Schedules, cron-job.org and GitHub poke on a plain interval; a run that's late or duplicated never spends AI twice, and a slot more than an hour late is reported. Users' interest sets refresh automatically 4 times a weekday (01:15, 08:10, 12:30, 21:20 UTC), the admin's 6 times. Signed-in users can also refresh their own My Interests by hand: 5 a day, 90 minutes apart, on a lighter model (Gemini Flash-Lite); every press writes a new briefing and tells them how many presses are left. The admin can refresh any section, 10 a day, on the best model. Shared sections can't be refreshed by users. A newly saved interest set gets its first briefing automatically, once.
- **Schedule:** weekdays World 4, US 2 (12:30 UTC pre-open is the graded call), Vietnam 5 (01:15 UTC pre-HOSE is the graded call). Sunday: each shared section twice, the admin's set 3 times, users none. Saturday: nothing.
- **Models:** shared on gpt-oss-120b (budget reserved), personal overflow on gpt-oss-20b, translation on qwen, Gemini Flash-Lite as backup; Ask AI on 20b. Shared sections use 20b only as the very last resort.
- **When no AI model works:** keep the last AI briefing and explain it in a banner; readers can switch to a rule-based summary of the latest news (only they see it; cached).
- **One language setting per person**, used for the app, briefings and alert emails. **Every briefing is generated in English and translated** (cached per briefing version). Never regenerate a briefing to change its language.
- **Signed-out visitors** can read World / US / Vietnam; My Interests shows a sign-in invitation. Visitors land on World (Vietnam if their language is Vietnamese).
- **Search like Apple Stocks:** find any US, Vietnamese or global stock / ETF / index (accents optional), tap + to follow. Following creates a one-ticker interest.
- **Prices must never just disappear:** Vietnamese prices come from Vietnamese brokers (DNSE, Vietcap, VNDirect); Yahoo is batched and backs off; Yahoo-only symbols fall back to tracking ETFs (tagged); last good prices fill gaps (dimmed). Grading never uses stale prices.
- **No scraped API keys** and no bypassing rate limits (an automated permission check blocked both; respect that).

## How the owner likes to work

The working rules (session start, stress testing, research and ideas, delivering, lines not to cross) are in `CLAUDE.md` under "Working with the owner", so they load in every session. In short: direct, concise writing with no em dashes or jargon; stress-test ideas and give other perspectives; research before building; short branch names; ask before merging to `main`.

## Current state

- `main` = v13, deployed on Vercel at `investhepi.vercel.app`.
- Multi-user mode is on (Google sign-in via Auth.js). Vercel env vars in use: AI keys (`GROQ_API_KEY`, `GEMINI_API_KEY`), Upstash (`KV_REST_API_*`), `APP_PASSWORD`, `CRON_SECRET`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `OWNER_EMAIL`, optionally `CONTACT_EMAIL` (shown on `/privacy` and `/terms`). GitHub repo secrets `APP_URL`, `CRON_SECRET` drive the GitHub backup poker.
- Optional knobs: `TRANSLATE_DAILY_LIMIT` (80), `AUTOGEN_DAILY_LIMIT` (6), `REFRESH_DAILY_LIMIT` (admin, 10), `USER_REFRESH_DAILY_LIMIT` (5), `USER_REFRESH_GAP_MIN` (90), `RULES_DAILY_LIMIT` (30), `ASK_DAILY_LIMIT`, `TICK_SECRET` (lets cron-job.org poke the scheduler and nothing else), model overrides `GROQ_MODEL`, `GROQ_SMALL_MODEL`, `GROQ_TRANSLATE_MODEL`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, limits `GROQ_TPD`, `GEMINI_RPD`.
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
