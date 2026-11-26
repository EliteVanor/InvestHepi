# InvestHepi

**Catch up on the news that matters, understand it, and see what it does to markets.** InvestHepi groups headlines from many outlets into stories, has an AI explain each one for a curious reader (with or without a finance background), and shows its effect on markets with real prices. Separate AI predictions make graded buy / hold / wait calls, and a public track record shows how often they are right.

**Live site: [investhepi.vercel.app](https://investhepi.vercel.app)** · [Tiếng Việt](README.vi.md) · [About](https://investhepi.vercel.app/about)

<p align="center">
  <img src="docs/screenshots/desktop-light.png" width="68%" alt="World section on a wide screen: the big picture and story cards" />
  <img src="docs/screenshots/mobile-dark.png" width="22%" alt="Vietnam section on a phone, dark mode" />
</p>

<sub>Screenshots of the live site, signed out, November 2026.</sub>

It runs on free plans only: Vercel Hobby, Upstash Redis, and the Groq and Gemini free tiers. The interface is in 8 languages (English, Tiếng Việt, 简体中文, 日本語, 한국어, Español, Français, Deutsch); Vietnamese readers come first.

> AI predictions from public news. They are wrong regularly. Nothing here is financial advice.

## What you get

| Section | Covers | Written in |
|---|---|---|
| **World** | Geopolitics, foreign economies, central banks, oil, trade, plus science and health | English, translated for readers |
| **US** | The Fed, economic data, Congress, the White House, companies | English, translated for readers |
| **Vietnam** | VN-Index, banks and large caps, the State Bank, USD/VND, plus science and culture | Vietnamese, translated for readers |
| **My Interests** | The stocks and themes you follow (sign in) | English, translated for readers |

Each section shows, top to bottom:

1. **The big picture**: three lines on what matters today.
2. **Story cards**: the 5 most important stories and 2 interesting ones. A story is one event as reported by several outlets. Each card says what happened, why it matters, the effect on markets (today's moves from real prices), the effect on the world, a similar past event from a checked library, the terms you may not know, and every source.
3. **Markets**: the price strip, the biggest movers (with a reason only when a headline names the company) and a market mood gauge.
4. **Predictions**: per market, the calls made before the open and at mid-day, and the weekly calls, each with its trigger, reasons and risks.
5. **Headlines**: the live list, refreshed every 15 minutes without AI.

<p align="center">
  <img src="docs/screenshots/desktop-dark.png" width="68%" alt="US section, dark mode" />
</p>

More: catch-up mode (`C`, the briefing as full-screen cards), a stock page with live charts and technicals, stock search by name or symbol with accents optional ("vinamilk", "hoa phat"), Ask AI for follow-up questions, email alerts, an optional holdings card, a command palette (`⌘K`), and every time shown in your time zone with the zone named.

<p align="center">
  <img src="docs/screenshots/ticker.png" width="49%" alt="Stock page with live chart and technicals" />
  <img src="docs/screenshots/catch-up.png" width="22%" alt="Catch-up mode on a phone" />
</p>

## How it keeps the AI honest

<img src="docs/screenshots/track-record.png" width="50%" align="right" alt="Track record sheet" />

- **Every number comes from data.** Market moves on story cards and movers are overwritten from real prices after the AI answers. A sentence with a number that is not in the AI's input is dropped.
- **Sources are checked.** A card can cite only headlines from its own story. A company's shares appear on a card only when a report names the company.
- **Past events come from a library**, not from the AI's memory: 80 entries, each with its date, measured market move and a source link. With no close match, the card says so.
- **Predictions are graded at each market's close**, against the price when the call was made. The headline number is the hit rate with its likely range, next to how often "always up" would have been right on the same calls, because markets rise more days than not.
- **The record feeds back in.** Every prediction prompt gets the track record. Once a confidence level has 20+ graded calls, the shown confidence moves toward its real hit rate.
- **No stale data in predictions.** If a market's latest close or live price is missing, the run is marked "unavailable" instead of guessing.

<br clear="right" />

## How it works

```mermaid
flowchart LR
  P["Schedulers<br/>Vercel 15 min · cron-job.org 30 min · GitHub 3 h"] --> T["/api/cron/tick<br/>one timetable"]
  T --> H["Headlines<br/>RSS, no AI, every 15 min"]
  T --> B["Briefing run<br/>cluster into stories, pick, one AI call"]
  T --> R["Prediction run<br/>one market, local time"]
  T --> G["Grading<br/>hourly, at each close"]
  B --> S[("Upstash Redis")]
  R --> S
  G --> S
  H --> S
  S --> W["The page<br/>translated per reader, cached"]
```

1. **Pokers** call the tick on an interval. The tick reads the one timetable (`src/lib/timetable.ts`), runs one unit that is due, and calls itself again.
2. **Headlines** come from RSS feeds (BBC, NPR, CNBC, Al Jazeera, VnExpress, CafeF, Vietstock, Tuổi Trẻ, Google News and more). They are grouped into stories by word matching, with no AI.
3. **A briefing run** picks the candidate stories (by outlet count and the market moves they touch), and one AI call writes the cards, the big picture and the movers' reasons. Gemini Flash-Lite goes first; Groq's models are the fallback.
4. **A prediction run** calls one market (Vietnam, US, Japan, China & Hong Kong, Europe, oil, gold, or a reader's interests) twice a weekday on that market's clock, on Groq's gpt-oss-120b first.
5. **Grading** checks every call against the close of its own exchange, within the hour, and again against the official close.

Prices are free, keyless and unofficial: Yahoo where it answers, Nasdaq for US stocks, DNSE, Vietcap and VNDirect for Vietnam, VNDirect's daily world closes and the US Treasury for world levels, and Eastmoney for intraday index levels. Where only a tracking ETF is available, the app shows its % move and never passes its price off as the index level.

**Free-tier budget.** Groq allows 200K tokens a day per model and Gemini Flash-Lite 500 requests a day. The app records its real use per model, cools a model down after a rate limit, keeps the best model's tokens for the predictions still due today, and stops visitor-triggered AI work at 70% of a model's day so the shared briefings always run.

## Run your own copy

About 15 minutes, all free.

1. **AI keys**: [Groq](https://console.groq.com/keys) and/or [Gemini](https://aistudio.google.com/apikey). Both give you a fallback.
2. **Deploy**: [vercel.com/new](https://vercel.com/new), import this repository, deploy.
3. **Storage**: in the Vercel project, Storage → Marketplace → **Upstash for Redis** (free) → connect. Without it, data is lost whenever Vercel recycles the server.
4. **Environment variables** (Vercel → Settings → Environment Variables; every option and its default is in [`.env.example`](.env.example)):
   - `GROQ_API_KEY` and/or `GEMINI_API_KEY`
   - `APP_PASSWORD`: the site asks for it once per browser, so strangers can't spend your AI quota
   - `CRON_SECRET`: a long random string. Vercel sends it with its scheduled calls, which turns the scheduler on.

   Then redeploy.
5. **Backup scheduler and late alerts (recommended)**: set `TICK_SECRET` in Vercel, then create a free [cron-job.org](https://cron-job.org) job that calls `GET https://YOUR-APP/api/cron/tick?src=cron-job.org` every 30 minutes with the header `Authorization: Bearer YOUR_TICK_SECRET` and email on failure. The tick answers 503 when a run is late, so you hear about it. For the GitHub backup, add repository secrets `APP_URL` and `CRON_SECRET`.
6. **Email alerts (optional)**: [Resend](https://resend.com) (`RESEND_API_KEY`) or Gmail with an app password (`SMTP_URL=smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com:465`), then Settings → Alerts → **Send test email**.
7. Open the site, enter your password, and press **↻ Refresh** on a section once. The schedule takes over from there.

### Accounts for other people (optional)

To let anyone sign in with Google and get their own interests, holdings, alerts and briefing:

1. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials): OAuth consent screen (External), then Credentials → OAuth client ID (Web application).
2. Redirect URI: `https://YOUR-APP.vercel.app/api/auth/callback/google` (and `http://localhost:3000/api/auth/callback/google` for local development).
3. In Vercel, add `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET` (`openssl rand -base64 32`), `OWNER_EMAIL` (your Google address: you keep your data and become the admin) and `CONTACT_EMAIL` (shown on the privacy page). Redeploy.
4. While the consent screen is in "Testing", only listed test users can sign in. Publish the app when you want anyone in.

Visitors then read World, US and Vietnam without signing in. My Interests, holdings, alerts, Ask AI and refresh need an account. People who follow the same interests share one briefing, so 50 people on the defaults cost the same as one.

### Adding Claude

Set `ANTHROPIC_API_KEY` and redeploy: Claude then goes first in every job (`CLAUDE_MODEL` picks the model). Count the calls first: about 20 briefings and 20 prediction runs on a weekday, plus users' sets, translations and Ask AI, against Anthropic's current pricing.

## Development

```bash
npm install
cp .env.example .env.local   # at least one AI key for real briefings
npm run dev                  # http://localhost:3000, data in .data/ as JSON
npm run refresh -- world     # run one briefing from the terminal
npm test                     # all offline test suites (no network), with a summary
npm run typecheck
npm run build                # must pass with and without the AUTH_* variables
```

Tests are plain `tsx` scripts with `node:assert`, a mocked `fetch` and a pinned clock, so they pass offline on any day. CI runs typecheck, the tests and both builds on every push.

- [`CLAUDE.md`](CLAUDE.md): the code map, the architecture, the price sources, and which test suite covers what.
- [`docs/dev-notes/`](docs/dev-notes/): the product decisions and the history of each round.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SECURITY.md`](SECURITY.md).

**Customizing**: refresh times in `src/lib/timetable.ts` (nothing else repeats them), feeds in `SECTION_FEEDS` (`src/lib/config.ts`), models and budgets in `src/lib/llm/models.ts`, holidays in `src/lib/holidays.ts`.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `1` `2` `3` `4` | Switch section |
| `R` | Refresh this section (if you may) |
| `N` | Jump to the headlines |
| `/` | Search headlines |
| `⌘K` / `Ctrl+K` | Command palette |
| `A` | Ask AI |
| `C` | Catch-up mode |
| `L` | Listen to the briefing |
| `T` | Track record |
| `D` | Light / dark |
| `[` / `]` | Wide screens: fold the sidebar / the Ask AI panel |
| `?` | All shortcuts |

To install it on a phone: open the site in Safari (iPhone) or Chrome (Android), then Share → **Add to Home Screen**.

## Known limits

- Headlines and their snippets only, no full articles: each part of a card may say "not clear from the reports".
- One event worded differently by different outlets can stay in separate stories, so outlet counts run low.
- "Live" prices are polled every 20 seconds to a minute, not streamed. Price alerts are checked every 20 minutes during US hours.
- Sources are unofficial and can change or rate-limit. World closes from VNDirect arrive the next day, so some Asian levels in the early run are one session old (labeled with their date). Shanghai, KOSPI, Nifty, gold and currency pairs have no intraday source from the cloud.
- Holidays and early closes are tabled for 2026-2027 (NYSE, CME, HOSE, Tokyo, Hong Kong, London, Frankfurt, Euronext). Seoul, Shanghai and Mumbai have no table.
- Free AI tiers change their limits and models often.
- Grading checks direction only. It doesn't measure the size of a move or profit after costs.

## License

[MIT](LICENSE). Headlines and links belong to their publishers. Market data comes from third-party sources and may be delayed or wrong.
