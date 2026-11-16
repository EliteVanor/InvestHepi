import { XMLParser } from "fast-xml-parser";
import type { Feed } from "./config";
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
      link,
      source,
      publishedAt: isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(),
      // Google News descriptions just repeat the title + publisher list, so drop them
      summary: summary && !summary.startsWith(title.slice(0, 30)) ? summary : undefined,
    });
  }
  return out;
}

export async function fetchFeeds(feeds: Feed[]): Promise<{ items: NewsItem[]; errors: string[] }> {
  const errors: string[] = [];
  const results = await Promise.all(
    feeds.map(async (f) => {
      try {
        const res = await fetchWithTimeout(f.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return parseFeed(await res.text(), f.name);
      } catch (e) {
        errors.push(`${f.name}: ${(e as Error).message}`);
        return [];
      }
    }),
  );
  return { items: results.flat(), errors };
}

const STOP = new Set("a an the of to in on for and or with at by from as is are was be after over amid says said new its it this that".split(" "));
function tokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9$% ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, "")),
  );
}
function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

/** Drop old items and near-duplicate headlines (same story from several outlets). Keeps the earliest seen. */
export function dedupe(items: NewsItem[], maxAgeHours = 36): NewsItem[] {
  const cutoff = Date.now() - maxAgeHours * 3600_000;
  const sorted = items
    .filter((i) => new Date(i.publishedAt).getTime() >= cutoff)
    .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
  const kept: { item: NewsItem; tok: Set<string> }[] = [];
  for (const item of sorted) {
    const tok = tokens(item.title);
    const dup = kept.find((k) => k.item.id === item.id || jaccard(k.tok, tok) >= 0.55);
    if (dup) {
      if (item.tags) dup.item.tags = [...new Set([...(dup.item.tags ?? []), ...item.tags])];
      // Remember other outlets covering the same story (coverage breadth = importance signal).
      if (item.source && item.source !== dup.item.source && !dup.item.alsoIn?.includes(item.source)) {
        dup.item.alsoIn = [...(dup.item.alsoIn ?? []), item.source].slice(0, 12);
      }
      continue;
    }
    kept.push({ item, tok });
  }
  return kept.map((k) => k.item);
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
          // Queries with Vietnamese characters search Google News Vietnam.
          url: `https://news.google.com/rss/search?q=${encodeURIComponent(it.query + " when:1d")}&${/[^\x00-\x7F]/.test(it.query) ? "hl=vi&gl=VN&ceid=VN:vi" : "hl=en-US&gl=US&ceid=US:en"}`,
        },
        ...it.tickers.slice(0, 4).map((t) => ({
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
