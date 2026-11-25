/**
 * One story run (v19b design section 6): cluster the scope's headlines (ids carry over), pick what to
 * show, explain only the stories without a fresh card (one AI call), save the new cards and the run.
 * `buildDigest` calls this where it called `analyze`; if the AI call fails it throws and the caller
 * falls back to the rule-based briefing (the stored AI briefing and its cards are kept).
 */
import type { Route } from "../llm";
import { alignMovers } from "../pipeline";
import { cachedCards } from "../translate";
import type { Analysis, CalendarEvent, NewsItem, Quote, SectionId } from "../types";
import type { Story } from "./cluster";
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
  const shown = shownStories(stories, quotes, pickOpts(scope));
  const { explain, keep } = pickForRun(stories, cards, quotes, o.now, pickOpts(scope));

  let run: Omit<StoryRun, "cards" | "explained">;
  let fresh: StoryCard[] = [];
  // Every shown card fresh: no AI call. Otherwise one call, even with no stories at all (the big picture and movers then come from the market data).
  if (explain.length || !keep.length || !prev) {
    const r = await explainStories({ scope, section: o.section, stories: explain, market: o.market, calendar: o.calendar, lang: storyLang(o.section), now: o.now }, o.route);
    fresh = r.cards;
    await saveCards(fresh);
    const sent = explain.filter((s) => !r.leftOut.includes(s.id));
    run = { bigPicture: r.bigPicture, movers: r.movers, watch: r.watch, provider: r.provider, note: r.note, leftOut: r.leftOut, news: members(sent) };
  } else {
    // The last run's lines stay; its movers are re-checked against today's prices and headlines.
    const news = members(shown);
    const at = new Map(news.map((n, i) => [n.id, i]));
    const movers = prev.movers.map(({ sourceItemIds, ...m }) => ({ ...m, sourceIds: sourceItemIds.flatMap((id) => (at.has(id) ? [at.get(id)!] : [])) }));
    run = { bigPicture: prev.bigPicture, movers: alignMovers(movers, quotes, news), watch: prev.watch, provider: prev.provider, note: `No new stories since ${prev.at}: cards and big picture kept (no AI call).`, leftOut: [], news };
  }

  const byId = new Map([...Object.values(cards), ...keep, ...fresh].map((c) => [c.id, c] as const));
  // A shown story whose new card was dropped (or left out) keeps its previous card, if any.
  const ordered = shown.flatMap((s) => (byId.has(s.id) ? [byId.get(s.id)!] : []));
  const record: RunRecord = {
    at: o.now.toISOString(),
    cardIds: ordered.map((c) => c.id),
    bigPicture: run.bigPicture,
    movers: run.movers.map(({ sourceIds, ...m }) => ({ ...m, sourceItemIds: (sourceIds ?? []).flatMap((i) => (run.news[i] ? [run.news[i].id] : [])) })),
    watch: run.watch,
    provider: run.provider,
  };
  await saveRun(scope, record);
  return { ...run, cards: ordered, explained: explain.map((s) => s.id) };
}

/** The latest run's cards (in order, with any cached translation into `lang`) and big picture. */
export async function readStories(scope: StoryScope, lang: string): Promise<{ cards: StoryCard[]; bigPicture: string[] } | null> {
  const run = await loadRun(scope);
  if (!run) return null;
  const cards = await loadCards(scope, run.cardIds);
  return { cards: await cachedCards(run.cardIds.flatMap((id) => (cards[id] ? [cards[id]] : [])), lang), bigPicture: run.bigPicture };
}
