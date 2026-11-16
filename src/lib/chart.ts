/**
 * Chart data and live quotes. Sources, in order, per symbol type:
 *   Vietnamese (*.VN):  DNSE → Vietcap → VNDirect (daily only) → Yahoo (stocks only)
 *   Everything else:    Yahoo (rate-limit aware, see yahoo.ts) → Nasdaq public API (US stocks, ETFs, NDX, COMP)
 * Stooq was dropped (it now serves a JavaScript bot check). Results are cached in memory per range.
 */
import { VN_INDEXES, dnseBars, ictDay, isVnSymbol, pool, vietcapBars, vndirectDaily, type DnseRes, type VietcapFrame } from "./vnmarket";
import { getJSON, setJSON } from "./store";
import { PROXIES, symLabel } from "./symbols";
import { yahooCooling, yahooJson, yahooSpark } from "./yahoo";

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

export type PriceSource = "yahoo" | "nasdaq" | "dnse" | "vietcap" | "vndirect";

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
  source: PriceSource;
  /** Every source failed; this is the last good daily data we saved. */
  stale?: boolean;
  /** Priced from this tracking ETF (see PROXIES). */
  proxy?: string;
}

const INTERVAL: Record<ChartRange, string> = { "1d": "1m", "5d": "5m", "1mo": "60m", "6mo": "1d", "1y": "1d" };
const TTL_MS: Record<ChartRange, number> = { "1d": 20_000, "5d": 60_000, "1mo": 5 * 60_000, "6mo": 30 * 60_000, "1y": 60 * 60_000 };
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const cache = new Map<string, { at: number; data: ChartData }>();
const pct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : 0);

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
  // Yahoo has the VN-Index but only as a single point; a chart needs a series.
  if (bars.length < 2 && range !== "1d") throw new Error("yahoo: no series");
  return {
    symbol,
    range,
    bars,
    price,
    prevClose,
    changePct: pct(price, prevClose),
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
  const j = await yahooJson(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${INTERVAL[range]}${prepost}`);
  return parseYahooChart(j, symbol, range);
}

/* --------------------------------------------------------------- Nasdaq */

/** Nasdaq's public quote API (US stocks, ETFs and the Nasdaq indexes, no key). Prices come as "$123.45". */
const nasdaqNum = (v: unknown) => Number(String(v ?? "").replace(/[$,%]/g, ""));
const NASDAQ_HEADERS = { Accept: "application/json, text/plain, */*", Origin: "https://www.nasdaq.com", Referer: "https://www.nasdaq.com/" };
const NASDAQ_INDEX: Record<string, string> = { "^NDX": "NDX", "^IXIC": "COMP" };

async function nasdaqJson(path: string, classes: string[]): Promise<{ data: unknown; cls: string }> {
  let last = "";
  for (const cls of classes) {
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
  return { symbol, range: "1d", bars, price, prevClose, changePct: pct(price, prevClose), asOf: bars.at(-1)!.t, source: "nasdaq" };
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
  return { symbol, range, bars, price: last.c, prevClose: bars.at(-2)!.c, changePct: pct(last.c, bars.at(-2)!.c), asOf: last.t, source: "nasdaq" };
}

async function nasdaqChart(symbol: string, range: ChartRange): Promise<ChartData> {
  const idx = NASDAQ_INDEX[symbol];
  if (!idx && /[=^]|-USD$|\./.test(symbol)) throw new Error("nasdaq: unsupported symbol");
  const code = encodeURIComponent(idx ?? symbol);
  const classes = idx ? ["index"] : ["stocks", "etf"];
  if (range === "1d") return parseNasdaqIntraday((await nasdaqJson(`${code}/chart`, classes)).data, symbol);
  const days = { "5d": 10, "1mo": 35, "6mo": 190, "1y": 370 }[range];
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const d = await nasdaqJson(`${code}/historical?fromdate=${from}&limit=400`, classes);
  return parseNasdaqHistorical(d.data, symbol, range);
}

/* ------------------------------------------------------------- Vietnam */

const VN_PLAN: Record<ChartRange, { dnse: DnseRes; days: number; vietcap: VietcapFrame; count: number; sessions?: number }> = {
  "1d": { dnse: "1", days: 5, vietcap: "ONE_MINUTE", count: 600, sessions: 1 },
  "5d": { dnse: "5", days: 10, vietcap: "ONE_HOUR", count: 60, sessions: 5 },
  "1mo": { dnse: "1H", days: 35, vietcap: "ONE_HOUR", count: 160 },
  "6mo": { dnse: "1D", days: 190, vietcap: "ONE_DAY", count: 130 },
  "1y": { dnse: "1D", days: 375, vietcap: "ONE_DAY", count: 260 },
};

/** Build ChartData from VN bars; intraday ranges keep the last N sessions and use yesterday's close. */
function vnChartData(symbol: string, range: ChartRange, all: Bar[], daily: Bar[] | null, source: PriceSource): ChartData {
  const plan = VN_PLAN[range];
  let bars = all;
  if (plan.sessions) {
    const days = [...new Set(all.map((b) => ictDay(b.t)))];
    const keep = new Set(days.slice(-plan.sessions));
    bars = all.filter((b) => keep.has(ictDay(b.t)));
  }
  if (bars.length < 1) throw new Error(`${source}: no data`);
  const last = bars.at(-1)!;
  const lastDay = ictDay(last.t);
  const ref = daily ?? all;
  const prevDaily = ref.filter((b) => ictDay(b.t) < lastDay).at(-1)?.c;
  const prevClose = prevDaily ?? (bars.length > 1 ? bars.at(-2)!.c : last.c);
  const today = bars.filter((b) => ictDay(b.t) === lastDay);
  const year = range === "1y" ? bars : null;
  return {
    symbol,
    range,
    bars,
    price: last.c,
    prevClose,
    changePct: pct(last.c, prevClose),
    dayHigh: today.length ? Math.max(...today.map((b) => b.h)) : undefined,
    dayLow: today.length ? Math.min(...today.map((b) => b.l)) : undefined,
    volume: plan.dnse === "1D" ? last.v : today.reduce((a, b) => a + b.v, 0) || undefined,
    ...(year ? { fiftyTwoWeekHigh: Math.max(...year.map((b) => b.h)), fiftyTwoWeekLow: Math.min(...year.map((b) => b.l)) } : {}),
    currency: VN_INDEXES[symbol] ? undefined : "VND",
    name: VN_INDEXES[symbol]?.name,
    asOf: last.t,
    source,
  };
}

async function dnseChart(symbol: string, range: ChartRange): Promise<ChartData> {
  const plan = VN_PLAN[range];
  const [bars, daily] = await Promise.all([dnseBars(symbol, plan.dnse, plan.days), plan.dnse === "1D" ? null : dnseBars(symbol, "1D", 12).catch(() => null)]);
  return vnChartData(symbol, range, bars, daily, "dnse");
}

async function vietcapChart(symbol: string, range: ChartRange): Promise<ChartData> {
  const plan = VN_PLAN[range];
  const [bars, daily] = await Promise.all([
    vietcapBars(symbol, plan.vietcap, plan.count),
    plan.vietcap === "ONE_DAY" ? null : vietcapBars(symbol, "ONE_DAY", 8).catch(() => null),
  ]);
  return vnChartData(symbol, range, bars, daily, "vietcap");
}

async function vndirectChart(symbol: string, range: ChartRange): Promise<ChartData> {
  const days = { "1d": 10, "5d": 10, "1mo": 25, "6mo": 130, "1y": 260 }[range];
  const bars = (await vndirectDaily([symbol], days)).get(symbol);
  if (!bars) throw new Error("vndirect: no data");
  // Daily bars only: show them as-is for every range (no intraday session filter).
  const d = vnChartData(symbol, range === "1y" ? "1y" : "6mo", bars, null, "vndirect");
  return { ...d, range };
}

export const vnPriceName = (symbol: string) => VN_INDEXES[symbol]?.name;

/* ---------------------------------------------------------------- public */

export async function getChart(symbol: string, range: ChartRange): Promise<ChartData> {
  const key = `${symbol}|${range}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS[range]) return hit.data;
  // Cloud IPs often get refused by one source, so try several in order and report every failure.
  const vn = isVnSymbol(symbol);
  const sources: [string, () => Promise<ChartData>][] = vn
    ? [
        ["dnse", () => dnseChart(symbol, range)],
        ["vietcap", () => vietcapChart(symbol, range)],
        ["vndirect", () => vndirectChart(symbol, range)],
        ...(VN_INDEXES[symbol] ? [] : ([["yahoo", () => yahooChart(symbol, range)]] as [string, () => Promise<ChartData>][])),
      ]
    : [
        ["yahoo", () => yahooChart(symbol, range)],
        ["nasdaq", () => nasdaqChart(symbol, range)],
      ];
  const errors: string[] = [];
  for (const [, run] of sources) {
    try {
      const data = await run();
      if (!data.bars.length) throw new Error("empty");
      cache.set(key, { at: Date.now(), data });
      if (cache.size > 400) cache.delete(cache.keys().next().value!);
      void saveDaily(data);
      return data;
    } catch (e) {
      errors.push((e as Error).message.slice(0, 80));
    }
  }
  if (hit) return hit.data; // serve stale rather than nothing
  const px = PROXIES[symbol];
  if (px) {
    try {
      const d = await getChart(px, range);
      const data: ChartData = { ...d, symbol, proxy: px, name: `${px} ETF · ${symLabel(symbol)}` };
      cache.set(key, { at: Date.now(), data });
      return data;
    } catch (e) {
      errors.push(`${px}: ${(e as Error).message.slice(0, 60)}`);
    }
  }
  const saved = await savedDaily(symbol, range).catch(() => null);
  if (saved) return saved;
  throw new Error(errors.join(" · "));
}

/*
 * Last good daily history per symbol (Redis), so a rate-limited minute shows a slightly old chart
 * instead of "unavailable". Written at most every 6 hours per symbol, only from 6M/1Y loads.
 */
const savedAt = new Map<string, number>();
async function saveDaily(d: ChartData): Promise<void> {
  if (d.range !== "1y" && d.range !== "6mo") return;
  const k = `chart:${d.symbol}`;
  const prev = savedAt.get(k) ?? 0;
  if (Date.now() - prev < 6 * 3600_000) return;
  savedAt.set(k, Date.now());
  await setJSON(k, { ...d, bars: d.bars.slice(-260) }).catch(() => {});
}
async function savedDaily(symbol: string, range: ChartRange): Promise<ChartData | null> {
  const d = await getJSON<ChartData>(`chart:${symbol}`);
  if (!d?.bars?.length) return null;
  const n = { "1d": 2, "5d": 5, "1mo": 22, "6mo": 126, "1y": 252 }[range];
  const bars = d.bars.slice(-n);
  const last = bars.at(-1)!;
  const prev = d.bars.at(-2)?.c ?? last.c;
  return { ...d, range, bars, price: last.c, prevClose: prev, changePct: pct(last.c, prev), asOf: last.t, stale: true };
}

export interface LiveQuote {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
  asOf: number;
  /** Intraday closes for a mini sparkline. */
  spark: number[];
  /** Priced from this tracking ETF (see PROXIES). */
  proxy?: string;
}

const liveCache = new Map<string, { at: number; q: LiveQuote }>();
const LIVE_TTL_MS = 25_000;
const thin = (xs: number[], n = 48) => {
  const step = Math.max(1, Math.floor(xs.length / n));
  return xs.filter((_, i) => i % step === 0 || i === xs.length - 1);
};

/**
 * Live quotes for many symbols with as few upstream requests as possible: one Yahoo spark request
 * per 20 symbols, DNSE for Vietnamese symbols (VNDirect batch as backup), and per-symbol charts only
 * for what's still missing. Failures are skipped. Shared by every user for 25 seconds.
 */
export async function getLiveQuotes(symbols: string[]): Promise<LiveQuote[]> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()))].filter((s) => /^[A-Z0-9.^=\-]{1,12}$/.test(s)).slice(0, 60);
  const now = Date.now();
  const out = new Map<string, LiveQuote>();
  for (const s of uniq) {
    const c = liveCache.get(s);
    if (c && now - c.at < LIVE_TTL_MS) out.set(s, c.q);
  }
  const need = uniq.filter((s) => !out.has(s));
  const put = (q: LiveQuote) => {
    out.set(q.symbol, q);
    liveCache.set(q.symbol, { at: Date.now(), q });
  };
  const vn = need.filter(isVnSymbol);
  const other = need.filter((s) => !isVnSymbol(s));

  await Promise.all([
    // Yahoo: 1 request per 20 symbols.
    (async () => {
      if (!other.length) return;
      const sp = await yahooSpark(other, "1d", "5m");
      for (const s of other) {
        const v = sp.get(s);
        if (!v || !v.points.length) continue;
        const price = v.points.at(-1)![1];
        const prev = v.chartPreviousClose ?? v.points[0][1];
        put({ symbol: s, price, prevClose: prev, changePct: pct(price, prev), asOf: v.points.at(-1)![0], spark: thin(v.points.map((p) => p[1])) });
      }
    })(),
    // Vietnam: DNSE daily bars (today's bar is live), a few at a time.
    (async () => {
      await pool(vn, 6, async (s) => {
        try {
          const bars = await dnseBars(s, "1D", 12);
          const last = bars.at(-1)!;
          const prev = bars.at(-2)!.c;
          put({ symbol: s, price: last.c, prevClose: prev, changePct: pct(last.c, prev), asOf: last.t, spark: bars.slice(-10).map((b) => b.c) });
        } catch {}
      });
      const missing = vn.filter((s) => !out.has(s));
      if (!missing.length) return;
      const m = await vndirectDaily(missing, 10).catch(() => new Map<string, Bar[]>());
      for (const [s, bars] of m) {
        const last = bars.at(-1)!;
        const prev = bars.at(-2)!.c;
        put({ symbol: s, price: last.c, prevClose: prev, changePct: pct(last.c, prev), asOf: last.t, spark: bars.map((b) => b.c) });
      }
    })(),
  ]);

  // Last resort, per symbol (bounded so a bad minute can't fan out into dozens of requests).
  const rest = uniq.filter((s) => !out.has(s)).slice(0, 8);
  await pool(rest, 2, async (s) => {
    try {
      const d = await getChart(s, "1d");
      put({ symbol: s, price: d.price, prevClose: d.prevClose, changePct: d.changePct, asOf: d.asOf, spark: thin(d.bars.map((b) => b.c)), ...(d.proxy ? { proxy: d.proxy } : {}) });
    } catch {}
  });
  if (liveCache.size > 800) for (const k of [...liveCache.keys()].slice(0, 200)) liveCache.delete(k);
  return uniq.map((s) => out.get(s)).filter((q): q is LiveQuote => q != null);
}

/** Tests only. */
export function clearPriceCaches() {
  cache.clear();
  liveCache.clear();
}

export { yahooCooling };

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
