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
import { BENCHMARKS, DEFAULT_INTERESTS, MAX_ITEMS_PER_SECTION, MAX_ITEMS_TO_LLM, MOOD_BENCH, SECTION_FEEDS, SECTION_GROUPS, SECTION_MACRO, SECTION_STRIPS, type SharedSection, type StripGroup } from "./config";
import { GUEST, OWNER, currentUid, ukey, withUser } from "./context";
import { isLang } from "./languages";
import { analyze } from "./llm";
import { translateDigest } from "./translate";
import { getQuotes } from "./market";
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

/**
 * The caller's interest list and briefing key. Every briefing is written in English (one AI call per
 * interest set, shared by everyone with the same interests); `display` is the caller's chosen
 * language, which readers get as a cached translation (translate.ts).
 */
export async function currentInterestSet(_langOverride?: string) {
  const [interests, settings] = await Promise.all([loadInterests(), loadSettings()]);
  return { interests, lang: "en", display: settings.briefingLanguage, hash: interestHash(interests, "en") };
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

/**
 * A newly saved interest set gets its first briefing right away (users can't refresh by hand).
 * Costs nothing if anyone already follows the same set; capped per user per day.
 * Returns true if a briefing exists or was just made.
 */
export async function ensureInterestBriefing(uid: string, onSpend?: () => Promise<boolean>): Promise<boolean> {
  const { interests, hash } = await currentInterestSet();
  if (await getJSON(`ib:${hash}`)) return true;
  if (onSpend && !(await onSpend())) return false;
  await refreshInterestSet(interests, "en", [uid]);
  return true;
}

/* ------------------------------------------------------------- reading */

/** Translation cache key for a stored briefing (prefix = ib:<hash> or digest:<section>:<lang>). */
const trKey = (prefix: string, lang: string) => `tr:${prefix}:${lang}`;

/**
 * The briefing a reader sees. `langOverride` is the reader's interface language: if the briefing was
 * written in another language and a translation of this exact version is cached, that's returned;
 * otherwise the original (the client then asks /api/translate once).
 */
export async function loadDigest(section: SectionId, at?: string, langOverride?: string): Promise<Digest | null> {
  const want = langOverride && isLang(langOverride) ? langOverride : undefined;
  const translated = async (prefix: string, d: Digest | null, target: string | undefined = want) => {
    if (!d || !target || d.language === target || at) return d;
    const tr = await getJSON<Digest>(trKey(prefix, target));
    return tr && tr.generatedAt === d.generatedAt ? tr : d;
  };
  const set = await currentInterestSet();
  if (section === "interests") {
    const { hash } = set;
    if (at) return getJSON<Digest>(`ib:${hash}:${at}`);
    const d = await getJSON<Digest>(`ib:${hash}`);
    // The owner's pre-multi-user briefing is shown until the first new one is generated.
    if (!d && currentUid() === OWNER) return translated("digest:interests", await getJSON<Digest>("digest:interests"), want ?? set.display);
    return translated(`ib:${hash}`, d, want ?? set.display);
  }
  const lang = want ?? set.display;
  if (at) return (await getJSON<Digest>(`digest:${section}:${lang}:${at}`)) ?? getJSON<Digest>(`digest:${section}:${at}`);
  // Shared sections are written once in English and translated; a native copy (older runs, or a
  // language someone generated directly) wins only if it's at least as new.
  const [native, en] = await Promise.all([getJSON<Digest>(`digest:${section}:${lang}`), lang !== "en" ? getJSON<Digest>(`digest:${section}:en`) : null]);
  if (native && (!en || native.generatedAt >= en.generatedAt)) return native;
  if (en) return translated(`digest:${section}:en`, en, lang);
  return getJSON<Digest>(`digest:${section}`);
}

const translating = new Map<string, Promise<Digest>>();

/**
 * Translate the latest briefing of a section into `lang`, once per briefing version (cached for
 * every reader; concurrent requests share one call). Returns the original if no translation is
 * needed or possible. `onSpend` runs only when a new translation is actually paid for.
 */
export async function translateLatest(section: SectionId, lang: string, onSpend?: () => Promise<boolean>): Promise<Digest | null> {
  const d = await loadDigest(section, undefined, lang);
  if (!d || !isLang(lang) || d.language === lang || d.provider === "rules" || d.translatedFrom) return d;
  const prefix = section === "interests" ? `ib:${(await currentInterestSet()).hash}` : `digest:${section}:${d.language ?? "en"}`;
  const key = trKey(prefix, lang);
  const pending = translating.get(key);
  if (pending) return pending;
  if (onSpend && !(await onSpend())) return d;
  const job = translateDigest(d, lang)
    .then(async (t) => {
      await setJSON(key, t);
      return t;
    })
    .finally(() => translating.delete(key));
  translating.set(key, job);
  return job;
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

/** Track records of the shared sections (calls on market groups, graded like personal ones). */
export const SHARED_CALLS: Record<"world" | "us" | "vn", string> = { world: "calls:world", us: "calls:us", vn: "calls:vn" };
export const VN_CALLS = SHARED_CALLS.vn;

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
    strip: cov.strip,
    feedErrors: newsRes.errors,
    language: provider === "rules" ? "en" : o.lang,
  };
}

/** Refresh one shared section in one language. */
export async function refreshShared(section: SectionId, lang: string, now = new Date()): Promise<Digest> {
  const shared = section as SharedSection;
  // Each shared section covers its own market groups and keeps its own track record.
  const interests = SECTION_GROUPS[shared];
  const callsKey = SHARED_CALLS[shared];
  await gradeCalls(now, callsKey).catch(() => 0);
  const d = await buildDigest({ section, interests, lang, callsKey, now });
  // Calls are keyed by date + ticker + horizon, so refreshing in several languages doesn't double-count.
  await recordCalls(d.analysis.outlook, interests, d.provider, now, callsKey).catch(() => {});
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
    // Same coverage (and cache slot) as the digest below, so this costs no extra price requests.
    positions: holdings.length ? positionsAsText(holdings, (await marketData(coverage("interests", interests, holdings.map((h) => h.symbol)))).quotes) : undefined,
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

/** Distinct interest sets among active users (identical interests + language share one briefing). */
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
  // Signed-out visitors don't see My Interests (they're asked to sign in), so no guest set is kept fresh.
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
    // Write the section once (English), then translate it for the other languages readers use:
    // a translation costs about a quarter of a full analysis and keeps the calls identical.
    await run(`${section}:en`, () => refreshShared(section, "en", now));
    for (const lang of (await sharedLanguages()).filter((l) => l !== "en")) {
      await run(`${section}:${lang}`, async () => (await translateLatest(section, lang)) ?? Promise.reject(new Error("no briefing")));
    }
    return { results };
  }
  const batch = opts.batch ?? (Number(process.env.INTEREST_BATCH) || 2);
  // 60 min: the closest scheduled runs are 80 min apart (11:50 and 13:10 UTC), so each run still refreshes.
  const minAge = (opts.minAgeMin ?? 60) * 60_000;
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
