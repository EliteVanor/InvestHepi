/** Pure P&L math, safe to import in the browser. Amounts are never added across currencies (no conversion). */
import { currencyOf } from "./quote-view";
import type { Holding } from "./types";

export interface Position extends Holding {
  price: number;
  value: number;
  dayPnl: number;
  dayPct: number;
  totalPnl: number;
  totalPct: number;
  /** Share of its currency's holdings, 0-100. */
  weight: number;
  currency: string;
}

/** Holdings in one currency and their subtotals. */
export interface CurrencyGroup {
  currency: string;
  positions: Position[];
  value: number;
  dayPnl: number;
  dayPct: number;
  totalPnl: number;
  totalPct: number;
}

export interface PortfolioSummary {
  /** Every priced position, largest first within each currency. */
  positions: Position[];
  /** One subtotal per currency, by currency code. */
  groups: CurrencyGroup[];
  /** Totals: only when every holding is in one currency, NaN otherwise. */
  value: number;
  dayPnl: number;
  dayPct: number;
  totalPnl: number;
  totalPct: number;
}

function subtotal(currency: string, rows: Position[]): CurrencyGroup {
  const value = rows.reduce((s, r) => s + r.value, 0);
  const dayPnl = rows.reduce((s, r) => s + r.dayPnl, 0);
  const cost = rows.reduce((s, r) => s + r.shares * r.cost, 0);
  for (const r of rows) r.weight = value ? (r.value / value) * 100 : 0;
  rows.sort((a, b) => b.value - a.value);
  return { currency, positions: rows, value, dayPnl, dayPct: value - dayPnl ? (dayPnl / (value - dayPnl)) * 100 : 0, totalPnl: value - cost, totalPct: cost ? ((value - cost) / cost) * 100 : 0 };
}

/** Pure P&L math. Holdings without a quote are skipped. */
export function summarize(holdings: Holding[], quotes: { symbol: string; price: number; prevClose: number; currency?: string }[]): PortfolioSummary {
  const q = new Map(quotes.map((x) => [x.symbol, x]));
  const byCurrency = new Map<string, Position[]>();
  for (const h of holdings) {
    const quote = q.get(h.symbol);
    if (!quote || !(h.shares > 0)) continue;
    const { price, prevClose } = quote;
    const currency = quote.currency ?? currencyOf(h.symbol) ?? "USD";
    const value = h.shares * price;
    const cost = h.shares * h.cost;
    const row: Position = { ...h, currency, price, value, dayPnl: h.shares * (price - prevClose), dayPct: prevClose ? ((price - prevClose) / prevClose) * 100 : 0, totalPnl: value - cost, totalPct: cost ? ((value - cost) / cost) * 100 : 0, weight: 0 };
    byCurrency.set(currency, [...(byCurrency.get(currency) ?? []), row]);
  }
  const groups = [...byCurrency.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([c, rows]) => subtotal(c, rows));
  const one = groups.length === 1 ? groups[0] : null;
  return {
    positions: groups.flatMap((g) => g.positions),
    groups,
    value: one ? one.value : groups.length ? NaN : 0,
    dayPnl: one ? one.dayPnl : groups.length ? NaN : 0,
    dayPct: one ? one.dayPct : groups.length ? NaN : 0,
    totalPnl: one ? one.totalPnl : groups.length ? NaN : 0,
    totalPct: one ? one.totalPct : groups.length ? NaN : 0,
  };
}
