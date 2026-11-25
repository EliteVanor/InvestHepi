import { XMLParser } from "fast-xml-parser";
import type { Feed } from "./config";
import { safeHttpUrl } from "./safe-url";
import { clusterStories, toHeadlines } from "./stories/cluster";
import { getJSON, setJSON } from "./store";
import type { Interest, NewsItem } from "./types";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });
const UA = "Mozilla/5.0 (compatible; InvestHepi/0.1; personal news reader)";

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)["#text"]);
  return "";
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

async function fetchWithTimeout(url: string, ms = 9000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" }, signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

/** Parse an RSS 2.0 or Atom document into NewsItems. */
const AHEAD_MS = 10 * 60_000;

/**
 * Some feeds label local time as UTC: Tuổi Trẻ stamps Hanoi time with GMT, so its headlines looked
 * 7 hours in the future ("in 1 hour" in the app, wrong times in the AI's prompt). When any item of a
 * Vietnamese site's feed is more than 10 minutes ahead, the whole feed is Hanoi time mislabeled:
 * every item moves back exactly 7 hours. Elsewhere a future time is clamped to now. Exported for tests.
 */
export function fixFeedTimes(items: NewsItem[], url: string, now = new Date()): NewsItem[] {
  const ahead = (i: NewsItem) => new Date(i.publishedAt).getTime() - now.getTime() > AHEAD_MS;
  if (!items.some(ahead)) return items;
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {}
  if (host.endsWith(".vn")) {
    return items.map((i) => {
      const t = new Date(new Date(i.publishedAt).getTime() - 7 * 3600_000);
      return { ...i, publishedAt: (t.getTime() - now.getTime() > AHEAD_MS ? now : t).toISOString() };
    });
  }
  return items.map((i) => (ahead(i) ? { ...i, publishedAt: now.toISOString() } : i));
}

export function parseFeed(xml: string, feedName: string): NewsItem[] {
  const doc = parser.parse(xml);
  const rawItems: Record<string, unknown>[] = [];
  const channel = doc?.rss?.channel ?? doc?.["rdf:RDF"];
  if (channel) {
    const it = channel.item ?? doc?.["rdf:RDF"]?.item;
    if (Array.isArray(it)) rawItems.push(...it);
    else if (it) rawItems.push(it);
  } else if (doc?.feed?.entry) {
    const e = doc.feed.entry;
    rawItems.push(...(Array.isArray(e) ? e : [e]));
  }

  const out: NewsItem[] = [];
  for (const r of rawItems) {
    let title = stripHtml(text(r.title));
    if (!title) continue;
    let link = text(r.link);
    if (!link && r.link && typeof r.link === "object") {
      const l = Array.isArray(r.link) ? r.link[0] : r.link;
      link = (l as Record<string, string>)["@_href"] ?? "";
    }
    let source = text(r.source) || feedName;
    // Google News titles look like "Headline - Publisher"
    if (feedName.startsWith("Google News") || /news\.google\.com/.test(link)) {
      const m = title.match(/^(.*) - ([^-]{2,60})$/);
      if (m) {
        title = m[1].trim();
        source = text(r.source) || m[2].trim();
      }
    }
    const dateStr = text(r.pubDate) || text(r.published) || text(r.updated) || text(r["dc:date"]);
    const d = dateStr ? new Date(dateStr) : new Date();
    const summary = stripHtml(text(r.description) || text(r.summary)).slice(0, 400);
    out.push({
      id: hash(title.toLowerCase()),
      title,
      link: safeHttpUrl(link),
      source,
      publishedAt: isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(),
      // Google News descriptions just repeat the title + publisher list, so drop them
      summary: summary && !summary.startsWith(title.slice(0, 30)) ? summary : undefined,
    });
  }
  return out;
}

/** Hosts that answered 429/503 rest this long (Google News and some Vietnamese sites rate-limit). */
const COOL_KEY = "news:cool";
const COOL_MS = 30 * 60_000;
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

export async function fetchFeeds(feeds: Feed[]): Promise<{ items: NewsItem[]; errors: string[] }> {
  const errors: string[] = [];
  const now = Date.now();
  const cool = (await getJSON<Record<string, number>>(COOL_KEY).catch(() => null)) ?? {};
  const backoff: Record<string, number> = {};
  const results = await Promise.all(
    feeds.map(async (f) => {
      const host = hostOf(f.url);
      if ((cool[host] ?? 0) > now) {
        errors.push(`${f.name}: ${host} is rate-limiting us, resting until ${new Date(cool[host]).toISOString().slice(11, 16)} UTC`);
        return [];
      }
      try {
        const res = await fetchWithTimeout(f.url);
        if (res.status === 429 || res.status === 503) {
          const ra = Number(res.headers.get("retry-after"));
          backoff[host] = now + Math.max(COOL_MS, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 0);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return fixFeedTimes(parseFeed(await res.text(), f.name), f.url).map((i) => (f.kind ? { ...i, feedKind: f.kind } : i));
      } catch (e) {
        errors.push(`${f.name}: ${(e as Error).message}`);
        return [];
      }
    }),
  );
  if (Object.keys(backoff).length) {
    const kept = Object.fromEntries(Object.entries({ ...cool, ...backoff }).filter(([, until]) => until > now));
    await setJSON(COOL_KEY, kept).catch(() => {});
  }
  return { items: results.flat(), errors };
}

/** Drop items older than 36 h and merge headlines about the same story (see stories/cluster.ts). Keeps the first (newest) of each. */
export function dedupe(items: NewsItem[]): NewsItem[] {
  return toHeadlines(clusterStories(items, null, new Date()));
}

/** Build a matcher for an interest from its query words and tickers. */
function interestMatcher(it: Interest): RegExp {
  const words = it.query
    .replace(/\b(OR|AND)\b/g, " ")
    .match(/"[^"]+"|[A-Za-z0-9&.]+/g)
    ?.map((w) => w.replace(/"/g, "").trim())
    .filter((w) => w.length > 2 && !/^(stocks?|news)$/i.test(w)) ?? [];
  const terms = [...new Set([...words, ...it.tickers, it.name])].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${terms.join("|")})\\b`, "i");
}

/** Tag items with the interests they mention. Items from an interest's own feed are tagged by the caller. */
export function tagInterests(items: NewsItem[], interests: Interest[]): NewsItem[] {
  const matchers = interests.map((it) => [it.id, interestMatcher(it)] as const);
  return items.map((item) => {
    const hay = `${item.title} ${item.summary ?? ""}`;
    const tags = new Set(item.tags ?? []);
    for (const [id, re] of matchers) if (re.test(hay)) tags.add(id);
    return { ...item, tags: [...tags] };
  });
}

export async function fetchInterestNews(
  interests: Interest[],
  generalFeeds: Feed[],
  finnhubKey?: string,
): Promise<{ items: NewsItem[]; errors: string[] }> {
  const errors: string[] = [];
  const all: NewsItem[] = [];

  // Per-interest feeds: everything from these is relevant by construction.
  await Promise.all(
    interests.map(async (it) => {
      const feeds: Feed[] = [
        {
          name: `Google News: ${it.name}`,
          // Vietnamese stocks, or queries with Vietnamese characters, search Google News Vietnam.
          url: `https://news.google.com/rss/search?q=${encodeURIComponent(it.query + " when:1d")}&${/[^\x00-\x7F]/.test(it.query) || it.tickers.every((t) => t.endsWith(".VN")) ? "hl=vi&gl=VN&ceid=VN:vi" : "hl=en-US&gl=US&ceid=US:en"}`,
        },
        // Yahoo's per-ticker feeds have nothing for Vietnamese listings or index symbols.
        ...it.tickers.filter((t) => !t.endsWith(".VN") && !t.startsWith("^")).slice(0, 4).map((t) => ({
          name: `Yahoo: ${t}`,
          url: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(t)}&region=US&lang=en-US`,
        })),
      ];
      const r = await fetchFeeds(feeds);
      errors.push(...r.errors);
      all.push(...r.items.map((i) => ({ ...i, tags: [it.id] })));
      if (finnhubKey) {
        const fr = await fetchFinnhub(it, finnhubKey);
        errors.push(...fr.errors);
        all.push(...fr.items);
      }
    }),
  );

  // General market feeds: keep only items that mention an interest.
  const general = await fetchFeeds(generalFeeds);
  errors.push(...general.errors);
  all.push(...general.items);

  const tagged = tagInterests(all, interests).filter((i) => (i.tags?.length ?? 0) > 0);
  return { items: dedupe(tagged), errors };
}

async function fetchFinnhub(it: Interest, key: string): Promise<{ items: NewsItem[]; errors: string[] }> {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
  const items: NewsItem[] = [];
  const errors: string[] = [];
  for (const t of it.tickers.slice(0, 3)) {
    try {
      const res = await fetchWithTimeout(`https://finnhub.io/api/v1/company-news?symbol=${t}&from=${from}&to=${to}&token=${key}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { headline: string; url: string; source: string; datetime: number; summary: string }[];
      for (const n of data.slice(0, 15)) {
        items.push({
          id: hash(n.headline.toLowerCase()),
          title: n.headline,
          link: n.url,
          source: n.source,
          publishedAt: new Date(n.datetime * 1000).toISOString(),
          summary: n.summary?.slice(0, 400),
          tags: [it.id],
        });
      }
    } catch (e) {
      errors.push(`Finnhub ${t}: ${(e as Error).message}`);
    }
  }
  return { items, errors };
}
