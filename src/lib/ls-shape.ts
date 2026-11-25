/**
 * Shape checks for values read back from localStorage (browser-safe, pure). A stored value can be
 * anything (an old version, another tab, a hand edit), so every read is checked for the shape the
 * code expects and falls back to the default when it doesn't match; JSON.parse not throwing is not enough.
 */
import type { NewsItem } from "./types";

export type Guard<T> = (v: unknown) => v is T;

export const isString: Guard<string> = (v): v is string => typeof v === "string";
export const isStringOrNull: Guard<string | null> = (v): v is string | null => v === null || typeof v === "string";
export const isStringArray: Guard<string[]> = (v): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
export const isNewsItems: Guard<NewsItem[]> = (v): v is NewsItem[] =>
  Array.isArray(v) && v.every((x) => x && typeof x === "object" && typeof x.id === "string" && typeof x.title === "string" && typeof x.link === "string" && typeof x.source === "string" && typeof x.publishedAt === "string");
export const oneOf = <T extends string>(...allowed: T[]): Guard<T> => (v): v is T => typeof v === "string" && (allowed as string[]).includes(v);

/** Parse stored text and keep it only when it passes the guard; otherwise the fallback. */
export function parseShaped<T>(raw: string | null, fallback: T, valid: Guard<T>): T {
  if (raw == null) return fallback;
  try {
    const v: unknown = JSON.parse(raw);
    return valid(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const recordOf = (v: unknown, ok: (x: unknown) => boolean) => isObj(v) && Object.values(v).every(ok);
export const isBoolean: Guard<boolean> = (v): v is boolean => typeof v === "boolean";
/** An object whose present keys are booleans (unknown keys are dropped by the reader's spread, wrong types fail the check). */
export const isBooleanFlags = <T extends object>(): Guard<Partial<T>> => (v): v is Partial<T> => recordOf(v, (x) => typeof x === "boolean");
/** The catch-up snapshot: the fields the diff reads, each of the right type. */
export const isVisitSnapshot = (v: unknown): v is { at: string; digestAt: string; calls: Record<string, { action: string; direction: string; confidence: number }>; prices: Record<string, number>; bases?: Record<string, string>; events: string[] } | null =>
  v === null ||
  (isObj(v) && typeof v.at === "string" && typeof v.digestAt === "string" && recordOf(v.calls, (c) => isObj(c) && typeof c.action === "string" && typeof c.direction === "string") && recordOf(v.prices, (x) => typeof x === "number") &&
    (v.bases === undefined || recordOf(v.bases, (x) => typeof x === "string")) && isStringArray(v.events));
