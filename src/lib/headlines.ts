/**
 * The live headline lists, refreshed with no AI: World, US and Vietnam every 15 minutes by the
 * scheduler tick; an interest set every 30 minutes, but only while someone who follows it has the page
 * open (the page asks /api/news every 5 minutes while visible), and right away when a user signs in
 * or comes back to a list that's gone stale. Nobody looking, no refresh. A briefing keeps the
 * headlines it was written from (its source ids point into its own list); readers see this live list,
 * and "Key" badges match headlines by id.
 *
 *   news:<section>     World, US, Vietnam
 *   news:ib:<hash>     an interest set
 *   news:active        interest sets someone is reading: { <hash>: { at, interests } }
 */
import { MAX_ITEMS_PER_SECTION, SECTION_FEEDS, type SharedSection } from "./config";
import { fetchFeeds, fetchInterestNews } from "./news";
import { getJSON, releaseLock, setJSON, takeLock } from "./store";
import { toHeadlines } from "./stories/cluster";
import { indexStories } from "./stories/store";
import type { StoryScope } from "./stories/types";
import type { Interest, NewsItem, SectionId } from "./types";

export interface LiveNews {
  at: string;
  items: NewsItem[];
  errors: string[];
}

/** Ticks come about every 15 minutes with some jitter, so "due" is a little under each interval. */
export const SHARED_EVERY_MIN = 15;
export const SET_EVERY_MIN = 30;
const SLACK_MIN = 2;
const SHARED: SharedSection[] = ["world", "us", "vn"];
const ACTIVE_KEY = "news:active";
/** A set counts as being read for this long after its last /api/news request (the page polls every 5 min). */
export const ACTIVE_MIN = 35;
type Active = Record<string, { at: string; interests: Interest[] }>;

export const newsKey = (section: SectionId, hash?: string) => (section === "interests" ? `news:ib:${hash}` : `news:${section}`);

/** Every outlet's copy of a section's (or an interest set's) headlines, before clustering into stories. */
export async function fetchSectionItems(section: SectionId, interests: Interest[] = []): Promise<{ items: NewsItem[]; errors: string[] }> {
  return section === "interests" ? fetchInterestNews(interests, SECTION_FEEDS.interests, process.env.FINNHUB_API_KEY, { raw: true }) : fetchFeeds(SECTION_FEEDS[section]);
}

export const storyScope = (section: SectionId, hash?: string): StoryScope => (section === "interests" ? `ib:${hash}` : section);

/**
 * Fetch a section's (or an interest set's) headlines, cluster them into stories (ids carried over in the
 * scope's story index, which this saves) and return one headline per story, newest first, capped, plus
 * every outlet's copy (`raw`) for a story run.
 */
export async function fetchSectionNews(section: SectionId, interests: Interest[] = [], hash?: string, now = new Date()): Promise<{ items: NewsItem[]; errors: string[]; raw: NewsItem[] }> {
  const r = await fetchSectionItems(section, interests);
  const stories = await indexStories(storyScope(section, hash), r.items, now);
  return { items: toHeadlines(stories).slice(0, MAX_ITEMS_PER_SECTION), errors: r.errors, raw: r.items };
}

/** An undated item (the feed gave no date) keeps the time it was first seen, so it ages instead of looking new on every fetch. */
export function keepFirstSeenTimes(items: NewsItem[], previous: NewsItem[] | undefined): NewsItem[] {
  if (!previous?.length || !items.some((i) => i.undated)) return items;
  const before = new Map(previous.map((i) => [i.id, i.publishedAt]));
  return items.map((i) => (i.undated && before.has(i.id) ? { ...i, publishedAt: before.get(i.id)! } : i));
}

export async function saveHeadlines(key: string, r: { items: NewsItem[]; errors: string[] }, now = new Date()): Promise<void> {
  // A feed outage shouldn't wipe the list: keep the previous items if nothing came back.
  const prev = await getJSON<LiveNews>(key);
  if (!r.items.length && prev?.items.length) return;
  await setJSON(key, { at: now.toISOString(), items: keepFirstSeenTimes(r.items, prev?.items), errors: r.errors.slice(0, 10) } satisfies LiveNews);
}

export const loadHeadlines = (section: SectionId, hash?: string) => getJSON<LiveNews>(newsKey(section, hash));

const due = (n: LiveNews | null, everyMin: number, now: Date) => !n || now.getTime() - new Date(n.at).getTime() >= (everyMin - SLACK_MIN) * 60_000;

/**
 * A reader of this interest set is on the page: remember it (at most every 4 minutes) so the tick keeps
 * the set's headlines fresh while they read. Entries older than a day are dropped.
 */
export async function noteReading(hash: string, interests: Interest[], now = new Date()): Promise<void> {
  const active = (await getJSON<Active>(ACTIVE_KEY)) ?? {};
  const cur = active[hash];
  if (cur && now.getTime() - new Date(cur.at).getTime() < 4 * 60_000) return;
  active[hash] = { at: now.toISOString(), interests };
  const dayAgo = now.getTime() - 86_400_000;
  await setJSON(ACTIVE_KEY, Object.fromEntries(Object.entries(active).filter(([, v]) => new Date(v.at).getTime() > dayAgo)));
}

/** Interest sets someone has read in the last 35 minutes. */
export async function readingNow(now = new Date()): Promise<[string, Interest[]][]> {
  const since = now.getTime() - ACTIVE_MIN * 60_000;
  return Object.entries((await getJSON<Active>(ACTIVE_KEY)) ?? {})
    .filter(([, v]) => new Date(v.at).getTime() >= since)
    .map(([h, v]) => [h, v.interests]);
}

/** Refresh one interest set's list if it's 30 minutes old (or missing). One fetch at a time per set. */
export async function refreshSetIfStale(hash: string, interests: Interest[], now = new Date()): Promise<boolean> {
  const key = newsKey("interests", hash);
  if (!due(await getJSON<LiveNews>(key), SET_EVERY_MIN, now)) return false;
  const token = await takeLock(`${key}:busy`, 60);
  if (!token) return false;
  try {
    await saveHeadlines(key, await fetchSectionNews("interests", interests, hash, now), now);
    return true;
  } finally {
    await releaseLock(`${key}:busy`, token).catch(() => {});
  }
}

/** Whether an interest set's list is due (the page then asks again shortly for the refreshed one). */
export async function setStale(hash: string, now = new Date()): Promise<boolean> {
  return due(await getJSON<LiveNews>(newsKey("interests", hash)), SET_EVERY_MIN, now);
}

/** Refresh every list that's due: the shared ones, and the interest sets someone is reading. Returns how many. */
export async function refreshHeadlines(now = new Date()): Promise<number> {
  const jobs: Promise<unknown>[] = [];
  for (const s of SHARED) {
    const key = newsKey(s);
    if (due(await getJSON<LiveNews>(key), SHARED_EVERY_MIN, now)) jobs.push(fetchSectionNews(s, [], undefined, now).then((r) => saveHeadlines(key, r, now)));
  }
  for (const [hash, interests] of await readingNow(now)) jobs.push(refreshSetIfStale(hash, interests, now).then((ran) => (ran ? undefined : Promise.reject(new Error("not due")))));
  const done = await Promise.allSettled(jobs);
  return done.filter((d) => d.status === "fulfilled").length;
}
