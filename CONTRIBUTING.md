# Contributing

Thanks for your interest. InvestHepi is a small project with one hard rule: **it must keep running on free plans** (Vercel Hobby, Upstash free, the Groq and Gemini free tiers). Every change that adds AI calls, requests or Redis commands needs its cost counted per day against those limits.

## Before you start

- Read [`CLAUDE.md`](CLAUDE.md): the code map, the architecture and which test suite covers what. The product decisions are in [`docs/dev-notes/HANDOFF.md`](docs/dev-notes/HANDOFF.md).
- For anything bigger than a fix, open an issue first and describe the problem, the change and its free-tier cost.

## Making a change

1. `npm install`, then `cp .env.example .env.local`. Every environment variable the code reads must be listed in `.env.example` with its default (a test checks this).
2. Add a regression test for every bug you fix. Tests are plain `tsx` scripts with `node:assert`, a mocked `fetch` and a pinned clock (`pinClock` in `scripts/clock.ts`), so they pass offline on any day. New v19 tests go in `scripts/v19/<topic>.ts`; new suites must be listed in `scripts/run-tests.ts`.
3. Any new UI string needs all 8 language files in `src/lib/i18n/` (`i18ntest` checks this).
4. Before you open a pull request, all of these must pass:

   ```bash
   npm test
   npm run typecheck
   npm run build
   AUTH_SECRET=x AUTH_GOOGLE_ID=x AUTH_GOOGLE_SECRET=x npm run build
   ```

## Rules for data and AI

- Prefer official, keyless, free sources. Don't add sources that need a scraped API key, a browser user agent trick, or a way around a bot check or rate limit.
- Every number the AI writes must trace to the data it was given. Overwrite numbers from data after the model answers and drop what can't be backed.
- Copy is plain and direct: no hype, specific risks, calibrated confidence.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
