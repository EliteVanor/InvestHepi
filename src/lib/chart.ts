/**
 * Intraday + historical chart data from Yahoo's public chart endpoint (no key), with a
 * short in-memory cache so live polling doesn't hammer it. Long ranges fall back to Stooq daily.
 */
import { isVnSymbol, tcbsBars, vndirectBars } from "./vnmarket";

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
  source: "yahoo" | "stooq" | "tcbs" | "vndirect";
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

const YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

async function yahooChart(symbol: string, range: ChartRange): Promise<ChartData> {
  const prepost = range === "1d" ? "&includePrePost=false" : "";
  let last = "";
  for (const host of YAHOO_HOSTS) {
    const res = await get(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${INTERVAL[range]}${prepost}`).catch((e) => e as Error);
    if (res instanceof Error) {
      last = `${host.split(".")[0]} ${res.message}`;
      continue;
    }
    if (res.ok) return parseYahooChart(await res.json(), symbol, range);
    last = `${host.split(".")[0]} ${res.status}`;
  }
  throw new Error(`yahoo: ${last}`);
}

/** Nasdaq's public quote API (US stocks and ETFs, no key). Prices come as "$123.45". */
const nasdaqNum = (v: unknown) => Number(String(v ?? "").replace(/[$,%]/g, ""));
const NASDAQ_HEADERS = { Accept: "application/json, text/plain, */*", Origin: "https://www.nasdaq.com", Referer: "https://www.nasdaq.com/" };

async function nasdaqJson(path: string): Promise<{ data: unknown; cls: string }> {
  let last = "";
  for (const cls of ["stocks", "etf"]) {
    const res = await fetch(`https://api.nasdaq.com/api/quote/${path}${path.includes("?") ? "&" : "?"}assetclass=${cls}`, { headers: { "User-Agent": UA, ...NASDAQ_HEADERS }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      last = String(res.status);
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j: any = await res.json();
    if (j?.data) return { data: j.data, cls };
    last = "no data";
  }
  throw new Error(`nasdaq ${last}`);
}

/** Exported for tests. */
export function parseNasdaqIntraday(d: unknown, symbol: string): ChartData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = d as any;
  const pts: { x: number; y: unknown }[] = data?.chart ?? [];
  const bars: Bar[] = pts
    .map((p) => ({ t: Math.floor(Number(p.x) / 1000), c: nasdaqNum(p.y) }))
    .filter((p) => p.t > 0 && p.c > 0)
    .map((p) => ({ t: p.t, o: p.c, h: p.c, l: p.c, c: p.c, v: 0 }));
  if (bars.length < 2) throw new Error("nasdaq: no intraday data");
  const price = nasdaqNum(data?.lastSalePrice) || bars.at(-1)!.c;
  const prevClose = nasdaqNum(data?.previousClose) || bars[0].c;
  return { symbol, range: "1d", bars, price, prevClose, changePct: ((price - prevClose) / prevClose) * 100, asOf: bars.at(-1)!.t, source: "yahoo" };
}

/** Exported for tests. */
export function parseNasdaqHistorical(d: unknown, symbol: string, range: ChartRange): ChartData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = (d as any)?.tradesTable?.rows ?? [];
  const bars: Bar[] = rows
    .map((r) => {
      const [m, day, y] = String(r.date).split("/").map(Number);
      const c = nasdaqNum(r.close);
      return { t: Math.floor(Date.UTC(y, m - 1, day, 21) / 1000), o: nasdaqNum(r.open) || c, h: nasdaqNum(r.high) || c, l: nasdaqNum(r.low) || c, c, v: nasdaqNum(r.volume) };
    })
    .filter((b) => b.c > 0 && Number.isFinite(b.t))
    .sort((a, b) => a.t - b.t);
  if (bars.length < 2) throw new Error("nasdaq: no history");
  const last = bars.at(-1)!;
  return { symbol, range, bars, price: last.c, prevClose: bars.at(-2)!.c, changePct: ((last.c - bars.at(-2)!.c) / bars.at(-2)!.c) * 100, asOf: last.t, source: "stooq" };
}

async function nasdaqChart(symbol: string, range: ChartRange): Promise<ChartData> {
  if (/[=^]|-USD$|\./.test(symbol)) throw new Error("nasdaq: unsupported symbol");
  if (range === "1d") return parseNasdaqIntraday((await nasdaqJson(`${encodeURIComponent(symbol)}/chart`)).data, symbol);
  const days = { "5d": 10, "1mo": 35, "6mo": 190, "1y": 370 }[range];
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const d = await nasdaqJson(`${encodeURIComponent(symbol)}/historical?fromdate=${from}&limit=400`);
  return parseNasdaqHistorical(d.data, symbol, range);
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

/** Vietnamese stocks and indexes from local public APIs (see vnmarket.ts). */
async function vnChart(symbol: string, range: ChartRange, src: "tcbs" | "vndirect"): Promise<ChartData> {
  const days = { "1d": 10, "5d": 10, "1mo": 25, "6mo": 130, "1y": 260 }[range];
  let bars: Bar[];
  if (src === "tcbs" && (range === "1d" || range === "5d")) {
    const intraday = await tcbsBars(symbol, true, 0);
    // 1D = the latest session only; 5D = the last 5 sessions of 5-minute bars.
    const dayOf = (t: number) => new Date((t + 7 * 3600) * 1000).toISOString().slice(0, 10);
    const sessions = [...new Set(intraday.map((b) => dayOf(b.t)))];
    const keep = new Set(sessions.slice(range === "1d" ? -1 : -5));
    bars = intraday.filter((b) => keep.has(dayOf(b.t)));
    const daily = await tcbsBars(symbol, false, 10).catch(() => [] as Bar[]);
    const lastDay = sessions.at(-1)!;
    const prev = daily.filter((b) => dayOf(b.t) < lastDay).at(-1)?.c ?? bars[0].c;
    const last = bars.at(-1)!;
    return { symbol, range, bars, price: last.c, prevClose: prev, changePct: ((last.c - prev) / prev) * 100, asOf: last.t, currency: "VND", source: "tcbs" };
  }
  bars = src === "tcbs" ? await tcbsBars(symbol, false, days) : await vndirectBars(symbol, days);
  if (range !== "1y") bars = bars.slice(-days);
  const last = bars.at(-1)!;
  const prev = bars.at(-2)!;
  const hi = Math.max(...bars.map((b) => b.h ?? b.c));
  const lo = Math.min(...bars.map((b) => b.l ?? b.c));
  return { symbol, range, bars, price: last.c, prevClose: prev.c, changePct: ((last.c - prev.c) / prev.c) * 100, asOf: last.t, currency: "VND", source: src, ...(range === "1y" ? { fiftyTwoWeekHigh: hi, fiftyTwoWeekLow: lo } : {}) };
}

export async function getChart(symbol: string, range: ChartRange): Promise<ChartData> {
  const key = `${symbol}|${range}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS[range]) return hit.data;
  // Cloud IPs often get refused by one source, so try several in order and report every failure.
  const sources: [string, () => Promise<ChartData>][] = isVnSymbol(symbol)
    ? [
        ["yahoo", () => yahooChart(symbol, range)],
        ["tcbs", () => vnChart(symbol, range, "tcbs")],
        ["vndirect", () => vnChart(symbol, range, "vndirect")],
      ]
    : [
        ["yahoo", () => yahooChart(symbol, range)],
        ["nasdaq", () => nasdaqChart(symbol, range)],
        ["stooq", () => stooqDaily(symbol, range === "1d" || range === "5d" ? "1mo" : range)],
      ];
  const errors: string[] = [];
  for (const [, run] of sources) {
    try {
      const data = await run();
      if (!data.bars.length) throw new Error("empty");
      cache.set(key, { at: Date.now(), data });
      if (cache.size > 300) cache.delete(cache.keys().next().value!);
      return data;
    } catch (e) {
      errors.push((e as Error).message.slice(0, 80));
    }
  }
  if (hit) return hit.data; // serve stale rather than nothing
  throw new Error(errors.join(" · "));
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
