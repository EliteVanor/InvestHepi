/**
 * Exchange clocks and the prediction markets. Pure (no I/O), so the scheduler, grading, the track
 * record and the page all use the same hours.
 *
 * Holidays are not modeled: a holiday simply has no price bar, and grading marks a daily call on it
 * "market closed, not graded" (track.ts).
 */
import { exchangeTz } from "./symbols";
import type { Interest, SectionId } from "./types";

/** Regular session per exchange time zone, minutes after local midnight. */
export const SESSIONS: Record<string, { open: number; close: number }> = {
  "America/New_York": { open: 570, close: 960 }, // 9:30-16:00
  "Asia/Ho_Chi_Minh": { open: 540, close: 885 }, // HOSE 9:00-14:45 (ATC)
  "Asia/Tokyo": { open: 540, close: 930 }, // 9:00-15:30
  "Asia/Seoul": { open: 540, close: 930 },
  "Asia/Hong_Kong": { open: 570, close: 960 },
  "Asia/Shanghai": { open: 570, close: 900 },
  "Asia/Kolkata": { open: 555, close: 930 },
  "Europe/London": { open: 480, close: 990 },
  "Europe/Berlin": { open: 540, close: 1050 },
  "Europe/Paris": { open: 540, close: 1050 },
};
const sessionOf = (tz: string) => SESSIONS[tz] ?? SESSIONS["America/New_York"];

/** Closing prints settle a few minutes after the bell. */
export const SETTLE_MINS = 15;

const fmts = new Map<string, Intl.DateTimeFormat>();
/** Local date (YYYY-MM-DD), minutes after midnight and weekday (0 = Sunday) of `d` in `tz`. */
export function localNow(d: Date | number, tz: string): { date: string; mins: number; wd: number } {
  let f = fmts.get(tz);
  if (!f) fmts.set(tz, (f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })));
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, mins: (Number(p.hour) % 24) * 60 + Number(p.minute), wd: new Date(date + "T12:00:00Z").getUTCDay() };
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const isWeekend = (iso: string) => [0, 6].includes(new Date(iso + "T12:00:00Z").getUTCDay());

/** The n-th weekday counting `date` itself (n = 1 is `date` when it's a weekday). Holidays aren't known. */
export function nthWeekday(date: string, n: number): string {
  let d = date;
  while (isWeekend(d)) d = addDays(d, 1);
  for (let i = 1; i < n; ) {
    d = addDays(d, 1);
    if (!isWeekend(d)) i++;
  }
  return d;
}

/** UTC instant of a local wall-clock time (`mins` after midnight on `date`) in `tz`. */
export function zonedToUtc(date: string, mins: number, tz: string): Date {
  const guess = new Date(`${date}T00:00:00Z`).getTime() + mins * 60_000;
  const l = localNow(guess, tz);
  const shown = new Date(`${l.date}T00:00:00Z`).getTime() + l.mins * 60_000;
  const first = guess - (shown - guess);
  // Second pass for the hours around a DST change.
  const l2 = localNow(first, tz);
  const shown2 = new Date(`${l2.date}T00:00:00Z`).getTime() + l2.mins * 60_000;
  return new Date(first + (guess - shown2));
}

export const openUtc = (date: string, tz: string) => zonedToUtc(date, sessionOf(tz).open, tz);
export const closeUtc = (date: string, tz: string) => zonedToUtc(date, sessionOf(tz).close, tz);

/** Whether the session on `date` is over on that clock (close plus settling). */
export function sessionClosed(date: string, tz: string, now: Date | number): boolean {
  const { date: today, mins } = localNow(now, tz);
  return date < today || (date === today && mins >= sessionOf(tz).close + SETTLE_MINS);
}

/**
 * The session a daily call made at `now` is graded on, on the ticker's own exchange: today's when it
 * hasn't closed yet, otherwise the next weekday's. `opened` says whether that session had already
 * started (then the call must be measured from the price at that moment, not the previous close).
 */
export function dailyTarget(now: Date | number, ticker: string): { date: string; opened: boolean; tz: string } {
  const tz = exchangeTz(ticker);
  const { date, mins } = localNow(now, tz);
  const s = sessionOf(tz);
  if (!isWeekend(date) && mins < s.close) return { date, opened: mins >= s.open, tz };
  let d = addDays(date, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return { date: d, opened: false, tz };
}

/** The weekday before `date`. */
export function prevWeekday(date: string): string {
  let d = addDays(date, -1);
  while (isWeekend(d)) d = addDays(d, -1);
  return d;
}

/** The latest session on a ticker's exchange that has closed by `now` (weekdays; holidays unknown). */
export function lastFinishedSession(symbol: string, now: Date | number, proxy?: string): string {
  const tz = proxy ? "America/New_York" : exchangeTz(symbol);
  let d = localNow(now, tz).date;
  while (isWeekend(d) || !sessionClosed(d, tz, now)) d = addDays(d, -1);
  return d;
}

/* --------------------------------------------------------- prediction markets */

export type Phase = "pre" | "mid";
/**
 * Markets that get their own prediction runs (two each per weekday, each run calls only its own
 * market): Vietnam, US, and each World market (Japan, China & Hong Kong, Europe, US stocks, oil, gold).
 */
export type PredMarket = "vn" | "us" | "jp" | "cn" | "eu" | "wus" | "oil" | "gold";
/** Timetable markets: the shared ones plus each interest set's US and Vietnam parts. */
export type SlotMarket = PredMarket | "ius" | "ivn";

export const MARKET_TZ: Record<SlotMarket, string> = {
  vn: "Asia/Ho_Chi_Minh",
  ivn: "Asia/Ho_Chi_Minh",
  us: "America/New_York",
  wus: "America/New_York",
  oil: "America/New_York",
  gold: "America/New_York",
  ius: "America/New_York",
  jp: "Asia/Tokyo",
  cn: "Asia/Hong_Kong",
  eu: "Europe/London",
};

/** Which World group (config.ts WORLD_GROUPS id) each World market predicts. */
export const WORLD_MARKETS: Record<"jp" | "cn" | "eu" | "wus" | "oil" | "gold", string> = {
  jp: "w-japan",
  cn: "w-china",
  eu: "w-europe",
  wus: "w-us",
  oil: "w-oil",
  gold: "w-gold",
};
export const WORLD_ORDER = ["jp", "cn", "eu", "wus", "oil", "gold"] as const;

export const sectionOfMarket = (m: SlotMarket): SectionId => (m === "vn" ? "vn" : m === "us" ? "us" : m === "ius" || m === "ivn" ? "interests" : "world");

/** An interest belongs to the Vietnam clock when its first ticker is Vietnamese, to the US clock otherwise. */
export const interestMarket = (i: Interest): "us" | "vn" => (i.tickers[0]?.toUpperCase().endsWith(".VN") ? "vn" : "us");

/** An interest set's part on one market's clock (empty when it has none there). */
export function interestPart(interests: Interest[], market: "us" | "vn"): Interest[] {
  return interests.filter((i) => i.tickers.length && interestMarket(i) === market);
}

/** When a prediction run's "before market" window closes: the market's open on the target day. */
export function preDeadline(market: SlotMarket, now: Date | number): Date {
  const tz = MARKET_TZ[market];
  const { date, mins } = localNow(now, tz);
  const s = sessionOf(tz);
  let d = !isWeekend(date) && mins < s.close ? date : addDays(date, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return openUtc(d, tz);
}

/** Short city name of a market clock, for labels ("08:15 Hanoi"). */
export const MARKET_CITY: Record<string, string> = {
  "Asia/Ho_Chi_Minh": "Hanoi",
  "America/New_York": "New York",
  "Asia/Tokyo": "Tokyo",
  "Asia/Hong_Kong": "Hong Kong",
  "Asia/Shanghai": "Shanghai",
  "Asia/Seoul": "Seoul",
  "Asia/Kolkata": "Mumbai",
  "Europe/London": "London",
  "Europe/Berlin": "Frankfurt",
  "Europe/Paris": "Paris",
};
