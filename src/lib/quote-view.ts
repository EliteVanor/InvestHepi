/**
 * The current quote, browser-safe part: the shape every screen reads and the pure rules behind it
 * (session state, stale, window changes, polling hours, overlaying a live quote on a briefing's
 * snapshot, currency). The server part that fetches it is `quote.ts`.
 *
 * `sessionState` is the one place that answers "is this symbol's market open now": holidays and early
 * closes come from the exchange calendars (holidays.ts via markets.ts isTradingDay / closeMinsOn).
 */
import { SESSIONS, calendarKey, closeMinsOn, isTradingDay, lastFinishedSession, localNow, zonedToUtc } from "./markets";
import { exchangeTz } from "./symbols";
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
  /** Unix seconds of `price`. */
  asOf: number;
  source: string;
  /** The session's intraday path (baseline prevClose) when `intraday`, else recent daily closes. */
  spark: number[];
  /** 5-session and one-month changes, when asked for (same series as `price`; null when unknown). */
  changes?: Record<QuoteWindow, number | null>;
}

const NY = "America/New_York";
/** Lunch break on Hanoi's exchanges, minutes after midnight. */
const VN_BREAK = { from: 690, to: 780 };
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
  if (tz === "Asia/Ho_Chi_Minh" && mins >= VN_BREAK.from && mins < VN_BREAK.to) return "break";
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
 * open, so the first minutes aren't stale), or a daily close older than the latest finished session.
 * A source's own stale flag (last good copy) always wins.
 */
export function isStale(q: Pick<CurrentQuote, "symbol" | "intraday" | "asOf" | "session" | "via"> & { stale?: boolean }, now: Date | number): boolean {
  if (q.stale) return true;
  const t = typeof now === "number" ? now : now.getTime();
  if (q.intraday && (isNear24h(q.symbol) ? liveHours(q.symbol, t) : sessionState(q.symbol, t, q.via) === "open")) {
    const tz = quoteTz(q.symbol, q.via);
    const open = isNear24h(q.symbol) ? 0 : zonedToUtc(localNow(t, tz).date, (SESSIONS[tz] ?? SESSIONS[NY]).open, tz).getTime();
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
  const today = session ?? history.at(-1)?.[0];
  if (!today || !Number.isFinite(price)) return null;
  const before = history.filter(([d, c]) => d < today && Number.isFinite(c) && c > 0);
  let base: number | undefined;
  if (window === "5d") base = before.length >= 5 ? before[before.length - 5][1] : undefined;
  else {
    const target = monthBefore(today);
    if (!before.length || before[0][0] > target) return null;
    base = before.filter(([d]) => d <= target).at(-1)?.[1];
  }
  return base ? ((price - base) / base) * 100 : null;
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
    history: l.intraday ? [] : l.spark.map((c, i) => [String(i), c] as [string, number]),
    spark: l.intraday ? l.spark : undefined,
    ...basisFlags(l),
  };
}

/** A price may be shown as a level unless it is an ETF stand-in's (Q5: then only its % with "via <ETF>"). */
export const showsLevel = (q: { proxy?: string; basis?: QuoteBasis }) => !q.proxy && q.basis !== "proxy";

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
