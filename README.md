# Invest Helper

A personal news site that catches you up on market news fast and tells you what it likely means for the stocks you follow.

<p align="center">
  <img src="docs/screenshots/desktop-light.png" width="68%" alt="Desktop, light mode" />
  <img src="docs/screenshots/mobile-dark.png" width="22%" alt="Phone, dark mode" />
</p>

<sub>Screenshots use sample data.</sub>

Three sections, each with its own news feed:

1. **My Interests**: Nasdaq, S&P 500 and chip stocks by default. Edit them in Settings → Interests and the news and analysis follow.
2. **World**: geopolitics, foreign economies, central banks, oil, trade.
3. **US**: Fed, economic data, Congress, the White House, regulation.

Every section opens with an AI briefing, ordered by what helps you act fastest:

- **Briefing**: the one-line takeaway, a risk-on/risk-off mood, and the main events.
- **What to do**: for each interest, a direction call, a confidence ring, an action (Buy / Add / Hold / Wait / Trim / Sell / Avoid), a concrete trigger, and the risks.
- **Movers**: why your biggest movers moved, from the headlines.
- **Key events**: why each event matters, impact per interest, a **past example** of how markets reacted to something similar, and **what could go wrong**.
- **Up next**: earnings for your tickers plus FOMC, CPI, jobs and PPI dates, all fed to the AI so its timing advice knows what's coming.
- **Headlines**: new-since-last-visit dots, "Key" badges on stories the AI used, "+N more" when many outlets ran the story, search, and saved headlines.

**New in v4: decide faster, trust for the right reasons**

- **Catch-up mode**: the whole briefing as full-screen cards, one idea each (headline → each call → movers → each event → scenarios → what's next). Tap, swipe or use the arrow keys. Press `C`.
- **Since you were last here**: calls that flipped, the biggest moves since then, and new key events, on top of the page.
- **Scenarios**: before CPI, FOMC, jobs or a followed company's earnings, an "if hot / in line / cool" playbook with probabilities, the expected reaction, and what to do in each case.
- **Technicals**: 20/50/200-day averages, RSI, 20-day range, typical daily move for every ticker. Shown on the quote page and the **watchlist table**, and given to the AI so triggers name real levels.
- **Market mood gauge**: a transparent 0-100 composite (momentum, strength, breadth, volatility, safe-haven demand). Tap it to see each part.
- **"If you followed the AI"**: an equity curve of acting on every daily call vs simply holding the same tickers, a per-ticker scorecard, and CSV export.
- **Holdings (optional)**: enter shares and cost for a live P&L card. The AI only ever sees position weights and gain %, never amounts, and words its advice for what you actually hold.
- **Chart upgrades**: candles, 20/50-day average overlays, and past AI calls marked on the chart (green = right, red = wrong).
- **Smaller things**: find tickers by company name, "Explain this" on any headline, iOS-style settings, toasts, a refresh progress bar, daily caps on Ask AI and manual refreshes.

<p align="center">
  <img src="docs/screenshots/catch-up-desktop.png" width="62%" alt="Catch-up mode" />
  <img src="docs/screenshots/catch-up.png" width="20%" alt="Catch-up mode on a phone" />
</p>
<p align="center">
  <img src="docs/screenshots/watchlist.png" width="49%" alt="Watchlist and events" />
  <img src="docs/screenshots/desktop-dark.png" width="49%" alt="Scenarios and chart" />
</p>

**New in v3**

- **Live chart** on every ticker: 1D · 5D · 1M · 6M · 1Y, crosshair readout, previous-close line, volume. Updates every ~20s while the market is open, at no cost (TradingView's open-source Lightweight Charts + Yahoo's public chart data).
- **Email alerts**:
  - a morning briefing in your inbox before the open, and a Sunday weekly recap;
  - price targets (above / below / % move), big moves in your tickers;
  - AI call changes (e.g. Hold → Sell), high-confidence calls;
  - catalyst reminders the evening before earnings, CPI, jobs or FOMC.
  - Alerts are de-duplicated, bundled into one email per check, and capped per day.
- **Ask AI**: follow-up questions answered from today's briefings, headlines, prices and calendar, with cited headlines.
- **Sector heatmap**: where money is rotating today. Also fed to the AI.
- **⌘K command palette**: jump to any ticker, section, setting, or ask a question.
- **Live prices** in the market strip, and a **quote page** per ticker with day / 52-week range, volume, the AI call and one-tap price alerts.

<p align="center">
  <img src="docs/screenshots/ticker.png" width="49%" alt="Ticker page with live chart" />
  <img src="docs/screenshots/ask-ai.png" width="49%" alt="Ask AI" />
  <img src="docs/screenshots/command-palette.png" width="49%" alt="Command palette" />
  <img src="docs/screenshots/email-morning.png" width="32%" alt="Morning briefing email" />
</p>

**Also included**

- light / dark / system theme;
- 8 interface languages (English, Tiếng Việt, 简体中文, 日本語, 한국어, Español, Français, Deutsch);
- a separate AI briefing language, which emails follow too;
- listen to the briefing;
- share;
- the last 10 briefings per section;
- the macro strip;
- a market open/close countdown;
- keyboard shortcuts;
- install to your home screen as an app.

Design notes and the reasoning behind each feature: [`docs/PLAN.md`](docs/PLAN.md) (v2), [`docs/PLAN-v3.md`](docs/PLAN-v3.md) (v3) and [`docs/PLAN-v4.md`](docs/PLAN-v4.md) (v4).

## The part that keeps the AI honest: the track record

<img src="docs/screenshots/track-record.png" width="60%" align="right" alt="Track record" />

A confidence number means nothing unless you know how often it's right. Every outlook in My Interests is logged as a call on the **next session that hasn't opened yet**, so the AI never gets to peek at the market's reaction. Each call is then graded against the real close ("today" calls on the next close, "this week" calls on the 5th close).

The calibration chart compares what the AI claimed (line) with how often it was right (bar). Below it, the equity curve shows what acting on every daily call would have returned next to simply holding the same tickers (before costs). These numbers go back into the prompt on every run so the model can recalibrate. Give it a few weeks before you trust them.

<br clear="right" />

## How it works

```
GitHub Actions cron (5x/day, free) ──► /api/refresh on Vercel
                                          │
         ┌────────────────────────────────┼─────────────────────────────┐
         ▼                                ▼                             ▼
  News: Google News RSS per interest,  Prices: Yahoo chart API      Track record:
  Yahoo per-ticker RSS, CNBC,          (Nasdaq, Stooq fallback)     grade past calls
  MarketWatch, BBC, NPR, Al Jazeera,
  VnExpress, CafeF, Vietstock,
  optional Finnhub
         │  dedupe near-duplicate headlines, tag by interest
         ▼
  AI analysis: Claude → Groq → Gemini → rule-based (first one that works)
  with a curated playbook of historical market reactions + your track record
         │
         ▼
  Upstash Redis (digests, interests, calls) ──► the web page
```

- **Provider chain.** Free today, Claude later. Free providers get a compact prompt (fewer headlines, only the relevant playbook entries, capped output) so a run stays under their tokens-per-minute limits. With no keys at all you get a rule-based keyword read, which is useful for testing and not much else. Add a free Groq or Gemini key for real analysis. Add `ANTHROPIC_API_KEY` and Claude takes over automatically. If a provider fails (rate limit, outage, bad JSON), the next one runs, and the page shows which one produced the briefing.
- **Historical playbook** (`src/lib/analogs.ts`): a hand-checked list of past events and how markets reacted (CPI surprises, Fed pivots, tariff shocks, DeepSeek, export controls, and more). The AI is told to prefer these over its own memory, which cuts down on invented history. Add your own entries.
- **Scheduler.** Vercel's free plan only allows one cron per day, so a GitHub Actions workflow calls the app before the open (twice), at midday, after the close, and on Sunday evening. Vercel's daily cron is a backup.

## Setup (about 15 minutes, all free)

1. **Get a free AI key**: [Groq](https://console.groq.com/keys) (recommended, generous limits) and/or [Gemini](https://aistudio.google.com/apikey). Having both gives you a fallback.
2. **Deploy to Vercel**: [vercel.com/new](https://vercel.com/new) → import this repo → Deploy.
3. **Add storage**: in the Vercel project, open Storage → Marketplace → **Upstash for Redis** → free plan → connect to the project. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Without it, data is lost whenever Vercel recycles the server.
4. **Environment variables** (Vercel → Settings → Environment Variables), see `.env.example`:
   - `GROQ_API_KEY` and/or `GEMINI_API_KEY`
   - `APP_PASSWORD`: anything you like. The site asks for it once per browser, which keeps strangers from burning your AI quota.
   - `CRON_SECRET`: a long random string (`openssl rand -hex 24`)
   - optional `FINNHUB_API_KEY` ([free](https://finnhub.io)) for extra ticker-tagged company news

   Then redeploy.
5. **Email alerts (optional, free)**: pick one.
   - **Resend** (simplest): sign up at [resend.com](https://resend.com) with the email you want alerts at, create an API key, and add `RESEND_API_KEY` in Vercel. Without your own domain, Resend sends from `onboarding@resend.dev` to your own address, which is all you need here.
   - **Gmail**: turn on 2-step verification, create an [app password](https://myaccount.google.com/apppasswords), and set `SMTP_URL=smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com:465`.

   Then in the app go to Settings → Alerts: turn alerts on, enter your email, press **Send test email**.
6. **Turn on the scheduler**: GitHub repo → Settings → Secrets and variables → Actions → add `APP_URL` (your Vercel URL, e.g. `https://invest-helper-xyz.vercel.app`) and `CRON_SECRET` (same value as in Vercel). Run it once by hand from the Actions tab → "Refresh briefings" → Run workflow. A second workflow, "Price alerts", checks prices every 20 minutes during US market hours (no AI, ~600 of the 2,000 free monthly Action minutes on a private repo). Want it every minute? Create a free job at [cron-job.org](https://cron-job.org) that calls `GET https://YOUR-APP/api/alerts/check` with the header `Authorization: Bearer YOUR_CRON_SECRET`.
7. Open the site, enter your password, and press **↻ Refresh** on any section.

### Accounts for other people (optional, free)

By default the app is just for you, behind `APP_PASSWORD`. To let anyone sign in with Google and get their own interests, holdings, alerts and personal briefing:

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → create a project → **OAuth consent screen** (External, add your app name and email) → **Credentials** → Create credentials → OAuth client ID → Web application.
2. Authorized redirect URI: `https://YOUR-APP.vercel.app/api/auth/callback/google` (add `http://localhost:3000/api/auth/callback/google` too for local dev).
3. In Vercel add `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET` (`openssl rand -base64 32`) and `OWNER_EMAIL` (your Google email, so you keep your current data and can force refreshes). Redeploy.
4. While the consent screen is in "Testing", only test users you add can sign in (up to 100). Press **Publish app** when you want anyone in. Basic sign-in (email, name, picture) doesn't need Google's verification review.

What changes:
- Visitors can read everything without signing in (default interests, shared sections in their language). Saving interests, holdings, alerts, Ask AI and refresh need an account. The password prompt goes away.
- World, US and Vietnam are generated once per language and shared by everyone. Personal briefings are shared too when interests and language match exactly, so 50 people on the defaults cost the same as one.
- The scheduler refreshes the 2 stalest personal sets per call, 3 calls per run (6 sets, about 5x a day). Past roughly 6 distinct interest sets, briefings get refreshed less often, not more expensively. Raise the `INTEREST_ROUNDS` repo variable when you have the quota for it. Manual refresh has a cooldown (30 min shared, 5 min personal) to protect the free AI tier.
- Actions minutes: each run is now about 7 minutes. Fine on a public repo (unlimited); on a private repo that plus price alerts is about 1,300 of the 2,000 free minutes.

### Adding Claude later

Set `ANTHROPIC_API_KEY` in Vercel and redeploy. It defaults to `claude-opus-5-5`. Rough cost: 3 sections × 5 runs a day is about 15 calls a day, roughly $1-2 a day on Opus at the default effort (about $25-40 a month). Set `CLAUDE_MODEL=claude-sonnet-5-5` to cut that roughly in half, or `claude-haiku-5-5` for pennies. Run them side by side for a while and let the track record decide.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `1` `2` `3` | Switch section |
| `R` | Refresh this section |
| `/` | Search headlines |
| `⌘K` / `Ctrl+K` | Command palette |
| `A` | Ask AI |
| `C` | Catch-up mode |
| `L` | Listen to the briefing |
| `T` | Track record |
| `D` | Toggle light/dark |
| `?` | Show shortcuts |

## Install on your phone

Open the site in Safari (iPhone) or Chrome (Android) → Share → **Add to Home Screen**. It opens full screen like an app.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in at least one AI key
npm run dev                  # http://localhost:3000
npm run refresh              # run the pipeline once from the terminal
npm test                     # offline tests: translations, pipeline, calendar, LLM path and fallback
```

Locally, data is stored as JSON in `.data/`.

## Customizing

- **Interests**: in the app. Name, news search (Google News syntax: `OR`, `"quoted phrases"`), tickers. The first ticker is the benchmark used for the outlook and track record. ETFs work well for themes: QQQ, SPY, SOXX, SMH, XLE, XLF, IBIT.
- **World/US feeds**: `SECTION_FEEDS` in `src/lib/config.ts`.
- **Analyst behavior**: `SYSTEM_PROMPT` in `src/lib/llm/prompt.ts`.
- **Refresh times**: `.github/workflows/refresh.yml` (cron is in UTC).

## Known limits, stated plainly

- Headlines only, no full articles. The AI sees what a fast reader would see, not paywalled analysis.
- "Live" means polled every ~20 seconds, not tick-by-tick streaming. Good for a daily-trend tool. True streaming needs a paid data feed.
- Price alerts are as fresh as the check interval (~20 min by default).
- Free feeds and the Yahoo price endpoint are unofficial and can change or rate-limit. Failures show up under "feed(s) failed", and the app keeps going with whatever loaded.
- Free LLM tiers change their limits and models often. If one starts failing, the fallback note on the page will say so. Swap the model via `GROQ_MODEL` / `GEMINI_MODEL`.
- Technical levels and the mood gauge are context computed from price history. They are not signals on their own.
- Scenario probabilities are the AI's estimates, not market-implied odds.
- The "followed the AI" curve ignores trading costs and assumes equal weight per call.
- The grading is a simple direction check. It doesn't measure how big a move was or whether a trade would have made money after costs.
- AI predictions from public news. They will be wrong regularly. Not financial advice.
