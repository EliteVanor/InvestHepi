/**
 * Track record: log the AI's prediction calls and grade them against real closes.
 *
 * Calls come from the prediction runs (predictions.ts), two a weekday per market:
 *  - "before market" (phase pre): a daily call graded at that session's close on the ticker's own
 *    exchange, measured from the previous close; plus a weekly call graded at the close of the 5th
 *    weekday counting the prediction day (a holiday there: the previous full session).
 *  - "mid-day" (phase mid): a daily call graded at the same close, measured from the price at the time
 *    of the call (`baseChg`, its move since the previous close, so it works with any price series).
 *    Without a live price that day it's graded from the previous close but not counted in the
 *    headline (`noLiveBase`): headlines could already say how the morning went.
 * A weekday with no session (a holiday) gets "market closed, not graded" (`closed`).
 *
 * Ids: <session>:<ticker>:d (before market), :m (mid-day), :w (weekly). Calls from before v18 have
 * no phase and count as before market (they came from the 08:15 Hanoi run).
 */
import { getQuotes } from "./market";
import { SETTLE_MINS, addDays, closeUtc, dailyTarget, localNow, nthWeekday, sessionClosed, type Phase } from "./markets";
import { exchangeTz } from "./symbols";
import { getJSON, setJSON } from "./store";
import type { Call, Interest, Outlook } from "./types";

export { sessionClosed } from "./markets";

const KEY = "calls";
const MAX_CALLS = 3000;

export const horizonOf = (c: Pick<Call, "id">): "d" | "w" => (c.id.endsWith(":w") ? "w" : "d");
export const phaseOf = (c: Pick<Call, "id" | "phase">): Phase => c.phase ?? (c.id.endsWith(":m") ? "mid" : "pre");
/** The session a call is graded on: its own for daily calls, the 5th weekday counting it for weekly ones. */
export const gradeDateOf = (c: Pick<Call, "id" | "date" | "endDate">) => c.endDate ?? (horizonOf(c) === "w" ? nthWeekday(c.date, 5) : c.date);

/**
 * Date of the next regular session that has not opened yet on the ticker's own exchange (holidays
 * ignored). Calls before v18 targeted this; it's kept for reports and old tests.
 */
export function targetSession(now: Date, ticker = "SPY"): string {
  const t = dailyTarget(now, ticker);
  if (!t.opened) return t.date;
  let d = addDays(t.date, 1);
  while ([0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay())) d = addDays(d, 1);
  return d;
}

export async function loadCalls(key = KEY): Promise<Call[]> {
  return (await getJSON<Call[]>(key)) ?? [];
}

export interface RecordOptions {
  phase?: Phase;
  /** Per ticker: its move since the previous close (%) in the session the call is graded on, when known. */
  live?: Map<string, number>;
}

export async function recordCalls(outlook: Outlook[], interests: Interest[], provider: string, now = new Date(), key = KEY, opts: RecordOptions = {}): Promise<Call[]> {
  if (provider === "rules") return []; // only grade real analyses
  const tracked = new Map<string, Interest>();
  for (const it of interests) for (const t of it.tickers) tracked.set(t.toUpperCase(), it);
  const calls = await loadCalls(key);
  const phase = opts.phase ?? "pre";
  const out: Call[] = [];
  for (const o of outlook) {
    const it = tracked.get(o.ticker);
    if (!it) continue;
    const weekly = o.horizon === "this week";
    const target = dailyTarget(now, o.ticker);
    const id = `${target.date}:${o.ticker}:${weekly ? "w" : phase === "mid" ? "m" : "d"}`;
    const chg = opts.live?.get(o.ticker);
    const call: Call = {
      id,
      date: target.date,
      madeAt: now.toISOString(),
      interest: it.name,
      ticker: o.ticker,
      direction: o.direction,
      confidence: o.aiConfidence ?? o.confidence, // the model's own number: calibration learns from it
      action: o.action,
      provider,
      phase,
      ...(weekly ? { endDate: nthWeekday(target.date, 5) } : {}),
      // Made after the open: measured from the price then; without one it can't count in the headline.
      ...(target.opened ? (chg != null && Number.isFinite(chg) ? { baseChg: Number(chg.toFixed(3)) } : { noLiveBase: true }) : {}),
    };
    const i = calls.findIndex((c) => c.id === id);
    if (i >= 0) calls[i] = call;
    else calls.push(call);
    out.push(call);
  }
  await setJSON(key, calls.slice(-MAX_CALLS));
  return out;
}

/**
 * The clock that decides when a ticker's session is over: its own exchange, except an ETF stand-in
 * (`proxy`), whose bars follow New York hours whatever index it tracks.
 */
const gradeTz = (ticker: string, proxy?: string) => (proxy ? "America/New_York" : exchangeTz(ticker));

/** When a pending call can be graded: its graded session's close plus settling, in UTC. */
export function gradesAfter(c: Pick<Call, "date" | "ticker" | "id"> & { endDate?: string }): string {
  const tz = gradeTz(c.ticker);
  return new Date(closeUtc(gradeDateOf(c), tz).getTime() + SETTLE_MINS * 60_000).toISOString();
}

/**
 * The band a "flat" call must stay inside, in %: about a third of the ticker's typical daily move
 * over the 20 sessions before the call (0.15-1.5%), wider for weekly calls (x sqrt 5). A fixed 0.5%
 * was too loose for a quiet index and too tight for a volatile stock.
 */
export function flatBand(closes: number[], weekly: boolean): number {
  const c = closes.slice(-21);
  const moves = c.slice(1).map((v, i) => Math.abs((v - c[i]) / c[i]) * 100).filter(Number.isFinite);
  const typical = moves.length >= 5 ? moves.reduce((a, b) => a + b, 0) / moves.length : 1;
  const day = Math.min(1.5, Math.max(0.15, typical * 0.35));
  return Number((weekly ? day * Math.sqrt(5) : day).toFixed(2));
}

/** Without a bar for a weekday, it counts as a holiday once a later session exists or two days have passed. */
const CLOSED_AFTER_MS = 48 * 3600_000;

export async function gradeCalls(now = new Date(), key = KEY): Promise<number> {
  const calls = await loadCalls(key);
  // Up/down calls graded before v17 with a move inside the band become "no result" (one-time, cheap).
  let fixed = 0;
  for (const c of calls) if (c.correct !== undefined && c.direction !== "flat" && c.band != null && c.returnPct != null && Math.abs(c.returnPct) < c.band) {
    c.correct = undefined;
    c.noResult = true;
    fixed++;
  }
  const pending = calls.filter((c) => c.correct === undefined && !c.gradedAt && sessionClosed(gradeDateOf(c), gradeTz(c.ticker), now));
  if (!pending.length) {
    if (fixed) await setJSON(key, calls);
    return 0;
  }
  const tickers = [...new Set(pending.map((c) => c.ticker))];
  // Fresh prices only (never the stale fallback), fetched in one batch.
  const quotes = new Map((await getQuotes(tickers, { allowStale: false })).map((q) => [q.symbol, q]));
  let graded = 0;
  for (const c of pending) {
    const q = quotes.get(c.ticker);
    if (!q) continue;
    const tz = gradeTz(c.ticker, q.proxy);
    const end = gradeDateOf(c);
    // Only finished sessions: today's bar is a live price until the exchange has closed.
    const hist = q.history.filter(([d]) => sessionClosed(d, tz, now));
    const before = hist.filter(([d]) => d < c.date);
    const base = before.at(-1);
    if (!base) continue;
    const weekly = horizonOf(c) === "w";
    let out = hist.find(([d]) => d === end);
    if (!out) {
      // No bar for the graded session yet: still being posted, or the market was closed that day.
      const later = hist.some(([d]) => d > end);
      const overdue = now.getTime() - closeUtc(end, tz).getTime() > CLOSED_AFTER_MS;
      if (!later && !overdue) continue;
      const inside = weekly ? hist.filter(([d]) => d >= c.date && d < end).at(-1) : undefined;
      if (!inside) {
        // Daily call on a holiday (or a whole week of them): market closed, not graded.
        c.closed = true;
        c.gradedAt = now.toISOString();
        graded++;
        continue;
      }
      out = inside; // weekly: the previous full session
    }
    const fromPrev = out[1] / base[1];
    // Calls made during the session are measured from the price at that moment.
    const r = (c.baseChg != null ? fromPrev / (1 + c.baseChg / 100) - 1 : fromPrev - 1) * 100;
    // Half a session left moves about sqrt(1/2) of a full one, so its band is narrower.
    const band = Number((flatBand(before.map(([, v]) => v), weekly) * (c.baseChg != null ? Math.SQRT1_2 : 1)).toFixed(2));
    c.baseClose = base[1];
    c.outcomeClose = out[1];
    c.returnPct = r;
    c.band = band;
    if (out[0] !== end) c.gradedOn = out[0];
    // A move inside the band says nothing about an up/down call: graded, but "no result" (not a miss).
    if (c.direction !== "flat" && Math.abs(r) < band) c.noResult = true;
    else c.correct = c.direction === "up" ? r > 0 : c.direction === "down" ? r < 0 : Math.abs(r) < band;
    c.gradedAt = now.toISOString();
    graded++;
  }
  if (graded || fixed) await setJSON(key, calls);
  return graded;
}

/** Local wall-clock of when a call was made, on its exchange's clock (for labels). */
export function madeLocal(c: Pick<Call, "madeAt" | "ticker">): { date: string; mins: number } {
  return localNow(new Date(c.madeAt), exchangeTz(c.ticker));
}

export interface Bucket {
  label: string;
  n: number;
  hits: number;
  avgConfidence: number;
}

/** A hit rate with its 90% range (Wilson): small samples get wide ranges, as they should. */
export interface Rate {
  n: number;
  hits: number;
  rate: number | null;
  low: number | null;
  high: number | null;
}

export interface TrackStats {
  total: number;
  graded: number;
  /** All graded calls (direction and flat), as before. */
  hitRate: number | null;
  /**
   * Up/down calls only: the headline. `base` is how often an "always up" call would have been right
   * on the same calls (markets rise more often than not), `skill` the hit rate minus that.
   */
  direction: Rate & {
    base: number | null;
    skill: number | null;
    noResult: number;
    /** Up/down calls behind the rate (several calls on one ticker and day share one outcome, so `n` counts days). */
    calls: number;
  };
  /** Graded but kept out of every rate: made during the session without a live price that day. */
  uncounted: number;
  /** Weekday calls on a day the market was closed: not graded. */
  closed: number;
  /** Daily calls by when they were made. */
  byPhase: { pre: Rate; mid: Rate };
  /** Flat calls: right when the move stayed inside the ticker's band. */
  flat: Rate;
  /** Mean (confidence - outcome)^2 over graded calls; 0 is perfect, 0.25 is a coin flip at 50%. */
  brier: number | null;
  buckets: Bucket[];
  byHorizon: { d: Rate; w: Rate };
  /** What acting on each action returned: Buy/Add long, Sell/Trim/Avoid the drop avoided, Hold/Wait the move sat out. */
  byAction: { action: string; n: number; avgReturn: number }[];
  /** Calls waiting for their session to close, with when they can be graded. */
  pending: { id: string; ticker: string; date: string; horizon: "d" | "w"; phase: Phase; madeAt: string; direction: string; action: string; confidence: number; gradesAfter: string; gradeDate: string; closesAt: string }[];
  recent: Call[];
  /** Cumulative % return of following every daily call vs holding the same tickers (before costs). */
  equity: { date: string; ai: number; hold: number }[];
  byTicker: { ticker: string; n: number; hits: number; avgReturn: number }[];
}

/** Return of acting on a call: long if up, short/avoid-gain if down, nothing if flat. */
export function strategyReturn(c: Call): number {
  const r = c.returnPct ?? 0;
  return c.direction === "up" ? r : c.direction === "down" ? -r : 0;
}

/** Being in the market: Buy, Add, Hold earn the move. Staying out: Sell, Trim, Avoid, Wait earn the drop avoided. */
const IN = new Set(["BUY", "ADD", "HOLD"]);
/** What the action earned, so positive always means it paid off (Wait before a 2% drop: +2). */
export function actionReturn(c: Call): number {
  const r = c.returnPct ?? 0;
  return IN.has(String(c.action).toUpperCase()) ? r : -r;
}

/** Wilson score interval at 90% (z = 1.645). */
export function rate(n: number, hits: number): Rate {
  if (!n) return { n, hits, rate: null, low: null, high: null };
  const z = 1.645;
  const p = hits / n;
  const d = 1 + (z * z) / n;
  const mid = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { n, hits, rate: p, low: Math.max(0, mid - half), high: Math.min(1, mid + half) };
}

export function equityCurve(calls: Call[]): TrackStats["equity"] {
  // One call per ticker and day: the before-market daily call (mid-day calls start from a different price).
  const daily = calls.filter((c) => c.correct !== undefined && !c.noLiveBase && horizonOf(c) === "d" && phaseOf(c) === "pre");
  const byDate = new Map<string, Call[]>();
  for (const c of daily) byDate.set(c.date, [...(byDate.get(c.date) ?? []), c]);
  let ai = 1;
  let hold = 1;
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, cs]) => {
      // Equal weight across that day's calls.
      ai *= 1 + cs.reduce((s, c) => s + strategyReturn(c), 0) / cs.length / 100;
      hold *= 1 + cs.reduce((s, c) => s + (c.returnPct ?? 0), 0) / cs.length / 100;
      return { date, ai: (ai - 1) * 100, hold: (hold - 1) * 100 };
    });
}

const RANGES: [string, number, number][] = [
  ["<60%", 0, 60],
  ["60-69%", 60, 70],
  ["70-79%", 70, 80],
  ["80%+", 80, 101],
];

/**
 * Rate over independent outcomes: calls on the same ticker, horizon and graded session share one
 * outcome (the before-market and mid-day calls on one day), so each such group counts once, with the
 * share of its calls that were right. Exported for tests.
 */
export function rateByDay(cs: Call[]): Rate & { base: number | null } {
  const groups = new Map<string, Call[]>();
  for (const c of cs) {
    const k = `${c.ticker}|${horizonOf(c)}|${gradeDateOf(c)}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const g = [...groups.values()];
  const share = (xs: Call[], f: (c: Call) => boolean) => xs.filter(f).length / xs.length;
  const hits = g.reduce((s, xs) => s + share(xs, (c) => !!c.correct), 0);
  const up = g.reduce((s, xs) => s + share(xs, (c) => (c.returnPct ?? 0) > 0), 0);
  const r = rate(g.length, hits);
  return { ...r, hits: Number(hits.toFixed(2)), base: g.length ? up / g.length : null };
}

export function computeStats(calls: Call[]): TrackStats {
  // Counted: graded right or wrong, with a clean starting price.
  const graded = calls.filter((c) => c.correct !== undefined && !c.noLiveBase);
  const hits = (cs: Call[]) => cs.filter((c) => c.correct).length;
  const directional = graded.filter((c) => c.direction !== "flat");
  const flat = graded.filter((c) => c.direction === "flat");
  const dir = rateByDay(directional);
  const buckets = RANGES.map(([label, lo, hi]) => {
    const b = graded.filter((c) => c.confidence >= lo && c.confidence < hi);
    return { label, n: b.length, hits: hits(b), avgConfidence: b.length ? b.reduce((s, c) => s + c.confidence, 0) / b.length : 0 };
  });
  const actions = [...new Set(graded.map((c) => String(c.action).toUpperCase()))];
  const pending = calls
    .filter((c) => c.correct === undefined && !c.gradedAt)
    .map((c) => ({ id: c.id, ticker: c.ticker, date: c.date, horizon: horizonOf(c), phase: phaseOf(c), madeAt: c.madeAt, direction: c.direction, action: c.action, confidence: c.confidence, gradesAfter: gradesAfter(c), gradeDate: gradeDateOf(c), closesAt: closeUtc(gradeDateOf(c), gradeTz(c.ticker)).toISOString() }))
    .sort((a, b) => a.gradesAfter.localeCompare(b.gradesAfter));
  const daily = graded.filter((c) => horizonOf(c) === "d");
  const of = (cs: Call[]) => rate(cs.length, hits(cs));
  const shown = calls.filter((c) => c.gradedAt);
  return {
    total: calls.length,
    graded: graded.length,
    hitRate: graded.length ? hits(graded) / graded.length : null,
    direction: { ...dir, skill: dir.rate != null && dir.base != null ? dir.rate - dir.base : null, noResult: calls.filter((c) => c.noResult).length, calls: directional.length },
    uncounted: calls.filter((c) => c.noLiveBase && c.gradedAt && !c.closed).length,
    closed: calls.filter((c) => c.closed).length,
    flat: of(flat),
    brier: graded.length ? graded.reduce((s, c) => s + (c.confidence / 100 - (c.correct ? 1 : 0)) ** 2, 0) / graded.length : null,
    buckets,
    byHorizon: { d: of(daily), w: of(graded.filter((c) => horizonOf(c) === "w")) },
    byPhase: { pre: of(daily.filter((c) => phaseOf(c) === "pre")), mid: of(daily.filter((c) => phaseOf(c) === "mid")) },
    byAction: actions
      .map((action) => {
        const cs = graded.filter((c) => String(c.action).toUpperCase() === action);
        return { action, n: cs.length, avgReturn: cs.reduce((s, c) => s + actionReturn(c), 0) / cs.length };
      })
      .sort((a, b) => b.n - a.n),
    pending: pending.slice(0, 60),
    recent: shown.sort((a, b) => (b.gradedAt ?? "").localeCompare(a.gradedAt ?? "") || b.date.localeCompare(a.date)).slice(0, 40),
    equity: equityCurve(calls),
    byTicker: [...new Set(graded.map((c) => c.ticker))]
      .map((ticker) => {
        const cs = graded.filter((c) => c.ticker === ticker);
        return { ticker, n: cs.length, hits: hits(cs), avgReturn: cs.reduce((s, c) => s + strategyReturn(c), 0) / cs.length };
      })
      .sort((a, b) => b.n - a.n)
      .slice(0, 20),
  };
}

/** A confidence band needs this many graded calls before its record moves the shown confidence. */
export const CALIBRATE_MIN = 20;

/**
 * Confidence pulled toward what really happened: once the AI's calls at this level have a record
 * (20+ graded), the shown number moves toward that hit rate, more as the record grows
 * (weight n / (n + 20)). Below that, the AI's own number stands.
 */
export function calibrate(confidence: number, stats: Pick<TrackStats, "buckets">): { confidence: number; record: { n: number; hits: number } | null } {
  const b = stats.buckets.find((x, i) => confidence >= RANGES[i][1] && confidence < RANGES[i][2]);
  if (!b || !b.n) return { confidence, record: null };
  const record = { n: b.n, hits: b.hits };
  if (b.n < CALIBRATE_MIN) return { confidence, record };
  const shift = ((b.hits / b.n) * 100 - b.avgConfidence) * (b.n / (b.n + CALIBRATE_MIN));
  return { confidence: Math.round(Math.min(95, Math.max(5, confidence + shift))), record };
}

const pct = (x: number | null) => (x == null ? "n/a" : `${(x * 100).toFixed(0)}%`);

/** The record fed back into the prompt, so each run can learn from the last ones. */
export function trackRecordText(stats: TrackStats): string {
  if (stats.graded < 5) return `Not enough graded calls yet (${stats.graded}). Default to moderate confidence (55-70).`;
  const d = stats.direction;
  const lines = [`${stats.graded} graded calls.`];
  if (d.noResult) lines.push(`${d.noResult} up/down calls moved less than the ticker's usual range and were not counted.`);
  if (d.n) lines.push(`Up/down calls: right ${pct(d.rate)} (${d.calls} calls over ${d.n} independent ticker-days, likely range ${pct(d.low)}-${pct(d.high)}); "always up" would have been right ${pct(d.base)}, so your edge is ${d.skill == null ? "n/a" : `${d.skill >= 0 ? "+" : ""}${(d.skill * 100).toFixed(0)} pts`}.`);
  if (stats.flat.n) lines.push(`Flat calls: right ${pct(stats.flat.rate)} (n=${stats.flat.n}).`);
  for (const b of stats.buckets) if (b.n) lines.push(`When you said ${b.label} (avg ${b.avgConfidence.toFixed(0)}): right ${pct(b.hits / b.n)} (n=${b.n}).`);
  const h = stats.byHorizon;
  if (h.d.n && h.w.n) lines.push(`Today calls right ${pct(h.d.rate)} (n=${h.d.n}); this-week calls right ${pct(h.w.rate)} (n=${h.w.n}).`);
  const ph = stats.byPhase;
  if (ph?.pre.n && ph.mid.n) lines.push(`Daily calls made before the open right ${pct(ph.pre.rate)} (n=${ph.pre.n}); made at mid-day right ${pct(ph.mid.rate)} (n=${ph.mid.n}).`);
  const act = stats.byAction.filter((a) => a.n >= 3).map((a) => `${a.action} ${a.avgReturn >= 0 ? "+" : ""}${a.avgReturn.toFixed(2)}% avg (n=${a.n})`);
  if (act.length) lines.push(`Average result of each action: ${act.join("; ")}.`);
  const tick = stats.byTicker.filter((t) => t.n >= 3).slice(0, 8).map((t) => `${t.ticker} ${t.hits}/${t.n}`);
  if (tick.length) lines.push(`Per ticker (right/graded): ${tick.join(", ")}.`);
  lines.push("Use this: lower confidence where your record at that level or on that ticker is weak, raise it only where the record is strong and the sample is large. If you have no edge over \"always up\", say so in the rationale.");
  return lines.join("\n");
}
