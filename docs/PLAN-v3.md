> Historical: this plan was carried out in an earlier round and is kept for the record. The current state is in `CLAUDE.md` and `docs/HANDOFF.md`.

# Invest Helper v3 plan

**Goal (unchanged):** catch up on news about my stocks fast, and act on an AI read of the daily trend.

v3 asks one question: *what still makes me open three other apps?* The answers are:

- a live chart to see the move;
- an alert so I don't have to keep checking;
- a way to ask a follow-up question;
- a sense of where money is rotating.

v3 closes those gaps without adding monthly costs.

## 1. Research: what top products do that we don't (yet)

| Product | Pattern | v3 decision |
|---|---|---|
| Robinhood, Yahoo Finance, Google Finance | Live intraday chart on every ticker, ranges 1D → 1Y, crosshair | ✅ **Live chart** with TradingView's open-source Lightweight Charts (Apache-2.0, ~45 KB). Data from Yahoo's intraday chart endpoint, polled ~20s while markets are open |
| Stock Alarm, Walnut, Stock Rover | Price above/below, % move from open, earnings reminder the day before, once-only alerts, alert history, email delivery | ✅ **Email alerts**: price targets, big moves, AI call changes, high-confidence calls, catalyst reminders. Once-only or recurring, daily cap, history |
| Moneda, Public, Robinhood | Daily AI briefing in your inbox, weekly digest | ✅ **Morning briefing email** (pre-market) and **Sunday weekly recap** (track record + week ahead) |
| Magnifi, Perplexity Finance, Fiscal.ai | "Ask AI" grounded in your data | ✅ **Ask AI**: questions answered from today's briefings, headlines, prices and calendar, with cited headline numbers |
| Finviz, Koyfin | Sector heatmap / rotation view | ✅ **Sector heatmap** (11 SPDR sectors + semis), also fed to the AI so it can say "rotation out of tech" with evidence |
| Linear, Raycast, Vercel (top-tier web apps) | ⌘K command palette | ✅ **Command palette**: jump to any ticker chart, section, action or setting |
| Danelfin, Barebone | Proprietary scores, insider/Congress trades | ✂️ Needs paid data. A made-up score would be noise |
| Benzinga Pro | Audio squawk, real-time wire | ✂️ Paid wire. We already have Listen (text to speech) |

## 2. Stress test

| Feature | Catch-up | Act | Risk | Mitigation | Verdict |
|---|---|---|---|---|---|
| Live chart | ✅ see the move in 1s | ✅ entries/levels | Yahoo is unofficial and may throttle cloud IPs | 15s server cache per symbol+range; poll only while visible and the market is open; Stooq daily fallback for long ranges; clear "delayed" label if the timestamp is stale | ✅ |
| Real-time *streaming* (websocket) | – | marginal | Finnhub's free websocket would expose the API key in the browser; true tick data costs money | ✂️ Polling every 20s is enough for a daily-trend tool | ✂️ |
| Price & move alerts | ✅ stop checking | ✅✅ | Only as fresh as the check interval. GitHub Actions minimum is 5 min | Check every 15 min during US hours (~2–3 billed min/day on a private repo). Say "within ~15 min" in the UI | ✅ |
| AI call-change alerts | ✅ | ✅✅ | Noisy if every small change emails | Alert only when the **action** flips (e.g. HOLD → SELL) or confidence crosses your threshold. Max one email per check (bundled). Daily cap 20 | ✅ |
| Catalyst reminders | ✅ | ✅ | Calendar data can be wrong | Mark the source; remind the evening before (ET) | ✅ |
| Morning email | ✅✅ inbox is where the day starts | ✅ | Must arrive before the open, once | Sent by the first scheduled refresh between 7:30 and 9:30 ET, de-duped per day | ✅ |
| Weekly recap | ✅ | ✅ calibration check | Low | Sunday evening run | ✅ |
| Email provider | – | – | Resend's free tier (3k/mo, 100/day) sends to *your own* address without a domain. Gmail SMTP is the alternative | Support both: `RESEND_API_KEY` or `SMTP_URL` | ✅ |
| Ask AI | ✅ | ✅✅ follow-ups like "should I trim NVDA before earnings?" | Free-tier limits, hallucination | Grounded context only (briefings + headlines + quotes + calendar), must cite headline numbers, short answers, compact context for free providers | ✅ |
| Sector heatmap | ✅ | ✅ rotation | 12 extra quotes | Cached with the live-quotes endpoint, not extra AI cost | ✅ |
| Live quote strip | ✅ | ✅ | Poll cost | One batched request per 60s while open and the tab is visible | ✅ |
| ⌘K palette | ✅ power-user speed | – | None | – | ✅ |
| Bull/bear case | – | marginal | Duplicates rationale/risks; more tokens | – | ✂️ |

## 3. Design upgrades ("top-tier")

- **Chart card:** crosshair with price/time readout, range segmented control (1D · 5D · 1M · 6M · 1Y), area chart that turns green or red against the previous close, dashed previous-close line, volume bars. Live dot while the market is open.
- **Sheets:** ticker sheet becomes a proper quote page (chart, key stats, AI call, why it's moving, alerts for this ticker, related news).
- **Micro-interactions:** price numbers briefly flash green or red when a live tick changes them (respecting reduced motion).
- **⌘K palette:** frosted panel, fuzzy search, keyboard navigation.
- **Email template:** same visual language (light, rounded cards, system font), readable in Gmail / Apple Mail, dark-mode safe.

## 4. Architecture

- `GET /api/chart?symbol&range`: normalized OHLCV + previous close + market state, 15s cache.
- `GET /api/quotes?symbols=`: batched live quotes for the strip and heatmap, 15s cache. No Redis use on hot paths.
- `lib/email.ts`: Resend or SMTP. `lib/alerts.ts`: rules, evaluation, de-dupe, bundling, templates.
- `GET/PUT /api/alerts`: settings + price alerts. `POST /api/alerts/test`. `GET /api/alerts/check`: cron, price/move alerts only, no AI.
- The pipeline calls alert evaluation after each refresh (call changes, high-confidence calls, catalysts, morning and weekly emails).
- `POST /api/ask`: grounded Q&A through the provider chain.
- GitHub Actions: new `alerts` job every 15 min during US hours.

## 5. Status

Everything marked ✅ is built on the `v3` branch and tested:

- **Offline tests** (`npm test`): alert rules, de-dupe, once-only disarm, daily cap, failure retry, morning/weekly timing, email localization and HTML escaping, chart parsing, live-quote validation, Ask AI grounding/citations/history.
- **Browser tests:**
  - polling runs only during market hours and stops when closed;
  - stale data is labeled "Delayed";
  - chart range and symbol switching;
  - ⌘K navigation, ticker quick alerts, Ask AI with history;
  - alert settings saving, the heatmap, and palette-driven headline search;
  - every v2 check still passes.
- **Visual QA:** light/dark, desktop/phone, plus rendered emails.

## 6. Decisions left for you

1. Which email provider: Resend (simplest) or Gmail SMTP (app password)? Both work, so pick whichever you prefer.
2. Alert thresholds (defaults: big move ±3%, high confidence ≥ 75%) can be changed in Settings → Alerts.
