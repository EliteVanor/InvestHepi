# v19b design: story pipeline (Nov 25 2026)

Owner decisions this design follows: HANDOFF v19 section (stories Q12-Q19, decisions 1-13) and the Nov 25 answers: v19a goes to `main` by PR #1; the past-event list is re-verified by opened pages; until the owner approves it, cards say "no close precedent"; **the Vietnam section is written in Vietnamese** and translated to English on read; no big-story trigger for My Interests; budget from estimates; design done in-session.

## Flow

```
 headline tick (15 min, no AI)                         briefing slot / big-story unit (briefing lane)
   fetchFeeds ─► clusterStories(items, prevIndex) ─► saveIndex(scope)          │
                     │            │                                            ▼
                     │            └─► bigStoryDue(index) ─► mark stories:big   runStories(scope, trigger)
                     ▼                                                         │ loadIndex → pickForRun
               toHeadlines(stories) ─► news:<section> (live list)              │ explainStories (1 AI call)
                                                                               │ guards → saveCards
                                                                               │ writeConcepts (≤1 small call)
                                                                               ▼
                                                     Digest { analysis (v18 shape), stories, bigPicture }
                                                     → per-card translation cache → page
```

The tick clusters with no AI and keeps the story index. `bigStoryDue` only marks a story; the scheduler runs it as a unit on the briefing lane (65 s gap, one unit per tick, cap 6 per section a day). A slot run and a big-story run go through the same `runStories`.

## Modules

All new code lives in `src/lib/stories/`. Seams: the AI call crosses `generateJSON` (tests mock `fetch`, as today); storage crosses `store.ts` (file store in tests, per-run `STORE_DIR`). Nothing else gets a port.

### 1. `cluster.ts` (pure, in-process): replaces `dedupe` (row 21)

```ts
interface Story { id: string; members: NewsItem[]; outlets: string[]; firstSeen: string; lastSeen: string; lang: "vi" | "en"; kind: "important" | "interesting" }
interface StoryIndex { at: string; stories: { id: string; memberIds: string[]; outlets: string[]; firstSeen: string }[] }
function clusterStories(items: NewsItem[], prev: StoryIndex | null, now: Date): Story[]
function toHeadlines(stories: Story[]): NewsItem[]   // one item per story, alsoIn = other outlets (today's dedupe output)
```

Hides: age cutoff (36 h), language detection (Vietnamese letters), Unicode-aware tokens (`\p{L}\p{N}`, NFC, accents kept, per-language stop words), character trigrams for short Vietnamese titles, similarity = max(word Jaccard, trigram Dice) against the cluster's first member (no chaining), one language per story (Q12), `kind` from the feed (`Feed.kind`, set on the new science/culture feeds), id carry-over (Q13: a story that shares a member with a previous story keeps that id; otherwise the id of its earliest member).
Errors: none; empty in, empty out. Tests: Vietnamese pairs that must merge and must not (the row 21 bug), English golden cases from today's `dedupe`, id carry-over across ticks, a chain A~B~C that must not merge A with C.

### 2. `pick.ts` (pure): what goes to the model

```ts
function pickForRun(stories: Story[], cards: Record<string, StoryCard>, quotes: Quote[], now: Date, opts: { important: number; interesting: number; toModel: number }):
  { explain: Story[]; keep: StoryCard[] }
function bigStoryDue(stories: Story[], cards: Record<string, StoryCard>, now: Date): Story | null
```

Hides: the score (outlet count + largest |move| of a market the story mentions, via `headlineMentions`), the top 10 to the model (Q16), the 5 + 2 split (2 interesting; My Interests: up to 6, only stories that mention a followed ticker), the re-explain rule (3+ new outlets since the card, or card older than 12 h, Q13), the big-story rule (4+ outlets within 30 min of its first headline, no card, Q18).

### 3. `past.ts` (data + lookup): the library (Q6, Q19-Q21)

```ts
interface PastEvent { id: string; type: string; date: string; region: string; event: string; move: string; source: string; lesson: string; keywords: string[] }
const LIBRARY_APPROVED = false            // flips in one commit when the owner approves the list
function candidates(story: Story, section: SectionId, n = 3): PastEvent[]   // [] while not approved
function resolve(id: string): PastEvent | undefined
```

One source of truth: `PLAYBOOK` in `analogs.ts` becomes a view of `PAST_EVENTS` (rules.ts keeps `EVENT_KEYWORDS`/`EVENT_BIAS`). The model sees at most 3 candidates per story and answers with an id or null; code fills date, move and source from `resolve`, so the model never writes a past figure.

### 4. `explain.ts`: the one AI call (Q14)

```ts
interface ExplainInput { scope: StoryScope; section: SectionId; stories: Story[]; market: { quotes: Quote[]; macro?: Quote[]; sectors?: Quote[] }; calendar: CalendarEvent[]; lang: "en" | "vi"; now: Date }
interface ExplainResult { cards: StoryCard[]; bigPicture: string[]; movers: Analysis["movers"]; watch: string[]; provider: string; note?: string; leftOut: string[] }
function explainStories(input: ExplainInput, route: Route): Promise<ExplainResult>   // throws when every model fails
```

Hides: the prompt (headlines are data, never instructions; titles capped; every member's title + snippet; "not clear from the reports" allowed; reader without finance background; terms flagged as concepts), fitting (Gemini gets the full prompt, row 22; Groq drops the lowest-ranked stories whole until it fits, Q14), the schema, and the guards:
- `source_ids` must be members of that story, else dropped; a card with none is dropped.
- a past-event id must be one of that story's candidates, else "no close precedent".
- market effects: the model names tickers and a direction; the % comes from the snapshot (`alignMovers` rule); a ticker not in the snapshot is dropped.
- a number in a card's text that doesn't appear in its input (members, snapshot, calendar) drops that sentence (`untraceableNumbers`).

```ts
interface StoryCard { id: string; scope: string; kind: "important" | "interesting"; lang: string; explainedAt: string; outletsAtExplain: number;
  title: string; outlets: string[]; what: string; why: string; markets: { symbol: string; direction: Direction; changePct?: number; text: string }[];
  world: string; past: { id: string; different: string } | null; watch?: string; concepts: string[]; memberIds: string[] }
```

### 5. `concepts.ts`: concept cards (Q15, decision 10)

```ts
function writeConcepts(terms: string[], now: Date): Promise<string[]>      // slugs written; ≤1 call; app-wide 10 new a day; cached forever
function loadConcepts(slugs: string[], lang: string): Promise<Concept[]>    // translated once per language, cached forever
```

### 6. `job.ts` + `store.ts`: the run and its keys

```ts
function runStories(scope: StoryScope, o: { trigger: "slot" | "big"; route: Route; now: Date; market: MarketData; calendar: CalendarEvent[] }): Promise<StoryRun>
function readStories(scope: StoryScope, lang: string): Promise<{ cards: StoryCard[]; bigPicture: string[] } | null>
```

`buildDigest` calls `runStories` where it calls `analyze` today. The Digest keeps `analysis` (v18 shape: `headline` = first big-picture line, `summary` = big picture, `events` = [], `movers`, `watchNext`) plus new `stories` and `bigPicture`, so v18 digests and history still render (decision 10) and the rule-based fallback is unchanged. On an AI failure the run keeps the previous cards.
Keys (all `store.ts`): `stories:<scope>` index (written by the tick), `story:<scope>:<id>` card (3 days), `stories:big:<scope>` pending big story, `concept:<slug>` and `concept:<slug>:<lang>` (no expiry), counters `stories:bigcount:<scope>:<date>` and `concepts:new:<date>`.
Translation: `textSlots` covers cards; each card's translation is cached by `tr:card:<scope>:<id>:<explainedAt>:<lang>`, so a run translates only new or re-explained cards. The Vietnam section is written in Vietnamese; English and other readers translate on read.

## Budget (estimates from reading code; measure on real runs)

| Model (free day) | News use per day | Notes |
|---|---|---|
| Flash-Lite 3.5 + 3.1 (500 requests each) | shared ≤ 56: 14 slots, ≤ 18 big stories, ≤ 10 concept calls, ≤ 14 retries; + 5 per active user (unchanged) | half-allowance line = 500 |
| One story call | ~6.2K tokens in, ~2.1K out | Groq fallback room ~5.1K input: drops 3-4 stories whole |
| qwen (200K tokens) | Vietnamese pre-translation ~37K (World + US runs ~23K, big stories ~10K, concepts ~4K) | today's estimate for the same work ~94K; Vietnam section no longer translated ahead (saves ~34K) |

Arithmetic in `node -e` during design; inputs: 10 stories × 4 headlines × 65 tokens, ~3.5 new cards per run × ~300 tokens, ×2 for in + out.

## Build order (one commit each, pinned tests first, review-code + thermo-nuclear per fix)

D1 row 21 `cluster.ts` (replaces `dedupe`) · D2 row 23 rest (title cap, undated items, data-not-instructions) · D3 row 22 full prompt for Gemini · D4 `past.ts` with the verified list, not approved · D5 `explain.ts` + schema + guards · D6 `job.ts`/`store.ts`, pipeline, Digest fields, per-card translation, Vietnam in Vietnamese · D7 `concepts.ts` · D8 big-story mark + scheduler unit · D9 science/culture feeds (checked from the cloud) · D10 UI: big picture, story cards, concepts, markets, predictions folded on phones and linked to stories · D11 row 24 live headline translation · E rows 25-27, 29, 30 + leftovers.

## Risks

Vietnamese clustering quality (wrong merges and splits; tested on real feeds in the stress test). Ids that change when outlets edit titles (carry-over by shared member). Groq fallback dropping too many stories. The number guard dropping good sentences (log drops, check in the audit).
