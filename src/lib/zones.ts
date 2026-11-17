/**
 * Time zones for readers: the setting (Auto = the device's, or a chosen IANA zone), and how a time is
 * written with its zone ("08:15 Hanoi"). Pure, so the server (settings validation) and the page use it.
 * Charts and the open/closed pill stay in the exchange's own time; everything else follows the setting.
 */
import { MARKET_CITY } from "./markets";

/** Quick picks shown first in the setting (then the full list). */
export const QUICK_ZONES = ["Asia/Ho_Chi_Minh", "America/New_York", "UTC"] as const;

const valid = new Map<string, boolean>();
export function isZone(v: unknown): v is string {
  if (typeof v !== "string" || !v || v.length > 64) return false;
  if (v === "auto") return true;
  let ok = valid.get(v);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: v });
      ok = true;
    } catch {
      ok = false;
    }
    valid.set(v, ok);
  }
  return ok;
}

export function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The zone a reader sees times in: the saved choice, or the device's for "auto". */
export const resolveZone = (setting?: string | null) => (setting && setting !== "auto" && isZone(setting) ? setting : deviceZone());

/** Every zone the browser knows (for the full list), with UTC first. */
export function allZones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    return ["UTC", ...list.filter((z) => z !== "UTC")];
  } catch {
    return [...QUICK_ZONES];
  }
}

/** Zones with a translated name (i18n keys "tz.<id>"); others show their IANA city. */
export const NAMED_ZONES: Record<string, string> = {
  "Asia/Ho_Chi_Minh": "hanoi",
  "Asia/Saigon": "hanoi",
  "America/New_York": "newyork",
  UTC: "utc",
  "Etc/UTC": "utc",
  "Asia/Tokyo": "tokyo",
  "Asia/Hong_Kong": "hongkong",
  "Europe/London": "london",
};

/** "Asia/Ho_Chi_Minh" → "Hanoi" (English; the page translates the named ones). */
export function zoneCity(tz: string): string {
  if (tz === "UTC" || tz === "Etc/UTC") return "UTC";
  return MARKET_CITY[tz] ?? tz.split("/").pop()!.replace(/_/g, " ");
}

/** The zone's UTC offset at `at`, e.g. "UTC+7" (for the setting's list). */
export function zoneOffset(tz: string, at: Date | number = Date.now()): string {
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(at);
    const v = p.find((x) => x.type === "timeZoneName")?.value ?? "GMT";
    return v.replace("GMT", "UTC").replace(/^UTC$/, "UTC±0");
  } catch {
    return "";
  }
}

/** Same local wall clock in two zones right now (Hanoi vs your time)? Then one label is enough. */
export function sameClock(a: string, b: string, at: Date | number = Date.now()): boolean {
  if (a === b) return true;
  const f = (tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  return f(a) === f(b);
}

/** "08:15" in `tz` (24-hour clock is clearer across the 8 languages). */
export function clockIn(at: Date | number | string, tz: string, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at));
}

/** "Mon 14:45" (or "Mon, Nov 23 14:45" with `date`) in `tz`. */
export function dayClockIn(at: Date | number | string, tz: string, locale: string, date = false): string {
  const d = new Date(at);
  const day = new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "short", ...(date ? { month: "short", day: "numeric" } : {}) }).format(d);
  return `${day} ${clockIn(d, tz)}`;
}
