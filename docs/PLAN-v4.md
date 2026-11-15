# Invest Helper v4 plan

**Goal (unchanged):** catch up on news about my stocks fast, and act on an AI read of the daily trend.

v1 gave the briefing. v2 made it pleasant and multilingual. v3 added live charts, alerts and Ask AI.
v4 asks: *where does the app still leave work for me?*

1. **Catching up still means scrolling.** A briefing page is long. The best catch-up products (Particle, stories formats) hand you one idea per screen.
2. **"What changed?" is on me.** I have to remember yesterday's calls to notice a flip.
3. **Triggers are vague without levels.** "Add on weakness" needs a number: the 50-day average, the 20-day low, RSI.
4. **A hit rate isn't money.** 61% right says nothing about whether following the calls beat just holding.
5. **Event risk is binary, the advice isn't.** Before CPI or FOMC, desks write "if hot / in line / cool" playbooks. We give one call.
6. **The AI doesn't know what I hold.** "Trim" means nothing if I own none.

## 1. Research → decisions

| Source | Pattern | v4 decision |
|---|---|---|
| Particle, stories formats | One idea per card, bullets first, follow-up questions per story | ✅ **Catch-up mode**: full-screen cards (headline → each call → movers → each event → scenarios → up next). Tap, swipe or arrow keys. ✅ **"Explain this"** on any headline opens Ask AI on it |
| Any good inbox / feed | "Since you were last here" | ✅ **Since-last-visit card**: calls that flipped, biggest moves since then, new key events |
| TradingView, Finviz, Koyfin | Watchlist table with RSI, moving averages, 52-week range, sortable | ✅ **Watchlist table** + **technicals engine** (20/50/200-day averages, RSI-14, 20-day support/resistance, typical daily move). Also fed to the AI so triggers cite real levels |
| Google Finance "key moments" | Events marked on the chart | ✅ **AI calls marked on the chart** (▲▼ with right/wrong), plus candles and 20/50-day average overlays |
| CNN Fear & Greed | Composite 0–100 of momentum, breadth, volatility, safe-haven demand | ✅ **Market mood gauge**, our own transparent composite from data we already fetch (5 parts, each shown). CNN's formulas aren't public and its endpoint blocks bots, so we don't copy the number |
| Sell-side CPI/FOMC previews | Three branches with probabilities and expected reaction | ✅ **Scenarios**: for the next major catalyst, the AI gives cases with probabilities, expected reaction for my interests, and what to do in each |
| Trading journals (equity curve vs S&P) | Benchmark the strategy, per-symbol breakdown | ✅ **"If you followed the AI"**: equity curve of the calls vs simply holding the same tickers, per-ticker scorecard, CSV export. Research found no consumer tool doing counterfactual signal replay, so this is the differentiator |
| Magnifi, Perplexity (linked holdings) | Advice aware of what you own | ✅ **Holdings (optional)**: shares + cost → live P&L card. The AI gets position *weights* only (never dollar amounts) and words actions for a holder vs non-holder |
| Yahoo, every broker | Find a ticker by company name | ✅ **Ticker search** (Yahoo's public search endpoint, local fallback) in ⌘K and the editors |
| Top-tier web apps | Toasts, progress, iOS-style settings navigation, collapsing titles | ✅ UX pass (section 3) |
| TipRanks, Seeking Alpha | Analyst ratings, price targets | ✂️ Paid data |
| Stocktwits | Social sentiment | ✂️ Noisy, API restricted |
| Brokers | Trade execution | ✂️ Out of scope and risk; this is a helper |

## 2. Stress test

| Feature | Catch-up | Act | Risk | Mitigation |
|---|---|---|---|---|
| Catch-up mode | ✅✅ | ✅ | Duplicates the page | It's the same data, zero extra AI cost. One button, one key (`C`) |
| Since last visit | ✅✅ | ✅ | Per device | Stated. Snapshot in localStorage |
| Technicals | ✅ | ✅✅ | +1 Yahoo call per ticker per refresh; indicators invite false precision | 1-hour cache; cap at 16 tickers; the prompt says levels are context, not signals |
| Watchlist table | ✅ | ✅ | Dense on phones | Sticky first column, horizontal scroll, 5 default columns |
| Chart markers / candles / averages | – | ✅ | Clutter | Off by default except call markers; toggles remembered |
| Mood gauge | ✅ | ✅ | A single number hides nuance | Tap to see the five parts and their values |
| Scenarios | ✅ | ✅✅ | More output tokens on free tiers; invented probabilities | Max 1 catalyst × 3 cases; probabilities must sum to ~100 and are labeled as estimates; only when a major catalyst is within ~7 days |
| Followed-the-AI curve | – | ✅✅ | Overstates: ignores costs, slippage, flat calls | Labeled "before costs"; flat calls = stay out; equal weight per day; shown next to buy-and-hold |
| Holdings | ✅ (P&L at a glance) | ✅✅ | Sensitive data | Stays in your own database; only weights + gain % go to the AI; fully optional; never in emails unless enabled |
| Ticker search | ✅ | – | Unofficial endpoint | Local alias fallback |
| Ask AI rate limit | – | – | Someone with the password burning quota | 60 questions/day cap, configurable |

Cut after stress test: analyst data, social sentiment, web push (email already covers alerts), streaming Ask AI answers (three provider-specific stream formats for a cosmetic gain).

## 3. UX pass ("top-tier")

- **Settings** becomes an iOS-style list with drill-down pages (Appearance & language, Interests, Holdings, Alerts, Status, Shortcuts). The tab row had run out of room.
- **Toasts** replace inline status messages. **Progress bar** under the top bar while a refresh runs, with stage text.
- **Collapsing title**: on phones the section name moves into the top bar once the large title scrolls away.
- **Page order** follows the decision flow: since-last-visit → briefing (with Catch up) → calls → scenarios → chart → watchlist → events / headlines, with mood, holdings, movers, sectors and calendar in the side rail.
- World and US sections drop the chart and watchlist (they're about news); calls and scenarios stay.
- Focus is trapped inside sheets; all new controls are keyboard reachable.

## 4. Architecture

- `lib/technicals.ts`, `lib/mood.ts`: pure functions over price history; results stored on each digest and added to the prompt.
- Schema: `scenarios[]`. Prompt: technicals, mood, positions (weights), scenario rules.
- `lib/track.ts`: `equity[]`, `byTicker[]`. `GET /api/track?format=csv`.
- `GET /api/search?q=`, `GET/PUT /api/portfolio`.
- `lib/ratelimit.ts`: per-day counters in the store.
- Client: `CatchUp`, `SinceLastVisit`, `Watchlist`, `MoodGauge`, `Scenarios`, `Portfolio`, toasts, settings navigation.
