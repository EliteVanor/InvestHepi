/**
 * The current quote, browser-safe part: the shape every screen reads and the pure rules behind it
 * (session state, stale, window changes, polling hours, overlaying a live quote on a briefing's
 * snapshot, currency). The server part that fetches it is `quote.ts`.
 *
 * `sessionState` is the one place that answers "is this symbol's market open now": holidays and early
 * closes come from the exchange calendars (holidays.ts via markets.ts isTradingDay / closeMinsOn).
 */
import { SESSIONS, calendarKey, closeMinsOn, isTradingDay, lastFinishedSession, localNow, zonedToUtc } from "./markets";
import { exchangeTz, priceDigits } from "./symbols";
import type { Quote } from "./types";

/** What the price is: a real level, a tracking ETF's price (never shown as a level), or a real level estimated from a same-hours ETF. */
export type QuoteBasis = "level" | "proxy" | "estimate";
/** The exchange's state now. "break" is Hanoi's lunch break. */
export type SessionState = "pre" | "open" | "break" | "after" | "closed";
export type QuoteWindow = "5d" | "1mo";

/** A pre-market or after-hours print, shown beside the regular-session price, never instead of it. */
export interface ExtendedPrint {
  kind: "pre" | "after";
  price: number;
  /** vs the regular-session price. */
  changePct: number;
  asOf: number;
}

export interface CurrentQuote {
  symbol: string;
  /** The regular-session price (the close once the session ends). Basis "proxy": the ETF's price. */
  price: number;
  prevClose: number;
  changePct: number;
  /** Exchange-local date (YYYY-MM-DD) of the session `price` belongs to. */
  session: string;
  /** The exchange's state now. */
  state: SessionState;
  /** `price` is a print from inside `session` (false: a daily close). */
  intraday: boolean;
  extended?: ExtendedPrint;
  basis: QuoteBasis;
  /** The ETF behind a "proxy" or "estimate" basis. */
  via?: string;
  /** Daily closes only for this market. */
  dailyOnly?: boolean;
  currency?: string;
  /** Live and not updated for 15 min during its session, or a daily close older than the latest finished session. */
  stale: boolean;
  /** The close comes from a daily row that may carry the after-hours print (no 1-day series to confirm it). */
  provisional?: boolean;
  /** Unix seconds of `price`. */
  asOf: number;
  source: string;
  /** The session's intraday path (baseline prevClose) when `intraday`, else recent daily closes. */
  spark: number[];
  /** A daily (non-intraday) reading's closes, [exchange date, close], oldest first. */
  closes?: [string, number][];
  /** 5-session and one-month changes, when asked for (same series as `price`; null when unknown). */
  changes?: Record<QuoteWindow, number | null>;
}

const NY = "America/New_York";
/**
 * Lunch breaks, minutes after local midnight: the one place they live. The v18 timetable puts the
 * Tokyo (11:45) and Hong Kong (12:15) mid-day prediction runs inside them on purpose.
 */
export const SESSION_BREAKS: Record<string, { from: number; to: number }> = {
  "Asia/Tokyo": { from: 690, to: 750 }, // 11:30-12:30
  "Asia/Hong_Kong": { from: 720, to: 780 }, // 12:00-13:00
  "Asia/Shanghai": { from: 690, to: 780 }, // 11:30-13:00
  "Asia/Ho_Chi_Minh": { from: 690, to: 780 }, // 11:30-13:00
};
const STALE_MS = 15 * 60_000;

/** The exchange clock a quote runs on: an ETF stand-in trades in New York. */
export const quoteTz = (symbol: string, via?: string) => (via ? NY : exchangeTz(symbol));

/** FX, futures and crypto trade (nearly) around the clock. */
export const isNear24h = (symbol: string) => /=X$|=F$|-USD$/.test(symbol);

/**
 * The state of a symbol's exchange at `now`: its regular session on its own calendar (weekends and
 * holidays closed, early closes end the session early). The one "is this market open now" function:
 * polling (liveHours), stale (isStale), the quote's `state` and the chart's live dot all ask it.
 */
export function sessionState(symbol: string, now: Date | number, via?: string): SessionState {
  const tz = quoteTz(symbol, via);
  const { date, mins } = localNow(now, tz);
  if (!isTradingDay(date, calendarKey(symbol, via))) return "closed";
  const s = SESSIONS[tz] ?? SESSIONS[NY];
  if (mins < s.open) return "pre";
  if (mins >= closeMinsOn(tz, date)) return "after";
  const br = SESSION_BREAKS[tz];
  if (br && mins >= br.from && mins < br.to) return "break";
  return "open";
}

/**
 * Whether a symbol's price moves now, so the page polls it every minute (Q8): crypto always; FX from
 * Sunday 17:00 to Friday 17:00 New York; futures the same with their 17:00-18:00 daily pause; everything
 * else during its own exchange's regular session.
 */
export function liveHours(symbol: string, now: Date | number): boolean {
  if (/-USD$/.test(symbol)) return true;
  if (/=X$|=F$/.test(symbol)) {
    const { date, mins, wd } = localNow(now, NY);
    if (wd === 6) return false;
    // CME holidays (Thanksgiving, Christmas...) for futures; FX has no exchange calendar.
    if (symbol.endsWith("=F") && wd !== 0 && !isTradingDay(date, "CME")) return false;
    if (wd === 0) return mins >= (symbol.endsWith("=F") ? 1080 : 1020);
    if (wd === 5 && mins >= 1020) return false;
    return !(symbol.endsWith("=F") && mins >= 1020 && mins < 1080);
  }
  return sessionState(symbol, now) === "open";
}

/**
 * Stale (Q4): a live price with no update for 15 minutes while its session is open (counted from the
 * open, or from the restart after a lunch break, so the first minutes aren't stale), or a daily close
 * older than the latest finished session. During a lunch break the morning's last print is live (it is
 * the mid-day base). A source's own stale flag (last good copy) always wins.
 */
export function isStale(q: Pick<CurrentQuote, "symbol" | "intraday" | "asOf" | "session" | "via"> & { stale?: boolean }, now: Date | number): boolean {
  if (q.stale) return true;
  const t = typeof now === "number" ? now : now.getTime();
  if (q.intraday && (isNear24h(q.symbol) ? liveHours(q.symbol, t) : sessionState(q.symbol, t, q.via) === "open")) {
    const tz = quoteTz(q.symbol, q.via);
    const { date, mins } = localNow(t, tz);
    const br = SESSION_BREAKS[tz];
    const restart = br && mins >= br.to ? br.to : (SESSIONS[tz] ?? SESSIONS[NY]).open;
    const open = isNear24h(q.symbol) ? 0 : zonedToUtc(date, restart, tz).getTime();
    return t - Math.max(q.asOf * 1000, open) > STALE_MS;
  }
  if (isNear24h(q.symbol) && q.intraday) return false;
  return q.session < lastFinishedSession(q.symbol, t, q.via);
}

/** The same calendar date one month earlier, clamped to the month's last day (Mar 31 → Feb 28/29). */
export function monthBefore(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return `${py}-${String(pm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/**
 * Change over a window (Q7), from daily closes [exchange date, close] (oldest first) to `price`, the
 * price of `session`. 5D: the close 5 sessions back (holidays have no bar, so they don't count).
 * 1M: the last close on or before the same calendar date one month earlier (a long holiday like Tet
 * doesn't stretch it). Closes dated `session` or later are the current price, not a base. Null when
 * the history doesn't reach back far enough.
 */
export function windowChange(history: [string, number][], price: number, window: QuoteWindow, session?: string): number | null {
  const base = windowBase(history, window, session);
  return base && Number.isFinite(price) ? ((price - base) / base) * 100 : null;
}

/** The base close of a window (see windowChange), e.g. for a yield's change in basis points. */
export function windowBase(history: [string, number][], window: QuoteWindow, session?: string): number | null {
  const today = session ?? history.at(-1)?.[0];
  if (!today) return null;
  const before = history.filter(([d, c]) => d < today && Number.isFinite(c) && c > 0);
  if (window === "5d") return before.length >= 5 ? before[before.length - 5][1] : null;
  const target = monthBefore(today);
  if (!before.length || before[0][0] > target) return null;
  return before.filter(([d]) => d <= target).at(-1)?.[1] ?? null;
}

/**
 * Whether a live quote may replace a briefing's quote: same basis (both real, or the same ETF), or a
 * real level replacing an ETF stand-in. Never an ETF price over a real level.
 */
export const canOverlay = (digestProxy?: string, liveProxy?: string) => (digestProxy ?? "") === (liveProxy ?? "") || (!!digestProxy && !liveProxy);

/** The flags a Quote carries for a current quote's basis. */
function basisFlags(l: CurrentQuote): Partial<Quote> {
  return {
    proxy: l.basis === "proxy" ? l.via : undefined,
    estimatedVia: l.basis === "estimate" ? l.via : undefined,
    dailyOnly: l.dailyOnly,
    session: l.session,
    stale: l.stale,
    extended: l.extended,
  };
}

/** A briefing's quote with the current quote laid over it (keeps the month of history; the stale label comes along, never dropped). */
export function overlayQuote(q: Quote, l: CurrentQuote | undefined): Quote {
  const liveProxy = l?.basis === "proxy" ? l.via : undefined;
  if (!l || !canOverlay(q.proxy, liveProxy)) return q;
  return { ...q, ...basisFlags(l), price: l.price, prevClose: l.prevClose, changePct: l.changePct, spark: l.intraday ? l.spark : undefined };
}

/** A current quote as a Quote, for a symbol the briefing didn't price. */
export function quoteFromCurrent(l: CurrentQuote): Quote {
  return {
    symbol: l.symbol, price: l.price, prevClose: l.prevClose, changePct: l.changePct, source: l.source as Quote["source"],
    history: l.intraday ? [] : l.closes ?? [],
    spark: l.intraday ? l.spark : undefined,
    ...basisFlags(l),
  };
}

/** A price may be shown as a level unless it is an ETF stand-in's (Q5: then only its % with "via <ETF>"). */
export const showsLevel = (q: { proxy?: string; basis?: QuoteBasis }) => !q.proxy && q.basis !== "proxy";

type Levelled = { symbol: string; price: number; proxy?: string; estimatedVia?: string; basis?: QuoteBasis; via?: string };
/**
 * How a price is written on every screen (strip, watchlist, search, chart header, alert emails): the
 * level, "≈level" for an estimate, or "via <ETF>" for a stand-in, never the ETF's price as the level.
 */
export function levelLabel(q: Levelled, opts: { fmt?: (n: number, digits?: number) => string; via?: (etf: string) => string } = {}): string {
  const proxy = q.proxy ?? (q.basis === "proxy" ? q.via : undefined);
  if (proxy) return (opts.via ?? ((e) => `via ${e}`))(proxy);
  const est = q.estimatedVia ?? (q.basis === "estimate" ? q.via : undefined);
  const fmt = opts.fmt ?? ((n: number, d?: number) => n.toFixed(d ?? 2));
  return `${est ? "≈" : ""}${fmt(q.price, priceDigits(q.symbol, q.price))}`;
}

/**
 * The chart header's quote: the current quote when the reply has one, otherwise the same fields read
 * from the series itself (one path for both).
 */
export function headerQuote(d: { symbol: string; price: number; prevClose: number; changePct: number; asOf: number; stale?: boolean; proxy?: string; estimatedVia?: string; dailyOnly?: boolean; range: string; quote?: CurrentQuote | null }): Pick<CurrentQuote, "symbol" | "price" | "prevClose" | "changePct" | "asOf" | "stale" | "basis" | "via" | "dailyOnly" | "intraday" | "extended"> & { session?: string } {
  if (d.quote) return d.quote;
  const via = d.proxy ?? d.estimatedVia;
  return {
    symbol: d.symbol, price: d.price, prevClose: d.prevClose, changePct: d.changePct, asOf: d.asOf, stale: !!d.stale,
    basis: d.proxy ? "proxy" : d.estimatedVia ? "estimate" : "level", ...(via ? { via } : {}),
    dailyOnly: d.dailyOnly, intraday: d.range === "1d" && !d.dailyOnly,
  };
}

/** A mover's day change: the current quote's when there is one, else the briefing's. */
export const moverChange = (m: { ticker: string; changePct: number }, quotes: { symbol: string; changePct: number }[]) =>
  quotes.find((q) => q.symbol === m.ticker)?.changePct ?? m.changePct;

/** Trading currency by listing (indexes have none). */
export function currencyOf(symbol: string): string | undefined {
  if (symbol.startsWith("^") || /=F$/.test(symbol)) return undefined;
  if (symbol.endsWith(".VN")) return "VND";
  if (/=X$/.test(symbol)) return undefined;
  if (symbol.endsWith(".T")) return "JPY";
  if (symbol.endsWith(".HK")) return "HKD";
  if (symbol.endsWith(".KS")) return "KRW";
  if (symbol.endsWith(".SS") || symbol.endsWith(".SZ")) return "CNY";
  if (symbol.endsWith(".L")) return "GBP";
  if (symbol.endsWith(".DE") || symbol.endsWith(".PA")) return "EUR";
  if (symbol.endsWith(".NS") || symbol.endsWith(".BO")) return "INR";
  return "USD";
}

/** How often the page polls a set of symbols: every minute while any of them trades, else every 5 minutes. */
export const pollInterval = (symbols: string[], now: Date | number = Date.now()) => (symbols.some((s) => liveHours(s, now)) ? 60_000 : 300_000);

const FULL_MS = 5 * 60_000;
/**
 * Which symbols one poll asks for (Q8 follows each symbol's hours without polling more): the whole set
 * when 5 minutes have passed since the last full request, otherwise only the symbols trading now, at
 * most every `everyMs`; nothing when none trades. Pure, for tests.
 */
export function pollPlan(symbols: string[], now: number, last: { lastFull: number; lastAny: number; everyMs?: number }): string[] {
  const slack = 1000; // the page's minute timer drifts a little
  if (now - last.lastFull >= FULL_MS - slack) return symbols;
  if (now - last.lastAny < (last.everyMs ?? 60_000) - slack) return [];
  const open = symbols.filter((s) => liveHours(s, now));
  // FX, futures and crypto alone don't earn a minute step (they trade around the clock, so they would
  // keep every page polling all night): they ride along while an exchange in the set is open, and
  // refresh with the full set every 5 minutes otherwise.
  return open.some((s) => !isNear24h(s)) ? open : [];
}
