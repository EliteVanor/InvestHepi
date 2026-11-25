# v19 audit: vetted findings (working notes)

Full report (private artifact): https://claude.ai/artifact/PHWikthAG3dygy7usaAzEy. Row numbers in HANDOFF refer to that report. Each line below was checked against the code on Nov 19 2026 (main = v18, c0b9d72 lineage). Request counts marked estimate are from reading code.

BASELINE: typecheck ok; selftest.ts:145 + vntest fail on 2026-11-19 (date-dependent); npm audit 4 high (postcss via next: build-time, not reachable), nodemailer via @auth/core (not reachable, no email provider); 6 unused locals.
FE-01 CONFIRMED layout.tsx:9,16 black-translucent+cover; globals.css:171-178 topbar no safe-area-top => iPhone home-screen hides login/top bar. S.
FE-02 CONFIRMED .cu globals.css:663 + .cu-top :666 double inset; .progress top:52px; sidebar/dock no inset; no left/right insets. S.
FE perf: polls all 4 sections every 5 min (hooks.ts:397,442), no refetch on visibility return (stale feel). S. Static imports of all sheets in page.tsx:9-25 (MED). html lang="en" always (layout.tsx:14).
SEC-01 CONFIRMED alerts email any address (api/alerts/route.ts:21), test send no cap (alerts/test/route.ts) - comment wrong. M.
SEC-02 no security headers (next.config.mjs empty). S.
SEC-03 CONFIRMED feed link unvalidated news.ts:90-110 -> href. S.
SEC-04 CONFIRMED refresh GET exported (refresh/route.ts:56), client uses POST only (page.tsx:236). S.
SEC-06/07 no per-IP limits; any Google account multiplies AI spend; no global cap. M.
SEC-08 raw error messages returned. S. SEC-09 track section unchecked (track/route.ts:12). S. SEC-05 non timing-safe compares. S.
TESTS-01 CONFIRMED no CI (only refresh.yml). S.
TESTS-02 CONFIRMED selftest/vntest real-clock; npm test && chain stops at suite 2 so 17 suites never run in `npm test`. M. TESTS-03 more real-clock fixtures (v13/v14/v17/v18). TESTS-04 shared .data and /tmp/invest-helper state.
TESTS-05 untested: ukey isolation directly, touchUser, chainTick, rulesVariant, gradeAll throttle. M.
PERF-01 ~30 Redis cmds per 5-min poll per tab (estimate), idle ticks ~70-115K/month (estimate); Upstash limit unverified in repo. Poll only active tab, batch, s-maxage. M.
DEP-01 next 16.4.6 available (major), next-auth beta; no unused deps; no engines/.nvmrc.
DOCS-01 CONFIRMED HANDOFF:19 old prediction times vs timetable.ts:49-55. DOCS-02 CONFIRMED README:176 says 16 suites. DOCS-03 old PLAN docs.
DEBT unused locals: 5 + track.ts:389 unused param x (real, unused find param).
TIME-T1 root cause selftest:145 = asserts legacy targetSession vs dailyTarget during NY hours (time-of-day flaky). vntest = fixed now 2026-11-17 + fixtures on real clock -> can never pass again. Both test-only. S.
TIME-C1 CONFIRMED grading errors swallowed scheduler.ts:290 (.catch(()=>0)) and GRADE_KEY written before grading (:289) -> silent 55-min loss / permanent silent failure. S.
TIME-C2 CONFIRMED lateNow only late|missed (:369); slots where items failed twice = "partial" -> no 503 email. Owner-intent MED. S.
TIME-C3 CONFIRMED gradesAfter/pending use gradeTz(ticker) w/o proxy (track.ts:104,133) -> shown grade time wrong for ETF-stand-in tickers (^STOXX50E), extra hourly fetches. S.
TIME-C4 CONFIRMED closed=true after 48h w/o later bar is permanent (track.ts:163-173) -> outage becomes "market closed". Calls older than 25-bar history pending forever. M.
TIME-C5 deadline checked before 65s sleep (scheduler.ts:294-308) -> pre-market run can start after the open and waste attempt. S. MED.
TIME-C6 lock TTL 310s + non-atomic release; RMW of calls:* (LOW-MED, Vercel kill mitigates).
TIME-T3 no DST/lock/lateNow tests; v13test:276 near-empty assertion.
NEWS-1 CONFIRMED page loads digest only on mount (page.tsx:126) + refresh; no visibilitychange anywhere except LiveChart -> PWA resumed shows hours-old briefing next to fresh headlines. MAIN cause of "stale". S.
NEWS-2 CONFIRMED interest briefings never pre-translated (scheduler.ts:205 !u.set, vi only) -> VN readers of My Interests get English then wait 10-25s. Catch-up no indicator. M. Interest hash order-sensitive (interests.ts:34) MED.
NEWS-3 translation all-or-nothing sequential chunks, can exceed 60s maxDuration; failure -> 10 min :failed; scheduler swallows. M.
NEWS-4 CONFIRMED dedupe tokenizer news.ts:169 strips all non a-z -> Vietnamese headlines collapse to 1-2 tokens; unrelated VN stories merged, real dups missed. Blocks clustering. S.
NEWS-5 schema coerces empty reply into valid briefing (schema.ts:122-176) -> can replace good briefing; source_ids unbounded. S.
NEWS-6 Gemini lacks reserve for briefings; qwen 200K/day probably mostly used by pre-translation (estimate). M.
NEWS-7 no cross-instance lock on translate / catch-up -> duplicate spend. S.
NEWS-8 feed titles unbounded, no "headlines are data" rule (prompt injection integrity). S.
NEWS-9 undated items stamped now every fetch (news.ts:104). S.
NEWS-10 CONFIRMED compact:true for Gemini too (llm/index.ts:229) -> main briefing model sees no summaries, 30 headlines. S.
NEWS-11 guest translate cap shared. NEWS-12 live headlines never translated (VN reader sees English titles). NEWS-13 analogs can be invented: prompt.ts:207 allows memory, schema doesn't validate.
NEWS slot gaps: users' interests 4/day -> 14:00 Hanoi reader sees ~6h old; vn longest gap 12:30->21:20 UTC.
PX-1 CONFIRMED Nasdaq 1d (chart.ts:157-158) uses lastSalePrice incl. extended hours + unreliable previousClose (fallback bars[0]=04:00 premarket) -> strip/chart/alerts/mid-day base show after-hours price & different % vs briefing (regular close). M. Root of "prices inconsistent" for US.
PX-2 CONFIRMED chart header shows price of selected range (LiveChart.tsx:342); Nasdaq history price=last daily bar (chart.ts:176) -> 1D vs 5D vs 1M show different "current" price. S&P/Dow 1d Eastmoney vs 5d+ VNDirect est. M. Fix: one current-quote function.
PX-3 CONFIRMED strip overlay forces stale:false (strip.ts:36); expired chart cache returned as live (chart.ts:391); stale never shown in chart/watchlist/movers. S-M.
PX-4 proxy ETF history mixed with real levels in sheets/portfolio/catchup/search (sheets.tsx:455-509). M. MED.
PX-5 CONFIRMED price alerts ignore proxy (alerts.ts:159-163, no proxy check) -> "S&P below 6000" fires on SPY 680. S.
PX-6 live polling clock per tab not per symbol (interests tab "us" for .VN; FX/futures/BTC treated as NY hours). S-M.
PX-7 CONFIRMED portfolio sums VND+USD as USD (portfolioMath.ts:30-35, portfolio.tsx:132 USD). S-M.
PX-8 px:last RMW race from 3 parallel getQuotes (market.ts:63-81). S.
PX-9 CONFIRMED market cache stores stale quotes 10 min (pipeline.ts:128); sectors not freshened (pipeline.ts:126). S.
PX-10 24h assets UTC-day % vs settlement %. PX-11 5d/1M/52w computed differently in watchlist vs sheet. PX-12 no breaker except 429, no in-flight dedupe. PX-13 no holidays/half-days (Thanksgiving Nov 26-27 is next week!). PX-14 small: VNDirect adjusted vs DNSE raw, FX toFixed(2) in prompt.
