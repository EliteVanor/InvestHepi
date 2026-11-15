import type { Quote } from "./types";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

async function get(url: string, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

/** Yahoo's unofficial chart endpoint. No key; sometimes rate-limits cloud IPs, hence the Stooq fallback. */
async function yahoo(symbol: string): Promise<Quote> {
  const res = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`);
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error("yahoo: no result");
  const ts: number[] = r.timestamp ?? [];
  const closes: (number | null)[] = r.indicators?.quote?.[0]?.close ?? [];
  const history: [string, number][] = [];
  ts.forEach((t, i) => {
    const c = closes[i];
    if (c != null) history.push([new Date(t * 1000).toISOString().slice(0, 10), c]);
  });
  const price: number = r.meta?.regularMarketPrice ?? history.at(-1)?.[1];
  // previous close = last completed session before the current one
  const lastDate = new Date((r.meta?.regularMarketTime ?? ts.at(-1)) * 1000).toISOString().slice(0, 10);
  const prior = history.filter(([d]) => d < lastDate).at(-1)?.[1] ?? r.meta?.chartPreviousClose ?? price;
  return { symbol, price, prevClose: prior, changePct: ((price - prior) / prior) * 100, history, source: "yahoo" };
}

/** Stooq daily CSV. US tickers use the ".us" suffix. */
async function stooq(symbol: string): Promise<Quote> {
  const s = symbol.startsWith("^") ? symbol.toLowerCase() : `${symbol.toLowerCase()}.us`;
  const res = await get(`https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`);
  if (!res.ok) throw new Error(`stooq ${res.status}`);
  const lines = (await res.text()).trim().split("\n").slice(1);
  const history: [string, number][] = lines
    .map((l) => l.split(","))
    .filter((p) => p.length >= 5 && !isNaN(Number(p[4])))
    .map((p) => [p[0], Number(p[4])] as [string, number])
    .slice(-25);
  if (history.length < 2) throw new Error("stooq: no data");
  const price = history.at(-1)![1];
  const prior = history.at(-2)![1];
  return { symbol, price, prevClose: prior, changePct: ((price - prior) / prior) * 100, history, source: "stooq" };
}

export async function getQuote(symbol: string): Promise<Quote | null> {
  try {
    return await yahoo(symbol);
  } catch {
    // Stooq only covers plain US tickers; futures (=F), FX and crypto pairs (-USD) need Yahoo.
    if (/[=^]|-USD$|\.NYB$/.test(symbol)) return null;
    try {
      return await stooq(symbol);
    } catch {
      return null;
    }
  }
}

export async function getQuotes(symbols: string[]): Promise<Quote[]> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const qs = await Promise.all(uniq.map(getQuote));
  return qs.filter((q): q is Quote => q != null);
}

export function quotesAsText(quotes: Quote[]): string {
  if (!quotes.length) return "(price data unavailable)";
  return quotes
    .map((q) => {
      const h = q.history;
      const wk = h.length > 5 ? ((q.price - h[h.length - 6][1]) / h[h.length - 6][1]) * 100 : NaN;
      const mo = h.length > 1 ? ((q.price - h[0][1]) / h[0][1]) * 100 : NaN;
      const f = (n: number) => (isNaN(n) ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);
      return `${q.symbol}: ${q.price.toFixed(2)} (last session ${f(q.changePct)}, 5d ${f(wk)}, 1mo ${f(mo)})`;
    })
    .join("\n");
}

/** Macro context shown in the strip and given to the AI. Yahoo symbols. */
export const MACRO: { symbol: string; label: string; unit?: string }[] = [
  { symbol: "^VIX", label: "VIX" },
  { symbol: "^TNX", label: "US 10Y", unit: "%" },
  { symbol: "CL=F", label: "Oil" },
  { symbol: "GC=F", label: "Gold" },
  { symbol: "DX-Y.NYB", label: "Dollar" },
  { symbol: "BTC-USD", label: "Bitcoin" },
];

export const macroLabel = (symbol: string) => MACRO.find((m) => m.symbol === symbol)?.label ?? symbol;

export function macroAsText(quotes: Quote[]): string {
  if (!quotes.length) return "(macro data unavailable)";
  return quotes
    .map((q) => {
      const h = q.history;
      const wk = h.length > 5 ? ((q.price - h[h.length - 6][1]) / h[h.length - 6][1]) * 100 : NaN;
      const f = (n: number) => (isNaN(n) ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);
      return `${macroLabel(q.symbol)}: ${q.price.toFixed(2)} (1d ${f(q.changePct)}, 5d ${f(wk)})`;
    })
    .join("\n");
}
