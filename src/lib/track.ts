/**
 * Track record: log the AI's direction calls and grade them against real closes.
 *
 * A call targets the NEXT regular session that hasn't opened yet, so every graded call was made
 * before the market could react (no peeking). Re-running before the open overwrites the call with
 * the latest view. "today" calls are graded on that session's close vs the prior close; "this week"
 * calls on the 5th session's close.
 */
import { getQuotes } from "./market";
import { exchangeTz } from "./symbols";
import { getJSON, setJSON } from "./store";
import type { Call, Interest, Outlook } from "./types";

const KEY = "calls";
const MAX_CALLS = 3000;

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const isWeekend = (iso: string) => [0, 6].includes(new Date(iso + "T12:00:00Z").getUTCDay());

/** Local opening time (minutes after midnight) of each exchange time zone. */
const OPEN_MINS: Record<string, number> = {
  "America/New_York": 570, // 9:30
  "Asia/Ho_Chi_Minh": 540, // HOSE 9:00
  "Asia/Tokyo": 540,
  "Asia/Seoul": 540,
  "Asia/Hong_Kong": 570,
  "Asia/Shanghai": 570,
  "Asia/Kolkata": 555,
  "Europe/London": 480,
  "Europe/Berlin": 540,
  "Europe/Paris": 540,
};

function localNow(d: Date, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, mins: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/**
 * Date of the next regular session that has not opened yet ON THE TICKER'S OWN EXCHANGE (holidays
 * ignored; grading handles them). Using New York's clock for everything let a Vietnam briefing written
 * at 11:00 in Hanoi be graded on a HOSE session that was already half over.
 */
export function targetSession(now: Date, ticker = "SPY"): string {
  const tz = exchangeTz(ticker);
  const { date, mins } = localNow(now, tz);
  let d = !isWeekend(date) && mins < (OPEN_MINS[tz] ?? 570) ? date : addDays(date, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

export async function loadCalls(key = KEY): Promise<Call[]> {
  return (await getJSON<Call[]>(key)) ?? [];
}

export async function recordCalls(outlook: Outlook[], interests: Interest[], provider: string, now = new Date(), key = KEY): Promise<number> {
  if (provider === "rules") return 0; // only grade real analyses
  const tracked = new Map<string, Interest>();
  for (const it of interests) for (const t of it.tickers) tracked.set(t.toUpperCase(), it);
  const calls = await loadCalls(key);
  let n = 0;
  for (const o of outlook) {
    const it = tracked.get(o.ticker);
    if (!it) continue;
    const date = targetSession(now, o.ticker);
    const horizon = o.horizon === "this week" ? "w" : "d";
    const id = `${date}:${o.ticker}:${horizon}`;
    const call: Call = {
      id,
      date,
      madeAt: now.toISOString(),
      interest: it.name,
      ticker: o.ticker,
      direction: o.direction,
      confidence: o.aiConfidence ?? o.confidence, // the model's own number: calibration learns from it
      action: o.action,
      provider,
    };
    const i = calls.findIndex((c) => c.id === id);
    if (i >= 0) calls[i] = call;
    else calls.push(call);
    n++;
  }
  await setJSON(key, calls.slice(-MAX_CALLS));
  return n;
}

/** Regular close on each exchange, minutes after local midnight (holidays: no bar, so nothing grades). */
const CLOSE_MINS: Record<string, number> = {
  "America/New_York": 960, // 16:00
  "Asia/Ho_Chi_Minh": 885, // HOSE 14:45 (ATC)
  "Asia/Tokyo": 930,
  "Asia/Seoul": 930,
  "Asia/Hong_Kong": 960,
  "Asia/Shanghai": 900,
  "Asia/Kolkata": 930,
  "Europe/London": 990,
  "Europe/Berlin": 1050,
  "Europe/Paris": 1050,
};
/** Closing prints settle a few minutes after the bell. */
const SETTLE_MINS = 15;

/**
 * The clock that decides when a ticker's session is over: its own exchange, except an ETF stand-in
 * (`proxy`), whose bars follow New York hours whatever index it tracks.
 */
const gradeTz = (ticker: string, proxy?: string) => (proxy ? "America/New_York" : exchangeTz(ticker));

/** Whether the session on `date` is over on that clock. */
export function sessionClosed(date: string, tz: string, now: Date): boolean {
  const { date: today, mins } = localNow(now, tz);
  return date < today || (date === today && mins >= (CLOSE_MINS[tz] ?? 960) + SETTLE_MINS);
}

/** UTC time of a local wall-clock time in `tz` (for "graded after ..." hints). */
function zonedToUtc(date: string, mins: number, tz: string): Date {
  const guess = new Date(`${date}T00:00:00Z`).getTime() + mins * 60_000;
  const l = localNow(new Date(guess), tz);
  const shown = new Date(`${l.date}T00:00:00Z`).getTime() + l.mins * 60_000;
  return new Date(guess - (shown - guess));
}

/** When a pending call can be graded: its last session's close plus settling, in UTC. */
export function gradesAfter(c: Pick<Call, "date" | "ticker" | "id">): string {
  const tz = gradeTz(c.ticker);
  let d = c.date;
  for (let i = 1; i < (c.id.endsWith(":w") ? 5 : 1); ) {
    d = addDays(d, 1);
    if (!isWeekend(d)) i++;
  }
  return zonedToUtc(d, (CLOSE_MINS[tz] ?? 960) + SETTLE_MINS, tz).toISOString();
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

export async function gradeCalls(now = new Date(), key = KEY): Promise<number> {
  const calls = await loadCalls(key);
  // Up/down calls graded before v17 with a move inside the band become "no result" (one-time, cheap).
  let fixed = 0;
  for (const c of calls) if (c.correct !== undefined && c.direction !== "flat" && c.band != null && c.returnPct != null && Math.abs(c.returnPct) < c.band) {
    c.correct = undefined;
    c.noResult = true;
    fixed++;
  }
  const pending = calls.filter((c) => c.correct === undefined && !c.gradedAt && sessionClosed(c.date, gradeTz(c.ticker), now));
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
    // Only finished sessions: today's bar is a live price until the exchange has closed.
    const hist = q.history.filter(([d]) => sessionClosed(d, tz, now));
    const before = hist.filter(([d]) => d < c.date);
    const base = before.at(-1);
    const sessions = hist.filter(([d]) => d >= c.date);
    const weekly = c.id.endsWith(":w");
    const need = weekly ? 5 : 1;
    if (!base || sessions.length < need) continue;
    const out = sessions[need - 1];
    const r = ((out[1] - base[1]) / base[1]) * 100;
    const band = flatBand(before.map(([, v]) => v), weekly);
    c.baseClose = base[1];
    c.outcomeClose = out[1];
    c.returnPct = r;
    c.band = band;
    // A move inside the band says nothing about an up/down call: graded, but "no result" (not a miss).
    if (c.direction !== "flat" && Math.abs(r) < band) c.noResult = true;
    else c.correct = c.direction === "up" ? r > 0 : c.direction === "down" ? r < 0 : Math.abs(r) < band;
    c.gradedAt = now.toISOString();
    graded++;
  }
  if (graded || fixed) await setJSON(key, calls);
  return graded;
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
  direction: Rate & { base: number | null; skill: number | null; noResult: number };
  /** Flat calls: right when the move stayed inside the ticker's band. */
  flat: Rate;
  /** Mean (confidence - outcome)^2 over graded calls; 0 is perfect, 0.25 is a coin flip at 50%. */
  brier: number | null;
  buckets: Bucket[];
  byHorizon: { d: Rate; w: Rate };
  /** What acting on each action returned: Buy/Add long, Sell/Trim/Avoid the drop avoided, Hold/Wait the move sat out. */
  byAction: { action: string; n: number; avgReturn: number }[];
  /** Calls waiting for their session to close, with when they can be graded. */
  pending: { id: string; ticker: string; date: string; horizon: "d" | "w"; direction: string; action: string; confidence: number; gradesAfter: string }[];
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
  const daily = calls.filter((c) => c.correct !== undefined && c.id.endsWith(":d"));
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

export function computeStats(calls: Call[]): TrackStats {
  const graded = calls.filter((c) => c.correct !== undefined);
  const hits = (cs: Call[]) => cs.filter((c) => c.correct).length;
  const directional = graded.filter((c) => c.direction !== "flat");
  const flat = graded.filter((c) => c.direction === "flat");
  const dir = rate(directional.length, hits(directional));
  const base = directional.length ? directional.filter((c) => (c.returnPct ?? 0) > 0).length / directional.length : null;
  const buckets = RANGES.map(([label, lo, hi]) => {
    const b = graded.filter((c) => c.confidence >= lo && c.confidence < hi);
    return { label, n: b.length, hits: hits(b), avgConfidence: b.length ? b.reduce((s, c) => s + c.confidence, 0) / b.length : 0 };
  });
  const actions = [...new Set(graded.map((c) => String(c.action).toUpperCase()))];
  const pending = calls
    .filter((c) => c.correct === undefined && !c.gradedAt)
    .map((c) => ({ id: c.id, ticker: c.ticker, date: c.date, horizon: (c.id.endsWith(":w") ? "w" : "d") as "d" | "w", direction: c.direction, action: c.action, confidence: c.confidence, gradesAfter: gradesAfter(c) }))
    .sort((a, b) => a.gradesAfter.localeCompare(b.gradesAfter));
  return {
    total: calls.length,
    graded: graded.length,
    hitRate: graded.length ? hits(graded) / graded.length : null,
    direction: { ...dir, base, skill: dir.rate != null && base != null ? dir.rate - base : null, noResult: calls.filter((c) => c.noResult).length },
    flat: rate(flat.length, hits(flat)),
    brier: graded.length ? graded.reduce((s, c) => s + (c.confidence / 100 - (c.correct ? 1 : 0)) ** 2, 0) / graded.length : null,
    buckets,
    byHorizon: {
      d: rate(graded.filter((c) => c.id.endsWith(":d")).length, hits(graded.filter((c) => c.id.endsWith(":d")))),
      w: rate(graded.filter((c) => c.id.endsWith(":w")).length, hits(graded.filter((c) => c.id.endsWith(":w")))),
    },
    byAction: actions
      .map((action) => {
        const cs = graded.filter((c) => String(c.action).toUpperCase() === action);
        return { action, n: cs.length, avgReturn: cs.reduce((s, c) => s + actionReturn(c), 0) / cs.length };
      })
      .sort((a, b) => b.n - a.n),
    pending: pending.slice(0, 60),
    recent: [...graded, ...calls.filter((c) => c.noResult)].sort((a, b) => (b.gradedAt ?? "").localeCompare(a.gradedAt ?? "") || b.date.localeCompare(a.date)).slice(0, 40),
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
  if (d.n) lines.push(`Up/down calls: right ${pct(d.rate)} (n=${d.n}, likely range ${pct(d.low)}-${pct(d.high)}); "always up" would have been right ${pct(d.base)}, so your edge is ${d.skill == null ? "n/a" : `${d.skill >= 0 ? "+" : ""}${(d.skill * 100).toFixed(0)} pts`}.`);
  if (stats.flat.n) lines.push(`Flat calls: right ${pct(stats.flat.rate)} (n=${stats.flat.n}).`);
  for (const b of stats.buckets) if (b.n) lines.push(`When you said ${b.label} (avg ${b.avgConfidence.toFixed(0)}): right ${pct(b.hits / b.n)} (n=${b.n}).`);
  const h = stats.byHorizon;
  if (h.d.n && h.w.n) lines.push(`Today calls right ${pct(h.d.rate)} (n=${h.d.n}); this-week calls right ${pct(h.w.rate)} (n=${h.w.n}).`);
  const act = stats.byAction.filter((a) => a.n >= 3).map((a) => `${a.action} ${a.avgReturn >= 0 ? "+" : ""}${a.avgReturn.toFixed(2)}% avg (n=${a.n})`);
  if (act.length) lines.push(`Average result of each action: ${act.join("; ")}.`);
  const tick = stats.byTicker.filter((t) => t.n >= 3).slice(0, 8).map((t) => `${t.ticker} ${t.hits}/${t.n}`);
  if (tick.length) lines.push(`Per ticker (right/graded): ${tick.join(", ")}.`);
  lines.push("Use this: lower confidence where your record at that level or on that ticker is weak, raise it only where the record is strong and the sample is large. If you have no edge over \"always up\", say so in the rationale.");
  return lines.join("\n");
}
