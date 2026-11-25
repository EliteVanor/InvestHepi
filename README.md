# InvestHepi

Catch up on market news in a few minutes and see what it likely means: a short AI briefing per market, separate graded predictions (buy / hold / wait calls made before each market opens and at mid-day, with the reasons and risks behind each), and a track record that grades every call against real closes.

<p align="center">
  <img src="docs/screenshots/desktop-light.png" width="68%" alt="World section on a wide screen" />
  <img src="docs/screenshots/mobile-dark.png" width="22%" alt="Vietnam section on a phone, dark mode" />
</p>

<sub>Screenshots from the live site (signed out), November 2026.</sub>

Runs entirely on free plans: Vercel Hobby, Upstash Redis, Groq and Gemini free tiers. 8 interface languages (English, Tiếng Việt, 简体中文, 日本語, 한국어, Español, Français, Deutsch).

## Sections

| Section | What it covers | Calls on |
|---|---|---|
| **My Interests** | Your own stocks and themes, from search (US, Vietnamese and global stocks, ETFs, indexes) or Settings → Interests | Each interest's first ticker |
| **World** | Geopolitics, foreign economies, central banks, oil, trade | US stocks, Europe, Japan, China & Hong Kong, oil, gold |
| **US** | Fed, economic data, Congress, the White House, regulation | S&P 500, Dow, Nasdaq 100, Russell 2000 |
| **Vietnam** | VN-Index, VN30, HNX, UPCoM, banks and large caps, SBV policy, USD/VND | VN-Index and five sector groups |

World, US and Vietnam are the same for everyone and never include anyone's personal stocks. With accounts on, My Interests is personal and asks visitors to sign in.

## What a briefing gives you

- **Briefing**: the takeaway, a risk-on / risk-off mood, and the main events.
- **What to do**: per market or interest, a direction, a confidence ring, an action (Buy / Add / Hold / Wait / Trim / Sell / Avoid), a concrete trigger, and the risks.
- **Scenarios**: before CPI, FOMC, jobs or earnings, an "if hot / in line / cool" playbook.
- **Movers**: the biggest moves, with a reason only when a cited headline names the company (otherwise "No clear news").
- **Key events**: why each matters, a past example of how markets reacted to something similar, and what could go wrong.
- **Up next**: earnings, FOMC, CPI, jobs and VN30 futures expiry, in the market's own time zone.
- **Headlines**: refreshed every 15 minutes without AI (your interests every 30 while you're reading, and right away when you come back), new-since-last-visit dots, the stories the AI used marked "Key", search, saved headlines, "Explain this".
- **Your time zone**: every time is shown in your zone (automatic, or pick one) and says which zone it is; charts and the open/closed pill stay in the exchange's own time.

<p align="center">
  <img src="docs/screenshots/desktop-dark.png" width="68%" alt="US section, dark mode" />
</p>

## Read faster, decide better

- **Catch-up mode** (`C`): the whole briefing as full-screen cards, one idea each. Tap, swipe or use the arrow keys.
- **Predictions** under each briefing: per market, the latest daily calls ("Before market" or "Mid-day", with the time on the market's clock and yours) and the weekly calls, each with when it's graded.
- **Since you were last here**: calls that flipped, the biggest moves since then, new key events.
- **Live prices and charts**: the strip and the stock page show the same numbers (1D · 5D · 1M · 6M · 1Y, candles, averages, past AI calls marked green/red), with technicals: 20/50/200-day averages, RSI, ranges, typical daily move.
- **Market mood gauge**: a transparent 0-100 composite you can open to see each part.
- **Ask AI**: follow-up questions answered from today's briefings, headlines, prices and calendar; chats saved per account.
- **Search like Apple Stocks**: any stock by name or symbol, accents optional ("vinamilk", "hoa phat"), one tap to follow.
- **Email alerts**: price targets and big moves, AI call changes, high-confidence calls, catalyst reminders, a morning briefing and a weekly recap.
- **Holdings (optional)**: a live P&L card. The AI only ever sees position weights and gain %, never amounts.
- **Command palette** (`⌘K`), keyboard shortcuts, listen to a briefing, share, the last 10 briefings per section, light/dark, install to your home screen.

<p align="center">
  <img src="docs/screenshots/catch-up-desktop.png" width="49%" alt="Catch-up mode" />
  <img src="docs/screenshots/ticker.png" width="49%" alt="Stock page with live chart and technicals" />
</p>
<p align="center">
  <img src="docs/screenshots/command-palette.png" width="49%" alt="Command palette" />
  <img src="docs/screenshots/catch-up.png" width="22%" alt="Catch-up mode on a phone" />
</p>

## The part that keeps the AI honest

<img src="docs/screenshots/track-record.png" width="58%" align="right" alt="Track record" />

A confidence number means nothing unless you know how often it's right. Predictions are their own job, run twice each weekday per market on that market's clock: **before market** (graded at that day's close on the ticker's own exchange, from the previous close) and **mid-day** (same close, measured from the price at that moment, so the morning's move doesn't count). Only the before-market run makes **weekly** calls, graded at the close of the 5th trading day (a holiday there: the previous session). A weekday the market is closed is "market closed, not graded". Each section keeps its own record, and every row says when the call was made and when it's graded.

The headline is the hit rate on up/down calls with its likely range, next to how often "always up" would have been right on the same calls: markets rise more days than not, so the edge over that is what counts. Calls on the same ticker and day share one outcome, so the range and the baseline count each ticker-day once. Flat calls must stay inside the ticker's usual daily range. The calibration chart compares what the AI claimed with how often it was right, the equity curve shows what acting on every call would have returned next to just holding, and each action (Buy, Wait, Sell...) shows what it earned.

The record feeds back in: every prediction prompt gets it, each call shows "Right x of y at this confidence", and once a confidence level has 20+ graded calls the shown confidence is pulled toward its real hit rate (the AI's own number stays visible). Give it a few weeks before trusting any of it; the sheet says "Early data" until then.

Other guards against invented facts:
- Every level, % and mover number is overwritten from real price data after the AI answers; tickers it can't back are dropped.
- A hand-checked playbook of past market reactions (`src/lib/analogs.ts`) that the AI must prefer over its memory.
- When an index is only available through a tracking ETF, the AI is told "level unknown, % moves only".
- When no AI model works, readers keep the last AI briefing with a banner, and can switch to a rule-based summary.

<br clear="right" />

## How it works

```
Vercel Schedules (every 15 min) ┐
cron-job.org (every 30 min)     ├──► /api/cron/tick ──► the timetable (src/lib/timetable.ts):
GitHub Actions (every 3 h)      ┘                       is a slot due? run ONE unit, then call the tick again
                                                                    │
     ┌──────────────────────────────────────────────────────────────┼────────────────────────────┐
     ▼                                                              ▼                            ▼
News: Google News per interest, Yahoo per-ticker RSS,   Prices: Yahoo (batched) → Nasdaq;     Track record:
CNBC, BBC, NPR, Al Jazeera, VnExpress, CafeF,           Vietnam: DNSE → Vietcap → VNDirect;   grade past calls
Vietstock, Tuổi Trẻ, optional Finnhub                   world closes: VNDirect, US Treasury
     │  dedupe near-duplicates, tag by interest
     ▼
AI: predictions on Groq gpt-oss-120b, briefings on Gemini Flash-Lite first (each job has its own model order),
token budgets tracked per model per day; briefings fall back to rules, predictions are retried once, never invented
     │
     ▼
Upstash Redis (briefings, interests, calls) ──► the page, translated per reader (cached per version)
```

- **Schedule.** Briefings (UTC, every day): World 4×, US 5×, Vietnam 5×; the admin's interests 6×, other users' 4×. Predictions (weekdays, each market's local time): two runs per market, Vietnam, US and each World market (Japan, China & Hong Kong, Europe, US stocks, oil, gold); each interest set's US and Vietnam parts on their own clocks. Users' sets are refreshed only if they were seen in the last day; someone back after longer gets a fresh briefing when they open the app. Runs are idempotent (anything written since 30 min before a slot is skipped), and a slot more than an hour late is reported.
- **One language to write, many to read.** Every briefing is written once in English and translated for readers, cached per version, so switching language never re-runs an analysis.
- **Free-tier budget.** Groq allows 200K tokens a day per model, Gemini Flash-Lite 500 requests a day each. The app records real use per model, cools a model down after a 429, and reserves the best model's tokens for the shared and admin briefings still due today.

## Setup (about 15 minutes, all free)

1. **AI keys**: [Groq](https://console.groq.com/keys) (recommended) and/or [Gemini](https://aistudio.google.com/apikey). Both gives you a fallback.
2. **Deploy**: [vercel.com/new](https://vercel.com/new) → import this repo → Deploy.
3. **Storage**: Vercel project → Storage → Marketplace → **Upstash for Redis** (free) → connect. Without it, data is lost whenever Vercel recycles the server.
4. **Environment variables** (Vercel → Settings → Environment Variables; every option with its default is in [`.env.example`](.env.example)):
   - `GROQ_API_KEY` and/or `GEMINI_API_KEY`
   - `APP_PASSWORD`: the site asks for it once per browser, so strangers can't burn your AI quota
   - `CRON_SECRET`: a long random string. Vercel sends it with its scheduled calls, which turns the scheduler on.

   Then redeploy.
5. **Scheduler backup and late alerts (recommended)**: set `TICK_SECRET` (another random string) in Vercel, then create a free [cron-job.org](https://cron-job.org) job calling `GET https://YOUR-APP/api/cron/tick?src=cron-job.org` every 30 minutes with the header `Authorization: Bearer YOUR_TICK_SECRET`, notifications on failure. It emails you when a refresh slot is late. Optionally add GitHub repo secrets `APP_URL` and `CRON_SECRET` for the GitHub backup.
6. **Email alerts (optional)**: [Resend](https://resend.com) (`RESEND_API_KEY`; without your own domain it sends to your own address) or Gmail with an app password (`SMTP_URL=smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com:465`). Then Settings → Alerts → **Send test email**.
7. Open the site, enter your password, and press **↻ Refresh** on any section once. The schedule takes over from there.

### Accounts for other people (optional, free)

To let anyone sign in with Google and get their own interests, holdings, alerts and briefing:

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → project → **OAuth consent screen** (External) → Credentials → OAuth client ID (Web application).
2. Redirect URI: `https://YOUR-APP.vercel.app/api/auth/callback/google` (plus `http://localhost:3000/api/auth/callback/google` for local dev).
3. In Vercel add `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET` (`openssl rand -base64 32`) and `OWNER_EMAIL` (your Google email: you keep your data and become the admin). Redeploy.
4. While the consent screen is in "Testing", only listed test users can sign in. **Publish app** when you want anyone in; basic sign-in needs no verification review.

Then: visitors read World, US and Vietnam without signing in; My Interests, holdings, alerts, Ask AI and refresh need an account. People with identical interests share one briefing, so 50 people on the defaults cost the same as one. Signed-in users can refresh their own My Interests 5 times a day (90 minutes apart, on a lighter model); the admin can refresh any section 10 times a day.

### Adding Claude later

Set `ANTHROPIC_API_KEY` and redeploy: Claude then goes first in every job (default `claude-opus-5-5`; `CLAUDE_MODEL=claude-sonnet-5-5` or `claude-haiku-5-5` costs less). Count the calls before you do: about 20 shared and admin briefings a day and 20 prediction runs on a weekday, plus users' sets, translations and Ask AI. Check that against Anthropic's current pricing, and let the track record decide whether it's worth it.

### Where prices come from

All free, keyless and unofficial, checked from a cloud server in November 2026:

| Symbols | Order tried |
|---|---|
| Vietnamese (`FPT.VN`, `^VNINDEX.VN`, `^VN30.VN`, `^HNX.VN`, `^UPCOM.VN`) | DNSE → Vietcap → VNDirect (→ Yahoo for stocks) |
| US stocks and ETFs | Yahoo (batched) → Nasdaq |
| World indexes, oil, gold, currencies | Yahoo → VNDirect's daily world closes (dated); US 10Y from the US Treasury's daily file |
| Euro Stoxx 50, DXY, VIX, Bitcoin | Yahoo → a tracking ETF (tagged "ETF", % moves only) |

Yahoo refuses most cloud servers, so the fallbacks do real work. Daily-only values carry their date; US index levels between official closes are carried forward from their ETF (shown with ≈). If nothing answers, the strip shows the last good price (dimmed) rather than a blank card. Graded calls never use stale prices.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `1` `2` `3` `4` | Switch section |
| `R` | Refresh this section (if you can) |
| `N` | Jump to the headlines |
| `/` | Search headlines |
| `⌘K` / `Ctrl+K` | Command palette |
| `A` | Ask AI |
| `C` | Catch-up mode |
| `L` | Listen to the briefing |
| `T` | Track record |
| `D` | Toggle light/dark |
| `[` / `]` | Wide screens: fold the sidebar / hide the Ask AI panel |
| `?` | Show shortcuts |

## Install on your phone

Open the site in Safari (iPhone) or Chrome (Android) → Share → **Add to Home Screen**.

## Development

```bash
npm install
cp .env.example .env.local   # at least one AI key
npm run dev                  # http://localhost:3000, data in .data/ as JSON
npm run refresh -- world     # run the pipeline once from the terminal
npm test                     # all 20 offline suites (no network), a summary at the end
npx tsx scripts/run-tests.ts v18test selftest   # only some suites (names from scripts/run-tests.ts)
npx tsx scripts/vntest.ts    # one suite on its own
npm run typecheck
npm run build                # must pass with and without the AUTH_* variables
```

[`CLAUDE.md`](CLAUDE.md) has the code map, the architecture and what each test suite covers; [`docs/HANDOFF.md`](docs/HANDOFF.md) has the product decisions and the history of each round.

## Customizing

- **Interests**: in the app. The first ticker of each interest is its benchmark (for the call and the track record). Theme ETFs work well: QQQ, SPY, SOXX, SMH, XLE, XLF, IBIT.
- **Refresh times**: `src/lib/timetable.ts` (UTC). Nothing else repeats the times.
- **Feeds**: `SECTION_FEEDS` in `src/lib/config.ts`. **Analyst rules**: `src/lib/llm/prompt.ts`. **Models**: `src/lib/llm/models.ts` or the env vars in `.env.example`.

## Known limits, stated plainly

- Headlines only, no full articles: the AI sees what a fast reader would see.
- "Live" means polled about every 20 seconds to a minute, not streaming. Price alerts are checked every 20 minutes during US hours.
- Sources are unofficial and can change or rate-limit; failed feeds are listed under the headlines and the app carries on with what loaded.
- World closes from VNDirect arrive the next day, so Asian indexes in the early-morning run are one session old (labeled with their date). Non-US listings (Samsung, Tencent, LVMH) have no source while Yahoo refuses the server.
- The market clocks and grading don't model Vietnamese holidays (Tet).
- Free AI tiers change their limits and models often. The admin sees each model's use today in `/api/status` (`aiUsage`).
- Technicals and the mood gauge are context, not signals. Scenario probabilities are the AI's estimates, not market odds. The "followed the AI" curve ignores costs.
- Grading is a direction check; it doesn't measure the size of a move or profit after costs.
- AI predictions from public news. They will be wrong regularly. Not financial advice.
