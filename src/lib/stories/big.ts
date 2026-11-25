/**
 * Big-story trigger (v19b D8, owner Q18): the headline tick marks a new story that 4+ outlets ran within
 * 30 min and that has no card; the scheduler explains it on the briefing lane. Shared sections only.
 *
 *   stories:big:<scope>                       pending marker { id, at, tries, lastTry }
 *   stories:bigcount:<scope>:<UTC date>       big-story cards made today (cap BIG_STORY_DAILY_LIMIT, default 6)
 */
import { delJSON, getJSON, setJSON } from "../store";
import type { Story } from "./cluster";
import { bigStoryDue } from "./pick";
import { loadCards } from "./store";
import type { StoryScope } from "./types";

export interface BigMarker {
  id: string;
  at: string;
  tries?: number;
  lastTry?: string;
  gaveUp?: boolean;
}

export const BIG_MARKER_MAX_AGE_MS = 2 * 3600_000;
export const bigKey = (scope: string) => `stories:big:${scope}`;
export const bigCountKey = (scope: string, now: Date) => `stories:bigcount:${scope}:${now.toISOString().slice(0, 10)}`;
export const bigLimit = () => {
  const raw = process.env.BIG_STORY_DAILY_LIMIT?.trim();
  return raw && Number.isFinite(Number(raw)) ? Number(raw) : 6;
};
export const bigCount = async (scope: string, now: Date) => (await getJSON<number>(bigCountKey(scope, now)).catch(() => 0)) ?? 0;
export const bumpBigCount = async (scope: string, now: Date) => setJSON(bigCountKey(scope, now), (await bigCount(scope, now)) + 1, 2 * 86400);
export const saveBigMarker = (scope: string, m: BigMarker) => setJSON(bigKey(scope), m, 3 * 3600);
export const clearBigMarker = (scope: string) => delJSON(bigKey(scope));

/** The pending marker; one older than 2 h is dropped (the story is no longer news). */
export async function pendingBig(scope: string, now: Date): Promise<BigMarker | null> {
  const m = await getJSON<BigMarker>(bigKey(scope)).catch(() => null);
  if (!m) return null;
  if (now.getTime() - new Date(m.at).getTime() >= BIG_MARKER_MAX_AGE_MS) {
    await clearBigMarker(scope).catch(() => {});
    return null;
  }
  return m;
}

/** After the tick indexed a shared scope: mark a big story if one is due, nothing pending and the day's cap isn't used. No AI. */
export async function markBigStory(scope: StoryScope, stories: Story[], now: Date): Promise<boolean> {
  if (scope.startsWith("ib:")) return false;
  if ((await pendingBig(scope, now)) || (await bigCount(scope, now)) >= bigLimit()) return false;
  const cards = await loadCards(scope, stories.map((s) => s.id), now);
  const s = bigStoryDue(stories, cards, now);
  if (!s) return false;
  await saveBigMarker(scope, { id: s.id, at: now.toISOString() });
  return true;
}
