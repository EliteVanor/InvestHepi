/**
 * One story run (v19b design section 6): cluster the scope's headlines (ids carry over), pick what to
 * show, explain only the stories without a fresh card (one AI call), save the new cards and the run.
 * `buildDigest` calls this where it called `analyze`; if the AI call fails it throws and the caller
 * falls back to the rule-based briefing (the stored AI briefing and its cards are kept).
 */
import type { Route } from "../llm";
import { cachedCards } from "../translate";
import type { Analysis, CalendarEvent, NewsItem, Quote, SectionId } from "../types";
import type { Story } from "./cluster";
import { writeConcepts } from "./concepts";
import { explainStories } from "./explain";
import { INTERESTS_PICK, SHARED_PICK, pickForRun, shownStories } from "./pick";
import { indexStories, loadCards, loadRun, saveCards, saveRun, type RunRecord } from "./store";
import type { StoryCard, StoryScope } from "./types";

export interface StoryRun {
  /** Shown cards in rank order: kept (fresh) and newly explained ones. */
  cards: StoryCard[];
  bigPicture: string[];
  /** `sourceIds` index `news`. */
  movers: Analysis["movers"];
  watch: string[];
  provider: string;
  note?: string;
  leftOut: string[];
  /** The headlines the movers' `sourceIds` point into: the explained (or shown) stories' members, in story order. */
  news: NewsItem[];
  /** Every shown card's member headlines not already in `news` (kept cards' sources), in card order. */
  shownNews: NewsItem[];
  /** Ids of the stories sent to the model this run (empty when every shown card was fresh). */
  explained: string[];
}

export interface RunOpts {
  section: SectionId;
  /** The scope's headlines as fetched (every outlet's copy, not one per story). */
  headlines: NewsItem[];
  route: Route;
  now: Date;
  market: { quotes: Quote[]; macro?: Quote[]; sectors?: Quote[] };
  calendar: CalendarEvent[];
  trigger?: "slot" | "big";
  /** Big-story run: explain only these stories (shown even if they are not in the top picks); the rest of the run is unchanged. */
  only?: string[];
}

/** The Vietnam section is written in Vietnamese; everything else in English. */
export const storyLang = (section: SectionId): "en" | "vi" => (section === "vn" ? "vi" : "en");
const pickOpts = (scope: StoryScope) => (scope.startsWith("ib:") ? INTERESTS_PICK : SHARED_PICK);
const members = (stories: Story[]) => stories.flatMap((s) => s.members);

export async function runStories(scope: StoryScope, o: RunOpts): Promise<StoryRun> {
  const stories = await indexStories(scope, o.headlines, o.now);
  const prev = await loadRun(scope);
  const quotes = o.market.quotes;
  const cards = await loadCards(scope, prev?.cardIds ?? [], o.now);
  let shown = shownStories(stories, quotes, pickOpts(scope));
  const picked = pickForRun(stories, cards, quotes, o.now, pickOpts(scope));
  const { keep } = picked;
  let explain = picked.explain;
  let skipped: string[] = [];
  if (o.only) {
    // Big-story run: only the named stories are explained; other stale stories keep their old card (named as covered).
    const ids = new Set(o.only);
    const extra = stories.filter((s) => ids.has(s.id) && !shown.includes(s));
    shown = [...extra, ...shown];
    skipped = picked.explain.filter((s) => !ids.has(s.id) && cards[s.id]).map((s) => cards[s.id].title);
    explain = [...extra, ...picked.explain].filter((s) => ids.has(s.id));
  }

  // One AI call per run (owner Q14): new and stale stories get cards; fresh ones are only named, so the big
  // picture, movers and watch line always come from today's data.
  const r = await explainStories({ scope, section: o.section, stories: explain, covered: [...keep.map((c) => c.title), ...skipped], market: o.market, calendar: o.calendar, lang: storyLang(o.section), now: o.now }, o.route);
  const fresh = r.cards;
  await saveCards(fresh);
  await writeConcepts(fresh.flatMap((c) => c.concepts), storyLang(o.section), o.route, o.now).catch(() => []);
  const sent = explain.filter((s) => !r.leftOut.includes(s.id));
  const run = { bigPicture: r.bigPicture, movers: r.movers, watch: r.watch, provider: r.provider, note: r.note, leftOut: r.leftOut, news: members(sent) };

  const byId = new Map([...Object.values(cards), ...keep, ...fresh].map((c) => [c.id, c] as const));
  // A shown story whose new card was dropped (or left out) keeps its previous card, if any.
  const ordered = shown.flatMap((s) => (byId.has(s.id) ? [byId.get(s.id)!] : []));
  const record: RunRecord = {
    at: o.now.toISOString(),
    cardIds: ordered.map((c) => c.id),
    bigPicture: run.bigPicture,
    watch: run.watch,
    provider: run.provider,
  };
  await saveRun(scope, record);
  const inNews = new Set(run.news.map((n) => n.id));
  const shownIds = new Set(record.cardIds);
  const shownNews = members(shown.filter((s) => shownIds.has(s.id))).filter((n) => !inNews.has(n.id) && (inNews.add(n.id), true));
  return { ...run, cards: ordered, shownNews, explained: explain.map((s) => s.id) };
}

/** The latest run's cards (in order, with any cached translation into `lang`) and big picture. */
export async function readStories(scope: StoryScope, lang: string): Promise<{ cards: StoryCard[]; bigPicture: string[] } | null> {
  const run = await loadRun(scope);
  if (!run) return null;
  const cards = await loadCards(scope, run.cardIds);
  return { cards: await cachedCards(run.cardIds.flatMap((id) => (cards[id] ? [cards[id]] : [])), lang), bigPicture: run.bigPicture };
}
