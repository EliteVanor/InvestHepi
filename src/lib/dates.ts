/** Calendar dates in a time zone. Pure (no imports), so both server and browser code use it. */

const formatters = new Map<string, Intl.DateTimeFormat>();

/** YYYY-MM-DD of `at` (a Date or epoch milliseconds) in `timeZone`, e.g. dayIn("Asia/Ho_Chi_Minh"). */
export function dayIn(timeZone: string, at: Date | number = new Date()): string {
  let f = formatters.get(timeZone);
  if (!f) formatters.set(timeZone, (f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })));
  return f.format(at);
}

/** US market days (daily caps, alerts, the calendar) roll over at midnight New York time. */
export const NY = "America/New_York";
