/**
 * Predictions: the graded calls, a separate AI job from briefings (v18). Each market gets two runs a
 * weekday (timetable.ts), "before market" and "mid-day", and each run calls only its own market:
 *  - shared: Vietnam and US (their market groups), and each World market (Japan, China & Hong Kong,
 *    Europe, US stocks, oil, gold);
 *  - interest sets: each set's US part on the New York clock and its Vietnam part on the Hanoi clock.
 * A daily call is graded at that day's close on the ticker's own exchange; only the before-market run
 * makes weekly calls (graded at the 5th weekday's close). No rule-based fallback: if no model works,
 * the run is retried once by the scheduler and otherwise missed.
 *
 * Storage:
 *   pred:<scope>             the latest daily run and the latest weekly run of one market
 *   tr:pred:<scope>:<lang>   its translation, per version
 * Scopes: vn, us, world:jp|cn|eu|wus|oil|gold, ib:<hash>:us|vn. Calls go to the section's or set's
 * call store (calls:vn|us|world, calls:<hash>), graded by track.ts.
 */
import { predictionAlerts } from "./alerts";
import { getCalendar } from "./calendar";
import { getLiveQuotes } from "./chart";
import { SECTION_MACRO, US_GROUPS, VN_GROUPS, WORLD_GROUPS } from "./config";
import { withUser } from "./context";
import { currentInterestSet } from "./interests";
import { generateJSON } from "./llm";
import type { Route } from "./llm/models";
import { buildPredictSystem, buildPredictUser, parsePrediction, PREDICT_HINT, predictOutputTokens } from "./llm/predict";
import { loadHeadlines } from "./headlines";
import { isLang } from "./languages";
import { MARKET_TZ, SETTLE_MINS, WORLD_MARKETS, WORLD_ORDER, closeUtc, dailyTarget, nthWeekday, sectionOfMarket, type Phase, type SlotMarket } from "./markets";
import { alignAction, coverage, marketData, SHARED_CALLS } from "./pipeline";
import { loadHoldings, positionsAsText } from "./portfolio";
import { getJSON, setJSON } from "./store";
import { exchangeTz } from "./symbols";
import { calibrate, computeStats, gradeCalls, loadCalls, recordCalls, trackRecordText } from "./track";
import { outlookSlots, translateSlots } from "./translate";
import { multiUser } from "./users";
import { tagInterests } from "./news";
import type { Interest, NewsItem, Outlook, SectionId } from "./types";
import type { PredictionSet } from "./predictions-view";

export type { PredRun, PredictionSet } from "./predictions-view";
export { callsOf } from "./predictions-view";

const predKey = (scope: string) => `pred:${scope}`;
const trKey = (scope: string, lang: string) => `tr:pred:${scope}:${lang}`;
const version = (s: PredictionSet) => `${s.daily?.at ?? ""}|${s.weekly?.at ?? ""}`;

/** The market groups a shared market calls. */
export function sharedGroups(market: SlotMarket): Interest[] {
  if (market === "vn") return VN_GROUPS;
  if (market === "us") return US_GROUPS;
  const id = WORLD_MARKETS[market as keyof typeof WORLD_MARKETS];
  return WORLD_GROUPS.filter((g) => g.id === id);
}

export function sharedScope(market: SlotMarket): string {
  return market === "vn" || market === "us" ? market : `world:${market}`;
}

/** Scopes a reader of a section sees, in display order. */
export function scopesFor(section: SectionId, hash?: string): string[] {
  if (section === "vn") return ["vn"];
  if (section === "us") return ["us"];
  if (section === "world") return WORLD_ORDER.map((m) => `world:${m}`);
  return hash ? [`ib:${hash}:us`, `ib:${hash}:vn`] : [];
}

/** Macro rows each market's prompt gets (a short list: the prompt stays small). */
const MARKET_MACRO: Record<SlotMarket, string[]> = {
  vn: SECTION_MACRO.vn,
  ivn: SECTION_MACRO.vn,
  us: SECTION_MACRO.us,
  ius: SECTION_MACRO.interests,
  wus: ["^VIX", "^TNX", "DX-Y.NYB"],
  jp: ["JPY=X", "^TNX", "^VIX"],
  cn: ["CNY=X", "^TNX", "^VIX"],
  eu: ["EURUSD=X", "^TNX", "^VIX"],
  oil: ["DX-Y.NYB", "^TNX", "^VIX"],
  gold: ["DX-Y.NYB", "^TNX", "^VIX"],
};

export interface PredictionJob {
  market: SlotMarket;
  phase: Phase;
  now: Date;
  /** Interest sets: the set and its part on this market's clock. */
  set?: { hash: string; interests: Interest[]; uids: string[]; admin: boolean };
}

/** Headlines for a run: the live list (refreshed every 15/30 min), the market's own first. */
async function headlinesFor(section: SectionId, interests: Interest[], hash?: string): Promise<NewsItem[]> {
  const live = await loadHeadlines(section, hash);
  const items = live?.items ?? [];
  if (section === "interests") {
    const ids = new Set(interests.map((i) => i.id));
    return items.filter((n) => n.tags?.some((t) => ids.has(t)));
  }
  // A World or Vietnam market: headlines naming it first, then the rest of the section's.
  const tagged = tagInterests(items, interests);
  return [...tagged.filter((n) => n.tags?.length), ...tagged.filter((n) => !n.tags?.length)].map(({ tags: _t, ...n }) => n);
}

/** Run one market's predictions. Never throws: returns ok=false with the reason. */
export async function runPrediction(job: PredictionJob): Promise<{ ok: boolean; note: string; n?: number }> {
  try {
    return await predict(job);
  } catch (e) {
    return { ok: false, note: (e as Error).message.slice(0, 200) };
  }
}

async function predict({ market, phase, now, set }: PredictionJob): Promise<{ ok: boolean; note: string; n?: number }> {
  const section = sectionOfMarket(market);
  const tz = MARKET_TZ[market];
  const interests = set ? set.interests : sharedGroups(market);
  if (!interests.length) return { ok: true, note: "nothing to predict" };
  const scope = set ? `ib:${set.hash}:${market === "ivn" ? "vn" : "us"}` : sharedScope(market);
  const callsKey = set ? `calls:${set.hash}` : SHARED_CALLS[section as keyof typeof SHARED_CALLS];
  const route: Route = set ? (set.admin ? "predAdmin" : "predUser") : "predShared";
  await gradeCalls(now, callsKey).catch(() => 0);

  const firsts = interests.map((i) => i.tickers[0]);
  const symbols = [...new Set(interests.flatMap((i) => i.tickers))];
  const macroWanted = MARKET_MACRO[market];
  const cov = { ...coverage(section === "interests" ? "interests" : section, interests), symbols, macro: macroWanted, sectors: false, tech: firsts, breadth: [] };
  const holdings = set && !multiUser() ? await loadHoldings().catch(() => []) : [];
  const [data, news, calendar, calls] = await Promise.all([
    marketData(cov),
    headlinesFor(section, interests, set?.hash),
    getCalendar(interests).catch(() => ({ events: [] })),
    loadCalls(callsKey),
  ]);
  const stats = computeStats(calls);

  // Daily calls made after a ticker's session opened start from the price at that moment.
  const targets = new Map(symbols.map((s) => [s, dailyTarget(now, s)]));
  const opened = new Set(symbols.filter((s) => targets.get(s)!.opened));
  const live = new Map<string, { price: number; chg: number; at: number }>();
  if (opened.size) {
    for (const q of await getLiveQuotes([...opened]).catch(() => [])) {
      // Only a price from the graded session itself; a last close or an ETF on another day won't do.
      if (q.session === targets.get(q.symbol)?.date && q.intraday !== false && !q.dailyOnly && Number.isFinite(q.changePct)) live.set(q.symbol, { price: q.price, chg: q.changePct, at: q.asOf * 1000 });
    }
  }
  const today = dailyTarget(now, firsts[0]).date;
  const weekEnd = nthWeekday(today, 5);
  const input = {
    interests, phase, tz, vn: market === "vn" || market === "ivn",
    quotes: data.quotes, live, opened, macro: data.macro, macroWanted, technicals: data.technicals,
    calendar: calendar.events, news, trackRecord: trackRecordText(stats),
    positions: holdings.length ? positionsAsText(holdings, data.quotes) : undefined,
    today, weekEnd, now,
  };
  const { value, provider } = await generateJSON(route, {
    build: (n) => ({ system: buildPredictSystem(input), user: buildPredictUser(input, n ?? 20) }),
    hint: PREDICT_HINT,
    parse: parsePrediction,
    maxTokens: predictOutputTokens(interests.length, phase),
  });

  // Keep calls on this market's tickers only; mid-day runs make no weekly calls; one call per ticker and horizon.
  const allowed = new Map<string, Interest>();
  for (const it of interests) for (const t of it.tickers) allowed.set(t.toUpperCase(), it);
  const seen = new Set<string>();
  const items: Outlook[] = [];
  for (const c of value.calls) {
    const it = allowed.get(c.ticker.toUpperCase());
    if (!it) continue;
    if (phase === "mid" && c.horizon === "this week") continue;
    const k = `${c.ticker}|${c.horizon}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const raw: Outlook = { interest: it.name, ticker: c.ticker.toUpperCase(), direction: c.direction, confidence: Math.max(0, Math.min(100, Math.round(c.confidence))), horizon: c.horizon, action: c.action, actionTrigger: c.action_trigger, rationale: c.rationale, risks: c.risks };
    const action = alignAction(raw.direction, raw.action, holdings.length > 0);
    const cal = calibrate(raw.confidence, stats);
    const target = targets.get(raw.ticker) ?? dailyTarget(now, raw.ticker);
    const gradeDate = raw.horizon === "this week" ? nthWeekday(target.date, 5) : target.date;
    items.push({
      ...raw,
      action,
      ...(action !== raw.action ? { aiAction: raw.action } : {}),
      aiConfidence: raw.confidence,
      confidence: cal.confidence,
      ...(cal.record ? { record: cal.record } : {}),
      phase,
      madeAt: now.toISOString(),
      gradeDate,
      gradesAt: new Date(closeUtc(gradeDate, exchangeTz(raw.ticker)).getTime() + SETTLE_MINS * 60_000).toISOString(),
    });
  }
  if (!items.length) throw new Error(`${provider} returned no usable calls`);

  const prev = await getJSON<PredictionSet>(predKey(scope));
  const daily = items.filter((o) => o.horizon === "today");
  const weekly = items.filter((o) => o.horizon === "this week");
  const next: PredictionSet = {
    scope, section, market, tz,
    daily: daily.length ? { phase, at: now.toISOString(), provider, date: today, items: daily } : prev?.daily,
    weekly: weekly.length ? { phase, at: now.toISOString(), provider, date: today, endDate: weekEnd, items: weekly } : prev?.weekly,
  };
  await setJSON(predKey(scope), next);
  await recordCalls(items, interests, provider, now, callsKey, { phase, live: new Map([...live].map(([s, v]) => [s, v.chg])) });

  // Call changes and high-confidence calls, for everyone who follows this set.
  if (set) {
    for (const uid of set.uids) await withUser(uid, () => predictionAlerts(daily, prev?.daily?.items ?? [], interests, now)).catch(() => {});
  }
  return { ok: true, note: provider, n: items.length };
}

/* ------------------------------------------------------------- reading */

/** A section's prediction sets for the caller (their interest set for My Interests), translated if cached. */
export async function loadPredictions(section: SectionId, lang?: string): Promise<PredictionSet[]> {
  const hash = section === "interests" ? (await currentInterestSet()).hash : undefined;
  const sets = (await Promise.all(scopesFor(section, hash).map((s) => getJSON<PredictionSet>(predKey(s))))).filter((s): s is PredictionSet => !!s);
  if (!lang || lang === "en" || !isLang(lang)) return sets;
  return Promise.all(
    sets.map(async (s) => {
      const tr = await getJSON<PredictionSet & { v: string }>(trKey(s.scope, lang));
      return tr && tr.v === version(s) ? tr : s;
    }),
  );
}

const translating = new Map<string, Promise<PredictionSet[]>>();

/**
 * Translate a section's predictions into `lang`: every set without a current translation, in one go
 * (chunked), cached per version. `onSpend` runs only when something is actually paid for.
 */
export async function translatePredictions(section: SectionId, lang: string, onSpend?: () => Promise<boolean>): Promise<PredictionSet[]> {
  const sets = await loadPredictions(section);
  if (!isLang(lang) || lang === "en") return sets;
  const key = `${section}:${sets.map((s) => s.scope).join(",")}:${lang}`;
  const pending = translating.get(key);
  if (pending) return pending;
  const job = (async () => {
    const out: PredictionSet[] = [];
    const todo: { orig: PredictionSet; copy: PredictionSet }[] = [];
    for (const s of sets) {
      const tr = await getJSON<PredictionSet & { v: string }>(trKey(s.scope, lang));
      if (tr && tr.v === version(s)) out.push(tr);
      else todo.push({ orig: s, copy: JSON.parse(JSON.stringify(s)) });
    }
    if (!todo.length) return sets.map((s) => out.find((x) => x.scope === s.scope) ?? s);
    // A failed translation isn't retried for 10 minutes (each reader would otherwise pay again).
    const failKey = `tr:pred:${section}:${lang}:failed`;
    const failed = await getJSON<{ at: number }>(failKey);
    if (failed && Date.now() - failed.at < 10 * 60_000) return sets;
    if (onSpend && !(await onSpend())) return sets;
    const slots = todo.flatMap(({ copy }) => outlookSlots([...(copy.daily?.items ?? []), ...(copy.weekly?.items ?? [])]));
    try {
      const provider = await translateSlots(slots, lang, "stock-market prediction notes (triggers, reasons, risks)");
      for (const { orig, copy } of todo) {
        const t = { ...copy, language: lang, translatedFrom: "en", v: version(orig), translatedBy: provider.split(":")[0] };
        await setJSON(trKey(orig.scope, lang), t);
        out.push(t);
      }
    } catch (e) {
      await setJSON(failKey, { at: Date.now() }).catch(() => {});
      throw e;
    }
    return sets.map((s) => out.find((x) => x.scope === s.scope) ?? s);
  })().finally(() => translating.delete(key));
  translating.set(key, job);
  return job;
}

/** Calls as plain text for Ask AI's context. */
export function predictionsAsText(sets: PredictionSet[]): string {
  const lines: string[] = [];
  for (const s of sets) {
    for (const run of [s.daily, s.weekly]) {
      if (!run) continue;
      for (const o of run.items) lines.push(`  - ${o.interest} (${o.ticker}), ${o.horizon === "this week" ? `this week to ${run.endDate}` : `today ${run.date}`}, made ${run.phase === "pre" ? "before market" : "mid-day"} ${run.at.slice(0, 16).replace("T", " ")} UTC: ${o.action}, ${o.direction}, ${o.confidence}% · trigger: ${o.actionTrigger} · risks: ${o.risks}`);
    }
  }
  return lines.join("\n");
}
