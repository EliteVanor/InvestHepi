/**
 * Technical context computed from daily bars: moving averages, RSI, support/resistance,
 * typical daily move. Pure functions; `getTechnicals` fetches 1-year history (cached 1h).
 * These are context for the reader and the AI, not trading signals on their own.
 */
import { getChart, type Bar } from "./chart";

export interface Technicals {
  symbol: string;
  price: number;
  sma20?: number;
  sma50?: number;
  sma125?: number;
  sma200?: number;
  rsi14?: number;
  /** Lowest low / highest high of the previous 20 sessions (excludes the latest bar). */
  support20?: number;
  resistance20?: number;
  high52?: number;
  low52?: number;
  /** Average true range (14) as % of price: the typical daily swing. */
  atrPct?: number;
  chg5d?: number;
  chg1m?: number;
  chg3m?: number;
  trend: "up" | "down" | "sideways";
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function sma(closes: number[], n: number): number | undefined {
  return closes.length >= n ? mean(closes.slice(-n)) : undefined;
}

/** Wilder's RSI. */
export function rsi(closes: number[], n = 14): number | undefined {
  if (closes.length <= n) return undefined;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

export function atrPct(bars: Bar[], n = 14): number | undefined {
  if (bars.length <= n) return undefined;
  const trs: number[] = [];
  for (let i = bars.length - n; i < bars.length; i++) {
    const b = bars[i];
    const pc = bars[i - 1].c;
    trs.push(Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)));
  }
  const last = bars.at(-1)!.c;
  return last ? (mean(trs) / last) * 100 : undefined;
}

const pctFrom = (closes: number[], back: number) => (closes.length > back ? ((closes.at(-1)! - closes.at(-1 - back)!) / closes.at(-1 - back)!) * 100 : undefined);

export function computeTechnicals(symbol: string, bars: Bar[], livePrice?: number): Technicals | null {
  if (bars.length < 15) return null;
  const closes = bars.map((b) => b.c);
  const price = livePrice ?? closes.at(-1)!;
  const prior = bars.slice(-21, -1);
  const year = bars.slice(-252);
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  let trend: Technicals["trend"] = "sideways";
  const slow = s200 ?? s50;
  const fast = s200 ? s50 : s20;
  if (fast && slow) {
    if (price > fast && fast > slow) trend = "up";
    else if (price < fast && fast < slow) trend = "down";
  }
  return {
    symbol,
    price,
    sma20: s20,
    sma50: s50,
    sma125: sma(closes, 125),
    sma200: s200,
    rsi14: rsi(closes),
    support20: prior.length ? Math.min(...prior.map((b) => b.l)) : undefined,
    resistance20: prior.length ? Math.max(...prior.map((b) => b.h)) : undefined,
    high52: Math.max(...year.map((b) => b.h)),
    low52: Math.min(...year.map((b) => b.l)),
    atrPct: atrPct(bars),
    chg5d: pctFrom(closes, 5),
    chg1m: pctFrom(closes, 21),
    chg3m: pctFrom(closes, 63),
    trend,
  };
}

export async function getTechnicals(symbols: string[]): Promise<Record<string, Technicals>> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()))].slice(0, 16);
  const out: Record<string, Technicals> = {};
  await Promise.all(
    uniq.map(async (s) => {
      try {
        const d = await getChart(s, "1y");
        const t = computeTechnicals(s, d.bars, d.price);
        if (t) out[s] = t;
      } catch {}
    }),
  );
  return out;
}

const f = (n: number | undefined, d = 2) => (n == null ? "n/a" : n.toFixed(d));
const rel = (price: number, level?: number) => (level ? `${price >= level ? "+" : ""}${(((price - level) / level) * 100).toFixed(1)}%` : "n/a");

export function technicalsAsText(t: Record<string, Technicals>): string {
  const rows = Object.values(t);
  if (!rows.length) return "(technical data unavailable)";
  return rows
    .map(
      (x) =>
        `${x.symbol}: trend ${x.trend}; vs 20d ${rel(x.price, x.sma20)}, 50d ${rel(x.price, x.sma50)}, 200d ${rel(x.price, x.sma200)}; RSI ${f(x.rsi14, 0)}; 20d range ${f(x.support20)}-${f(x.resistance20)}; ${rel(x.price, x.high52)} from 52w high; typical day ±${f(x.atrPct, 1)}%`,
    )
    .join("\n");
}
