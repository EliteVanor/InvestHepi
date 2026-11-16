/**
 * Market mood gauge: a transparent 0-100 composite (0 = extreme fear, 100 = extreme greed)
 * built from data the app already fetches. Inspired by CNN's Fear & Greed index, whose exact
 * formulas aren't public; this is our own version, and every part is shown to the user.
 */
import type { Technicals } from "./technicals";
import type { Quote } from "./types";

export type MoodLabel = "extreme-fear" | "fear" | "neutral" | "greed" | "extreme-greed";

export interface MoodPart {
  key: "momentum" | "strength" | "breadth" | "volatility" | "safehaven";
  score: number;
  detail: string;
}

export interface MoodGauge {
  score: number;
  label: MoodLabel;
  parts: MoodPart[];
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

export function moodLabel(score: number): MoodLabel {
  if (score < 25) return "extreme-fear";
  if (score < 45) return "fear";
  if (score <= 55) return "neutral";
  if (score <= 75) return "greed";
  return "extreme-greed";
}

function ret(q: Quote | undefined, back: number): number | undefined {
  const h = q?.history ?? [];
  if (h.length <= back) return undefined;
  const base = h[h.length - 1 - back][1];
  return base ? ((q!.price - base) / base) * 100 : undefined;
}

/**
 * `spy` is the section's benchmark technicals (SPY, ACWI or the VN-Index), `sectors` the breadth set
 * (US sectors, world indexes or Vietnamese large caps), `benchSymbol` the benchmark's quote symbol.
 */
export function computeMood(input: { spy?: Technicals; sectors: Quote[]; macro: Quote[]; quotes: Quote[]; benchSymbol?: string }): MoodGauge | undefined {
  const parts: MoodPart[] = [];
  const { spy } = input;

  // 1. Momentum: S&P 500 vs its 125-day average (±10% maps to 0/100).
  if (spy?.sma125) {
    const d = ((spy.price - spy.sma125) / spy.sma125) * 100;
    parts.push({ key: "momentum", score: clamp(50 + d * 5), detail: `${pct(d)} vs 125d` });
  }
  // 2. Strength: S&P 500 RSI-14 (30 → 0, 70 → 100).
  if (spy?.rsi14 != null) parts.push({ key: "strength", score: clamp(((spy.rsi14 - 30) / 40) * 100), detail: `RSI ${spy.rsi14.toFixed(0)}` });

  // 3. Breadth: share of sectors rising today and over 5 days.
  if (input.sectors.length >= 6) {
    const upToday = input.sectors.filter((s) => s.changePct > 0).length / input.sectors.length;
    const five = input.sectors.map((s) => ret(s, 5)).filter((x): x is number => x != null);
    const up5 = five.length ? five.filter((x) => x > 0).length / five.length : upToday;
    parts.push({ key: "breadth", score: clamp(((upToday + up5) / 2) * 100), detail: `${Math.round(upToday * input.sectors.length)}/${input.sectors.length} up` });
  }
  // 4. Volatility: VIX level (12 → 100, 30 → 0) blended with VIX vs its 1-month average.
  const vix = input.macro.find((m) => m.symbol === "^VIX");
  if (vix) {
    const level = clamp(((30 - vix.price) / 18) * 100);
    const hist = vix.history.map((h) => h[1]);
    const avg = hist.length >= 5 ? hist.reduce((a, b) => a + b, 0) / hist.length : undefined;
    const relative = avg ? clamp(50 - (vix.price / avg - 1) * 250) : level;
    parts.push({ key: "volatility", score: (level + relative) / 2, detail: `VIX ${vix.price.toFixed(1)}` });
  }
  // 5. Safe-haven demand: stocks vs gold over ~1 month (±10 points maps to 0/100).
  const spyQ = input.quotes.find((q) => q.symbol === (input.benchSymbol ?? "SPY"));
  const gold = input.macro.find((m) => m.symbol === "GC=F");
  const back = Math.min((spyQ?.history.length ?? 1) - 1, (gold?.history.length ?? 1) - 1, 20);
  const rs = back >= 5 ? ret(spyQ, back) : undefined;
  const rg = back >= 5 ? ret(gold, back) : undefined;
  if (rs != null && rg != null) parts.push({ key: "safehaven", score: clamp(50 + (rs - rg) * 5), detail: `${pct(rs - rg)} vs gold` });

  if (parts.length < 3) return undefined;
  const score = Math.round(parts.reduce((a, p) => a + p.score, 0) / parts.length);
  return { score, label: moodLabel(score), parts: parts.map((p) => ({ ...p, score: Math.round(p.score) })) };
}

export function moodAsText(g?: MoodGauge): string {
  if (!g) return "(unavailable)";
  return `${g.score}/100 (${g.label.replace("-", " ")}): ${g.parts.map((p) => `${p.key} ${p.score} [${p.detail}]`).join(", ")}`;
}
