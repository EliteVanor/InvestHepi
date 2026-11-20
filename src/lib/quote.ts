/**
 * The current quote: one answer per symbol that every screen reads (the strip, the chart header, the
 * ticker sheet, the watchlist, the portfolio, alerts, mid-day prediction starts). The rules live here
 * and in `quote-view.ts` (browser-safe); the source adapters sit behind it:
 *   chart.ts (Yahoo, Nasdaq, Eastmoney, DNSE, Vietcap, VNDirect, worldmarket), yahoo.ts spark batches,
 *   market.ts daily history (getQuotes).
 *
 * What a caller gets (`CurrentQuote`): the regular-session price (the close once the session ends) and
 * the previous close, the session date and the exchange's state, a pre-market or after-hours print
 * kept apart, the basis (real level / ETF stand-in / estimate), currency, stale, as-of and source, and
 * on request the 5-session and one-month changes from the same series.
 *
 * Requests stay low: one Yahoo spark per 20 symbols, Vietnamese 1-day charts (the chart sheet's own
 * series, so they can't disagree), per-symbol charts only for what is missing; readings shared for
 * 25 s; daily history (previous closes, windows) for 10 min.
 */
import { getChart, type Bar, type ChartData, type ChartRange } from "./chart";
import { dayIn } from "./dates";
import { getQuotes } from "./market";
import { closeUtc, lastFinishedSession } from "./markets";
import { currencyOf, isStale, quoteTz, sessionState, windowChange, type CurrentQuote, type QuoteWindow } from "./quote-view";
import { exchangeTz } from "./symbols";
import type { Quote } from "./types";
import { isVnSymbol, pool, vndirectDaily } from "./vnmarket";
import { yahooSpark } from "./yahoo";

export type { CurrentQuote } from "./quote-view";

/** One source's reading, before the module's rules (previous close, extended hours, stale). */
interface Reading {
  symbol: string;
  price: number;
  prevClose: number;
  asOf: number;
  spark: number[];
  session: string;
  intraday: boolean;
  source: string;
  proxy?: string;
  estimatedVia?: string;
  dailyOnly?: boolean;
  stale?: boolean;
  currency?: string;
  extended?: { kind: "pre" | "after"; price: number; asOf: number };
  /** Daily readings only: the closes, [exchange date, close]. */
  closes?: [string, number][];
}

const SYMBOL_RE = /^[A-Z0-9.^=\-]{1,12}$/;
const pct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : NaN);
const thin = (xs: number[], n = 48) => {
  const step = Math.max(1, Math.floor(xs.length / n));
  return xs.filter((_, i) => i % step === 0 || i === xs.length - 1);
};
/** Exchange-local date of a timestamp; an ETF-priced index trades on the ETF's exchange (New York). */
const sessionDate = (symbol: string, t: number) => dayIn(exchangeTz(symbol), t * 1000);

/** Reading from a 1-day chart: the same numbers as the chart sheet, by construction. */
function fromChart(s: string, d: ChartData): Reading {
  return {
    symbol: s, price: d.price, prevClose: d.prevClose, asOf: d.asOf, spark: thin(d.bars.map((b) => b.c)), source: d.source,
    session: sessionDate(d.estimatedVia ?? d.shapeVia ?? d.proxy ?? s, d.asOf),
    intraday: d.range === "1d" && d.source !== "vndirect" && !d.stale && !d.dailyOnly,
    ...(d.range !== "1d" || d.source === "vndirect" || d.dailyOnly ? { closes: d.bars.map((b) => [sessionDate(d.proxy ?? s, b.t), b.c] as [string, number]) } : {}),
    ...(d.proxy ? { proxy: d.proxy } : {}), ...(d.estimatedVia ? { estimatedVia: d.estimatedVia } : {}), ...(d.dailyOnly ? { dailyOnly: true } : {}),
    ...(d.stale ? { stale: true } : {}), ...(d.currency ? { currency: d.currency } : {}), ...(d.extended ? { extended: d.extended } : {}),
  };
}

const readings = new Map<string, { at: number; r: Reading }>();
const READING_TTL_MS = 25_000;

/** Latest readings for many symbols with as few upstream requests as possible. Failures are skipped. */
async function read(uniq: string[]): Promise<Map<string, Reading>> {
  const now = Date.now();
  const out = new Map<string, Reading>();
  for (const s of uniq) {
    const c = readings.get(s);
    if (c && now - c.at < READING_TTL_MS) out.set(s, c.r);
  }
  const put = (r: Reading) => {
    out.set(r.symbol, r);
    readings.set(r.symbol, { at: Date.now(), r });
  };
  const need = uniq.filter((s) => !out.has(s));
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
        const [asOf, price] = v.points.at(-1)!;
        put({ symbol: s, price, prevClose: v.chartPreviousClose ?? v.points[0][1], asOf, spark: thin(v.points.map((p) => p[1])), session: sessionDate(s, asOf), intraday: true, source: "yahoo" });
      }
    })(),
    // Vietnam: the chart sheet's 1-day chart (DNSE 1-minute bars, Vietcap backup); VNDirect's daily batch last.
    (async () => {
      await pool(vn, 6, async (s) => {
        try {
          put(fromChart(s, await getChart(s, "1d")));
        } catch {}
      });
      const missing = vn.filter((s) => !out.has(s));
      if (!missing.length) return;
      const m = await vndirectDaily(missing, 10).catch(() => new Map<string, Bar[]>());
      for (const [s, bars] of m) {
        const last = bars.at(-1)!;
        put({ symbol: s, price: last.c, prevClose: bars.at(-2)!.c, asOf: last.t, spark: bars.map((b) => b.c), closes: bars.map((b) => [sessionDate(s, b.t), b.c] as [string, number]), session: sessionDate(s, last.t), intraday: false, source: "vndirect" });
      }
    })(),
  ]);
  // Per symbol for whatever is still missing (with Yahoo refusing the server, the whole non-VN strip).
  const rest = uniq.filter((s) => !out.has(s)).slice(0, 32);
  await pool(rest, 4, async (s) => {
    try {
      put(fromChart(s, await getChart(s, "1d")));
    } catch {}
  });
  if (readings.size > 800) for (const k of [...readings.keys()].slice(0, 200)) readings.delete(k);
  return out;
}

/* ------------------------------------------------------- daily history */

const history = new Map<string, { at: number; q: Quote | null }>();
const HISTORY_TTL_MS = 10 * 60_000;
const HISTORY_MISS_TTL_MS = 2 * 60_000;

/** Daily closes per series symbol (official, never the stale fallback), shared for 10 minutes. */
async function dailyHistory(symbols: string[]): Promise<Map<string, Quote>> {
  const now = Date.now();
  const fresh = (s: string) => {
    const h = history.get(s);
    return h && now - h.at < (h.q ? HISTORY_TTL_MS : HISTORY_MISS_TTL_MS);
  };
  const need = [...new Set(symbols)].filter((s) => !fresh(s));
  if (need.length) {
    // remember: false: no px:last read or write, so /api/quotes and /api/chart never touch Redis.
    const got = new Map((await getQuotes(need, { allowStale: false, remember: false }).catch(() => [] as Quote[])).map((q) => [q.symbol, q]));
    for (const s of need) history.set(s, { at: now, q: got.get(s) ?? null });
    if (history.size > 600) for (const k of [...history.keys()].slice(0, 150)) history.delete(k);
  }
  const out = new Map<string, Quote>();
  for (const s of symbols) {
    const q = history.get(s)?.q;
    // Only a real series: an ETF stand-in's history isn't the index's.
    if (q && !q.proxy) out.set(s, q);
  }
  return out;
}

/**
 * Regular-session closes taken from Nasdaq's 1-day series once a session ended, per series symbol:
 * Nasdaq's daily row for the same evening can carry the 20:00 after-hours print (SPY, Nov 19 2026),
 * so this close wins over that row for the price and for the next session's previous close.
 */
const regularCloses = new Map<string, Map<string, number>>();
function noteRegularClose(series: string, session: string, close: number) {
  const m = regularCloses.get(series) ?? new Map<string, number>();
  m.set(session, close);
  if (m.size > 5) m.delete(m.keys().next().value!);
  regularCloses.set(series, m);
  if (regularCloses.size > 400) regularCloses.delete(regularCloses.keys().next().value!);
}
/** Daily closes with the remembered regular-session closes laid over the daily rows. */
function withRegularCloses(series: string, closes: [string, number][]): [string, number][] {
  const m = regularCloses.get(series);
  if (!m?.size) return closes;
  const out = new Map(closes);
  for (const [d, c] of m) if (out.has(d) || d > (closes.at(-1)?.[0] ?? "")) out.set(d, c);
  return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/** A session's close is only taken from the 1-day series this long after the bell (the last bar can lag). */
const CLOSE_SETTLE_MS = 5 * 60_000;

/** The symbol whose daily series matches a reading: the ETF for a stand-in, the symbol itself otherwise. */
const seriesOf = (r: Reading) => r.proxy ?? r.symbol;

/* --------------------------------------------------------------- rules */

/** Apply the rules to one reading (Q1-Q5). Exported for tests through currentQuotes only. */
function finish(r: Reading, h: Quote | undefined, now: Date, windows: boolean): CurrentQuote | null {
  let { price, prevClose, session, intraday } = r;
  const series = seriesOf(r);
  // Nasdaq's 1-day series for a session that ended (and settled): its last regular-session bar is the
  // close, whatever the daily row says (that row can carry the 20:00 after-hours print). Taken from
  // this reading itself, so a cold instance needs no remembered close.
  const settled = now.getTime() >= closeUtc(session, quoteTz(r.symbol, r.proxy)).getTime() + CLOSE_SETTLE_MS;
  const ownClose = r.source === "nasdaq" && r.intraday && r.extended?.kind !== "pre" && session === lastFinishedSession(r.symbol, now, r.proxy) && sessionState(r.symbol, now, r.proxy) !== "open" && settled;
  if (ownClose) noteRegularClose(series, session, price);
  let closes = withRegularCloses(series, h?.history ?? []);
  if (ownClose) closes = closes.filter(([d]) => d !== session).concat([[session, price]]).sort((a, b) => a[0].localeCompare(b[0]));
  let provisional = false;
  if (r.extended?.kind === "pre") {
    // Before the open: the last close is the price, its session's change the day change.
    const last = closes.at(-1);
    if (last) {
      // No 1-day series for that session here: unless a close was remembered, the row may be the after-hours print.
      provisional = r.source === "nasdaq" && last[0] === lastFinishedSession(r.symbol, now, r.proxy) && regularCloses.get(series)?.get(last[0]) !== last[1];
      price = last[1];
      prevClose = closes.at(-2)?.[1] ?? NaN;
      session = last[0];
    } else prevClose = NaN;
    intraday = false;
  } else if (r.source === "nasdaq" && closes.length) {
    // Nasdaq's previous-close field is unreliable: the daily history's close before the session is.
    // The session's own price stays the last regular-session bar: Nasdaq's daily row for the same
    // evening matched the 20:00 after-hours print (SPY Nov 19: row 715.87 = 20:00 print, 16:00 bar 715.06).
    const before = closes.filter(([d]) => d < session).at(-1);
    if (before) prevClose = before[1];
  }
  const changePct = pct(price, prevClose);
  if (!Number.isFinite(price) || !Number.isFinite(changePct)) return null;
  const via = r.proxy ?? r.estimatedVia;
  const q: CurrentQuote = {
    symbol: r.symbol, price, prevClose, changePct, session, intraday,
    state: sessionState(r.symbol, now, r.proxy),
    basis: r.proxy ? "proxy" : r.estimatedVia ? "estimate" : "level",
    ...(via ? { via } : {}),
    ...(r.dailyOnly ? { dailyOnly: true } : {}),
    ...(r.currency ?? currencyOf(r.symbol) ? { currency: r.currency ?? currencyOf(r.symbol) } : {}),
    ...(provisional ? { provisional: true } : {}),
    stale: isStale({ symbol: r.symbol, intraday, asOf: r.asOf, session, via: r.proxy, stale: r.stale }, now),
    asOf: r.asOf, source: r.source, spark: r.spark, ...(r.closes ? { closes: r.closes } : {}),
  };
  if (r.extended) q.extended = { kind: r.extended.kind, price: r.extended.price, changePct: pct(r.extended.price, price), asOf: r.extended.asOf };
  if (windows) {
    const w = (k: QuoteWindow) => (closes.length ? windowChange(closes, price, k, session) : null);
    q.changes = { "5d": w("5d"), "1mo": w("1mo") };
  }
  return q;
}

/* -------------------------------------------------------------- public */

/**
 * The current quote for each symbol (unknown or failing symbols are left out). `windows` adds the
 * 5-session and one-month changes (daily history, cached 10 min); `now` is for state and stale.
 */
export async function currentQuotes(symbols: string[], opts: { windows?: boolean; now?: Date } = {}): Promise<CurrentQuote[]> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()))].filter((s) => SYMBOL_RE.test(s)).slice(0, 60);
  const now = opts.now ?? new Date();
  const got = await read(uniq);
  const rs = uniq.map((s) => got.get(s)).filter((r): r is Reading => r != null);
  const wanted = rs.filter((r) => opts.windows || r.source === "nasdaq").map(seriesOf);
  const hist = wanted.length ? await dailyHistory(wanted) : new Map<string, Quote>();
  return rs.map((r) => finish(r, hist.get(seriesOf(r)), now, !!opts.windows)).filter((q): q is CurrentQuote => q != null);
}

/**
 * A chart series with the current quote beside it (Q3): the header always shows `quote` (price and day
 * change, identical on every range), and `rangeChangePct` the selected range's change (5D, 1M from the
 * same rule as everywhere else; 6M, 1Y from the first bar of the same series; 1D none).
 */
export async function chartWithQuote(symbol: string, range: ChartRange): Promise<ChartData & { quote: CurrentQuote | null; rangeChangePct: number | null }> {
  const [chart, [quote]] = await Promise.all([getChart(symbol, range), currentQuotes([symbol], { windows: true }).catch(() => [] as CurrentQuote[])]);
  if (!quote) return { ...chart, quote: null, rangeChangePct: null };
  const sameSeries = (chart.proxy ?? "") === (quote.basis === "proxy" ? quote.via ?? "" : "");
  let rangeChangePct: number | null = null;
  if (range === "5d" || range === "1mo") rangeChangePct = quote.changes?.[range] ?? null;
  else if (range !== "1d" && sameSeries && chart.bars[0]?.c) rangeChangePct = pct(quote.price, chart.bars[0].c);
  // The 1-day chart's previous-close line is the quote's previous close.
  const day = range === "1d" && sameSeries ? { prevClose: quote.prevClose, price: quote.price, changePct: quote.changePct } : {};
  return { ...chart, ...day, quote, rangeChangePct };
}

/** Tests only. `keepCloses` keeps the remembered regular-session closes (a restart of the readings only). */
export function clearQuoteCaches(keepCloses = false) {
  readings.clear();
  history.clear();
  if (!keepCloses) regularCloses.clear();
}
