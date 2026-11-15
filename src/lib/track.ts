/**
 * Track record: log the AI's direction calls and grade them against real closes.
 *
 * A call targets the NEXT regular session that hasn't opened yet, so every graded call was made
 * before the market could react (no peeking). Re-running before the open overwrites the call with
 * the latest view. "today" calls are graded on that session's close vs the prior close; "this week"
 * calls on the 5th session's close.
 */
import { getQuote } from "./market";
import { getJSON, setJSON } from "./store";
import type { Call, Interest, Outlook } from "./types";

const KEY = "calls";
const MAX_CALLS = 3000;

function etNow(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, mins: Number(p.hour) * 60 + Number(p.minute), weekday: p.weekday as string };
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const isWeekend = (iso: string) => [0, 6].includes(new Date(iso + "T12:00:00Z").getUTCDay());

/** Date of the next regular session that has not opened yet (holidays ignored; grading handles them). */
export function targetSession(now: Date): string {
  const { date, mins } = etNow(now);
  let d = !isWeekend(date) && mins < 570 ? date : addDays(date, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

export async function loadCalls(): Promise<Call[]> {
  return (await getJSON<Call[]>(KEY)) ?? [];
}

export async function recordCalls(outlook: Outlook[], interests: Interest[], provider: string, now = new Date()): Promise<number> {
  if (provider === "rules") return 0; // only grade real analyses
  const tracked = new Map<string, Interest>();
  for (const it of interests) for (const t of it.tickers) tracked.set(t.toUpperCase(), it);
  const date = targetSession(now);
  const calls = await loadCalls();
  let n = 0;
  for (const o of outlook) {
    const it = tracked.get(o.ticker);
    if (!it) continue;
    const horizon = o.horizon === "this week" ? "w" : "d";
    const id = `${date}:${o.ticker}:${horizon}`;
    const call: Call = {
      id,
      date,
      madeAt: now.toISOString(),
      interest: it.name,
      ticker: o.ticker,
      direction: o.direction,
      confidence: o.confidence,
      action: o.action,
      provider,
    };
    const i = calls.findIndex((c) => c.id === id);
    if (i >= 0) calls[i] = call;
    else calls.push(call);
    n++;
  }
  await setJSON(KEY, calls.slice(-MAX_CALLS));
  return n;
}

export async function gradeCalls(now = new Date()): Promise<number> {
  const calls = await loadCalls();
  const pending = calls.filter((c) => c.correct === undefined);
  if (!pending.length) return 0;
  const { date: today, mins } = etNow(now);
  const tickers = [...new Set(pending.map((c) => c.ticker))];
  const quotes = new Map((await Promise.all(tickers.map(getQuote))).filter(Boolean).map((q) => [q!.symbol, q!]));
  let graded = 0;
  for (const c of pending) {
    const q = quotes.get(c.ticker);
    if (!q) continue;
    // Drop today's bar until the session is over (it's a live price, not a close).
    const hist = q.history.filter(([d]) => d < today || (d === today && mins >= 16 * 60 + 15));
    const base = hist.filter(([d]) => d < c.date).at(-1);
    const sessions = hist.filter(([d]) => d >= c.date);
    const need = c.id.endsWith(":w") ? 5 : 1;
    if (!base || sessions.length < need) continue;
    const out = sessions[need - 1];
    const r = ((out[1] - base[1]) / base[1]) * 100;
    c.baseClose = base[1];
    c.outcomeClose = out[1];
    c.returnPct = r;
    c.correct = c.direction === "up" ? r > 0 : c.direction === "down" ? r < 0 : Math.abs(r) < 0.5;
    c.gradedAt = now.toISOString();
    graded++;
  }
  if (graded) await setJSON(KEY, calls);
  return graded;
}

export interface Bucket {
  label: string;
  n: number;
  hits: number;
  avgConfidence: number;
}

export interface TrackStats {
  total: number;
  graded: number;
  hitRate: number | null;
  buckets: Bucket[];
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

export function computeStats(calls: Call[]): TrackStats {
  const graded = calls.filter((c) => c.correct !== undefined);
  const ranges: [string, number, number][] = [
    ["<60%", 0, 60],
    ["60-69%", 60, 70],
    ["70-79%", 70, 80],
    ["80%+", 80, 101],
  ];
  const buckets = ranges.map(([label, lo, hi]) => {
    const b = graded.filter((c) => c.confidence >= lo && c.confidence < hi);
    return {
      label,
      n: b.length,
      hits: b.filter((c) => c.correct).length,
      avgConfidence: b.length ? b.reduce((s, c) => s + c.confidence, 0) / b.length : 0,
    };
  });
  return {
    total: calls.length,
    graded: graded.length,
    hitRate: graded.length ? graded.filter((c) => c.correct).length / graded.length : null,
    buckets,
    recent: [...calls].sort((a, b) => b.madeAt.localeCompare(a.madeAt)).slice(0, 40),
    equity: equityCurve(calls),
    byTicker: [...new Set(graded.map((c) => c.ticker))]
      .map((ticker) => {
        const cs = graded.filter((c) => c.ticker === ticker);
        return { ticker, n: cs.length, hits: cs.filter((c) => c.correct).length, avgReturn: cs.reduce((s, c) => s + strategyReturn(c), 0) / cs.length };
      })
      .sort((a, b) => b.n - a.n)
      .slice(0, 20),
  };
}

/** Short summary fed back into the prompt so the model can recalibrate. */
export function trackRecordText(stats: TrackStats): string {
  if (stats.graded < 5) return `Not enough graded calls yet (${stats.graded}). Default to moderate confidence (55-70).`;
  const lines = [`${stats.graded} graded calls, overall hit rate ${(stats.hitRate! * 100).toFixed(0)}%.`];
  for (const b of stats.buckets) {
    if (b.n) lines.push(`When you said ${b.label}: right ${((b.hits / b.n) * 100).toFixed(0)}% of the time (n=${b.n}).`);
  }
  return lines.join("\n");
}
