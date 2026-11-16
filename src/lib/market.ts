/**
 * Daily quotes (price, previous close, ~1 month of closes) for the briefings and the strip.
 * Batched to stay under free sources' rate limits:
 *   non-Vietnamese symbols: one Yahoo spark request per 20 symbols, then per-symbol fallbacks
 *     (Yahoo chart, then Nasdaq for US stocks/ETFs/Nasdaq indexes) for anything missing;
 *   Vietnamese symbols (*.VN): one VNDirect request for all of them, then DNSE/Vietcap per symbol.
 */
import { getChart, type Bar } from "./chart";
import { PROXIES, isPercentQuote, priceDigits, symLabel } from "./symbols";
import type { Quote } from "./types";
import { getJSON, setJSON } from "./store";
import { isVnSymbol, pool, vnDaily, vndirectDaily } from "./vnmarket";
import { hasWorldDaily, worldDaily } from "./worldmarket";
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
    if (!q) return null;
    return { ...q, ...(d.proxy ? { proxy: d.proxy } : {}), ...(d.estimatedVia ? { estimatedVia: d.estimatedVia } : {}), ...(d.dailyOnly ? { dailyOnly: true } : {}) };
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
  // Real world levels (VNDirect daily) for Yahoo-only indexes, futures and FX: one request per table,
  // which the per-symbol fallbacks below then read from cache.
  if (missing.some(hasWorldDaily)) await worldDaily(missing.filter(hasWorldDaily)).catch(() => null);
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

export function quotesAsText(quotes: Quote[]): string {
  if (!quotes.length) return "(price data unavailable)";
  return quotes
    .map((q) => {
      const h = q.history;
      const wk = h.length > 5 ? ((q.price - h[h.length - 6][1]) / h[h.length - 6][1]) * 100 : NaN;
      const mo = h.length > 1 ? ((q.price - h[0][1]) / h[0][1]) * 100 : NaN;
      const f = (n: number) => (isNaN(n) ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);
      const name = symLabel(q.symbol);
      const label = `${q.symbol}${name !== q.symbol && !q.symbol.endsWith(".VN") ? ` (${name})` : ""}`;
      return `${label}: ${levelText(q)}${q.stale ? " [stale, from an earlier fetch]" : ""} (last session ${f(q.changePct)}, 5d ${f(wk)}, 1mo ${f(mo)})`;
    })
    .join("\n");
}

export const macroLabel = (symbol: string) => symLabel(symbol);

/**
 * How a price is shown to the AI, with the session it belongs to: a real level, a real level carried
 * forward by a same-hours ETF (marked ≈), or "level unknown" when only an ETF's price exists.
 */
export function levelText(q: Quote): string {
  const px = (v: number) => v.toFixed(priceDigits(q.symbol, v) ?? 2);
  const date = q.history.at(-1)?.[0];
  const prevDate = q.history.at(-2)?.[0];
  if (q.proxy) return `level unknown [tracked by the ${q.proxy} ETF: use % moves only, never quote a price level]`;
  if (q.estimatedVia) return `≈${px(q.price)} [estimate for the ${date} session: the ${prevDate} official close ${px(q.prevClose)} moved with the ${q.estimatedVia} ETF; say "about"]`;
  return `${px(q.price)}${date ? ` [${q.dailyOnly ? "close of " : "as of "}${date}]` : ""}`;
}
/** Names for the AI, where the short UI label is ambiguous ("Dollar" was read as USD/VND). */
const PROMPT_NAMES: Record<string, string> = { "DX-Y.NYB": "US dollar index (DXY, vs euro, yen etc.; not USD/VND)", "^TNX": "US 10-year Treasury yield (%)" };
const promptName = (s: string) => PROMPT_NAMES[s] ?? macroLabel(s);

export function macroAsText(quotes: Quote[], wanted: string[] = []): string {
  // Say what's missing, so the model doesn't fill the gap from memory or from a look-alike row.
  const missing = wanted.filter((s) => !quotes.some((q) => q.symbol === s)).map((s) => `${promptName(s)}: unavailable today (don't guess it)`);
  if (!quotes.length) return missing.length ? missing.join("\n") : "(macro data unavailable)";
  return [...quotes
    .map((q) => {
      const h = q.history;
      const wk = h.length > 5 ? ((q.price - h[h.length - 6][1]) / h[h.length - 6][1]) * 100 : NaN;
      const f = (n: number) => (isNaN(n) ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);
      // Yields move in basis points, not percent of themselves (5.10% → 5.15% is +5 bp, not "+1.0%").
      if (isPercentQuote(q.symbol)) {
        const bp = (d: number) => (Number.isFinite(d) ? `${d >= 0 ? "+" : ""}${Math.round(d * 100)} bp` : "n/a");
        const back = h.length > 5 ? h[h.length - 6][1] : NaN;
        return `${promptName(q.symbol)}: ${levelText(q)} (1d ${bp(q.price - q.prevClose)}, 5d ${bp(q.price - back)})`;
      }
      if (!q.proxy) return `${promptName(q.symbol)}: ${levelText(q)} (1d ${f(q.changePct)}, 5d ${f(wk)})`;
      // e.g. USO ~145 is not "oil at $145", UUP ~29.5 is not the dollar index (or USD/VND).
      const note = q.symbol === "^VIX" ? "the VIXY futures ETF: direction only, it moves less than the VIX itself" : `the ${q.proxy} ETF: % moves only`;
      return `${promptName(q.symbol)}: level unknown [tracked by ${note}; never quote a price level] (1d ${f(q.changePct)}, 5d ${f(wk)})`;
    }), ...missing]
    .join("\n");
}
