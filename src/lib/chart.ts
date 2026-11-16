/**
 * Chart data and live quotes. Sources, in order, per symbol type:
 *   Vietnamese (*.VN):  DNSE → Vietcap → VNDirect (daily only) → Yahoo (stocks only)
 *   Everything else:    Yahoo (rate-limit aware, see yahoo.ts) → Nasdaq public API (US stocks, ETFs, NDX, COMP)
 * Stooq was dropped (it now serves a JavaScript bot check). Results are cached in memory per range.
 */
import { VN_INDEXES, dnseBars, ictDay, isVnSymbol, pool, vietcapBars, vndirectDaily, type DnseRes, type VietcapFrame } from "./vnmarket";
import { getJSON, setJSON } from "./store";
import { PROXIES, exchangeTz, symLabel } from "./symbols";
import { SAME_HOURS_ETF, estimateFromEtf, hasWorldDaily, worldDaily } from "./worldmarket";
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

export type PriceSource = "yahoo" | "nasdaq" | "dnse" | "vietcap" | "vndirect" | "vndirect-world";

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
  /** Real level carried forward by this same-hours ETF's move since the last official close (worldmarket.ts). */
  estimatedVia?: string;
  /** Daily closes only (no intraday source for this market): bars are whole sessions. */
  dailyOnly?: boolean;
  /** Price and previous close are official; only the intraday path is this same-hours ETF's, rescaled. */
  shapeVia?: string;
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

/**
 * Nasdaq's intraday `x` is New York wall-clock time written as if it were UTC (x = "04:00Z" for
 * "4:00 AM ET"). Shift it by New York's UTC offset at that moment so charts label the real time.
 * DST switches happen at 2 AM on a Sunday, when nothing trades, so the offset lookup is safe.
 */
export function nyWallToUtc(sec: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hour12: false })
      .formatToParts(new Date(sec * 1000))
      .map((x) => [x.type, Number(x.value)]),
  );
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) / 1000;
  return sec + (sec - wallAsUtc); // offset is negative in New York, so this adds 4-5 hours
}

/** Exported for tests. */
export function parseNasdaqIntraday(d: unknown, symbol: string): ChartData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = d as any;
  const pts: { x: number; y: unknown }[] = data?.chart ?? [];
  const bars: Bar[] = pts
    .map((p) => ({ t: nyWallToUtc(Math.floor(Number(p.x) / 1000)), c: nasdaqNum(p.y) }))
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
  // Share classes: Yahoo writes BRK-B, Nasdaq writes BRK.B.
  const code = encodeURIComponent(idx ?? symbol.replace(/^([A-Z]{1,5})-([A-Z])$/, "$1.$2"));
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

/**
 * Daily bars used only for the previous close of intraday charts. They change once a day, so they're
 * kept 15 minutes: the strip polls every symbol's 1-day chart, and this halves those requests.
 * (DNSE's daily series doesn't include today's bar during the session, so it can't be the live price.)
 */
const dailyRef = new Map<string, { at: number; bars: Bar[] }>();
async function dnseDailyRef(symbol: string): Promise<Bar[] | null> {
  const hit = dailyRef.get(symbol);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.bars;
  const bars = await dnseBars(symbol, "1D", 12).catch(() => null);
  if (bars) dailyRef.set(symbol, { at: Date.now(), bars });
  if (dailyRef.size > 300) dailyRef.delete(dailyRef.keys().next().value!);
  return bars ?? hit?.bars ?? null;
}

async function dnseChart(symbol: string, range: ChartRange): Promise<ChartData> {
  const plan = VN_PLAN[range];
  const [bars, daily] = await Promise.all([dnseBars(symbol, plan.dnse, plan.days), plan.dnse === "1D" ? null : dnseDailyRef(symbol)]);
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


/* ------------------------------------------------------- world (VNDirect) */

const SESSIONS: Record<ChartRange, number> = { "1d": 5, "5d": 10, "1mo": 22, "6mo": 126, "1y": 252 };
const etfDate = (s: string, t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: exchangeTz(s), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t * 1000));

/**
 * Real index / futures / FX levels from VNDirect's daily closes. For US-hours markets with a same-hours
 * ETF, a newer ETF session extends the series as an estimate (1D/5D: the ETF's intraday path scaled to
 * the official level; longer ranges: one estimated bar). Everything else is daily closes, labeled so.
 */
async function worldChart(symbol: string, range: ChartRange): Promise<ChartData> {
  const daily = (await worldDaily([symbol])).get(symbol);
  if (!daily || daily.length < 2) throw new Error("vndirect-world: no data");
  const etf = SAME_HOURS_ETF[symbol];
  const name = symLabel(symbol);
  if (etf) {
    try {
      const etfDaily = await getChart(etf, "1mo");
      const closes = collapseDaily(etf, etfDaily.bars);
      const est = estimateFromEtf(daily, closes, (t) => etfDate(etf, t));
      if (est) {
        if (range === "1d" || range === "5d") {
          // The ETF's own intraday path, rescaled so its previous close sits on the official close.
          const intra = await getChart(etf, range);
          const k = est.prevClose / intra.prevClose;
          const bars = intra.bars.map((b) => ({ ...b, o: b.o * k, h: b.h * k, l: b.l * k, c: b.c * k, v: 0 }));
          return { symbol, range, bars, price: intra.price * k, prevClose: est.prevClose, changePct: intra.changePct, asOf: intra.asOf, source: "vndirect-world", estimatedVia: etf, name };
        }
        const t = Math.floor(Date.UTC(+est.date.slice(0, 4), +est.date.slice(5, 7) - 1, +est.date.slice(8, 10), 12) / 1000);
        const bars = [...daily, { t, o: est.prevClose, h: Math.max(est.prevClose, est.price), l: Math.min(est.prevClose, est.price), c: est.price, v: 0 }].slice(-SESSIONS[range]);
        return worldData(symbol, range, bars, { estimatedVia: etf });
      }
      // Same session in both: the official close is known; the ETF only supplies the intraday shape,
      // scaled so it ends exactly on the official close.
      const offLast = daily.at(-1)!;
      if ((range === "1d" || range === "5d") && closes.at(-1)?.[0] === etfDate(etf, offLast.t)) {
        const intra = await getChart(etf, range);
        const k = offLast.c / intra.price;
        const bars = intra.bars.map((b) => ({ ...b, o: b.o * k, h: b.h * k, l: b.l * k, c: b.c * k, v: 0 }));
        const prev = daily.at(-2)!.c;
        return { symbol, range, bars, price: offLast.c, prevClose: prev, changePct: pct(offLast.c, prev), asOf: intra.asOf, source: "vndirect-world", shapeVia: etf, name };
      }
    } catch {}
  }
  return worldData(symbol, range, daily.slice(-SESSIONS[range]), { dailyOnly: true });
}

function worldData(symbol: string, range: ChartRange, bars: Bar[], extra: Partial<ChartData>): ChartData {
  const last = bars.at(-1)!;
  const prev = bars.at(-2)?.c ?? last.c;
  const year = bars.length > 150 ? bars : null;
  return {
    symbol, range, bars, price: last.c, prevClose: prev, changePct: pct(last.c, prev), asOf: last.t, source: "vndirect-world", name: symLabel(symbol),
    dayHigh: last.h, dayLow: last.l,
    ...(year ? { fiftyTwoWeekHigh: Math.max(...year.map((b) => b.h)), fiftyTwoWeekLow: Math.min(...year.map((b) => b.l)) } : {}),
    ...extra,
  };
}

/** Daily closes [exchange date, close] from any bars (intraday collapsed to each day's last bar). */
function collapseDaily(symbol: string, bars: Bar[]): [string, number][] {
  const m = new Map<string, number>();
  for (const b of bars) m.set(etfDate(symbol, b.t), b.c);
  return [...m.entries()];
}

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
        // Real levels (daily, or estimated from a same-hours ETF) before falling back to an ETF's price.
        ...(hasWorldDaily(symbol) ? ([["vndirect-world", () => worldChart(symbol, range)]] as [string, () => Promise<ChartData>][]) : []),
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
  /** Exchange-local date of the session the price and spark belong to (YYYY-MM-DD). */
  session?: string;
  /** True when `spark` is that session's intraday path (baseline: prevClose); false for daily closes. */
  intraday?: boolean;
  /** Real level estimated from this same-hours ETF's move (see worldmarket.ts). */
  estimatedVia?: string;
  /** Only daily closes exist for this market; the price is the last close. */
  dailyOnly?: boolean;
}

/** Exchange-local date of a timestamp (Hanoi for Vietnamese symbols, the exchange's zone otherwise). */
function sessionDate(symbol: string, t: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: exchangeTz(symbol), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t * 1000));
}

/** A live quote from a 1-day chart: identical numbers to the chart sheet, by construction. */
function liveFromChart(s: string, d: ChartData): LiveQuote {
  // An ETF-priced index trades on the ETF's exchange (New York), so date its session there.
  const intraday = d.range === "1d" && d.source !== "vndirect" && !d.stale;
  return {
    symbol: s, price: d.price, prevClose: d.prevClose, changePct: d.changePct, asOf: d.asOf, spark: thin(d.bars.map((b) => b.c)),
    session: sessionDate(d.estimatedVia ?? d.shapeVia ?? d.proxy ?? s, d.asOf), intraday: intraday && !d.dailyOnly,
    ...(d.proxy ? { proxy: d.proxy } : {}), ...(d.estimatedVia ? { estimatedVia: d.estimatedVia } : {}), ...(d.dailyOnly ? { dailyOnly: true } : {}),
  };
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
        const asOf = v.points.at(-1)![0];
        put({ symbol: s, price, prevClose: prev, changePct: pct(price, prev), asOf, spark: thin(v.points.map((p) => p[1])), session: sessionDate(s, asOf), intraday: true });
      }
    })(),
    // Vietnam: the same 1-day chart the chart sheet shows (DNSE 1-minute bars, Vietcap backup), so the
    // strip and the chart can't disagree; VNDirect's daily batch (today's row is live) as a last resort.
    (async () => {
      await pool(vn, 6, async (s) => {
        try {
          put(liveFromChart(s, await getChart(s, "1d")));
        } catch {}
      });
      const missing = vn.filter((s) => !out.has(s));
      if (!missing.length) return;
      const m = await vndirectDaily(missing, 10).catch(() => new Map<string, Bar[]>());
      for (const [s, bars] of m) {
        const last = bars.at(-1)!;
        const prev = bars.at(-2)!.c;
        put({ symbol: s, price: last.c, prevClose: prev, changePct: pct(last.c, prev), asOf: last.t, spark: bars.map((b) => b.c), session: sessionDate(s, last.t), intraday: false });
      }
    })(),
  ]);

  // Per symbol for whatever is still missing. With Yahoo refusing the server that's the whole
  // non-VN strip (Nasdaq, one request per symbol, cached 20 s), so the bound covers a full strip.
  const rest = uniq.filter((s) => !out.has(s)).slice(0, 32);
  await pool(rest, 4, async (s) => {
    try {
      put(liveFromChart(s, await getChart(s, "1d")));
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
