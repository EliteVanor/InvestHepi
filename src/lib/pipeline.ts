import { afterRefresh } from "./alerts";
import { getCalendar } from "./calendar";
import { SECTORS } from "./chart";
import { computeMood } from "./mood";
import { loadHoldings, positionsAsText } from "./portfolio";
import { getTechnicals, type Technicals } from "./technicals";
import { BENCHMARKS, DEFAULT_INTERESTS, MAX_ITEMS_PER_SECTION, MAX_ITEMS_TO_LLM, SECTION_FEEDS } from "./config";
import { isLang } from "./languages";
import { analyze } from "./llm";
import { MACRO, getQuotes } from "./market";
import { dedupe, fetchFeeds, fetchInterestNews } from "./news";
import { delJSON, getJSON, setJSON } from "./store";
import { computeStats, gradeCalls, loadCalls, recordCalls, trackRecordText } from "./track";
import type { Digest, DigestMeta, Interest, SectionId, Settings } from "./types";

const HISTORY_SIZE = 10;
export const DEFAULT_SETTINGS: Settings = { briefingLanguage: "en" };

export async function loadInterests(): Promise<Interest[]> {
  return (await getJSON<Interest[]>("interests")) ?? DEFAULT_INTERESTS;
}

export async function saveInterests(list: Interest[]): Promise<void> {
  await setJSON("interests", list);
}

export async function loadSettings(): Promise<Settings> {
  const s = await getJSON<Partial<Settings>>("settings");
  return { ...DEFAULT_SETTINGS, ...s, briefingLanguage: isLang(s?.briefingLanguage) ? s!.briefingLanguage! : "en" };
}

export async function saveSettings(s: Settings): Promise<void> {
  await setJSON("settings", s);
}

export async function loadDigest(section: SectionId, at?: string): Promise<Digest | null> {
  if (at) return getJSON<Digest>(`digest:${section}:${at}`);
  return getJSON<Digest>(`digest:${section}`);
}

export interface HistoryEntry extends DigestMeta {
  key: string;
}

export async function loadHistory(section: SectionId): Promise<HistoryEntry[]> {
  return (await getJSON<HistoryEntry[]>(`history:${section}`)) ?? [];
}

async function archive(d: Digest): Promise<void> {
  const ts = d.generatedAt.replace(/[^0-9]/g, "").slice(0, 14);
  const key = `digest:${d.section}:${ts}`;
  await setJSON(key, d);
  const entry: HistoryEntry = { key: ts, generatedAt: d.generatedAt, provider: d.provider, headline: d.analysis.headline, mood: d.analysis.mood };
  const list = [entry, ...(await loadHistory(d.section)).filter((h) => h.key !== ts)];
  for (const old of list.slice(HISTORY_SIZE)) await delJSON(`digest:${d.section}:${old.key}`).catch(() => {});
  await setJSON(`history:${d.section}`, list.slice(0, HISTORY_SIZE));
}

export async function refreshSection(section: SectionId, now = new Date()): Promise<Digest> {
  const [interests, settings, holdings] = await Promise.all([loadInterests(), loadSettings(), loadHoldings().catch(() => [])]);
  const symbols = [...BENCHMARKS, ...interests.flatMap((i) => i.tickers), ...holdings.map((h) => h.symbol)];

  const [newsRes, quotes, macro, sectors, calendar, technicals] = await Promise.all([
    section === "interests"
      ? fetchInterestNews(interests, SECTION_FEEDS.interests, process.env.FINNHUB_API_KEY)
      : fetchFeeds(SECTION_FEEDS[section]).then((r) => ({ items: dedupe(r.items), errors: r.errors })),
    getQuotes(symbols),
    getQuotes(MACRO.map((m) => m.symbol)),
    getQuotes(SECTORS.map((x) => x.symbol)),
    getCalendar(interests).catch(() => ({ events: [], notes: [], generatedAt: now.toISOString() })),
    getTechnicals(symbols).catch(() => ({})),
  ]);
  const gauge = computeMood({ spy: (technicals as Record<string, Technicals>).SPY, sectors, macro, quotes });
  const news = newsRes.items.slice(0, MAX_ITEMS_PER_SECTION);

  const stats = computeStats(await loadCalls());
  const { analysis, provider, note } = await analyze({
    section,
    interests,
    news: news.slice(0, MAX_ITEMS_TO_LLM),
    quotes,
    macro,
    sectors,
    technicals,
    gauge,
    positions: positionsAsText(holdings, quotes),
    calendar: calendar.events,
    trackRecord: trackRecordText(stats),
    language: settings.briefingLanguage,
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
    macro,
    sectors,
    technicals,
    gauge,
    feedErrors: newsRes.errors,
    language: provider === "rules" ? "en" : settings.briefingLanguage,
  };
  await setJSON(`digest:${section}`, digest);
  await archive(digest).catch(() => {});
  return digest;
}

export async function refreshAll(sections: SectionId[] = ["interests", "world", "us"]) {
  const graded = await gradeCalls().catch(() => 0);
  const prevInterests = sections.includes("interests") ? await loadDigest("interests").catch(() => null) : undefined;
  const results: { section: SectionId; ok: boolean; provider?: string; error?: string }[] = [];
  // Sequential on purpose: free LLM tiers have tight per-minute limits.
  for (const s of sections) {
    try {
      const d = await refreshSection(s);
      await setJSON(`lastRefresh:${s}`, { at: d.generatedAt, provider: d.provider, ok: true });
      results.push({ section: s, ok: true, provider: d.provider });
    } catch (e) {
      await setJSON(`lastRefresh:${s}`, { at: new Date().toISOString(), ok: false, error: (e as Error).message });
      results.push({ section: s, ok: false, error: (e as Error).message });
    }
  }
  const alerts = await runAlerts(prevInterests).catch((e) => ({ error: (e as Error).message }));
  return { graded, results, alerts };
}

/** Email alerts that depend on fresh briefings (call changes, catalysts, morning and weekly emails). */
async function runAlerts(prevInterests: Digest | null | undefined) {
  const interests = await loadInterests();
  const [i, w, u, cal, calls] = await Promise.all([
    loadDigest("interests"),
    loadDigest("world"),
    loadDigest("us"),
    getCalendar(interests).catch(() => ({ events: [] })),
    loadCalls(),
  ]);
  const stats = computeStats(calls);
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const week = calls.filter((c) => c.correct !== undefined && (c.gradedAt ?? "") >= weekAgo);
  return afterRefresh({
    interests,
    digests: { interests: i, world: w, us: u },
    prevInterests: prevInterests === undefined ? undefined : prevInterests,
    calendar: cal.events,
    trackSummary: { graded: stats.graded, hitRate: stats.hitRate, weekGraded: week.length, weekHits: week.filter((c) => c.correct).length },
  });
}
