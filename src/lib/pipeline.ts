/**
 * Briefing pipeline: gather news, prices and the calendar for a section or interest set, have the
 * AI (or the rule-based fallback) write the briefing (summary, trend, events, movers, scenarios),
 * then store it. Briefings make no buy/hold/wait calls: those are the prediction job (predictions.ts).
 *
 * Two kinds of briefings:
 *  - Shared sections (World, US, Vietnam): written once in English, the same for everyone.
 *  - Interest briefings: one per interest set (interests.ts); users with identical interests share it.
 * Storage layout: briefings.ts. Per-user data runs as whoever the request or job is (context.ts).
 */
import { afterRefresh } from "./alerts";
import { getCalendar } from "./calendar";
import { MAX_ITEMS_PER_SECTION, MAX_ITEMS_TO_LLM, SECTION_GROUPS, type SharedSection } from "./config";
import { OWNER, currentUid, withUser } from "./context";
import type { Route } from "./llm";
import { analyzeWithRules } from "./llm/rules";
import { coverage, marketData } from "./market-data";
import { computeMood } from "./mood";
import { fetchSectionItems, newsKey, saveHeadlines, storyScope } from "./headlines";
import { clusterStories, toHeadlines } from "./stories/cluster";
import { runStories } from "./stories/job";
import { loadHoldings, positionsAsText } from "./portfolio";
import { getJSON, releaseLock, setJSON, takeLock } from "./store";
import { waitUntil } from "./lock-wait";
import { computeStats, loadCalls, SHARED_CALLS } from "./track";
import { callsOf, loadPredictions } from "./predictions";
import { multiUser } from "./users";
import type { Analysis, Digest, Interest, NewsItem, SectionId } from "./types";
import { callsKeyFor, currentCallsKey, currentInterestSet, interestHash, loadInterests, withHoldings } from "./interests";
import { basePrefix, interestBriefingStale, loadDigest, pretranslateSet, loadRules, prefixFor, RULES_TTL_MS, storeBriefing } from "./briefings";

/** A returning user's briefing older than this is refreshed when they open the app. */
export const CATCH_UP_AFTER_MS = 12 * 3600_000;

/**
 * The caller's interest briefing, made in the background when it's missing (a newly saved set) or,
 * with `maxAgeMs`, older than that (a user back after the scheduler stopped refreshing them).
 * Free when it's already fresh; otherwise `allowed()` counts it against the daily cap.
 */
export async function ensureInterestBriefing(uid: string, allowed?: () => Promise<boolean>, maxAgeMs = Infinity): Promise<"fresh" | "capped" | "refreshed"> {
  const { interests, hash } = await currentInterestSet();
  if (!(await interestBriefingStale(hash, maxAgeMs))) return "fresh";
  // One briefing per interest set across instances: the loser waits for the winner's briefing, never writes a second.
  const lockKey = `ib:${hash}:lock`;
  const token = await takeLock(lockKey, 330);
  if (!token) {
    await waitUntil(async () => !(await interestBriefingStale(hash, maxAgeMs)));
    return "fresh";
  }
  try {
    if (!(await interestBriefingStale(hash, maxAgeMs))) return "fresh"; // the previous holder finished just before our lock
    if (allowed && !(await allowed())) return "capped";
    await refreshInterestSet(interests, "en", [uid]);
    await pretranslateSet(hash, [uid]).catch(() => []); // opens already translated for a reader of another language
    return "refreshed";
  } finally {
    await releaseLock(lockKey, token).catch(() => {});
  }
}

/**
 * A fresh rule-based copy (latest headlines and prices, no AI) unless one under 15 minutes old exists.
 * `onBuild` gates the build (per-user daily cap); when it says no, the cached copy is returned.
 */
export async function rulesVariant(section: SectionId, lang?: string, onBuild?: () => Promise<boolean>, now = new Date()): Promise<Digest | null> {
  const cached = await loadRules(section, lang);
  if (cached && now.getTime() - new Date(cached.generatedAt).getTime() < RULES_TTL_MS) return cached;
  if (onBuild && !(await onBuild())) return cached;
  const prefix = `${await basePrefix(section)}:rules`;
  const job = rulesBuilds.get(prefix) ?? buildRules(section, now).finally(() => rulesBuilds.delete(prefix));
  rulesBuilds.set(prefix, job);
  const d = await job;
  await setJSON(prefix, d);
  return d;
}

const rulesBuilds = new Map<string, Promise<Digest>>();

async function buildRules(section: SectionId, now: Date): Promise<Digest> {
  if (section === "interests") {
    const { interests, hash } = await currentInterestSet();
    return buildDigest({ section, interests, lang: "en", callsKey: `calls:${hash}`, now, rulesOnly: true });
  }
  const shared = section as SharedSection;
  return buildDigest({ section, interests: SECTION_GROUPS[shared], lang: "en", callsKey: SHARED_CALLS[shared], now, rulesOnly: true });
}

interface BuildOptions {
  section: SectionId;
  interests: Interest[];
  lang: string;
  callsKey: string;
  positions?: string;
  extraSymbols?: string[];
  now: Date;
  /** Which models to use (models.ts routes). */
  route?: Route;
  /** Skip AI entirely: the rule-based copy readers can switch to. */
  rulesOnly?: boolean;
  /** Big-story run (v19b D8): explain only these story ids. */
  only?: string[];
}

async function buildDigest(o: BuildOptions): Promise<Digest> {
  const cov = coverage(o.section, o.interests, o.extraSymbols);
  const [newsRes, market, calendar] = await Promise.all([
    fetchSectionItems(o.section, o.interests),
    marketData(cov),
    getCalendar(o.interests).catch(() => ({ events: [], notes: [], generatedAt: o.now.toISOString() })),
  ]);
  const { quotes, macro, sectors, technicals } = market;
  const breadth = cov.sectors ? sectors : quotes.filter((q) => cov.breadth.includes(q.symbol));
  const gauge = computeMood({ spy: technicals[cov.bench], sectors: breadth, macro, quotes, benchSymbol: cov.bench });
  // One headline per story, newest first (the story run clusters again with the saved ids).
  const news = toHeadlines(clusterStories(newsRes.items, null, o.now)).slice(0, MAX_ITEMS_PER_SECTION);
  const hash = o.section === "interests" ? interestHash(o.interests, "en") : undefined;
  const base = { section: o.section, generatedAt: o.now.toISOString(), quotes, macro, sectors, technicals, gauge, strip: cov.strip, feedErrors: newsRes.errors };
  const rules = (note: string, items = news): Digest => ({ ...base, provider: "rules", providerNote: note, analysis: analyzeWithRules(items, o.interests, quotes), news, language: "en" });
  if (o.rulesOnly) return rules("Rule-based summary of the latest headlines (no AI).");
  // The headlines just fetched also refresh the live list readers see (no extra requests).
  await saveHeadlines(newsKey(o.section, hash), { items: news, errors: newsRes.errors }, o.now).catch(() => {});
  try {
    const run = await runStories(storyScope(o.section, hash), {
      section: o.section,
      headlines: newsRes.items,
      route: o.route ?? (o.section === "interests" ? "userAuto" : "shared"),
      now: o.now,
      market,
      calendar: calendar.events,
      ...(o.only ? { only: o.only, trigger: "big" as const } : {}),
    });
    // Digest.news: the headlines the movers' sourceIds index (the run's stories' members), then the kept cards'
    // members (so every card can list its sources), then the rest of the list.
    const ids = new Set([...run.news, ...run.shownNews].map((n) => n.id));
    const analysis: Analysis = {
      headline: run.bigPicture[0] ?? "",
      mood: moodOf(gauge?.score),
      summary: run.bigPicture,
      events: [],
      watchNext: run.watch,
      movers: run.movers,
    };
    return { ...base, provider: run.provider, providerNote: run.note, analysis, stories: run.cards, bigPicture: run.bigPicture, news: [...run.news, ...run.shownNews, ...news.filter((n) => !ids.has(n.id))], language: o.section === "vn" ? "vi" : o.lang };
  } catch (e) {
    // As before stories: the rule-based analysis of the headlines an AI would have seen (storeBriefing keeps the last AI briefing).
    const msg = (e as Error).message;
    const note = msg === "NO_PROVIDER" ? "No AI key configured. Add a free GROQ_API_KEY or GEMINI_API_KEY for real analysis." : msg.slice(0, 2000);
    return rules(note, news.slice(0, MAX_ITEMS_TO_LLM));
  }
}

/** The briefing's mood from the gauge (0 fear - 100 greed): 60+ risk-on, 40 or less risk-off. */
export const moodOf = (score?: number): Analysis["mood"] => (score == null ? "mixed" : score >= 60 ? "risk-on" : score <= 40 ? "risk-off" : "mixed");

/** A refresh result: the new briefing, flagged when AI failed and readers kept the previous AI one. */
export type Refreshed = Digest & { keptAi?: boolean };

/** Refresh one shared section in one language. */
export async function refreshShared(section: SectionId, lang: string, now = new Date(), route: Route = "shared", only?: string[]): Promise<Refreshed> {
  const shared = section as SharedSection;
  // Each shared section covers its own market groups and keeps its own track record.
  const interests = SECTION_GROUPS[shared];
  const callsKey = SHARED_CALLS[shared];
  const d = await buildDigest({ section, interests, lang, callsKey, now, route, only });
  const prefix = prefixFor(section, lang);
  const { keptAi } = await storeBriefing(prefix, d);
  // A big-story run isn't a slot's briefing: it must not make the next slot skip as "fresh".
  if (!only) await setJSON(`${prefix}:last`, { at: d.generatedAt, provider: d.provider, ok: !keptAi });
  return keptAi ? { ...d, keptAi } : d;
}

/**
 * Refresh one interest briefing, record its calls, then run alerts for every user who follows
 * exactly this set. Positions only shape the briefing in single-user mode (briefings are shared
 * in multi-user mode; Ask AI is still position-aware there).
 */
export async function refreshInterestSet(interests: Interest[], lang: string, uids: string[], now = new Date(), route: Route = uids.includes(OWNER) ? "adminAuto" : "userAuto"): Promise<Refreshed> {
  const hash = interestHash(interests, lang);
  const callsKey = await callsKeyFor(hash);
  const prev = (await getJSON<Digest>(`ib:${hash}`)) ?? (uids.includes(OWNER) ? await getJSON<Digest>("digest:interests") : null);
  const holdings = !multiUser() ? await loadHoldings().catch(() => []) : [];
  const d = await buildDigest({
    section: "interests",
    interests,
    lang,
    callsKey,
    // Same coverage (and cache slot) as the digest below, so this costs no extra price requests.
    positions: holdings.length ? positionsAsText(holdings, (await marketData(coverage("interests", interests, holdings.map((h) => h.symbol)))).quotes) : undefined,
    extraSymbols: holdings.map((h) => h.symbol),
    now,
    route,
  });
  const { keptAi } = await storeBriefing(`ib:${hash}`, d);
  await setJSON(`ib:${hash}:last`, { at: d.generatedAt, provider: d.provider, ok: !keptAi });
  for (const uid of uids) await withUser(uid, () => runAlerts(prev)).catch(() => {});
  return keptAi ? { ...d, keptAi } : d;
}

/** Refresh a section as the current caller (their interest set / their language). */
export async function refreshSection(section: SectionId, now = new Date()): Promise<Digest> {
  const { interests, lang } = await currentInterestSet();
  if (section === "interests") return refreshInterestSet(interests, lang, [currentUid()], now);
  return refreshShared(section, lang, now);
}

export async function refreshAll(sections: SectionId[] = ["interests", "world", "us", "vn"]) {
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
  return { results };
}

/** Email alerts that depend on fresh briefings, for the current user. */
async function runAlerts(prevInterests: Digest | null | undefined) {
  const interests = await loadInterests();
  const callsKey = await currentCallsKey();
  const [i, w, u, cal, calls] = await Promise.all([
    loadDigest("interests"),
    loadDigest("world"),
    loadDigest("us"),
    getCalendar(interests).catch(() => ({ events: [] })),
    loadCalls(callsKey),
  ]);
  const stats = computeStats(calls);
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const week = calls.filter((c) => c.correct !== undefined && (c.gradedAt ?? "") >= weekAgo);
  const held = await loadHoldings().catch(() => []);
  const preds = await loadPredictions("interests").catch(() => []);
  return afterRefresh({
    interests: withHoldings(interests, held.map((h) => h.symbol)),
    calls: callsOf(preds),
    digests: { interests: i, world: w, us: u },
    prevInterests,
    calendar: cal.events,
    trackSummary: { graded: stats.graded, hitRate: stats.hitRate, weekGraded: week.length, weekHits: week.filter((c) => c.correct).length },
  });
}
