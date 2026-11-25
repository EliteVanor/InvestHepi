/**
 * Server-side use of the headline matcher: which headlines name a company (the Vietnamese listing's short
 * name included) and the movers the briefing shows. Kept apart from `mentions.ts` (browser-safe) because it
 * reads the listing, and apart from `pipeline.ts` so the story pipeline can use it without a circular import.
 */
import { mentionsIn } from "./mentions";
import type { NewsItem, Quote } from "./types";
import { vnNameSync } from "./vnlist";

const NO_CLEAR_NEWS = "No clear news in today's headlines.";

/** Whether a headline mentions the company (code as a whole word, names as substrings; accents ignored), the Vietnamese listing's short name included. */
export function headlineMentions(title: string, symbol: string): boolean {
  return mentionsIn(title, symbol, [vnNameSync(symbol.replace(/\.VN$/i, "").replace(/^\^/, "")) ?? ""]);
}

/**
 * Movers with the snapshot's own last-session change (tickers not in the snapshot are dropped), and a
 * reason only when a cited headline actually mentions the company; otherwise "No clear news". The model
 * once explained VHM's move with an "earnings beat" no headline mentioned. Exported for tests.
 */
export function alignMovers<M extends { ticker: string; changePct: number; why: string; sourceIds?: number[] }>(movers: M[], quotes: Quote[], news?: NewsItem[]): M[] {
  const by = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));
  return movers.flatMap((m) => {
    const q = by.get(m.ticker.toUpperCase());
    if (!q) return [];
    const out = { ...m, ticker: q.symbol, changePct: q.changePct };
    if (!news) return [out];
    const backed = (m.sourceIds ?? []).filter((i) => news[i] && headlineMentions(news[i].title, q.symbol));
    return [backed.length ? { ...out, sourceIds: backed } : { ...out, why: NO_CLEAR_NEWS, sourceIds: [] }];
  });
}
