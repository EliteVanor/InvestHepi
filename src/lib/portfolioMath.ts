/** Pure P&L math, safe to import in the browser. */
import type { Holding } from "./types";

export interface Position extends Holding {
  price: number;
  value: number;
  dayPnl: number;
  dayPct: number;
  totalPnl: number;
  totalPct: number;
  weight: number; // 0-100
}

export interface PortfolioSummary {
  positions: Position[];
  value: number;
  dayPnl: number;
  dayPct: number;
  totalPnl: number;
  totalPct: number;
}

/** Pure P&L math. Holdings without a quote are skipped. */
export function summarize(holdings: Holding[], quotes: { symbol: string; price: number; prevClose: number }[]): PortfolioSummary {
  const q = new Map(quotes.map((x) => [x.symbol, x]));
  const rows = holdings
    .filter((h) => q.has(h.symbol) && h.shares > 0)
    .map((h) => {
      const { price, prevClose } = q.get(h.symbol)!;
      const value = h.shares * price;
      const cost = h.shares * h.cost;
      const dayPnl = h.shares * (price - prevClose);
      return { ...h, price, value, dayPnl, dayPct: prevClose ? ((price - prevClose) / prevClose) * 100 : 0, totalPnl: value - cost, totalPct: cost ? ((value - cost) / cost) * 100 : 0, weight: 0 };
    });
  const value = rows.reduce((s, r) => s + r.value, 0);
  const dayPnl = rows.reduce((s, r) => s + r.dayPnl, 0);
  const cost = rows.reduce((s, r) => s + r.shares * r.cost, 0);
  for (const r of rows) r.weight = value ? (r.value / value) * 100 : 0;
  rows.sort((a, b) => b.value - a.value);
  return { positions: rows, value, dayPnl, dayPct: value - dayPnl ? (dayPnl / (value - dayPnl)) * 100 : 0, totalPnl: value - cost, totalPct: cost ? ((value - cost) / cost) * 100 : 0 };
}
