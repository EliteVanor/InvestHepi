/**
 * Story storage (v19b design section 6). The key layout is the contract:
 *
 *   stories:<scope>          the story index (ids and their headline ids), written by the tick and by runs
 *   story:<scope>:<id>       one explained card, 3 days
 *   stories:<scope>:run      the latest run: the shown card ids in order, big picture, movers, watch, provider
 */
import { getJSON, setJSON } from "../store";
import type { Analysis, NewsItem } from "../types";
import { clusterStories, toIndex, type Story, type StoryIndex } from "./cluster";
import type { StoryCard, StoryScope } from "./types";

export const CARD_TTL_SEC = 3 * 86400;

export const indexKey = (scope: StoryScope) => `stories:${scope}`;
export const cardKey = (scope: StoryScope, id: string) => `story:${scope}:${id}`;
export const runKey = (scope: StoryScope) => `stories:${scope}:run`;

/** A run's movers keep the headline ids behind each reason (indexes change with every Digest.news). */
export type RunMover = Omit<Analysis["movers"][number], "sourceIds"> & { sourceItemIds: string[] };
export interface RunRecord {
  at: string;
  cardIds: string[];
  bigPicture: string[];
  movers: RunMover[];
  watch: string[];
  provider: string;
}

/**
 * The one place that clusters a scope's headlines: ids carry over from the saved index (a story that
 * shares a headline with a previous one keeps its id), and the new index is saved. Used by the headline
 * tick and by every story run.
 */
export async function indexStories(scope: StoryScope, items: NewsItem[], now: Date): Promise<Story[]> {
  const prev = await getJSON<StoryIndex>(indexKey(scope)).catch(() => null);
  const stories = clusterStories(items, prev, now);
  if (stories.length) await setJSON(indexKey(scope), toIndex(stories, now)).catch(() => {});
  return stories;
}

export async function saveCards(cards: StoryCard[]): Promise<void> {
  await Promise.all(cards.map((c) => setJSON(cardKey(c.scope as StoryScope, c.id), c, CARD_TTL_SEC)));
}

/** Cards by id; a local file store keeps expired keys, so cards past 3 days are ignored here too. */
export async function loadCards(scope: StoryScope, ids: string[], now = new Date()): Promise<Record<string, StoryCard>> {
  const out: Record<string, StoryCard> = {};
  const found = await Promise.all(ids.map((id) => getJSON<StoryCard>(cardKey(scope, id)).catch(() => null)));
  for (const c of found) if (c && now.getTime() - new Date(c.explainedAt).getTime() < CARD_TTL_SEC * 1000) out[c.id] = c;
  return out;
}

export const loadRun = (scope: StoryScope) => getJSON<RunRecord>(runKey(scope)).catch(() => null);
export const saveRun = (scope: StoryScope, r: RunRecord) => setJSON(runKey(scope), r, CARD_TTL_SEC);
