/**
 * Exchange clocks and the prediction markets. Pure (no I/O), so the scheduler, grading, the track
 * record and the page all use the same hours.
 *
 * Holidays and early closes come from the table in holidays.ts (2026-2027, per exchange). A closure the
 * table doesn't know simply has no price bar, and grading still marks a daily call on it "market closed,
 * not graded" once a later bar exists or 48 h passed (track.ts).
 */
import { earlyCloseMins, isHoliday } from "./holidays";
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
/**
 * A calendar key is an exchange time zone, or "CME" for oil and gold futures (New York's clock, but CME's
 * holidays: Globex trades on Thanksgiving). `zoneOf` is the real time zone behind a key.
 */
export const zoneOf = (key: string) => (key === "CME" ? "America/New_York" : key);
/** The calendar key of a ticker's own exchange; an ETF stand-in (`proxy`) follows New York's NYSE. */
export const calendarKey = (symbol: string, proxy?: string) => (proxy ? "America/New_York" : /=F$/.test(symbol) ? "CME" : exchangeTz(symbol));
/** Closing minute of the session on `date` (an early close ends it sooner). */
export const closeMinsOn = (tz: string, date: string): number => earlyCloseMins(tz, date) ?? sessionOf(tz).close;
/** The date `now` falls on in the zone behind a calendar key. */
export const localDate = (key: string, now: Date | number): string => localNow(now, zoneOf(key)).date;
/** Regular session hours in minutes after local midnight, for the day `date` when given. */
export const sessionHours = (tz: string, date?: string) => ({ open: sessionOf(tz).open, close: date ? closeMinsOn(tz, date) : sessionOf(tz).close });

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
/** A day the exchange on `tz` trades: a weekday that isn't in its holiday table (without `tz`: any weekday). */
export const isTradingDay = (iso: string, tz?: string) => !isWeekend(iso) && !(tz && isHoliday(tz, iso));

/**
 * The n-th trading day counting `date` itself (n = 1 is `date` when it trades). With `tz`, the exchange's
 * holidays are skipped; without it, only weekends.
 */
export function nthWeekday(date: string, n: number, tz?: string): string {
  let d = date;
  while (!isTradingDay(d, tz)) d = addDays(d, 1);
  for (let i = 1; i < n; ) {
    d = addDays(d, 1);
    if (isTradingDay(d, tz)) i++;
  }
  return d;
}
/** The first trading day after `date` on the exchange's calendar. */
export function nextTradingDay(date: string, tz?: string): string {
  let d = addDays(date, 1);
  while (!isTradingDay(d, tz)) d = addDays(d, 1);
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

export const openUtc = (date: string, tz: string) => zonedToUtc(date, sessionOf(tz).open, zoneOf(tz));
export const closeUtc = (date: string, tz: string) => zonedToUtc(date, closeMinsOn(tz, date), zoneOf(tz));

/**
 * Whether the session on `date` is over on that clock (close plus settling). A holiday is over from
 * its first minute (there is nothing to wait for).
 */
export function sessionClosed(date: string, tz: string, now: Date | number): boolean {
  const { date: today, mins } = localNow(now, zoneOf(tz));
  if (isHoliday(tz, date)) return date <= today;
  return date < today || (date === today && mins >= closeMinsOn(tz, date) + SETTLE_MINS);
}

/**
 * The session a daily call made at `now` is graded on, on the ticker's own exchange: today's when it
 * hasn't closed yet, otherwise the next weekday's. `opened` says whether that session had already
 * started (then the call must be measured from the price at that moment, not the previous close).
 */
export function dailyTarget(now: Date | number, ticker: string): { date: string; opened: boolean; tz: string } {
  const tz = calendarKey(ticker);
  const { date, mins } = localNow(now, zoneOf(tz));
  const s = sessionOf(tz);
  if (isTradingDay(date, tz) && mins < closeMinsOn(tz, date)) return { date, opened: mins >= s.open, tz };
  return { date: nextTradingDay(date, tz), opened: false, tz };
}

/** The trading day before `date` (with `tz`, on that exchange's calendar; without, weekends only). */
export function prevWeekday(date: string, tz?: string): string {
  let d = addDays(date, -1);
  while (!isTradingDay(d, tz)) d = addDays(d, -1);
  return d;
}

/** The latest session on a ticker's exchange that has closed by `now` (trading days only; an early close ends it early). */
export function lastFinishedSession(symbol: string, now: Date | number, proxy?: string): string {
  const tz = calendarKey(symbol, proxy);
  let d = localNow(now, zoneOf(tz)).date;
  while (!isTradingDay(d, tz) || !sessionClosed(d, tz, now)) d = addDays(d, -1);
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

/**
 * The calendars (keys) a market's benchmarks trade on. Europe's group spans London (FTSE) and Frankfurt
 * (DAX, Euro Stoxx 50); oil and gold are CME futures. The rest follow `MARKET_TZ`.
 */
export const MARKET_CALENDARS: Record<SlotMarket, string[]> = {
  ...(Object.fromEntries(Object.entries(MARKET_TZ).map(([m, tz]) => [m, [tz]])) as Record<SlotMarket, string[]>),
  eu: ["Europe/London", "Europe/Berlin"],
  oil: ["CME"],
  gold: ["CME"],
};

/**
 * When a prediction run's "before market" window closes: the first open of the market's exchanges on the
 * target day (a day when only some of them trade counts).
 */
export function preDeadline(market: SlotMarket, now: Date | number): Date {
  return new Date(
    Math.min(
      ...MARKET_CALENDARS[market].map((key) => {
        const { date, mins } = localNow(now, zoneOf(key));
        const d = isTradingDay(date, key) && mins < closeMinsOn(key, date) ? date : nextTradingDay(date, key);
        return openUtc(d, key).getTime();
      }),
    ),
  );
}

/** Whether any exchange of a market trades on the local date of `at` (its own clock). */
export const marketTradesOn = (market: SlotMarket, at: Date | number): boolean => MARKET_CALENDARS[market].some((key) => isTradingDay(localDate(key, at), key));

/**
 * Whether a run at `at` still leaves room for its calls: before market always (when the market trades); mid-day
 * only when some trading exchange of the market closes at least `MID_MIN_LEFT` minutes later (a half session is
 * too short for a mid-day call, whose flat band assumes half a session).
 */
export const MID_MIN_LEFT = 120;
export function runPossible(market: SlotMarket, phase: Phase, at: Date | number): boolean {
  return MARKET_CALENDARS[market].some((key) => {
    const { date, mins } = localNow(at, zoneOf(key));
    if (!isTradingDay(date, key)) return false;
    return phase === "pre" || closeMinsOn(key, date) - mins >= MID_MIN_LEFT;
  });
}

/** The latest close of a market's trading exchanges on the local date of `at` (UTC ms), or `at` when none trades. */
export function marketCloseOn(market: SlotMarket, at: Date | number): number {
  const closes = MARKET_CALENDARS[market].flatMap((key) => {
    const date = localDate(key, at);
    return isTradingDay(date, key) ? [closeUtc(date, key).getTime()] : [];
  });
  return closes.length ? Math.max(...closes) : new Date(at).getTime();
}

/** A ticker whose own exchange is closed on its local date today (holiday or weekend) gets no call. */
export const tradesToday = (symbol: string, now: Date | number, proxy?: string): boolean => {
  const key = calendarKey(symbol, proxy);
  return isTradingDay(localDate(key, now), key);
};

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
