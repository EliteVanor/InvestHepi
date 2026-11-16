/**
 * The refresh timetable: the one place that says what is refreshed when. Times are UTC
 * (Hanoi = UTC+7; New York = UTC-5 in winter, UTC-4 in summer). The scheduler (scheduler.ts)
 * runs it; the AI budget (models.ts scheduledPerDay) counts from it. Pokers (Vercel Schedules,
 * cron-job.org, GitHub) only call /api/cron/tick on a plain interval and never repeat these times.
 *
 * Weekdays: World 4, US 2, Vietnam 5; the admin's interests 6, everyone else's 4.
 * Sunday: each shared section twice, the admin's interests 3 times, users none. Saturday: nothing.
 */

/** A shared section, or interest sets: "all" = every active set (admin's first), "admin" = the admin's only. */
export type SlotItem = "vn" | "world" | "us" | "interests:all" | "interests:admin";

export interface Slot {
  id: string;
  days: "weekday" | "sunday";
  /** HH:MM UTC */
  at: string;
  /** Run in this order: the graded call first. */
  items: SlotItem[];
}

export const TIMETABLE: Slot[] = [
  { id: "wd-0115", days: "weekday", at: "01:15", items: ["vn", "world", "interests:all"] }, // 08:15 Hanoi, before the HOSE open (graded VN call)
  { id: "wd-0435", days: "weekday", at: "04:35", items: ["vn", "interests:admin"] }, // HOSE lunch break
  { id: "wd-0810", days: "weekday", at: "08:10", items: ["vn", "world", "interests:all"] }, // after the HOSE close; Europe opening
  { id: "wd-1030", days: "weekday", at: "10:30", items: ["interests:admin"] },
  { id: "wd-1230", days: "weekday", at: "12:30", items: ["us", "world", "vn", "interests:all"] }, // before the US open (graded US call)
  { id: "wd-2120", days: "weekday", at: "21:20", items: ["us", "world", "vn", "interests:all"] }, // after the US close
  { id: "su-0200", days: "sunday", at: "02:00", items: ["vn", "world", "interests:admin"] },
  { id: "su-0800", days: "sunday", at: "08:00", items: ["vn"] },
  { id: "su-0905", days: "sunday", at: "09:05", items: ["world"] },
  { id: "su-1405", days: "sunday", at: "14:05", items: ["us", "interests:admin"] },
  { id: "su-2005", days: "sunday", at: "20:05", items: ["us", "interests:admin"] },
];

/** A slot may run this late at most; after that (or once the next slot starts) what's left is missed. */
export const MAX_LATE_MIN = 360;
/** A slot counts as late when it isn't finished this long after its time. */
export const LATE_AFTER_MIN = 60;

export interface Occurrence {
  slot: Slot;
  /** UTC date the slot belongs to, YYYY-MM-DD */
  date: string;
  start: number;
  /** The next slot's start, capped at MAX_LATE_MIN. */
  end: number;
}

const DAY = 86_400_000;

function onDay(slot: Slot, wd: number): boolean {
  return slot.days === "sunday" ? wd === 0 : wd >= 1 && wd <= 5;
}

function startsOn(dayMs: number): Occurrence[] {
  const d = new Date(dayMs);
  const date = d.toISOString().slice(0, 10);
  return TIMETABLE.filter((s) => onDay(s, d.getUTCDay())).map((slot) => {
    const [h, m] = slot.at.split(":").map(Number);
    return { slot, date, start: dayMs + (h * 60 + m) * 60_000, end: 0 };
  });
}

/** Every slot occurrence that starts in [from, to], with its end filled in. */
export function occurrences(from: number, to: number): Occurrence[] {
  const first = Math.floor(from / DAY) * DAY - DAY;
  const all: Occurrence[] = [];
  // Look a week past `to` so the last occurrence knows when the next slot starts.
  for (let day = first; day <= to + 7 * DAY; day += DAY) all.push(...startsOn(day));
  all.sort((a, b) => a.start - b.start);
  all.forEach((o, i) => (o.end = Math.min(all[i + 1]?.start ?? Infinity, o.start + MAX_LATE_MIN * 60_000)));
  return all.filter((o) => o.start >= from && o.start <= to);
}

/** Slots that may still run at `now` (started, not past their end), oldest first. */
export function openOccurrences(now: number): Occurrence[] {
  return occurrences(now - MAX_LATE_MIN * 60_000, now).filter((o) => now < o.end);
}

export const runKey = (o: Pick<Occurrence, "date" | "slot">) => `sched:${o.date}:${o.slot.id}`;

/** Shared and admin briefings the timetable writes on this UTC day (sets the 120b token reserve). */
export function plannedPerDay(now: Date): { shared: number; admin: number } {
  const items = TIMETABLE.filter((s) => onDay(s, now.getUTCDay())).flatMap((s) => s.items);
  return { shared: items.filter((i) => !i.startsWith("interests")).length, admin: items.filter((i) => i.startsWith("interests")).length };
}
