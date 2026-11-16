/**
 * Stock search, Apple Stocks style: one box for US, Vietnamese and global stocks, ETFs and indexes.
 *   - Vietnamese listings (VNDirect, accent-insensitive: "vinamilk", "hoa phat", "HPG")
 *   - built-in index names ("S&P 500", "VN30", "Nikkei")
 *   - Yahoo's global search (through the shared rate-limit guard in yahoo.ts)
 *   - when Yahoo is unavailable (it refuses Vercel's servers): Nasdaq's public autocomplete (every
 *     US-listed stock and ETF, including foreign companies' US listings) plus a built-in list
 * Results are ranked by match quality; Vietnamese results get a boost for Vietnamese readers or
 * queries typed with Vietnamese accents.
 */
import { PROXIES, SYMBOL_LABELS } from "./symbols";
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

/** Parse Nasdaq's autocomplete. Exported for tests. */
export function parseNasdaqSearch(j: unknown): SearchHit[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = (j as any)?.data ?? [];
  return rows
    .filter((r) => (r?.asset === "STOCKS" || r?.asset === "ETF") && /^[A-Z]{1,5}(\.[A-Z])?$/.test(String(r.symbol ?? "")))
    .slice(0, 8)
    .map((r) => ({
      symbol: String(r.symbol).replace(".", "-"), // Yahoo-style share classes (BRK-B), used everywhere else
      name: String(r.name ?? r.symbol).replace(/\s+(Common Stock|Class [A-Z] Common Stock|Ordinary Shares|American Depositary Shares).*$/i, "").trim(),
      type: r.asset === "ETF" ? "ETF" : "EQUITY",
      exchange: r.exchange || undefined,
      region: "intl" as const,
    }));
}

async function nasdaqSearch(q: string): Promise<SearchHit[]> {
  const res = await fetch(`https://api.nasdaq.com/api/autocomplete/slookup/10?search=${encodeURIComponent(q)}`, {
    // Same headers as the Nasdaq price calls in chart.ts.
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", Accept: "application/json, text/plain, */*", Origin: "https://www.nasdaq.com", Referer: "https://www.nasdaq.com/" },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`nasdaq search ${res.status}`);
  return parseNasdaqSearch(await res.json());
}

/** Symbols only Yahoo can price (foreign listings, yields): don't offer them while Yahoo is unreachable. */
export const yahooOnly = (s: string) => !s.endsWith(".VN") && !PROXIES[s] && s !== "^IXIC" && /[\^=.]|-USD$/.test(s);

export function localSearch(q: string): SearchHit[] {
  const needle = q.toLowerCase();
  return Object.entries(ALIASES)
    .filter(([sym, names]) => sym.toLowerCase().startsWith(needle) || names.some((n) => n.toLowerCase().includes(needle)))
    .slice(0, 8)
    .map(([symbol, names]) => ({ symbol, name: names[0], region: "intl" as const }));
}

/** Indexes, currencies and commodities by name ("s&p", "vn30", "gold"). */
function labelSearch(q: string, yahooUp = true): { hit: SearchHit; score: number }[] {
  const fq = fold(q);
  if (!fq) return [];
  const out: { hit: SearchHit; score: number }[] = [];
  for (const [symbol, label] of Object.entries(SYMBOL_LABELS)) {
    const fl = fold(label);
    const fs = fold(symbol);
    const score = fl === fq || fs === fq ? 90 : fl.startsWith(fq) || fs.startsWith(fq) ? 72 : fq.length >= 3 && fl.includes(fq) ? 40 : 0;
    if (!score || (!yahooUp && yahooOnly(symbol))) continue;
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

  const [yahooRes, vn] = await Promise.all([yahooSearch(q).then((h) => ({ ok: true, h }), () => ({ ok: false, h: [] as SearchHit[] })), searchVn(q, 8).catch(() => [])]);
  // Nasdaq only when Yahoo failed: one extra request at most, and only on servers Yahoo refuses.
  const yahoo = yahooRes.ok ? yahooRes.h : await nasdaqSearch(q).catch(() => [] as SearchHit[]);
  const vnBoost = opts.lang === "vi" || /[^\x00-\x7F]/.test(q) ? 14 : 0;
  const upper = q.toUpperCase();
  const scored: { hit: SearchHit; score: number }[] = [
    ...vn.map((l) => ({
      hit: { symbol: `${l.code}.VN`, name: l.short, sub: l.name !== l.short ? l.name : l.nameEn, exchange: l.floor, type: l.type === "ETF" ? "ETF" : "EQUITY", region: "vn" as const },
      score: scoreVn(l, q) + vnBoost,
    })),
    ...labelSearch(q, yahooRes.ok),
    ...yahoo.map((h, i) => ({ hit: h, score: (h.symbol === upper ? 100 : 70 - i * 4) + (h.region === "vn" ? vnBoost : 0) })),
  ];
  if (!yahooRes.ok) scored.push(...localSearch(q).filter((h) => !yahooOnly(h.symbol)).map((h, i) => ({ hit: h, score: (h.symbol === upper ? 100 : 60 - i * 4) })));

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
