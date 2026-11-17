/**
 * The refresh timetable: the one place that says what runs when. Briefing times are UTC (Hanoi =
 * UTC+7; New York = UTC-5 in winter, UTC-4 in summer). Prediction times are each market's own local
 * time (`tz`), so summer time never puts a "before market" run after the open. The scheduler
 * (scheduler.ts) runs it; the AI budget (models.ts) counts from it. Pokers (Vercel Schedules,
 * cron-job.org, GitHub) only call /api/cron/tick on a plain interval and never repeat these times.
 *
 * Two kinds of slots:
 *  - Predictions (the market's weekdays only): two runs per market, "before market" and "mid-day",
 *    each calling only its own market. Every World market (Japan, China & Hong Kong, Europe, US
 *    stocks, oil, gold) has its own pair; each interest set runs its US part on the New York clock and
 *    its Vietnam part on the Hanoi clock. Only the before-market run makes weekly calls.
 *  - Briefings (every day, weekends included): World 4, US 5, Vietnam 5; the admin's interests 6,
 *    everyone else's 4.
 */
import { MARKET_TZ, preDeadline, zonedToUtc, type Phase, type SlotMarket } from "./markets";

export type BriefItem = "vn" | "world" | "us" | "interests:all" | "interests:admin";
export type PredItem = `p:${SlotMarket}:${Phase}`;
export type SlotItem = BriefItem | PredItem;

export interface Slot {
  id: string;
  /** Weekdays it runs on (0 = Sunday), in `tz` when set, else UTC. */
  days: number[];
  /** HH:MM, local to `tz` when set, else UTC. */
  at: string;
  /** Prediction slots: the market's time zone. */
  tz?: string;
  /** Run in this order. */
  items: SlotItem[];
}

const WEEKDAYS = [1, 2, 3, 4, 5];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const TOKYO = "Asia/Tokyo";
const HK = "Asia/Hong_Kong";
const HANOI = "Asia/Ho_Chi_Minh";
const LONDON = "Europe/London";
const NEW_YORK = "America/New_York";

export const TIMETABLE: Slot[] = [
  // Predictions, in each market's local time. Before-market runs start 75-120 minutes before the open,
  // so several pokes (Vercel every 15 min, cron-job.org every 30) and a retry 20 min later all land
  // before it: Japan 07:30 Tokyo (open 09:00), China & HK 08:00 HK (09:30), Vietnam 07:45 Hanoi (09:00),
  // Europe 06:30 London (08:00), US 07:30 New York (09:30). Winter UTC: 22:30 (the evening before),
  // 00:00, 00:45, 06:30, 12:30. Mid-day runs sit in the Asian lunch breaks and at noon in London and
  // New York (02:45, 04:15, 04:35, 12:00, 17:00 UTC).
  { id: "p-jp-pre", tz: TOKYO, days: WEEKDAYS, at: "07:30", items: ["p:jp:pre"] },
  { id: "p-jp-mid", tz: TOKYO, days: WEEKDAYS, at: "11:45", items: ["p:jp:mid"] },
  { id: "p-cn-pre", tz: HK, days: WEEKDAYS, at: "08:00", items: ["p:cn:pre"] },
  { id: "p-cn-mid", tz: HK, days: WEEKDAYS, at: "12:15", items: ["p:cn:mid"] },
  { id: "p-vn-pre", tz: HANOI, days: WEEKDAYS, at: "07:45", items: ["p:vn:pre", "p:ivn:pre"] },
  { id: "p-vn-mid", tz: HANOI, days: WEEKDAYS, at: "11:35", items: ["p:vn:mid", "p:ivn:mid"] },
  { id: "p-eu-pre", tz: LONDON, days: WEEKDAYS, at: "06:30", items: ["p:eu:pre"] },
  { id: "p-eu-mid", tz: LONDON, days: WEEKDAYS, at: "12:00", items: ["p:eu:mid"] },
  { id: "p-us-pre", tz: NEW_YORK, days: WEEKDAYS, at: "07:30", items: ["p:us:pre", "p:wus:pre", "p:oil:pre", "p:gold:pre", "p:ius:pre"] },
  { id: "p-us-mid", tz: NEW_YORK, days: WEEKDAYS, at: "12:00", items: ["p:us:mid", "p:wus:mid", "p:oil:mid", "p:gold:mid", "p:ius:mid"] },
  // Briefings, every day.
  { id: "b-0115", days: EVERY_DAY, at: "01:15", items: ["vn", "world", "interests:all"] }, // before the HOSE open
  { id: "b-0215", days: EVERY_DAY, at: "02:15", items: ["us"] }, // US evening
  { id: "b-0435", days: EVERY_DAY, at: "04:35", items: ["vn", "interests:admin"] }, // HOSE lunch break
  { id: "b-0810", days: EVERY_DAY, at: "08:10", items: ["vn", "world", "interests:all"] }, // after the HOSE close; Europe open
  { id: "b-1030", days: EVERY_DAY, at: "10:30", items: ["interests:admin"] },
  { id: "b-1230", days: EVERY_DAY, at: "12:30", items: ["us", "world", "vn", "interests:all"] }, // before the US open
  { id: "b-1530", days: EVERY_DAY, at: "15:30", items: ["us"] }, // US morning
  { id: "b-1700", days: EVERY_DAY, at: "17:00", items: ["us"] }, // US mid-day
  { id: "b-2120", days: EVERY_DAY, at: "21:20", items: ["us", "world", "vn", "interests:all"] }, // after the US close
];

/** A briefing may run this late at most (and never once the same briefing's next run starts). */
export const MAX_LATE_MIN = 360;
/** A mid-day prediction may run this late at most. */
export const MID_LATE_MIN = 90;
/** A slot counts as late when it isn't finished this long after its time. */
export const LATE_AFTER_MIN = 60;

export const isPred = (i: SlotItem): i is PredItem => i.startsWith("p:");
export function predParts(i: PredItem): { market: SlotMarket; phase: Phase } {
  const [, market, phase] = i.split(":");
  return { market: market as SlotMarket, phase: phase as Phase };
}
/** Briefing items that refresh the same thing (both interest items refresh interest sets). */
const family = (i: SlotItem) => (i.startsWith("interests") ? "interests" : i);

export interface Occurrence {
  slot: Slot;
  /** UTC date the slot belongs to, YYYY-MM-DD */
  date: string;
  start: number;
  /** When its last item stops being runnable (see itemEnd). */
  end: number;
}

const DAY = 86_400_000;
const MIN = 60_000;

function startsOn(dayMs: number): Occurrence[] {
  const date = new Date(dayMs).toISOString().slice(0, 10);
  const wd = new Date(dayMs).getUTCDay();
  return TIMETABLE.filter((s) => s.days.includes(wd)).map((slot) => {
    const [h, m] = slot.at.split(":").map(Number);
    // A local slot happens on that local date; the UTC instant moves with summer time.
    const start = slot.tz ? zonedToUtc(date, h * 60 + m, slot.tz).getTime() : dayMs + (h * 60 + m) * MIN;
    return { slot, date, start, end: 0 };
  });
}

function rawOccurrences(from: number, to: number): Occurrence[] {
  const first = Math.floor(from / DAY) * DAY - 2 * DAY;
  const all: Occurrence[] = [];
  for (let day = first; day <= to + 7 * DAY; day += DAY) all.push(...startsOn(day));
  return all.sort((a, b) => a.start - b.start);
}

/**
 * When an item of an occurrence stops being runnable:
 *  - before-market predictions: the market's open (a "before market" call made after it would see the session);
 *  - mid-day predictions: 90 minutes after the slot;
 *  - briefings: when the same briefing's next run starts, at most 6 hours later.
 */
export function itemEnd(o: Pick<Occurrence, "start" | "slot">, item: SlotItem, all?: Occurrence[]): number {
  if (isPred(item)) {
    const { market, phase } = predParts(item);
    return phase === "pre" ? Math.min(preDeadline(market, o.start).getTime(), o.start + MAX_LATE_MIN * MIN) : o.start + MID_LATE_MIN * MIN;
  }
  const list = all ?? rawOccurrences(o.start, o.start + MAX_LATE_MIN * MIN);
  const next = list.find((x) => x.start > o.start && x.slot.items.some((i) => !isPred(i) && family(i) === family(item)));
  return Math.min(next?.start ?? Infinity, o.start + MAX_LATE_MIN * MIN);
}

/** Every slot occurrence that starts in [from, to], with its end filled in. */
export function occurrences(from: number, to: number): Occurrence[] {
  const all = rawOccurrences(from, to);
  for (const o of all) o.end = Math.max(...o.slot.items.map((i) => itemEnd(o, i, all)));
  return all.filter((o) => o.start >= from && o.start <= to);
}

/** Slots that may still run at `now` (started, not past their end), oldest first. */
export function openOccurrences(now: number): Occurrence[] {
  return occurrences(now - MAX_LATE_MIN * MIN, now).filter((o) => now < o.end);
}

export const runKey = (o: Pick<Occurrence, "date" | "slot">) => `sched:${o.date}:${o.slot.id}`;

const utcDay = (now: Date) => {
  const d = Math.floor(now.getTime() / DAY) * DAY;
  return rawOccurrences(d, d + DAY - 1).filter((o) => o.start >= d && o.start < d + DAY);
};

/**
 * What the timetable runs on this UTC day on gpt-oss-120b first (sets its token reserve): shared
 * predictions, and the admin's interest-set predictions (at most one per interest-set item).
 */
export function plannedPerDay(now: Date): { shared: number; admin: number } {
  const items = utcDay(now).flatMap((o) => o.slot.items).filter(isPred);
  const admin = items.filter((i) => predParts(i).market === "ius" || predParts(i).market === "ivn").length;
  return { shared: items.length - admin, admin };
}

/** Briefings the timetable writes on this UTC day, per section ("interests" counts the admin's set). */
export function briefingsPerDay(now: Date): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of utcDay(now).flatMap((o) => o.slot.items).filter((x) => !isPred(x))) {
    const k = i.startsWith("interests") ? "interests" : i;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/**
 * The next prediction runs for a market after `now` (for "next predictions at ..." on the page).
 * Pure, so the browser uses it too.
 */
export function nextPredictionRuns(market: SlotMarket, now: number, n = 1): { at: number; phase: Phase; tz: string }[] {
  const out: { at: number; phase: Phase; tz: string }[] = [];
  for (const o of rawOccurrences(now, now + 8 * DAY)) {
    if (o.start <= now) continue;
    for (const i of o.slot.items) {
      if (!isPred(i)) continue;
      const p = predParts(i);
      if (p.market === market) out.push({ at: o.start, phase: p.phase, tz: MARKET_TZ[market] });
    }
    if (out.length >= n) break;
  }
  return out.slice(0, n);
}
