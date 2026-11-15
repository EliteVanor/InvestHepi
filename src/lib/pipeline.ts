import { BENCHMARKS, DEFAULT_INTERESTS, MAX_ITEMS_PER_SECTION, MAX_ITEMS_TO_LLM, SECTION_FEEDS } from "./config";
import { analyze } from "./llm";
import { getQuotes } from "./market";
import { dedupe, fetchFeeds, fetchInterestNews } from "./news";
import { getJSON, setJSON } from "./store";
import { computeStats, gradeCalls, loadCalls, recordCalls, trackRecordText } from "./track";
import type { Digest, Interest, SectionId } from "./types";

export async function loadInterests(): Promise<Interest[]> {
  return (await getJSON<Interest[]>("interests")) ?? DEFAULT_INTERESTS;
}

export async function saveInterests(list: Interest[]): Promise<void> {
  await setJSON("interests", list);
}

export async function loadDigest(section: SectionId): Promise<Digest | null> {
  return getJSON<Digest>(`digest:${section}`);
}

export async function refreshSection(section: SectionId, now = new Date()): Promise<Digest> {
  const interests = await loadInterests();
  const symbols = [...BENCHMARKS, ...interests.flatMap((i) => i.tickers)];

  const [newsRes, quotes] = await Promise.all([
    section === "interests"
      ? fetchInterestNews(interests, SECTION_FEEDS.interests, process.env.FINNHUB_API_KEY)
      : fetchFeeds(SECTION_FEEDS[section]).then((r) => ({ items: dedupe(r.items), errors: r.errors })),
    getQuotes(symbols),
  ]);
  const news = newsRes.items.slice(0, MAX_ITEMS_PER_SECTION);

  const stats = computeStats(await loadCalls());
  const { analysis, provider, note } = await analyze({
    section,
    interests,
    news: news.slice(0, MAX_ITEMS_TO_LLM),
    quotes,
    trackRecord: trackRecordText(stats),
    now,
  });

  // Only the interests section feeds the track record, so each ticker gets one call per session.
  if (section === "interests") await recordCalls(analysis.outlook, interests, provider, now);

  const digest: Digest = {
    section,
    generatedAt: now.toISOString(),
    provider,
    providerNote: note,
    analysis,
    news,
    quotes,
    feedErrors: newsRes.errors,
  };
  await setJSON(`digest:${section}`, digest);
  return digest;
}

export async function refreshAll(sections: SectionId[] = ["interests", "world", "us"]) {
  const graded = await gradeCalls().catch(() => 0);
  const results: { section: SectionId; ok: boolean; provider?: string; error?: string }[] = [];
  // Sequential on purpose: free LLM tiers have tight per-minute limits.
  for (const s of sections) {
    try {
      const d = await refreshSection(s);
      results.push({ section: s, ok: true, provider: d.provider });
    } catch (e) {
      results.push({ section: s, ok: false, error: (e as Error).message });
    }
  }
  return { graded, results };
}
