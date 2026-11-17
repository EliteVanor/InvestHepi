# Plan v18: predictions apart from briefings, timezone setting, weekend briefings, 15-min headlines

Decided by the owner on Nov 16-17 2026. Don't re-ask these; ask only what's still open.

## Predictions (new, separate AI job)

- **Briefing** = summary, trend, big events, movers, scenarios. **No buy/hold/wait calls any more.**
- **Prediction** = the calls, made from prices, technicals, news and the track record. Same items as today: shared sections predict their market groups; My Interests predicts each interest's first ticker.
- **Daily: 2 per market per weekday**, "before market" and "mid-day", **graded at that day's close on the ticker's own exchange** (VN 14:45 Hanoi, US 16:00 New York, etc.). Not 24 h.
- **Weekly:** once a day, only in the before-market run, **graded at the close of the 5th trading day counting the prediction day** (Wed → next Tue close). If that day is a holiday (no price bar), grade on the previous full session.
- **Holiday weekday:** the daily slot may still fire (no holiday calendar); with no session that day, mark "market closed, not graded".
- **No predictions on Saturday and Sunday** (markets closed; confirmed).
- **Times (UTC, winter; the timetable is UTC):**
  - Vietnam: before 01:15 (08:15 Hanoi), mid-day 04:35 (lunch break).
  - US: before 12:30, mid-day 17:00.
  - World: per market on its own clock, 2 each (8 World runs a day, confirmed): Japan before 23:30 (previous UTC day) / mid-day 02:45; China & Hong Kong before 01:00 / mid-day 04:15; Europe before 07:30 / mid-day 12:00; US stocks, oil and gold with the US times. Each world market's weekly call goes in its own before-market run.
  - My Interests: each set split by market (US or Vietnam, by each interest's first ticker); each part on its market's clock, so up to 4 runs a set a day.
- **Models:** predictions on gpt-oss-120b (shared and admin; users: 120b beyond the reserve, then 20b, then Flash-Lite). **Briefings move to Gemini Flash-Lite first** (120b as fallback). Recount `reserveFor120` from the timetable.
- **AI failure:** retry once 20 min later; otherwise the slot is "missed": no rule-based prediction, nothing graded.
- **Prompt:** "by today's close" for daily, "by the close of the 5th session" for weekly. Actions must still agree with directions (`alignAction`); calibration (`calibrate`) and no-result (`noResult`) rules stay.

## Track record

- Each record shows **when it was made** ("Before market", "Mid-day", or the weekday for weekly) and **when it's graded** (computed from market hours, e.g. "Graded at close, Mon 14:45").
- The likely range and the "always up" baseline are computed **by independent day per ticker** (several predictions on one day share one outcome).
- **Existing records:** label them "Before market" (they came from the 08:15 Hanoi run and were already graded at that session's close); grades don't change.

## Briefings

- Schedule as before, **US raised to 5 a weekday**: 12:30, 15:30, 17:00, 21:20, 02:15 UTC.
- **Saturday and Sunday: the same briefing rate as weekdays** (all sections, the admin's set 6, users' sets 4).

## Headlines

- **Shared sections (World, US, Vietnam) refreshed every 15 minutes; active users' interest sets every 30 minutes**, with no AI, from the scheduler tick (Vercel's schedule already ticks every 15 min). Roughly 6,000 feed requests a day or fewer.
- The briefing keeps the headlines it cited (its source ids point into its own list); the live list is separate, and "Key" badges match by headline id.
- Back off per host on a 429 (Google News and some Vietnamese sites rate-limit).

## Timezone setting

- Default: the device's timezone. Options: Auto, Hanoi, New York, UTC, and a full list. Saved per account (like language) and per device for signed-out visitors.
- Every time a reader sees follows it, labeled with the zone: briefing times, prediction made/graded times ("Before market · 08:15 Hanoi · 01:15 your time"), headlines, the schedule, "Up next".
- Charts and the open/closed pill stay in the exchange's own time, clearly labeled.
- The design must be intuitive and easy to follow; all 8 languages.

## UI

- A **Predictions card** under the briefing: the latest daily calls (labeled "Before market 08:15" or "Mid-day 11:35") and the weekly calls, linking to the track record.
- Alerts (call changes, high confidence), catch-up mode, Ask AI and the stock page's "AI call" switch to the predictions.

## Budget (check before building)

- 120b weekday: shared predictions VN 2 + US 2 + World 8 = 12, admin up to 4: about 16 × 5K = ~80K of ~194K usable.
- Flash-Lite: shared and admin briefings (~20 a day, every day now) plus users' overflow, under 500 requests a day per model.
- Slot load: the VN before-market slot must finish predictions within 45 min (run predictions first). Many more units per slot: check slots still finish within 60 min; consider letting a tick run a prediction and a briefing back to back when they use different models (separate per-minute limits).

## Verification

- `v18test`: timetable slots and times, grading at each exchange's close (daily) and the 5th close with the holiday rule (weekly), market-closed days, the My Interests split, record labels and graded times, migration of existing records, budgets, headline refresh (15 min shared, 30 min interest sets).
- All suites, typecheck, both builds; browser checks in all 8 languages, wide and phone, light and dark.
- After merge: read-only production checks, then a scheduled check-in at the first prediction slot and the first close.

## Owner tasks

None expected (Vercel's 15-min schedule covers the headline refresh; cron-job.org stays at 30 min).
