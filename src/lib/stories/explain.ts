/**
 * explainStories (v19b design section 4): the one AI call that turns up to 10 stories into cards. No
 * rule-based fallback: when every model fails it throws and the caller keeps the previous cards.
 * Fitting (audit row 22): Gemini and Claude get every story with full snippets; a Groq step drops the
 * lowest-ranked stories whole until input + output fits. Guards after the reply: sources must be the
 * story's own headlines, a past event must be one offered, market % come from the snapshot, and a
 * sentence holding a number the input doesn't have is removed.
 */
import { z } from "zod";
import { generateJSON, type Route } from "../llm";
import { estimateTokens } from "../llm/openai-compat";
import { alignMovers } from "../pipeline";
import type { Analysis, CalendarEvent, Direction, NewsItem, Quote, SectionId } from "../types";
import type { Story } from "./cluster";
import { EXPLAIN_HINT, buildExplainSystem, buildExplainUser, contextText } from "./explain-prompt";
import { candidates, type PastEvent } from "./past";
import type { StoryCard, StoryScope } from "./types";

export interface ExplainInput {
  scope: StoryScope;
  section: SectionId;
  stories: Story[];
  market: { quotes: Quote[]; macro?: Quote[]; sectors?: Quote[] };
  calendar: CalendarEvent[];
  lang: "en" | "vi";
  now: Date;
}
export interface ExplainResult {
  cards: StoryCard[];
  bigPicture: string[];
  /** `sourceIds` index the members of the explained stories, flattened in story order. */
  movers: Analysis["movers"];
  watch: string[];
  provider: string;
  note?: string;
  /** Stories that didn't fit a provider's request-size limit (lowest ranked first to go). */
  leftOut: string[];
}

/** ~2.1K tokens out for 10 stories (design budget), with room. */
export const EXPLAIN_MAX_TOKENS = 2500;

// Kept free of min/max constraints so it works as a Claude structured-output schema too.
const Dir = z.enum(["up", "down", "flat"]);
export const ExplainSchema = z.object({
  big_picture: z.array(z.string()),
  stories: z.array(
    z.object({
      story: z.string(),
      title: z.string(),
      what: z.string(),
      why: z.string(),
      markets: z.array(z.object({ ticker: z.string(), direction: Dir, text: z.string() })),
      world: z.string(),
      past_id: z.string().nullable(),
      different: z.string(),
      watch: z.string().optional(),
      concepts: z.array(z.string()),
      source_ids: z.array(z.string()),
    }),
  ),
  movers: z.array(z.object({ ticker: z.string(), why: z.string(), source_ids: z.array(z.string()) })),
  watch: z.array(z.string()),
});
export type RawExplain = z.infer<typeof ExplainSchema>;

const str = (v: unknown) => (v == null ? "" : String(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown) => arr(v).map(str).filter((s) => s.trim());

/** Repair common free-model slips (story as a number, "null" strings, numeric ids, missing arrays). */
export function normalizeExplain(input: unknown): unknown {
  const o = (input ?? {}) as Record<string, unknown>;
  const dir = (d: unknown) => {
    const s = str(d).toLowerCase();
    return s.startsWith("up") ? "up" : s.startsWith("down") ? "down" : "flat";
  };
  return {
    big_picture: strs(o.big_picture),
    stories: arr(o.stories).map((x) => {
      const s = (x ?? {}) as Record<string, unknown>;
      const n = str(s.story).trim();
      const past = str(s.past_id).trim();
      return {
        story: /^\d+$/.test(n) ? `S${n}` : n.toUpperCase(),
        title: str(s.title),
        what: str(s.what),
        why: str(s.why),
        markets: arr(s.markets).map((m) => {
          const q = (m ?? {}) as Record<string, unknown>;
          return { ticker: str(q.ticker), direction: dir(q.direction), text: str(q.text) };
        }),
        world: str(s.world),
        past_id: !past || /^(null|none|n\/a)$/i.test(past) ? null : past,
        different: str(s.different),
        ...(s.watch != null && str(s.watch).trim() ? { watch: str(s.watch) } : {}),
        concepts: strs(s.concepts),
        source_ids: strs(s.source_ids),
      };
    }),
    movers: arr(o.movers).map((x) => {
      const m = (x ?? {}) as Record<string, unknown>;
      return { ticker: str(m.ticker), why: str(m.why), source_ids: strs(m.source_ids) };
    }),
    watch: strs(o.watch),
  };
}

export function parseExplain(raw: unknown): RawExplain {
  const p = ExplainSchema.safeParse(normalizeExplain(raw));
  if (!p.success) throw new Error(`explain JSON doesn't match the schema: ${p.error.issues[0]?.message}`);
  if (!p.data.stories.length && !p.data.big_picture.length) throw new Error("model reply had no usable content (no stories, no big picture)");
  return p.data;
}

// --- guards (pure, exported for tests) ---

/** a. Cited ids that are members of this story, de-duplicated. */
export function memberSources(ids: string[], story: Story): string[] {
  const own = new Set(story.members.map((m) => m.id));
  return [...new Set(ids.filter((id) => own.has(id)))];
}

/** b. The past-event id only if it was one of this story's candidates. */
export function pastFor(id: string | null | undefined, cands: PastEvent[]): string | null {
  const clean = str(id).trim().replace(/^P:/i, "");
  return cands.some((c) => c.id === clean) ? clean : null;
}

/** c. Snapshot tickers only, with the snapshot's % (never the model's). */
export function alignMarkets(markets: { ticker: string; direction: Direction; text: string }[], quotes: Quote[]): StoryCard["markets"] {
  const by = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));
  return markets.flatMap((m) => {
    const q = by.get(m.ticker.trim().toUpperCase());
    return q ? [{ symbol: q.symbol, direction: m.direction, changePct: q.changePct, text: m.text }] : [];
  });
}

const NUM = /\d+(?:[.,]\d+)*/g;
/** A number token's readings as [value, decimals]: "1.700"/"1,700" → 1700 (or 1.7), "4,3" → 4.3, "1,234.5" → 1234.5. */
function readings(tok: string): [number, number][] {
  const seps = tok.match(/[.,]/g) ?? [];
  if (!seps.length) return [[Number(tok), 0]];
  const parts = tok.split(/[.,]/);
  const out: [number, number][] = [];
  if (new Set(seps).size === 2) {
    const last = tok.search(/[.,][^.,]*$/);
    const dec = tok.slice(last + 1);
    out.push([Number(tok.slice(0, last).replace(/[.,]/g, "") + "." + dec), dec.length]);
    return out;
  }
  if (parts.slice(1).every((p) => p.length === 3)) out.push([Number(parts.join("")), 0]);
  if (seps.length === 1) out.push([Number(parts.join(".")), parts[1].length]);
  return out;
}
const ignored = (tok: string) => /^\d$/.test(tok) || (/^\d{4}$/.test(tok) && +tok >= 1990 && +tok <= 2035);

/**
 * d. Numbers in `text` that don't appear in `haystack` (allowing either decimal mark and rounding of an
 * input figure). One-digit numbers and years 1990-2035 are ignored.
 */
export function untraceableNumbers(text: string, haystack: string): string[] {
  const known = (haystack.match(NUM) ?? []).flatMap(readings);
  return (text.match(NUM) ?? []).filter((tok) => !ignored(tok) && !readings(tok).some(([v, d]) => known.some(([h]) => Number(h.toFixed(d)) === v)));
}

/** d. The text without the sentences that hold an untraceable number. */
export function dropUntraceable(text: string, haystack: string): string {
  return text
    .split(/(?<=[.!?。])\s+/)
    .filter((s) => s.trim() && !untraceableNumbers(s, haystack).length)
    .join(" ")
    .trim();
}

// --- the call ---

/** Stories that fit `limit` tokens: input order is rank, so the lowest ranked drop first, always whole. */
export function fitStories(stories: Story[], size: (kept: Story[]) => number, limit: number): number {
  for (let k = stories.length; k > 1; k--) if (size(stories.slice(0, k)) <= limit) return k;
  return Math.min(1, stories.length);
}

const memberText = (s: Story) => s.members.map((m) => `${m.title} ${m.summary ?? ""}`).join("\n");

export async function explainStories(input: ExplainInput, route: Route): Promise<ExplainResult> {
  const cands = input.stories.map((s) => candidates(s, input.section));
  const system = buildExplainSystem(input);
  const context = contextText(input);
  const prompt = (k: number) => ({ system, user: buildExplainUser(input, input.stories.slice(0, k), cands, context) });
  // The prompt of the step being tried; the successful step's is the last one built.
  let shown = input.stories.length;
  const { value: raw, provider, note } = await generateJSON(route, {
    build: () => prompt((shown = input.stories.length)),
    fit: (limit) => {
      shown = fitStories(input.stories, (kept) => estimateTokens(system + EXPLAIN_HINT + prompt(kept.length).user), limit);
      return prompt(shown);
    },
    hint: EXPLAIN_HINT,
    parse: parseExplain,
    maxTokens: EXPLAIN_MAX_TOKENS,
  });

  const stories = input.stories.slice(0, shown);
  const explainedAt = input.now.toISOString();
  const cards: StoryCard[] = [];
  const done = new Set<number>();
  for (const c of raw.stories) {
    const i = Number(c.story.replace(/^S/i, "")) - 1;
    const s = stories[i];
    if (!s || done.has(i)) continue;
    if (!memberSources(c.source_ids, s).length) continue;
    done.add(i);
    const hay = `${memberText(s)}\n${context}`;
    const clean = (t: string) => dropUntraceable(t, hay);
    const past = pastFor(c.past_id, cands[i]);
    const watch = c.watch ? clean(c.watch) : "";
    cards.push({
      id: s.id,
      scope: input.scope,
      kind: s.kind,
      lang: input.lang,
      explainedAt,
      outletsAtExplain: s.outlets.length,
      title: clean(c.title) || s.members[0].title,
      outlets: s.outlets,
      what: clean(c.what),
      why: clean(c.why),
      markets: alignMarkets(c.markets, input.market.quotes).map((m) => ({ ...m, text: clean(m.text) })),
      world: clean(c.world),
      past: past ? { id: past, different: clean(c.different) } : null,
      ...(watch ? { watch } : {}),
      concepts: c.concepts.map((t) => t.trim()).filter(Boolean).slice(0, 3),
      memberIds: s.members.map((m) => m.id),
    });
  }

  // Movers and top-level lines may draw on any shown story.
  const news: NewsItem[] = stories.flatMap((s) => s.members);
  const allHay = `${stories.map(memberText).join("\n")}\n${context}`;
  const index = new Map(news.map((m, i) => [m.id, i]));
  const movers = alignMovers(
    raw.movers.map((m) => ({ ticker: m.ticker, changePct: 0, why: dropUntraceable(m.why, allHay), sourceIds: m.source_ids.flatMap((id) => (index.has(id) ? [index.get(id)!] : [])) })),
    input.market.quotes,
    news,
  );
  const lines = (xs: string[]) => xs.map((t) => dropUntraceable(t, allHay)).filter(Boolean);
  return {
    cards,
    bigPicture: lines(raw.big_picture).slice(0, 3),
    movers,
    watch: lines(raw.watch),
    provider,
    note,
    leftOut: input.stories.slice(shown).map((s) => s.id),
  };
}
