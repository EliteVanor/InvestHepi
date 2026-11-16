/**
 * Stock search, Apple Stocks style: one box for US, Vietnamese and global stocks, ETFs and indexes.
 *   - Vietnamese listings (VNDirect, accent-insensitive: "vinamilk", "hoa phat", "HPG")
 *   - built-in index names ("S&P 500", "VN30", "Nikkei")
 *   - Yahoo's global search (through the shared rate-limit guard in yahoo.ts)
 *   - a built-in list of big US names if Yahoo is unavailable
 * Results are ranked by match quality; Vietnamese results get a boost for Vietnamese readers or
 * queries typed with Vietnamese accents.
 */
import { SYMBOL_LABELS } from "./symbols";
import { ALIASES } from "./tickers";
import { fold, scoreVn, searchVn } from "./vnlist";
import { yahooJson } from "./yahoo";

export interface SearchHit {
  symbol: string;
  name: string;
  type?: string;
  exchange?: string;
  /** Secondary line: the full legal name for Vietnamese stocks. */
  sub?: string;
  region?: "vn" | "intl";
}

const TYPES = new Set(["EQUITY", "ETF", "INDEX", "CRYPTOCURRENCY", "CURRENCY", "MUTUALFUND"]);
const cache = new Map<string, { at: number; hits: SearchHit[] }>();
const MAX = 12;

/** Parse Yahoo's response. Exported for tests. */
export function parseYahooSearch(j: unknown): SearchHit[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const quotes: any[] = (j as any)?.quotes ?? [];
  return quotes
    .filter((q) => q?.symbol && /^[A-Z0-9.^=\-]{1,12}$/.test(q.symbol))
    // Futures only when they're ones we name (oil, gold); Yahoo otherwise lists odd single-stock futures.
    .filter((q) => !q.quoteType || TYPES.has(q.quoteType) || (q.quoteType === "FUTURE" && SYMBOL_LABELS[q.symbol]))
    .slice(0, 8)
    .map((q) => ({ symbol: q.symbol, name: q.shortname ?? q.longname ?? q.symbol, type: q.quoteType, exchange: q.exchDisp, region: q.symbol.endsWith(".VN") ? "vn" : "intl" }));
}

export function localSearch(q: string): SearchHit[] {
  const needle = q.toLowerCase();
  return Object.entries(ALIASES)
    .filter(([sym, names]) => sym.toLowerCase().startsWith(needle) || names.some((n) => n.toLowerCase().includes(needle)))
    .slice(0, 8)
    .map(([symbol, names]) => ({ symbol, name: names[0], region: "intl" as const }));
}

/** Indexes, currencies and commodities by name ("s&p", "vn30", "gold"). */
function labelSearch(q: string): { hit: SearchHit; score: number }[] {
  const fq = fold(q);
  if (!fq) return [];
  const out: { hit: SearchHit; score: number }[] = [];
  for (const [symbol, label] of Object.entries(SYMBOL_LABELS)) {
    const fl = fold(label);
    const fs = fold(symbol);
    const score = fl === fq || fs === fq ? 90 : fl.startsWith(fq) || fs.startsWith(fq) ? 72 : fq.length >= 3 && fl.includes(fq) ? 40 : 0;
    if (!score) continue;
    const isIndex = symbol.startsWith("^") || symbol === "000001.SS";
    out.push({ hit: { symbol, name: label, type: isIndex ? "INDEX" : undefined, region: symbol.endsWith(".VN") ? "vn" : "intl" }, score });
  }
  return out;
}

async function yahooSearch(q: string): Promise<SearchHit[]> {
  const j = await yahooJson(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0`, 5000);
  return parseYahooSearch(j);
}

export async function searchTickers(query: string, opts: { lang?: string } = {}): Promise<SearchHit[]> {
  const q = query.trim().slice(0, 40);
  if (q.length < 1) return [];
  const key = `${q.toLowerCase()}|${opts.lang ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.hits;

  const [yahoo, vn] = await Promise.all([yahooSearch(q).catch(() => [] as SearchHit[]), searchVn(q, 8).catch(() => [])]);
  const vnBoost = opts.lang === "vi" || /[^\x00-\x7F]/.test(q) ? 14 : 0;
  const upper = q.toUpperCase();
  const scored: { hit: SearchHit; score: number }[] = [
    ...vn.map((l) => ({
      hit: { symbol: `${l.code}.VN`, name: l.short, sub: l.name !== l.short ? l.name : l.nameEn, exchange: l.floor, type: l.type === "ETF" ? "ETF" : "EQUITY", region: "vn" as const },
      score: scoreVn(l, q) + vnBoost,
    })),
    ...labelSearch(q),
    ...yahoo.map((h, i) => ({ hit: h, score: (h.symbol === upper ? 100 : 70 - i * 4) + (h.region === "vn" ? vnBoost : 0) })),
  ];
  if (!yahoo.length) scored.push(...localSearch(q).map((h, i) => ({ hit: h, score: (h.symbol === upper ? 100 : 60 - i * 4) })));

  const seen = new Set<string>();
  const hits = scored
    .sort((a, b) => b.score - a.score)
    .map((x) => x.hit)
    .filter((h) => (seen.has(h.symbol) ? false : (seen.add(h.symbol), true)))
    .slice(0, MAX);
  cache.set(key, { at: Date.now(), hits });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return hits;
}
