/**
 * Daily quotes (price, previous close, ~1 month of closes) for the briefings and the strip.
 * Batched to stay under free sources' rate limits:
 *   non-Vietnamese symbols: one Yahoo spark request per 20 symbols, then per-symbol fallbacks
 *     (Yahoo chart, then Nasdaq for US stocks/ETFs/Nasdaq indexes) for anything missing;
 *   Vietnamese symbols (*.VN): one VNDirect request for all of them, then DNSE/Vietcap per symbol.
 */
import { getChart, type Bar } from "./chart";
import { PROXIES, symLabel } from "./symbols";
import type { Quote } from "./types";
import { getJSON, setJSON } from "./store";
import { isVnSymbol, pool, vnDaily, vndirectDaily } from "./vnmarket";
import { yahooSpark } from "./yahoo";

const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/** Quote from daily bars (oldest first): last close vs the one before. Exported for tests. */
export function quoteFromCloses(symbol: string, points: [number, number][], source: Quote["source"]): Quote | null {
  // One close per calendar day (Yahoo can append today's live point with an intraday timestamp).
  const byDay = new Map<string, number>();
  for (const [t, c] of points) byDay.set(day(t), c);
  const history = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-25) as [string, number][];
  if (history.length < 2) return null;
  const price = history.at(-1)![1];
  const prior = history.at(-2)![1];
  const changePct = ((price - prior) / prior) * 100;
  if (!Number.isFinite(price) || !Number.isFinite(changePct)) return null;
  return { symbol, price, prevClose: prior, changePct, history, source };
}

const fromBars = (symbol: string, bars: Bar[], source: Quote["source"]) => quoteFromCloses(symbol, bars.map((b) => [b.t, b.c]), source);

async function singleQuote(symbol: string): Promise<Quote | null> {
  try {
    if (isVnSymbol(symbol)) {
      const { bars, source } = await vnDaily(symbol, 30);
      return fromBars(symbol, bars, source);
    }
    const d = await getChart(symbol, "1mo");
    // 1mo charts are hourly; collapse to daily closes.
    const q = quoteFromCloses(symbol, d.bars.map((b) => [b.t, b.c]), d.source);
    return q && d.proxy ? { ...q, proxy: d.proxy } : q;
  } catch {
    return null;
  }
}

/**
 * Last good quote per symbol, so a briefing built while Yahoo is rate-limiting still shows recent
 * prices (flagged `stale`) instead of empty cards. One small JSON blob; each symbol saved at most every 10 min.
 */
const LAST_KEY = "px:last";
const STALE_MAX_MS = 4 * 86400_000;
/** When each symbol was last saved by this server instance (each symbol saved at most every 10 min). */
const savedAt = new Map<string, number>();

async function rememberAndFill(uniq: string[], got: Map<string, Quote>, allowStale: boolean): Promise<void> {
  if (!allowStale && !got.size) return;
  const last = (await getJSON<Record<string, Quote & { at: number }>>(LAST_KEY).catch(() => null)) ?? {};
  const now = Date.now();
  if (allowStale) {
    for (const s of uniq) {
      const q = last[s];
      if (!got.has(s) && q && now - q.at < STALE_MAX_MS) got.set(s, { ...q, stale: true });
    }
  }
  const fresh = [...got.values()].filter((q) => !q.stale && now - (savedAt.get(q.symbol) ?? 0) > 600_000);
  if (!fresh.length) return;
  for (const q of fresh) {
    last[q.symbol] = { ...q, at: now };
    savedAt.set(q.symbol, now);
  }
  // Keep the blob small: the 400 most recently updated symbols.
  const kept = Object.fromEntries(Object.entries(last).sort((a, b) => b[1].at - a[1].at).slice(0, 400));
  await setJSON(LAST_KEY, kept).catch(() => {});
}

/** Quotes for many symbols. `allowStale` (default) fills gaps from the last good copy; grading turns it off. */
export async function getQuotes(symbols: string[], opts: { allowStale?: boolean } = {}): Promise<Quote[]> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const vn = uniq.filter(isVnSymbol);
  const other = uniq.filter((s) => !isVnSymbol(s));
  const got = new Map<string, Quote>();
  await Promise.all([
    (async () => {
      if (!other.length) return;
      const sp = await yahooSpark(other, "1mo", "1d");
      for (const [s, v] of sp) {
        const q = quoteFromCloses(s, v.points, "yahoo");
        if (q) got.set(s, q);
      }
    })(),
    (async () => {
      if (!vn.length) return;
      const m = await vndirectDaily(vn, 30).catch(() => new Map<string, Bar[]>());
      for (const [s, bars] of m) {
        const q = fromBars(s, bars, "vndirect");
        if (q) got.set(s, q);
      }
    })(),
  ]);
  const missing = uniq.filter((s) => !got.has(s));
  // Per-symbol fallbacks, bounded: a rate-limited minute shouldn't fan out into dozens of requests.
  const filled = await pool(missing.slice(0, 30), 4, singleQuote);
  filled.forEach((q) => q && got.set(q.symbol, q));
  // Yahoo-only symbols (indexes, futures, FX): a tracking ETF priced by Nasdaq beats a stale price.
  const proxied = uniq.filter((s) => !got.has(s) && PROXIES[s]);
  if (proxied.length) {
    const px = await pool(proxied, 3, async (s) => ({ s, q: got.get(PROXIES[s]) ?? (await singleQuote(PROXIES[s])) }));
    for (const { s, q } of px) if (q && !q.stale) got.set(s, { ...q, symbol: s, proxy: PROXIES[s] });
  }
  await rememberAndFill(uniq, got, opts.allowStale !== false);
  return uniq.map((s) => got.get(s)).filter((q): q is Quote => q != null);
}

/** One fresh quote (never stale: used for grading calls). */
export async function getQuote(symbol: string): Promise<Quote | null> {
  return (await getQuotes([symbol], { allowStale: false }))[0] ?? null;
}

export function quotesAsText(quotes: Quote[]): string {
  if (!quotes.length) return "(price data unavailable)";
  return quotes
    .map((q) => {
      const h = q.history;
      const wk = h.length > 5 ? ((q.price - h[h.length - 6][1]) / h[h.length - 6][1]) * 100 : NaN;
      const mo = h.length > 1 ? ((q.price - h[0][1]) / h[0][1]) * 100 : NaN;
      const f = (n: number) => (isNaN(n) ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);
      const name = symLabel(q.symbol);
      return `${q.symbol}${name !== q.symbol && !q.symbol.endsWith(".VN") ? ` (${name})` : ""}${q.proxy ? ` [priced via the ${q.proxy} ETF]` : ""}: ${q.price.toFixed(2)}${q.stale ? " [stale, from an earlier fetch]" : ""} (last session ${f(q.changePct)}, 5d ${f(wk)}, 1mo ${f(mo)})`;
    })
    .join("\n");
}

export const macroLabel = (symbol: string) => symLabel(symbol);

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
