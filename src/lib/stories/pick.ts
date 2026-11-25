/**
 * What goes to the model in a story run (v19b design section 2). Pure, no I/O.
 *
 * Score = outlet count + the largest |day move| of a snapshot ticker the story's headlines name
 * (`headlineMentions`). The shown set is the top 5 important + 2 interesting stories (fewer interesting:
 * important ones fill in), taken from the top `toModel` (10) by score, plus the best-ranked interesting
 * stories, which seldom score high (no market move). My Interests: up to 6 stories that mention a followed
 * interest (a tagged headline), no interesting quota. A shown story whose card is fresh (under 12 h old and
 * fewer than 3 new outlets since it was explained) keeps its card; the rest go to the model, best first.
 */
import { headlineMentions } from "../pipeline";
import type { Quote } from "../types";
import type { Story } from "./cluster";
import type { StoryCard } from "./types";

export interface PickOpts {
  important: number;
  interesting: number;
  toModel: number;
  /** My Interests: only stories with a tagged headline, `important` of them, no interesting quota. */
  interests?: boolean;
}

export const SHARED_PICK: PickOpts = { important: 5, interesting: 2, toModel: 10 };
export const INTERESTS_PICK: PickOpts = { important: 6, interesting: 0, toModel: 10, interests: true };

/** A card is re-explained once it is this old, or once its story gained this many outlets. */
export const CARD_FRESH_MS = 12 * 3600_000;
export const NEW_OUTLETS_REEXPLAIN = 3;

export function storyScore(s: Story, quotes: Quote[]): number {
  let move = 0;
  for (const q of quotes) {
    const m = Math.abs(q.changePct ?? 0);
    if (m > move && Number.isFinite(m) && s.members.some((i) => headlineMentions(i.title, q.symbol))) move = m;
  }
  return s.outlets.length + move;
}

export function cardFresh(card: StoryCard | undefined, s: Story, now: Date): card is StoryCard {
  if (!card) return false;
  const age = now.getTime() - new Date(card.explainedAt).getTime();
  return age >= 0 && age < CARD_FRESH_MS && s.outlets.length - card.outletsAtExplain < NEW_OUTLETS_REEXPLAIN;
}

/** The stories to show this run, best first (also used to order the run's cards). */
export function shownStories(stories: Story[], quotes: Quote[], opts: PickOpts): Story[] {
  const pool = opts.interests ? stories.filter((s) => s.members.some((m) => m.tags?.length)) : stories;
  const ranked = pool
    .map((s, i) => ({ s, i, score: storyScore(s, quotes) }))
    .sort((a, b) => b.score - a.score || a.i - b.i) // ties: clustering order (newest first)
    .map((x) => x.s);
  if (opts.interests) return ranked.slice(0, Math.min(opts.important, opts.toModel));
  const top = ranked.slice(0, opts.toModel);
  const interesting = ranked.filter((s) => s.kind === "interesting").slice(0, opts.interesting);
  const important = top.filter((s) => s.kind === "important");
  const total = opts.important + opts.interesting;
  const chosen = new Set([...important.slice(0, opts.important), ...interesting]);
  for (const s of important) if (chosen.size < total) chosen.add(s); // too few interesting: important fill in
  return ranked.filter((s) => chosen.has(s));
}

export function pickForRun(stories: Story[], cards: Record<string, StoryCard>, quotes: Quote[], now: Date, opts: PickOpts = SHARED_PICK): { explain: Story[]; keep: StoryCard[] } {
  const explain: Story[] = [];
  const keep: StoryCard[] = [];
  for (const s of shownStories(stories, quotes, opts)) {
    const card = cards[s.id];
    if (cardFresh(card, s, now)) keep.push({ ...card, outlets: s.outlets });
    else explain.push(s);
  }
  return { explain, keep };
}
