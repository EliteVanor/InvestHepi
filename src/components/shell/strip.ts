/**
 * The price strip under the section title, as plain functions (tested in v15test).
 * My Interests shows the user's tickers; shared sections show their own market groups (from the
 * briefing, or from config for briefings made before strips existed) and their macro list.
 * Live quotes win over the briefing's snapshot when `canOverlay` allows (same basis, or a real level
 * replacing an ETF stand-in), so the strip shows the same numbers as the chart sheet.
 */
import { SECTION_MACRO, SECTION_STRIPS, type SharedSection } from "@/lib/config";
import type { LiveQuote } from "@/lib/chart";
import type { Digest, Quote, SectionId } from "@/lib/types";
import { canOverlay } from "../live";

export interface StripPlan {
  groups: { key?: string; symbols: string[] }[];
  macro: string[];
}

export function stripPlan(shown: Digest | null | undefined, tab: SectionId): StripPlan {
  if (!shown) return { groups: [], macro: [] };
  if (tab === "interests") return { groups: [{ symbols: shown.quotes.map((q) => q.symbol) }], macro: (shown.macro ?? []).map((q) => q.symbol) };
  const shared = tab as SharedSection;
  return { groups: shown.strip ?? SECTION_STRIPS[shared], macro: SECTION_MACRO[shared] };
}

export const planSymbols = (p: StripPlan) => [...p.groups.flatMap((g) => g.symbols), ...p.macro];

export function stripRows(shown: Digest | null | undefined, plan: StripPlan, live: Map<string, LiveQuote>) {
  const known = new Map<string, Quote>();
  for (const q of [...(shown?.quotes ?? []), ...(shown?.macro ?? [])]) known.set(q.symbol, q);
  const resolve = (s: string): Quote | null => {
    const q = known.get(s);
    const l = live.get(s);
    // Live wins (same numbers as the chart sheet), with its intraday path for the sparkline.
    const spark = l?.intraday ? l.spark : undefined;
    const flags = l ? { estimatedVia: l.estimatedVia, dailyOnly: l.dailyOnly, session: l.session } : {};
    if (q) return l && canOverlay(q.proxy, l.proxy) ? { ...q, proxy: l.proxy, price: l.price, prevClose: l.prevClose, changePct: l.changePct, stale: false, spark, ...flags } : q;
    if (l) return { symbol: s, price: l.price, prevClose: l.prevClose, changePct: l.changePct, history: l.intraday ? [] : l.spark.map((c, i) => [String(i), c] as [string, number]), spark, source: "yahoo", proxy: l.proxy, ...flags };
    return null;
  };
  const ok = (q: Quote | null): q is Quote => q != null && Number.isFinite(q.price) && Number.isFinite(q.changePct);
  const pick = (syms: string[]) => syms.map(resolve).filter(ok);
  return { groups: plan.groups.map((g) => ({ key: g.key, quotes: pick(g.symbols) })), macro: pick(plan.macro) };
}

/** Tickers for the chart card and the palette: each interest's benchmark first, then the rest (max 14). */
export function chartSymbols(interests: { tickers: string[] }[]): string[] {
  const bench = interests.map((i) => i.tickers[0]).filter(Boolean);
  const rest = interests.flatMap((i) => i.tickers.slice(1));
  const list = [...new Set([...bench, ...rest])];
  return list.length ? list.slice(0, 14) : ["SPY", "QQQ", "SOXX"];
}
