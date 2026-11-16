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
- **Users can't refresh any section.** Briefings refresh on the GitHub Actions schedule. Only the admin (owner) can force a refresh. A newly saved interest set gets its first briefing automatically, once.
- **One language setting per person**, used for the app, briefings and alert emails. **Every briefing is generated in English and translated** (cached per briefing version). Never regenerate a briefing to change its language.
- **Signed-out visitors** can read World / US / Vietnam; My Interests shows a sign-in invitation. Visitors land on World (Vietnam if their language is Vietnamese).
- **Search like Apple Stocks:** find any US, Vietnamese or global stock / ETF / index (accents optional), tap + to follow. Following creates a one-ticker interest.
- **Prices must never just disappear:** Vietnamese prices come from Vietnamese brokers (DNSE, Vietcap, VNDirect); Yahoo is batched and backs off; Yahoo-only symbols fall back to tracking ETFs (tagged); last good prices fill gaps (dimmed). Grading never uses stale prices.
- **No scraped API keys** and no bypassing rate limits (an automated permission check blocked both; respect that).

## How the owner likes to work

- Direct, concise, natural writing. No em dashes, buzzwords or jargon. Explain decisions plainly.
- Wants ideas stress-tested and different perspectives; first-principles reasoning; propose the cheaper option when token cost is involved.
- Wants research before building when data sources are involved (test real endpoints from a cloud server).
- **Git:** work on a new branch (`v9`, `v10`, ...), run `npm test` + `npm run build`, push, then **ask before merging to `main`** (merging deploys to production) unless the owner says to merge right away.
- Commits end with the `Co-Authored-By` / `Claude-Session` lines the session provides.
- Keep the owner's personal details (email) out of code, docs and requests to outside services.

## Current state

- `main` = v8, deployed on Vercel at `investhepi.vercel.app`.
- Multi-user mode is on (Google sign-in via Auth.js). Vercel env vars in use: AI keys (`GROQ_API_KEY`, `GEMINI_API_KEY`), Upstash (`KV_REST_API_*`), `APP_PASSWORD`, `CRON_SECRET`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `OWNER_EMAIL`, optionally `CONTACT_EMAIL` (shown on `/privacy` and `/terms`). GitHub repo secrets `APP_URL`, `CRON_SECRET` drive the scheduler.
- Optional knobs: `TRANSLATE_DAILY_LIMIT` (80), `AUTOGEN_DAILY_LIMIT` (6), `REFRESH_DAILY_LIMIT`, `ASK_DAILY_LIMIT`, `INTEREST_BATCH`, repo variable `INTEREST_ROUNDS`, `SHARED_LANGUAGES`.
- Google OAuth consent screen: branding filled in, privacy/terms pages exist; publishing needs no logo (a logo triggers brand verification).
- A personal Claude cloud environment named `invest-helper` exists with network access to the market-data hosts (Yahoo, Nasdaq, DNSE, Vietcap, VNDirect, ...) for live testing. Node needs `NODE_USE_ENV_PROXY=1` there.
- Tests: 10 offline suites (`npm test`), all passing at v8.

## Open items / known gaps

- Translations are covered by tests with a fake AI but haven't been checked with a real AI key; verify output quality on the live site.
- When Yahoo refuses Vercel, US 10Y and USD/VND have no ETF stand-in and only show their last known value.
- Track-record grading uses the US trading calendar; Vietnamese holidays (Tet) aren't modeled. The HOSE market clock doesn't model holidays either.
- Interest sets saved in Vietnamese before v8 get their first English briefing on the next scheduled run.
- README screenshots in `docs/screenshots` still show the old name "Invest Helper".
- Alert emails to other users need a verified Resend domain or Gmail SMTP (Resend's test sender only reaches the account owner).
