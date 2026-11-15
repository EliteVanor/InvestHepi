/**
 * Briefing pipeline.
 *
 * Two kinds of briefings:
 *  - Shared sections (World, US, Vietnam): one per language, the same for everyone.
 *    Stored at digest:<section>:<lang>.
 *  - Interest briefings: one per (interest list + language). Users with identical interests share
 *    one briefing and one track record, which keeps AI cost flat as users grow.
 *    Stored at ib:<hash>, calls at calls:<hash>.
 *
 * Per-user data (interests, settings, holdings, alerts) is namespaced by ukey() for whoever the
 * request or scheduled job is running as (see context.ts).
 */
import { createHash } from "node:crypto";
import { afterRefresh } from "./alerts";
import { getCalendar } from "./calendar";
import { SECTORS } from "./chart";
import { BENCHMARKS, DEFAULT_INTERESTS, MAX_ITEMS_PER_SECTION, MAX_ITEMS_TO_LLM, SECTION_FEEDS, VN_INTEREST, VN_SYMBOLS } from "./config";
import { GUEST, OWNER, currentUid, ukey, withUser } from "./context";
import { isLang } from "./languages";
import { analyze } from "./llm";
import { MACRO, getQuotes } from "./market";
import { computeMood } from "./mood";
import { dedupe, fetchFeeds, fetchInterestNews } from "./news";
import { loadHoldings, positionsAsText } from "./portfolio";
import { delJSON, getJSON, setJSON } from "./store";
import { getTechnicals, type Technicals } from "./technicals";
import { computeStats, gradeCalls, loadCalls, recordCalls, trackRecordText } from "./track";
import { activeUsers, multiUser } from "./users";
import type { Digest, DigestMeta, Interest, Quote, SectionId, Settings } from "./types";

const HISTORY_SIZE = 10;
export const DEFAULT_SETTINGS: Settings = { briefingLanguage: "en" };

/* ------------------------------------------------------- per-user data */

export async function loadInterests(): Promise<Interest[]> {
  return (await getJSON<Interest[]>(ukey("interests"))) ?? DEFAULT_INTERESTS;
}

export async function saveInterests(list: Interest[]): Promise<void> {
  await setJSON(ukey("interests"), list);
}

export async function loadSettings(): Promise<Settings> {
  const s = await getJSON<Partial<Settings>>(ukey("settings"));
  return { ...DEFAULT_SETTINGS, ...s, briefingLanguage: isLang(s?.briefingLanguage) ? s!.briefingLanguage! : "en" };
}

export async function saveSettings(s: Settings): Promise<void> {
  await setJSON(ukey("settings"), s);
}

/* --------------------------------------------------------------- keys */

export function interestHash(interests: Interest[], lang: string): string {
  const norm = interests.map((i) => [i.name.trim(), i.query.trim(), i.tickers.map((t) => t.toUpperCase())]);
  return createHash("sha1").update(JSON.stringify(norm) + "|" + lang).digest("hex").slice(0, 16);
}

/** Storage prefix for a briefing: ib:<hash> for interests, digest:<section>:<lang> for shared ones. */
function prefixFor(section: SectionId, lang: string, hash?: string): string {
  return section === "interests" ? `ib:${hash}` : `digest:${section}:${lang}`;
}

/** The interest list, language and hash the current caller sees (guests: defaults). */
export async function currentInterestSet(langOverride?: string) {
  const [interests, settings] = await Promise.all([loadInterests(), loadSettings()]);
  const lang = currentUid() === GUEST && langOverride && isLang(langOverride) ? langOverride : settings.briefingLanguage;
  return { interests, lang, hash: interestHash(interests, lang) };
}

/** Track-record key for the current caller's interest set (owner's legacy record carries over once). */
export async function currentCallsKey(langOverride?: string): Promise<string> {
  const { hash } = await currentInterestSet(langOverride);
  return callsKeyFor(hash);
}

async function callsKeyFor(hash: string): Promise<string> {
  const key = `calls:${hash}`;
  if (currentUid() === OWNER && !(await getJSON(key))) {
    const legacy = await getJSON<unknown[]>("calls");
    if (legacy?.length) await setJSON(key, legacy);
  }
  return key;
}

/** Shared sections are generated for the languages active users read (English always). */
export async function sharedLanguages(): Promise<string[]> {
  const fixed = process.env.SHARED_LANGUAGES?.split(",").map((s) => s.trim()).filter(isLang);
  if (fixed?.length) return fixed;
  const langs = new Set<string>(["en"]);
  for (const uid of multiUser() ? await activeUsers() : [OWNER]) {
    const s = await withUser(uid, loadSettings);
    langs.add(s.briefingLanguage);
  }
  return [...langs].slice(0, 3);
}

/* ------------------------------------------------------------- reading */

export async function loadDigest(section: SectionId, at?: string, langOverride?: string): Promise<Digest | null> {
  if (section === "interests") {
    const { hash } = await currentInterestSet(langOverride);
    if (at) return getJSON<Digest>(`ib:${hash}:${at}`);
    const d = await getJSON<Digest>(`ib:${hash}`);
    // The owner's pre-multi-user briefing is shown until the first new one is generated.
    if (!d && currentUid() === OWNER) return getJSON<Digest>("digest:interests");
    return d;
  }
  const { lang } = await currentInterestSet(langOverride);
  if (at) return (await getJSON<Digest>(`digest:${section}:${lang}:${at}`)) ?? getJSON<Digest>(`digest:${section}:${at}`);
  return (
    (await getJSON<Digest>(`digest:${section}:${lang}`)) ??
    (lang !== "en" ? await getJSON<Digest>(`digest:${section}:en`) : null) ??
    getJSON<Digest>(`digest:${section}`)
  );
}

export interface HistoryEntry extends DigestMeta {
  key: string;
}

export async function loadHistory(section: SectionId, langOverride?: string): Promise<HistoryEntry[]> {
  const { lang, hash } = await currentInterestSet(langOverride);
  return (await getJSON<HistoryEntry[]>(`${prefixFor(section, lang, hash)}:history`)) ?? [];
}

async function archive(prefix: string, d: Digest): Promise<void> {
  const ts = d.generatedAt.replace(/[^0-9]/g, "").slice(0, 14);
  await setJSON(`${prefix}:${ts}`, d);
  const hk = `${prefix}:history`;
  const entry: HistoryEntry = { key: ts, generatedAt: d.generatedAt, provider: d.provider, headline: d.analysis.headline, mood: d.analysis.mood };
  const list = [entry, ...((await getJSON<HistoryEntry[]>(hk)) ?? []).filter((h) => h.key !== ts)];
  for (const old of list.slice(HISTORY_SIZE)) await delJSON(`${prefix}:${old.key}`).catch(() => {});
  await setJSON(hk, list.slice(0, HISTORY_SIZE));
}

/* --------------------------------------------------------- market data */

interface MarketData {
  key: string;
  at: number;
  quotes: Quote[];
  macro: Quote[];
  sectors: Quote[];
  technicals: Record<string, Technicals>;
}
const MARKET_TTL_MS = 10 * 60_000;

/** Prices, macro, sectors and technicals, shared across sections and users for 10 minutes. */
async function marketData(symbols: string[]): Promise<MarketData> {
  const key = [...new Set(symbols.map((s) => s.toUpperCase()))].sort().join(",");
  const slot = `market:${createHash("sha1").update(key).digest("hex").slice(0, 12)}`;
  const cached = await getJSON<MarketData>(slot).catch(() => null);
  if (cached && cached.key === key && Date.now() - cached.at < MARKET_TTL_MS && cached.quotes.length) return cached;
  const [quotes, macro, sectors, technicals] = await Promise.all([
    getQuotes(symbols),
    getQuotes(MACRO.map((m) => m.symbol)),
    getQuotes(SECTORS.map((x) => x.symbol)),
    getTechnicals(symbols).catch(() => ({}) as Record<string, Technicals>),
  ]);
  const data: MarketData = { key, at: Date.now(), quotes, macro, sectors, technicals };
  if (quotes.length) await setJSON(slot, data).catch(() => {});
  return data;
}

/* ------------------------------------------------------------ building */

interface BuildOptions {
  section: SectionId;
  interests: Interest[];
  lang: string;
  callsKey: string;
  positions?: string;
  extraSymbols?: string[];
  now: Date;
}

async function buildDigest(o: BuildOptions): Promise<Digest> {
  const symbols = [...BENCHMARKS, ...o.interests.flatMap((i) => i.tickers), ...(o.extraSymbols ?? [])];
  const [newsRes, market, calendar] = await Promise.all([
    o.section === "interests"
      ? fetchInterestNews(o.interests, SECTION_FEEDS.interests, process.env.FINNHUB_API_KEY)
      : fetchFeeds(SECTION_FEEDS[o.section]).then((r) => ({ items: dedupe(r.items), errors: r.errors })),
    marketData(symbols),
    getCalendar(o.interests).catch(() => ({ events: [], notes: [], generatedAt: o.now.toISOString() })),
  ]);
  const { quotes, macro, sectors, technicals } = market;
  const gauge = computeMood({ spy: technicals.SPY, sectors, macro, quotes });
  const news = newsRes.items.slice(0, MAX_ITEMS_PER_SECTION);
  const stats = computeStats(await loadCalls(o.callsKey));
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
    feedErrors: newsRes.errors,
    language: provider === "rules" ? "en" : o.lang,
  };
}

/** Refresh one shared section in one language. */
export async function refreshShared(section: SectionId, lang: string, now = new Date()): Promise<Digest> {
  const isVn = section === "vn";
  const interests = isVn ? [...DEFAULT_INTERESTS, VN_INTEREST] : DEFAULT_INTERESTS;
  const d = await buildDigest({ section, interests, lang, callsKey: `calls:${interestHash(DEFAULT_INTERESTS, "en")}`, extraSymbols: isVn ? VN_SYMBOLS : [], now });
  const prefix = prefixFor(section, lang);
  await setJSON(prefix, d);
  await archive(prefix, d).catch(() => {});
  await setJSON(`${prefix}:last`, { at: d.generatedAt, provider: d.provider, ok: true });
  return d;
}

/**
 * Refresh one interest briefing, record its calls, then run alerts for every user who follows
 * exactly this set. Positions only shape the briefing in single-user mode (briefings are shared
 * in multi-user mode; Ask AI is still position-aware there).
 */
export async function refreshInterestSet(interests: Interest[], lang: string, uids: string[], now = new Date()): Promise<Digest> {
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
    positions: holdings.length ? positionsAsText(holdings, (await marketData([...BENCHMARKS, ...interests.flatMap((i) => i.tickers), ...holdings.map((h) => h.symbol)])).quotes) : undefined,
    extraSymbols: holdings.map((h) => h.symbol),
    now,
  });
  await recordCalls(d.analysis.outlook, interests, d.provider, now, callsKey);
  await setJSON(`ib:${hash}`, d);
  await archive(`ib:${hash}`, d).catch(() => {});
  await setJSON(`ib:${hash}:last`, { at: d.generatedAt, provider: d.provider, ok: true });
  for (const uid of uids) await withUser(uid, () => runAlerts(prev)).catch(() => {});
  return d;
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

/* ----------------------------------------------------------- scheduler */

interface Group {
  interests: Interest[];
  lang: string;
  uids: string[];
}

/** Distinct interest sets among active users, plus the default set guests see. */
export async function interestGroups(): Promise<Map<string, Group>> {
  const groups = new Map<string, Group>();
  const add = (interests: Interest[], lang: string, uid?: string) => {
    const h = interestHash(interests, lang);
    const g = groups.get(h) ?? { interests, lang, uids: [] };
    if (uid && !g.uids.includes(uid)) g.uids.push(uid);
    groups.set(h, g);
  };
  for (const uid of multiUser() ? await activeUsers() : [OWNER]) {
    await withUser(uid, async () => {
      const { interests, lang } = await currentInterestSet();
      add(interests, lang, uid);
    });
  }
  if (multiUser()) for (const lang of await sharedLanguages()) add(DEFAULT_INTERESTS, lang);
  return groups;
}

/**
 * Scheduled refresh. Shared sections: every language in use. Interests: the stalest sets first,
 * at most `batch` per call (free AI tiers allow roughly one briefing a minute).
 */
export async function refreshScheduled(section: SectionId, opts: { batch?: number; minAgeMin?: number } = {}, now = new Date()) {
  const results: { key: string; ok: boolean; provider?: string; error?: string }[] = [];
  const run = async (key: string, fn: () => Promise<Digest>) => {
    try {
      const d = await fn();
      results.push({ key, ok: true, provider: d.provider });
    } catch (e) {
      results.push({ key, ok: false, error: (e as Error).message });
    }
  };
  if (section !== "interests") {
    for (const lang of await sharedLanguages()) await run(`${section}:${lang}`, () => refreshShared(section, lang, now));
    return { results };
  }
  const batch = opts.batch ?? (Number(process.env.INTEREST_BATCH) || 2);
  const minAge = (opts.minAgeMin ?? 90) * 60_000;
  const groups = [...(await interestGroups()).entries()];
  const ages = await Promise.all(groups.map(async ([h]) => (await getJSON<{ at: string }>(`ib:${h}:last`))?.at ?? "1970-01-01"));
  const due = groups
    .map(([h, g], i) => ({ h, g, at: ages[i] }))
    .filter((x) => now.getTime() - new Date(x.at).getTime() >= minAge)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, batch);
  for (const x of due) await run(`interests:${x.h}`, () => refreshInterestSet(x.g.interests, x.g.lang, x.g.uids, now));
  return { results, pending: Math.max(0, groups.length - due.length) };
}

/* -------------------------------------------------------------- alerts */

/** Adds held tickers (not already followed) as one extra group so alerts cover them too. */
export function withHoldings(interests: Interest[], held: string[]): Interest[] {
  const have = new Set(interests.flatMap((i) => i.tickers));
  const extra = held.filter((s) => !have.has(s));
  return extra.length ? [...interests, { id: "holdings", name: "Holdings", query: "", tickers: extra }] : interests;
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
