/** US equity market session in New York time. Holidays are not modeled. */
export type Phase = "pre" | "open" | "after" | "closed" | "break";

function nyParts(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", second: "numeric", hour12: false })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { wd: p.weekday as string, secs: (Number(p.hour) % 24) * 3600 + Number(p.minute) * 60 + Number(p.second) };
}

const OPEN = 9.5 * 3600;
const CLOSE = 16 * 3600;
const PRE = 4 * 3600;
const AFTER_END = 20 * 3600;

/** Phase plus seconds until the next open (if closed/pre) or the close (if open). */
export function marketClock(now = new Date()): { phase: Phase; secs: number } {
  const { wd, secs } = nyParts(now);
  const weekend = wd === "Sat" || wd === "Sun";
  if (!weekend && secs >= OPEN && secs < CLOSE) return { phase: "open", secs: CLOSE - secs };
  // seconds until next weekday 9:30
  let days = 0;
  const order = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let idx = order.indexOf(wd);
  if (!weekend && secs < OPEN) days = 0;
  else {
    days = 1;
    idx = (idx + 1) % 7;
    while (order[idx] === "Sat" || order[idx] === "Sun") {
      days++;
      idx = (idx + 1) % 7;
    }
  }
  const untilOpen = days * 86400 + OPEN - secs;
  let phase: Phase = "closed";
  if (!weekend && secs >= PRE && secs < OPEN) phase = "pre";
  else if (!weekend && secs >= CLOSE && secs < AFTER_END) phase = "after";
  return { phase, secs: untilOpen };
}

/**
 * Ho Chi Minh City exchange (HOSE), ICT = UTC+7, no DST: 9:00-11:30 and 13:00-14:45
 * (closing auction from 14:30). Holidays (Tet etc.) are not modeled.
 */
export function vnMarketClock(now = new Date()): { phase: Phase; secs: number } {
  const ict = new Date(now.getTime() + 7 * 3600_000);
  const wd = ict.getUTCDay();
  const secs = ict.getUTCHours() * 3600 + ict.getUTCMinutes() * 60 + ict.getUTCSeconds();
  const weekday = wd >= 1 && wd <= 5;
  const [O, LB, LE, C] = [9 * 3600, 11.5 * 3600, 13 * 3600, 14.75 * 3600];
  if (weekday && secs >= O && secs < LB) return { phase: "open", secs: LB - secs };
  if (weekday && secs >= LB && secs < LE) return { phase: "break", secs: LE - secs };
  if (weekday && secs >= LE && secs < C) return { phase: "open", secs: C - secs };
  let days = weekday && secs < O ? 0 : 1;
  let d = (wd + days) % 7;
  while (days > 0 && (d === 0 || d === 6)) {
    days++;
    d = (d + 1) % 7;
  }
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
