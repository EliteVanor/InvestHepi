/** US and Vietnam equity market sessions. Holidays and early closes come from holidays.ts. */
import { earlyCloseMins, isHoliday } from "./holidays";

export type Phase = "pre" | "open" | "after" | "closed" | "break";

const NY = "America/New_York";
const HANOI = "Asia/Ho_Chi_Minh";

function nyParts(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: NY, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "numeric", second: "numeric", hour12: false })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, secs: (Number(p.hour) % 24) * 3600 + Number(p.minute) * 60 + Number(p.second) };
}

const addDay = (iso: string, n: number) => new Date(new Date(iso + "T12:00:00Z").getTime() + n * 86400_000).toISOString().slice(0, 10);
const dayOff = (iso: string, tz: string) => [0, 6].includes(new Date(iso + "T12:00:00Z").getUTCDay()) || isHoliday(tz, iso);
/** Whole days from `date` to the next trading day on `tz`'s calendar. */
function daysToNextTrading(date: string, tz: string): number {
  let n = 1;
  while (dayOff(addDay(date, n), tz)) n++;
  return n;
}

const OPEN = 9.5 * 3600;
const CLOSE = 16 * 3600;
const PRE = 4 * 3600;
const AFTER_END = 20 * 3600;

/** Phase plus seconds until the next open (if closed/pre) or the close (if open). */
export function marketClock(now = new Date()): { phase: Phase; secs: number } {
  const { date, secs } = nyParts(now);
  const off = dayOff(date, NY);
  const close = (earlyCloseMins(NY, date) ?? CLOSE / 60) * 60;
  if (!off && secs >= OPEN && secs < close) return { phase: "open", secs: close - secs };
  const days = !off && secs < OPEN ? 0 : daysToNextTrading(date, NY);
  const untilOpen = days * 86400 + OPEN - secs;
  let phase: Phase = "closed";
  if (!off && secs >= PRE && secs < OPEN) phase = "pre";
  else if (!off && secs >= close && secs < (close < CLOSE ? 17 * 3600 : AFTER_END)) phase = "after";
  return { phase, secs: untilOpen };
}

/**
 * Ho Chi Minh City exchange (HOSE), ICT = UTC+7, no DST: 9:00-11:30 and 13:00-14:45
 * (closing auction from 14:30). Holidays (Tet etc.) come from holidays.ts.
 */
export function vnMarketClock(now = new Date()): { phase: Phase; secs: number } {
  const ict = new Date(now.getTime() + 7 * 3600_000);
  const date = ict.toISOString().slice(0, 10);
  const secs = ict.getUTCHours() * 3600 + ict.getUTCMinutes() * 60 + ict.getUTCSeconds();
  const weekday = !dayOff(date, HANOI);
  const [O, LB, LE, C] = [9 * 3600, 11.5 * 3600, 13 * 3600, 14.75 * 3600];
  if (weekday && secs >= O && secs < LB) return { phase: "open", secs: LB - secs };
  if (weekday && secs >= LB && secs < LE) return { phase: "break", secs: LE - secs };
  if (weekday && secs >= LE && secs < C) return { phase: "open", secs: C - secs };
  const days = weekday && secs < O ? 0 : daysToNextTrading(date, HANOI);
  return { phase: weekday && secs < O && secs >= 8.5 * 3600 ? "pre" : "closed", secs: days * 86400 + O - secs };
}

export function fmtDuration(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
