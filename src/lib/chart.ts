/**
 * Intraday + historical chart data from Yahoo's public chart endpoint (no key), with a
 * short in-memory cache so live polling doesn't hammer it. Long ranges fall back to Stooq daily.
 */

export type ChartRange = "1d" | "5d" | "1mo" | "6mo" | "1y";
export const CHART_RANGES: ChartRange[] = ["1d", "5d", "1mo", "6mo", "1y"];

export interface Bar {
  t: number; // unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface ChartData {
  symbol: string;
  range: ChartRange;
  bars: Bar[];
  price: number;
  prevClose: number;
  changePct: number;
  dayHigh?: number;
  dayLow?: number;
  volume?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  currency?: string;
  name?: string;
  asOf: number; // unix seconds of last trade
  source: "yahoo" | "stooq";
}

const INTERVAL: Record<ChartRange, string> = { "1d": "1m", "5d": "5m", "1mo": "60m", "6mo": "1d", "1y": "1d" };
const TTL_MS: Record<ChartRange, number> = { "1d": 15_000, "5d": 60_000, "1mo": 5 * 60_000, "6mo": 30 * 60_000, "1y": 60 * 60_000 };
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const cache = new Map<string, { at: number; data: ChartData }>();

async function get(url: string, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

/** Parse Yahoo's v8 chart JSON. Exported for tests. */
export function parseYahooChart(j: unknown, symbol: string, range: ChartRange): ChartData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (j as any)?.chart?.result?.[0];
  if (!r) throw new Error("no chart result");
  const ts: number[] = r.timestamp ?? [];
  const q = r.indicators?.quote?.[0] ?? {};
  const bars: Bar[] = [];
  ts.forEach((t, i) => {
    const c = q.close?.[i];
    if (c == null) return;
    bars.push({ t, o: q.open?.[i] ?? c, h: q.high?.[i] ?? c, l: q.low?.[i] ?? c, c, v: q.volume?.[i] ?? 0 });
  });
  const m = r.meta ?? {};
  const price: number = m.regularMarketPrice ?? bars.at(-1)?.c ?? NaN;
  // For 1d the chart's previous close is yesterday's close; for longer ranges it's the close before the window.
  const prevClose: number = (range === "1d" ? m.chartPreviousClose ?? m.previousClose : m.previousClose ?? m.chartPreviousClose) ?? bars[0]?.o ?? price;
  if (!Number.isFinite(price)) throw new Error("no price");
  return {
    symbol,
    range,
    bars,
    price,
    prevClose,
    changePct: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
    dayHigh: m.regularMarketDayHigh,
    dayLow: m.regularMarketDayLow,
    volume: m.regularMarketVolume,
    fiftyTwoWeekHigh: m.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: m.fiftyTwoWeekLow,
    currency: m.currency,
    name: m.longName ?? m.shortName,
    asOf: m.regularMarketTime ?? bars.at(-1)?.t ?? Math.floor(Date.now() / 1000),
    source: "yahoo",
  };
}

async function yahooChart(symbol: string, range: ChartRange): Promise<ChartData> {
  const prepost = range === "1d" ? "&includePrePost=false" : "";
  const res = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${INTERVAL[range]}${prepost}`);
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  return parseYahooChart(await res.json(), symbol, range);
}

async function stooqDaily(symbol: string, range: ChartRange): Promise<ChartData> {
  const s = `${symbol.toLowerCase()}.us`;
  const res = await get(`https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`);
  if (!res.ok) throw new Error(`stooq ${res.status}`);
  const rows = (await res.text()).trim().split("\n").slice(1).map((l) => l.split(","));
  const days = range === "1y" ? 252 : range === "6mo" ? 126 : 22;
  const bars: Bar[] = rows
    .filter((p) => p.length >= 5 && !isNaN(Number(p[4])))
    .slice(-days)
    .map((p) => ({ t: Math.floor(new Date(p[0] + "T21:00:00Z").getTime() / 1000), o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +(p[5] ?? 0) }));
  if (bars.length < 2) throw new Error("stooq: no data");
  const last = bars.at(-1)!;
  const prev = bars.at(-2)!;
  return { symbol, range, bars, price: last.c, prevClose: prev.c, changePct: ((last.c - prev.c) / prev.c) * 100, asOf: last.t, source: "stooq" };
}

export async function getChart(symbol: string, range: ChartRange): Promise<ChartData> {
  const key = `${symbol}|${range}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS[range]) return hit.data;
  let data: ChartData;
  try {
    data = await yahooChart(symbol, range);
  } catch (e) {
    if (range === "1d" || range === "5d" || /[=^]|-USD$|\.NYB$/.test(symbol)) {
      if (hit) return hit.data; // serve stale rather than nothing
      throw e;
    }
    data = await stooqDaily(symbol, range);
  }
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return data;
}

export interface LiveQuote {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
  asOf: number;
  /** Intraday closes for a mini sparkline. */
  spark: number[];
}

/** Live quotes for many symbols (uses the 1D chart cache). Failures are skipped. */
export async function getLiveQuotes(symbols: string[]): Promise<LiveQuote[]> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()))].filter((s) => /^[A-Z0-9.^=\-]{1,12}$/.test(s)).slice(0, 40);
  const out = await Promise.all(
    uniq.map(async (s) => {
      try {
        const d = await getChart(s, "1d");
        const step = Math.max(1, Math.floor(d.bars.length / 48));
        return { symbol: s, price: d.price, prevClose: d.prevClose, changePct: d.changePct, asOf: d.asOf, spark: d.bars.filter((_, i) => i % step === 0).map((b) => b.c) };
      } catch {
        return null;
      }
    }),
  );
  return out.filter((q): q is LiveQuote => q != null);
}

export const SECTORS: { symbol: string; key: string }[] = [
  { symbol: "XLK", key: "tech" },
  { symbol: "SMH", key: "semis" },
  { symbol: "XLC", key: "comms" },
  { symbol: "XLY", key: "discretionary" },
  { symbol: "XLF", key: "financials" },
  { symbol: "XLI", key: "industrials" },
  { symbol: "XLV", key: "health" },
  { symbol: "XLE", key: "energy" },
  { symbol: "XLB", key: "materials" },
  { symbol: "XLP", key: "staples" },
  { symbol: "XLU", key: "utilities" },
  { symbol: "XLRE", key: "realestate" },
];

export function sectorsAsText(quotes: { symbol: string; changePct: number }[]): string {
  if (!quotes.length) return "(sector data unavailable)";
  return [...quotes]
    .sort((a, b) => b.changePct - a.changePct)
    .map((q) => `${SECTORS.find((s) => s.symbol === q.symbol)?.key ?? q.symbol} (${q.symbol}) ${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%`)
    .join(", ");
}
