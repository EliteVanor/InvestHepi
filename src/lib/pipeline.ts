/**
 * Briefing pipeline: gather news, prices and the calendar for a section or interest set, have the
 * AI (or the rule-based fallback) write the briefing, then store it and record its calls.
 *
 * Two kinds of briefings:
 *  - Shared sections (World, US, Vietnam): written once in English, the same for everyone.
 *  - Interest briefings: one per interest set (interests.ts); users with identical interests share it.
 * Storage layout: briefings.ts. Per-user data runs as whoever the request or job is (context.ts).
 */
import { createHash } from "node:crypto";
import { afterRefresh } from "./alerts";
import { getCalendar } from "./calendar";
import { SECTORS } from "./chart";
import { BENCHMARKS, MAX_ITEMS_PER_SECTION, MAX_ITEMS_TO_LLM, MOOD_BENCH, SECTION_FEEDS, SECTION_GROUPS, SECTION_MACRO, SECTION_STRIPS, type SharedSection, type StripGroup } from "./config";
import { OWNER, currentUid, withUser } from "./context";
import { analyze, type Route } from "./llm";
import { analyzeWithRules } from "./llm/rules";
import { getQuotes } from "./market";
import { computeMood } from "./mood";
import { dedupe, fetchFeeds, fetchInterestNews } from "./news";
import { loadHoldings, positionsAsText } from "./portfolio";
import { getJSON, setJSON } from "./store";
import { getTechnicals, type Technicals } from "./technicals";
import { calibrate, computeStats, gradeCalls, loadCalls, recordCalls, trackRecordText } from "./track";
import { multiUser } from "./users";
import { fold, vnNameSync } from "./vnlist";
import { symLabel } from "./symbols";
import { ALIASES } from "./tickers";
import type { Action, Digest, Direction, Interest, NewsItem, Quote, SectionId } from "./types";
import { callsKeyFor, currentCallsKey, currentInterestSet, interestHash, loadInterests, withHoldings } from "./interests";
import { basePrefix, interestBriefingStale, loadDigest, loadRules, prefixFor, RULES_TTL_MS, storeBriefing } from "./briefings";

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
  if (allowed && !(await allowed())) return "capped";
  await refreshInterestSet(interests, "en", [uid]);
  return "refreshed";
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

interface MarketData {
  key: string;
  at: number;
  quotes: Quote[];
  macro: Quote[];
  sectors: Quote[];
  technicals: Record<string, Technicals>;
}

const MARKET_TTL_MS = 10 * 60_000;

/** What one digest prices: strip/AI symbols, macro, whether US sectors matter, and the mood inputs. */
interface Coverage {
  symbols: string[];
  macro: string[];
  sectors: boolean;
  /** Technicals: mood benchmark first, then each group's benchmark (the free-tier prompt keeps those). */
  tech: string[];
  bench: string;
  /** Quotes used for the mood gauge's breadth (US sectors when `sectors`). */
  breadth: string[];
  strip?: StripGroup[];
}

export function coverage(section: SectionId, interests: Interest[], extra: string[] = []): Coverage {
  const bench = MOOD_BENCH[section];
  const firsts = interests.map((i) => i.tickers[0]).filter(Boolean);
  if (section === "interests") {
    const symbols = [...BENCHMARKS, ...interests.flatMap((i) => i.tickers), ...extra];
    return { symbols, macro: SECTION_MACRO.interests, sectors: true, tech: [bench, ...firsts, ...symbols], bench, breadth: [] };
  }
  const strip = SECTION_STRIPS[section];
  const stripSyms = strip.flatMap((g) => g.symbols);
  // Shared sections: the strip, each group's tickers, and the (hidden) mood benchmark. No personal stocks.
  const symbols = [...stripSyms, ...interests.flatMap((i) => i.tickers), bench];
  const breadth = section === "world" ? strip[0].symbols : section === "vn" ? strip.slice(1).flatMap((g) => g.symbols) : [];
  return { symbols, macro: SECTION_MACRO[section], sectors: section === "us", tech: [bench, ...firsts, ...stripSyms], bench, breadth, strip };
}

/** Prices, macro, sectors and technicals, shared across sections and users for 10 minutes. */
async function marketData(cov: Coverage): Promise<MarketData> {
  const key = [[...new Set(cov.symbols.map((s) => s.toUpperCase()))].sort().join(","), cov.macro.join(","), cov.sectors ? "s" : "", cov.tech.slice(0, 16).join(",")].join("|");
  const slot = `market:${createHash("sha1").update(key).digest("hex").slice(0, 12)}`;
  const cached = await getJSON<MarketData>(slot).catch(() => null);
  if (cached && cached.key === key && Date.now() - cached.at < MARKET_TTL_MS && cached.quotes.length) return cached;
  const [quotes, macro, sectors, technicals] = await Promise.all([
    getQuotes(cov.symbols),
    getQuotes(cov.macro),
    cov.sectors ? getQuotes(SECTORS.map((x) => x.symbol)) : Promise.resolve([] as Quote[]),
    getTechnicals(cov.tech).catch(() => ({}) as Record<string, Technicals>),
  ]);
  const data: MarketData = { key, at: Date.now(), quotes, macro, sectors, technicals };
  if (quotes.length) await setJSON(slot, data).catch(() => {});
  return data;
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
}

/** Track records of the shared sections (calls on market groups, graded like personal ones). */
export const SHARED_CALLS: Record<"world" | "us" | "vn", string> = { world: "calls:world", us: "calls:us", vn: "calls:vn" };

async function buildDigest(o: BuildOptions): Promise<Digest> {
  const cov = coverage(o.section, o.interests, o.extraSymbols);
  const [newsRes, market, calendar] = await Promise.all([
    o.section === "interests"
      ? fetchInterestNews(o.interests, SECTION_FEEDS.interests, process.env.FINNHUB_API_KEY)
      : fetchFeeds(SECTION_FEEDS[o.section]).then((r) => ({ items: dedupe(r.items), errors: r.errors })),
    marketData(cov),
    getCalendar(o.interests).catch(() => ({ events: [], notes: [], generatedAt: o.now.toISOString() })),
  ]);
  const { quotes, macro, sectors, technicals } = market;
  const breadth = cov.sectors ? sectors : quotes.filter((q) => cov.breadth.includes(q.symbol));
  const gauge = computeMood({ spy: technicals[cov.bench], sectors: breadth, macro, quotes, benchSymbol: cov.bench });
  const news = newsRes.items.slice(0, MAX_ITEMS_PER_SECTION);
  const stats = computeStats(await loadCalls(o.callsKey));
  if (o.rulesOnly) {
    return {
      section: o.section, generatedAt: o.now.toISOString(), provider: "rules", providerNote: "Rule-based summary of the latest headlines (no AI).",
      analysis: analyzeWithRules(news, o.interests, quotes), news, quotes, macro, sectors, technicals, gauge, strip: cov.strip, feedErrors: newsRes.errors, language: "en",
    };
  }
  const { analysis, provider, note } = await analyze({
    section: o.section,
    interests: o.interests,
    news: news.slice(0, MAX_ITEMS_TO_LLM),
    quotes,
    macro,
    sectors,
    technicals,
    gauge,
    positions: o.positions,
    calendar: calendar.events,
    trackRecord: trackRecordText(stats),
    language: o.lang,
    now: o.now,
  }, o.route ?? (o.section === "interests" ? "userAuto" : "shared"));
  // Movers' numbers come from the price data, never from the model (it once reported a 5-day gain as
  // the last session's). A ticker that isn't in the snapshot is dropped.
  analysis.movers = alignMovers(analysis.movers ?? [], quotes, news);
  // The track record adjusts each call's confidence once its level has enough graded calls; the
  // model's own number is kept (aiConfidence) and is what gets recorded and graded.
  analysis.outlook = (analysis.outlook ?? []).map((x) => {
    const c = calibrate(x.confidence, stats);
    const action = alignAction(x.direction, x.action, !!o.positions);
    return { ...x, action, ...(action !== x.action ? { aiAction: x.action } : {}), aiConfidence: x.confidence, confidence: c.confidence, ...(c.record ? { record: c.record } : {}) };
  });
  return {
    section: o.section,
    generatedAt: o.now.toISOString(),
    provider,
    providerNote: note,
    analysis,
    news,
    quotes,
    macro,
    sectors,
    technicals,
    gauge,
    strip: cov.strip,
    feedErrors: newsRes.errors,
    language: provider === "rules" ? "en" : o.lang,
  };
}

const NO_CLEAR_NEWS = "No clear news in today's headlines.";

/** Words a headline would use for a ticker: its code, our label, and the Vietnamese listing's short name. */
function namesFor(symbol: string): string[] {
  const code = symbol.replace(/\.VN$/i, "").replace(/^\^/, "");
  const names = [code, symLabel(symbol), vnNameSync(code) ?? "", ...(ALIASES[symbol] ?? [])];
  return [...new Set(names.map((n) => fold(n)).filter((n) => n.length >= 2))];
}

/**
 * An action that contradicts its call's direction is replaced: "up" with Sell/Trim/Avoid becomes
 * Hold, "down" with Buy/Add becomes Wait, and "down" with Hold becomes Wait unless the investor holds
 * positions (then holding through an expected dip is a real choice). The prompt asks for this too.
 */
export function alignAction(direction: Direction, action: Action, hasPositions = false): Action {
  if (direction === "up" && (action === "SELL" || action === "TRIM" || action === "AVOID")) return "HOLD";
  if (direction === "down" && (action === "BUY" || action === "ADD")) return "WAIT";
  if (direction === "down" && action === "HOLD" && !hasPositions) return "WAIT";
  return action;
}

/** Whether a headline mentions the company (code as a whole word, names as substrings; accents ignored). */
export function headlineMentions(title: string, symbol: string): boolean {
  const t = fold(title);
  return namesFor(symbol).some((n) => (n.length <= 4 ? new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(t) : t.includes(n)));
}

/**
 * Movers with the snapshot's own last-session change (tickers not in the snapshot are dropped), and a
 * reason only when a cited headline actually mentions the company; otherwise "No clear news". The model
 * once explained VHM's move with an "earnings beat" no headline mentioned. Exported for tests.
 */
export function alignMovers<M extends { ticker: string; changePct: number; why: string; sourceIds?: number[] }>(movers: M[], quotes: Quote[], news?: NewsItem[]): M[] {
  const by = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));
  return movers.flatMap((m) => {
    const q = by.get(m.ticker.toUpperCase());
    if (!q) return [];
    const out = { ...m, ticker: q.symbol, changePct: q.changePct };
    if (!news) return [out];
    const backed = (m.sourceIds ?? []).filter((i) => news[i] && headlineMentions(news[i].title, q.symbol));
    return [backed.length ? { ...out, sourceIds: backed } : { ...out, why: NO_CLEAR_NEWS, sourceIds: [] }];
  });
}

/** Refresh one shared section in one language. */
/** A refresh result: the new briefing, flagged when AI failed and readers kept the previous AI one. */
export type Refreshed = Digest & { keptAi?: boolean };

export async function refreshShared(section: SectionId, lang: string, now = new Date(), route: Route = "shared"): Promise<Refreshed> {
  const shared = section as SharedSection;
  // Each shared section covers its own market groups and keeps its own track record.
  const interests = SECTION_GROUPS[shared];
  const callsKey = SHARED_CALLS[shared];
  await gradeCalls(now, callsKey).catch(() => 0);
  const d = await buildDigest({ section, interests, lang, callsKey, now, route });
  // Calls are keyed by date + ticker + horizon, so refreshing in several languages doesn't double-count.
  await recordCalls(d.analysis.outlook, interests, d.provider, now, callsKey).catch(() => {});
  const prefix = prefixFor(section, lang);
  const { keptAi } = await storeBriefing(prefix, d);
  await setJSON(`${prefix}:last`, { at: d.generatedAt, provider: d.provider, ok: !keptAi });
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
  await gradeCalls(now, callsKey).catch(() => 0);
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
  await recordCalls(d.analysis.outlook, interests, d.provider, now, callsKey);
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
  return afterRefresh({
    interests: withHoldings(interests, held.map((h) => h.symbol)),
    digests: { interests: i, world: w, us: u },
    prevInterests,
    calendar: cal.events,
    trackSummary: { graded: stats.graded, hitRate: stats.hitRate, weekGraded: week.length, weekHits: week.filter((c) => c.correct).length },
  });
}
