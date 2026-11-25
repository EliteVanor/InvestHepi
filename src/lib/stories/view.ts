/**
 * Story cards on the page (v19b D10): the pure, browser-safe parts. Which layout a digest gets, the
 * DOM id a card is linked by, a card's member headlines, the stories behind a prediction call, the
 * past-event block, the concept chip's slug, and which call a folded market shows on phones.
 */
import { mentionsIn } from "../mentions";
import { safeHttpUrl } from "../safe-url";
import type { Digest, Interest, NewsItem, Outlook } from "../types";
import { resolve as resolvePast, type PastEvent } from "./past";
import type { StoryCard } from "./types";

/** Lowercase, accents folded, anything else to "-": "Lãi suất" and "lai suat" share `lai-suat`. */
export function conceptSlug(term: string): string {
  return term
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** What `/api/concepts` accepts as a slug (what `conceptSlug` makes, capped). */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 80;
export const CONCEPTS_PER_REQUEST = 10;

/**
 * v19 digests (with story cards or a big picture) get the news-first layout: big picture, stories,
 * markets, predictions. Older digests and rule-based ones keep the v18 layout (owner decision 10).
 */
export function layoutOf(d: Pick<Digest, "stories" | "bigPicture"> | null | undefined): "stories" | "classic" {
  return d && ((d.stories?.length ?? 0) > 0 || (d.bigPicture?.length ?? 0) > 0) ? "stories" : "classic";
}

/** The element id a story card is rendered with (prediction rows link to it). */
export const storyDomId = (id: string) => `story-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;

/** The card's member headlines found in the digest's news, in the card's order. */
export function cardMembers(card: Pick<StoryCard, "memberIds">, news: NewsItem[]): NewsItem[] {
  const by = new Map(news.map((n) => [n.id, n]));
  return card.memberIds.flatMap((id) => (by.has(id) ? [by.get(id)!] : []));
}

/**
 * The stories behind a prediction call (owner decision 11): cards whose markets name the ticker or
 * whose member headlines mention it (original titles too, so a translated digest still matches).
 * Best-ranked cards first, at most `max`.
 */
export function relatedStories(ticker: string, cards: StoryCard[] | undefined, news: NewsItem[], max = 3): StoryCard[] {
  const sym = ticker.toUpperCase();
  return (cards ?? [])
    .filter((c) => c.markets.some((m) => m.symbol.toUpperCase() === sym) || cardMembers(c, news).some((n) => mentionsIn(n.title, sym) || (!!n.titleOrig && mentionsIn(n.titleOrig, sym))))
    .slice(0, max);
}

export type PastView =
  | { kind: "none" }
  | { kind: "event"; date: string; event: string; move: string; source: string; lesson: string; different: string };

/**
 * The "similar past event" block: date, event, measured move and source come from the library
 * (`resolve`), never the model; the model only adds what is different. An unknown id reads as no
 * precedent. `lookup` is for tests.
 */
export function pastView(past: StoryCard["past"], lookup: (id: string) => PastEvent | undefined = resolvePast): PastView {
  const e = past ? lookup(past.id) : undefined;
  if (!past || !e) return { kind: "none" };
  return { kind: "event", date: e.date, event: e.event, move: e.move, source: safeHttpUrl(e.source), lesson: e.lesson, different: past.different };
}

/**
 * The call a market shows when the Predictions card is folded on phones (fix-plan item 8): the first
 * group's benchmark call (groups in section order), else that group's first call, else the first call.
 */
export function mainCall(items: Outlook[], groups: Interest[] = []): Outlook | undefined {
  for (const g of groups) {
    const bench = g.tickers[0]?.toUpperCase();
    const hit = items.find((o) => o.ticker.toUpperCase() === bench) ?? items.find((o) => o.interest === g.name);
    if (hit) return hit;
  }
  return items[0];
}

/**
 * A story's market line shows today's change from the current quote the strip shows (prices agree everywhere);
 * the card's own snapshot (taken when it was explained) only when the page has no quote for the symbol.
 */
export function marketChange(m: { changePct?: number }, quote?: { changePct?: number }): number | undefined {
  const live = quote?.changePct;
  return typeof live === "number" && Number.isFinite(live) ? live : m.changePct;
}

/**
 * The briefing's provider note ("Fell back after ...", or why the AI failed) is for the admin only: it names
 * models and can carry an error message, and visitors see only generic errors (v19 rows 16-20). Visitors get
 * the separate "AI failed" banner with the rule-based switch.
 */
export function providerNoteFor(d: { providerNote?: string } | null | undefined, admin: boolean): string | null {
  return admin && d?.providerNote ? d.providerNote : null;
}
