> Historical: this plan was carried out in an earlier round and is kept for the record. The current state is in `CLAUDE.md` and `docs/HANDOFF.md`.

# Invest Helper v2 plan

**Goal (fixed):** catch up on news about my stocks fast, and act on an AI read of the daily trend.

Every feature below was checked against two questions:

1. Does it make catching up faster?
2. Does it make the decision better or easier to act on?

If neither, it got cut, even if competitors have it.

## 1. What the research says

| Product | What it does well | What we take |
|---|---|---|
| Robinhood Cortex Digests | Plain-language "why is this stock moving", right on the stock page | A **Movers** block: the AI explains your biggest movers in the same call (no extra cost) |
| Google Finance (2026 app) | Scheduled AI pre-market summary, "key moments" on charts | Already have the scheduled briefing. Add a **ticker sheet** with chart + related news + the AI call |
| StockTitan / StockNews.AI | Impact scoring per headline | Mark headlines the AI used as **Key**. Scoring every headline costs tokens free tiers can't afford |
| Ground News | Clusters one story from many outlets, shows source count | **"+N sources"** on merged headlines. Coverage breadth is a cheap importance signal |
| Benzinga Pro | Calendars (earnings, economic), movers, audio squawk | **Up next calendar** (earnings for your tickers + FOMC/CPI/jobs), **Listen** (text-to-speech briefing) |
| Perplexity Finance | Earnings hub, AI market summary with citations | Calendar goes into the AI prompt so "watch next" uses real dates. Sources stay linked |
| Apple (HIG, Liquid Glass) | Glass only on navigation, never behind content. Semantic colors, SF type scale, 44pt targets | Design system in section 3 |

## 2. Features: stress test

✅ build · ✂️ cut · ⏸ needs your decision

| Feature | Catch-up | Act | Risk or cost | Verdict |
|---|---|---|---|---|
| Light / dark / system theme | – | – | None. You asked for it | ✅ |
| UI language (EN, VI, 中文, 日本語, 한국어, ES, FR, DE) | ✅ reads in your language | – | Static strings, upkeep is low | ✅ |
| AI briefing language | ✅ the summary is the catch-up layer | ✅ | Briefings are made by the scheduler in one language, so it's a server setting. Saving it re-runs the analysis. Headlines stay in their original language (translating 60 a run would blow free-tier limits) | ✅ |
| "New since last visit" dots + tab badges | ✅✅ the core of catching up | – | Per browser (phone and laptop track separately). Acceptable for one user | ✅ |
| "+N sources" on merged stories | ✅ shows what's big | ✅ | Free, comes out of dedupe | ✅ |
| "Key" badge on headlines the AI cited | ✅ | ✅ | Free | ✅ |
| Movers: AI "why it's moving" for your biggest movers | ✅ | ✅✅ | Small schema addition, same AI call | ✅ |
| Up next calendar (earnings + FOMC/CPI/jobs) | ✅ | ✅✅ catalysts drive daily trend | Free calendar sources are shaky (see risks). Multiple sources, hard-coded 2026 FOMC dates | ✅ |
| Macro strip (VIX, 10Y, oil, gold, dollar, BTC) + fed to AI | ✅ | ✅ explains index moves | Yahoo only, may fail silently | ✅ |
| Market status + countdown (ET and your local time) | ✅ | ✅ | None | ✅ |
| Sparklines on quotes, ticker detail sheet | ✅ | ✅ | Uses price history we already fetch | ✅ |
| Listen to briefing (text to speech) | ✅ hands-free on a commute | – | Browser voices vary. Hidden if unsupported | ✅ |
| Copy / share briefing | – | ✅ | None | ✅ |
| Briefing history (last 10 per section) | – | ✅ see how calls shift | ~2 MB in Redis, well within free tier | ✅ |
| Calibration chart in track record | – | ✅✅ is the confidence trustworthy? | None | ✅ |
| Search + saved headlines | ✅ | – | localStorage | ✅ |
| Keyboard shortcuts | ✅ desktop speed | – | None | ✅ |
| Install as app (PWA manifest, icons) | ✅ daily habit from the home screen | – | No offline cache on purpose: stale market data offline is worse than none | ✅ |
| Setup / status panel (which keys work, storage) | – | – | Essential, since nothing is deployed yet | ✅ |
| Density setting | marginal | – | More settings, against minimalism | ✂️ |
| Fear & Greed index | – | marginal | CNN endpoint is unofficial and blocks bots. VIX covers fear | ✂️ |
| Impact score on every headline | ✅ | ✅ | Doubles output tokens. Free tiers can't afford it | ✂️ |
| Offline mode / service worker | – | – | Stale prices are dangerous | ✂️ |
| Alerts (big move, high-confidence call) | ✅ | ✅✅ | Needs a channel: web push, Telegram or email. Each has setup and privacy tradeoffs | ⏸ |
| Translate headlines | ✅ | – | Token cost on free tiers | ⏸ (doable with Claude) |

## 3. Design system ("Apple, minimal, quietly futuristic")

- **Type:** system font stack (SF Pro on Apple devices, Segoe/Roboto elsewhere). Large titles 34px, semibold, -0.02em tracking. Numbers in SF Mono / ui-monospace with tabular figures so prices don't jitter.
- **Color:** semantic tokens only. Light: #f5f5f7 background, white cards, #1d1d1f text, #0071e3 accent. Dark: true black background, #1c1c1e cards, #0a84ff accent. Apple system green/red/orange for up/down/neutral. Every pair checked for contrast.
- **Glass:** only the top bar, the bottom tab bar (mobile) and sheets, per Apple's guidance. Content sits on solid surfaces for legibility.
- **Futuristic, sparingly:** one soft accent glow behind the briefing, confidence shown as rings, a live pulse dot, thin hairlines, monospace numbers. No neon, no gradients on text.
- **Layout:** large-title header with the date. Segmented control for sections on desktop, iOS-style glass tab bar on mobile. Sheets slide up from the bottom on mobile and sit centered on desktop.
- **Motion:** short (≤250ms) ease-out transitions. Fully disabled under `prefers-reduced-motion`.
- **Accessibility:** 44px touch targets, visible focus rings, ARIA labels on icon buttons.

## 4. Architecture changes

- `settings` key in the store (briefing language). `GET/PUT /api/settings`, and saving re-runs the analysis.
- Digest history: `digest:{section}:{timestamp}` plus an index, capped at 10. `GET /api/history`.
- Calendar module: Finnhub earnings (if a key is set) → Nasdaq calendar (no key) → none. FOMC 2026 hard-coded, BLS release schedule fetched when reachable. Stored once per refresh and fed to the prompt. `GET /api/calendar`.
- Macro quotes in the digest and in the prompt.
- Schema: add `movers[]`.
- `GET /api/status`: providers configured, storage type, last refresh per section.
- Front end split into components plus a small i18n module. No new runtime dependencies.

## 5. Risks found by stress-testing, and fixes

1. **Free-tier token limits (biggest risk).** Groq's free tier caps tokens per minute per model, reportedly as low as ~8K for large models. The v1 prompt (full playbook + 45 headlines + summaries) plus output could exceed that, and adding the calendar, macro data and movers makes it worse. **Fix:**
   - only the playbook entries relevant to today's detected event types;
   - a compact prompt for free providers (fewer headlines, no summaries);
   - capped output;
   - the scheduler waits ~65s between sections so each one gets a fresh minute;
   - Gemini as fallback.
2. **Language mismatch:** if the UI is in Vietnamese and the briefing in English, that's fine and expected. The settings sheet says so, and saving a new briefing language re-runs the analysis right away.
3. **Calendar data gaps:** every source is optional. When the year rolls past the hard-coded FOMC dates, the panel says so instead of showing nothing.
4. **"New" dots are wrong across devices:** stated in the UI. Server-side read state would need user accounts, which is overkill for one person.
5. **More UI ≠ faster catch-up:** order follows priority (briefing → what to do → movers → events → calendar → headlines). Secondary features live in sheets, not on the main page.

## 6. Status

All ✅ items are built and tested on the `v2-ui` branch:

- offline tests cover translations, pipeline, calendar parsing, history cap, compact prompt, and free-provider fallback;
- browser checks cover new-dots/badges, theme persistence, shortcuts, search, saved headlines, history, and live language switching;
- visual review done in light, dark, desktop and phone.

## 7. Decisions waiting for you

1. **Alerts:** do you want them, and through which channel? Web push needs nothing extra but iOS needs the app installed to the home screen. Telegram needs a bot token. Email needs a sending service.
2. **Headline translation:** worth turning on once Claude is connected?
3. **Merge:** the v2 work is on the `v2-ui` branch. Merge to `main` when you've looked at it.
