/** Ticker search by symbol or company name: Yahoo's public search endpoint with a local fallback. */
import { ALIASES } from "./tickers";

export interface SearchHit {
  symbol: string;
  name: string;
  type?: string;
  exchange?: string;
}

const TYPES = new Set(["EQUITY", "ETF", "INDEX", "CRYPTOCURRENCY", "FUTURE", "CURRENCY", "MUTUALFUND"]);
const cache = new Map<string, { at: number; hits: SearchHit[] }>();

/** Parse Yahoo's response. Exported for tests. */
export function parseYahooSearch(j: unknown): SearchHit[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const quotes: any[] = (j as any)?.quotes ?? [];
  return quotes
    .filter((q) => q?.symbol && (!q.quoteType || TYPES.has(q.quoteType)) && /^[A-Z0-9.^=\-]{1,12}$/.test(q.symbol))
    .slice(0, 8)
    .map((q) => ({ symbol: q.symbol, name: q.shortname ?? q.longname ?? q.symbol, type: q.quoteType, exchange: q.exchDisp }));
}

export function localSearch(q: string): SearchHit[] {
  const needle = q.toLowerCase();
  return Object.entries(ALIASES)
    .filter(([sym, names]) => sym.toLowerCase().startsWith(needle) || names.some((n) => n.toLowerCase().includes(needle)))
    .slice(0, 8)
    .map(([symbol, names]) => ({ symbol, name: names[0] }));
}

export async function searchTickers(query: string): Promise<SearchHit[]> {
  const q = query.trim().slice(0, 40);
  if (q.length < 1) return [];
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.hits;
  let hits: SearchHit[] = [];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    }).finally(() => clearTimeout(t));
    if (res.ok) hits = parseYahooSearch(await res.json());
  } catch {}
  if (!hits.length) hits = localSearch(q);
  cache.set(key, { at: Date.now(), hits });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return hits;
}
