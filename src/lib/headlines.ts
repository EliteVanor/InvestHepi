/**
 * The live headline lists, refreshed by the scheduler tick with no AI: World, US and Vietnam every
 * 15 minutes, each active interest set every 30. A briefing keeps the headlines it was written from
 * (its source ids point into its own list); readers see this live list, and "Key" badges match
 * headlines by id.
 *
 *   news:<section>     World, US, Vietnam
 *   news:ib:<hash>     an interest set
 */
import { MAX_ITEMS_PER_SECTION, SECTION_FEEDS, type SharedSection } from "./config";
import { interestGroups } from "./interests";
import { dedupe, fetchFeeds, fetchInterestNews } from "./news";
import { getJSON, setJSON } from "./store";
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

export const newsKey = (section: SectionId, hash?: string) => (section === "interests" ? `news:ib:${hash}` : `news:${section}`);

/** Fetch a section's (or an interest set's) headlines: deduped, newest first, capped. */
export async function fetchSectionNews(section: SectionId, interests: Interest[] = []): Promise<{ items: NewsItem[]; errors: string[] }> {
  const r =
    section === "interests"
      ? await fetchInterestNews(interests, SECTION_FEEDS.interests, process.env.FINNHUB_API_KEY)
      : await fetchFeeds(SECTION_FEEDS[section]).then((x) => ({ items: dedupe(x.items), errors: x.errors }));
  return { items: r.items.slice(0, MAX_ITEMS_PER_SECTION), errors: r.errors };
}

export async function saveHeadlines(key: string, r: { items: NewsItem[]; errors: string[] }, now = new Date()): Promise<void> {
  // A feed outage shouldn't wipe the list: keep the previous items if nothing came back.
  if (!r.items.length && (await getJSON<LiveNews>(key))?.items.length) return;
  await setJSON(key, { at: now.toISOString(), items: r.items, errors: r.errors.slice(0, 10) } satisfies LiveNews);
}

export const loadHeadlines = (section: SectionId, hash?: string) => getJSON<LiveNews>(newsKey(section, hash));

const due = (n: LiveNews | null, everyMin: number, now: Date) => !n || now.getTime() - new Date(n.at).getTime() >= (everyMin - SLACK_MIN) * 60_000;

/** Refresh every list that's due. Returns how many were refreshed. */
export async function refreshHeadlines(now = new Date()): Promise<number> {
  const jobs: Promise<void>[] = [];
  for (const s of SHARED) {
    const key = newsKey(s);
    if (due(await getJSON<LiveNews>(key), SHARED_EVERY_MIN, now)) jobs.push(fetchSectionNews(s).then((r) => saveHeadlines(key, r, now)));
  }
  for (const [hash, g] of await interestGroups()) {
    const key = newsKey("interests", hash);
    if (due(await getJSON<LiveNews>(key), SET_EVERY_MIN, now)) jobs.push(fetchSectionNews("interests", g.interests).then((r) => saveHeadlines(key, r, now)));
  }
  const done = await Promise.allSettled(jobs);
  return done.filter((d) => d.status === "fulfilled").length;
}
