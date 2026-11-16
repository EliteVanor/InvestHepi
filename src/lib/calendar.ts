/**
 * "Up next" catalysts: earnings for the user's tickers + US macro releases.
 * Every source is optional; the panel just shows what loaded.
 *  - FOMC: hard-coded from the Fed's published 2026 schedule (update yearly).
 *  - BLS (CPI, jobs, PPI, JOLTS): BLS release-schedule iCal feed, when reachable.
 *  - Earnings: Finnhub (if FINNHUB_API_KEY) else Nasdaq's public calendar API.
 */
import { createHash } from "node:crypto";
import { getJSON, setJSON } from "./store";
import type { CalendarEvent, Interest } from "./types";

// Decision day (second day of each meeting). Statement 2:00 PM ET, press conference 2:30 PM ET.
// Source: federalreserve.gov FOMC calendar for 2026.
const FOMC: Record<number, string[]> = {
  2026: ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09"],
};
const SEP_MONTHS = new Set(["03", "06", "09", "12"]); // meetings with economic projections (dot plot)

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const WINDOW_DAYS = 21;
const CACHE_HOURS = 6;

async function get(url: string, headers: Record<string, string> = {}, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers: { "User-Agent": BROWSER_UA, ...headers }, signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

export function etToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function fomcEvents(from: string, to: string): { events: CalendarEvent[]; covered: boolean } {
  const years = new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))]);
  const covered = [...years].every((y) => FOMC[y]);
  const events = Object.values(FOMC)
    .flat()
    .filter((d) => d >= from && d <= to)
    .map((d) => ({
      date: d,
      time: "14:00 ET",
      kind: "macro" as const,
      title: SEP_MONTHS.has(d.slice(5, 7)) ? "FOMC rate decision + projections" : "FOMC rate decision",
      importance: 3 as const,
    }));
  return { events, covered };
}

/**
 * VN30 index futures expire on the third Thursday of each month (HNX rule; a holiday moves it to the
 * previous session, which isn't modeled). Expiry days often bring sharp moves in VN30 large caps.
 * Exported for tests.
 */
export function vnFuturesExpiry(from: string, to: string): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const start = new Date(from + "T12:00:00Z");
  for (let i = 0; i < 3; i++) {
    const y = start.getUTCFullYear();
    const m = start.getUTCMonth() + i;
    const first = new Date(Date.UTC(y, m, 1, 12));
    const thursday = 1 + ((4 - first.getUTCDay() + 7) % 7) + 14;
    const date = new Date(Date.UTC(y, m, thursday, 12)).toISOString().slice(0, 10);
    if (date >= from && date <= to) out.push({ date, time: "14:45 ICT", kind: "macro", title: "VN30 futures expiry", importance: 2 });
  }
  return out;
}

const BLS_RELEASES: [RegExp, string, 1 | 2 | 3][] = [
  [/consumer price index/i, "CPI inflation", 3],
  [/employment situation/i, "Jobs report (nonfarm payrolls)", 3],
  [/producer price index/i, "PPI inflation", 2],
  [/job openings and labor turnover/i, "JOLTS job openings", 2],
];

/** Parse a BLS iCal feed. Exported for tests. */
export function parseBlsIcs(ics: string, from: string, to: string): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const summary = block.match(/\nSUMMARY[^:]*:(.*)/)?.[1]?.trim() ?? "";
    const start = block.match(/\nDTSTART[^:]*:(\d{8})(?:T(\d{2})(\d{2}))?/);
    if (!start) continue;
    const date = `${start[1].slice(0, 4)}-${start[1].slice(4, 6)}-${start[1].slice(6, 8)}`;
    if (date < from || date > to) continue;
    const match = BLS_RELEASES.find(([re]) => re.test(summary));
    if (!match) continue;
    out.push({ date, time: start[2] ? `${start[2]}:${start[3]} ET` : "08:30 ET", kind: "macro", title: match[1], importance: match[2] });
  }
  return out;
}

async function blsEvents(from: string, to: string): Promise<CalendarEvent[]> {
  const res = await get("https://www.bls.gov/schedule/news_release/bls.ics", { Accept: "text/calendar,*/*" });
  if (!res.ok) throw new Error(`BLS ${res.status}`);
  return parseBlsIcs(await res.text(), from, to);
}

const hourLabel = (h: string) => (h === "bmo" ? "before open" : h === "amc" ? "after close" : undefined);

async function finnhubEarnings(tickers: string[], from: string, to: string, key: string): Promise<CalendarEvent[]> {
  const out: CalendarEvent[] = [];
  for (const t of tickers) {
    const res = await get(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${encodeURIComponent(t)}&token=${key}`);
    if (!res.ok) throw new Error(`Finnhub earnings ${res.status}`);
    const j = (await res.json()) as { earningsCalendar?: { date: string; hour: string; symbol: string; epsEstimate?: number }[] };
    for (const e of j.earningsCalendar ?? []) {
      out.push({
        date: e.date,
        time: hourLabel(e.hour),
        kind: "earnings",
        ticker: e.symbol,
        title: `${e.symbol} earnings${e.epsEstimate != null ? ` (EPS est. ${e.epsEstimate.toFixed(2)})` : ""}`,
        importance: 2,
      });
    }
  }
  return out;
}

/** Nasdaq's public calendar: one request per weekday, filtered to our tickers. */
async function nasdaqEarnings(tickers: string[], from: string, to: string): Promise<CalendarEvent[]> {
  const want = new Set(tickers);
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = new Date(d + "T12:00:00Z").getUTCDay();
    if (wd !== 0 && wd !== 6) days.push(d);
  }
  const out: CalendarEvent[] = [];
  let failures = 0;
  await Promise.all(
    days.map(async (d) => {
      try {
        const res = await get(`https://api.nasdaq.com/api/calendar/earnings?date=${d}`, { Accept: "application/json, text/plain, */*", Origin: "https://www.nasdaq.com", Referer: "https://www.nasdaq.com/" });
        if (!res.ok) throw new Error(String(res.status));
        const j = await res.json();
        for (const r of (j?.data?.rows ?? []) as { symbol: string; time?: string; epsForecast?: string }[]) {
          if (!want.has(r.symbol)) continue;
          out.push({
            date: d,
            time: r.time === "time-pre-market" ? "before open" : r.time === "time-after-hours" ? "after close" : undefined,
            kind: "earnings",
            ticker: r.symbol,
            title: `${r.symbol} earnings${r.epsForecast ? ` (EPS est. ${r.epsForecast})` : ""}`,
            importance: 2,
          });
        }
      } catch {
        failures++;
      }
    }),
  );
  if (failures === days.length && days.length) throw new Error("Nasdaq calendar unreachable");
  return out;
}

export interface CalendarData {
  generatedAt: string;
  events: CalendarEvent[];
  notes: string[];
}

export async function buildCalendar(interests: Interest[], now = new Date()): Promise<CalendarData> {
  const from = etToday(now);
  const to = addDays(from, WINDOW_DAYS);
  const notes: string[] = [];
  const events: CalendarEvent[] = [];

  const f = fomcEvents(from, to);
  events.push(...f.events);
  if (!f.covered) notes.push("FOMC dates for next year aren't in the app yet (update src/lib/calendar.ts).");

  const tickers = [...new Set(interests.flatMap((i) => i.tickers))];
  if (tickers.some((t) => t.toUpperCase().endsWith(".VN"))) events.push(...vnFuturesExpiry(from, to));
  const [bls, earnings] = await Promise.allSettled([
    blsEvents(from, to),
    process.env.FINNHUB_API_KEY
      ? finnhubEarnings(tickers, from, to, process.env.FINNHUB_API_KEY).catch(() => nasdaqEarnings(tickers, from, to))
      : nasdaqEarnings(tickers, from, to),
  ]);
  if (bls.status === "fulfilled") events.push(...bls.value);
  else notes.push(`Economic releases unavailable (${(bls.reason as Error).message}).`);
  if (earnings.status === "fulfilled") events.push(...earnings.value);
  else notes.push(`Earnings dates unavailable (${(earnings.reason as Error).message}).`);

  const seen = new Set<string>();
  const unique = events.filter((e) => {
    const k = `${e.date}|${e.title}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  unique.sort((a, b) => a.date.localeCompare(b.date) || b.importance - a.importance);
  return { generatedAt: now.toISOString(), events: unique, notes };
}

/** Cached calendar; rebuilt at most every few hours or when interests change. */
export async function getCalendar(interests: Interest[], { force = false } = {}): Promise<CalendarData> {
  const key = `calendar:${interests.flatMap((i) => i.tickers).sort().join(",")}`.slice(0, 200);
  const slot = `calendar:${createHash("sha1").update(key).digest("hex").slice(0, 12)}`;
  const cached = await getJSON<CalendarData & { key: string }>(slot);
  const fresh = cached && cached.key === key && Date.now() - new Date(cached.generatedAt).getTime() < CACHE_HOURS * 3600_000;
  if (fresh && !force) {
    // Drop events that are now in the past.
    const today = etToday();
    return { ...cached, events: cached.events.filter((e) => e.date >= today) };
  }
  const data = await buildCalendar(interests);
  await setJSON(slot, { ...data, key });
  return data;
}

export function calendarAsText(events: CalendarEvent[]): string {
  if (!events.length) return "(no scheduled catalysts found)";
  return events
    .slice(0, 15)
    .map((e) => `${e.date}${e.time ? ` ${e.time}` : ""}: ${e.title}`)
    .join("\n");
}
