/**
 * Eastmoney's public intraday series (the data behind its own web charts; keyless JSON) for markets
 * that have no other intraday source reachable from a cloud server: Nikkei 225, Hang Seng, DAX,
 * FTSE 100, Euro Stoxx 50, S&P 500, Dow and WTI. One request returns the latest session's minute
 * prices (Beijing time) and the previous session's close.
 *
 * Checked from a cloud sandbox Nov 17 2026: previous closes matched our official ones exactly for
 * S&P 500, Dow, DAX and FTSE. Rejected: its "NDX" is the Nasdaq Composite (25,136 vs the Nasdaq 100
 * at ~27,944), Shanghai (1.000001) and KOSPI timed out every time, gold was unreliable. The service is
 * flaky from abroad (timeouts, 502s), so requests go one at a time, a network error or 5xx is tried
 * once more after a pause (never a 429: that's a rate limit to respect), answers are cached a minute
 * and failures 15 seconds, and a failure falls through to the next source.
 */
import { exchangeTz } from "./symbols";
import { dayIn } from "./dates";
import { getJSON, setJSON } from "./store";

export const EM_SECID: Record<string, string> = {
  "^N225": "100.N225",
  "^HSI": "100.HSI",
  "^GDAXI": "100.GDAXI",
  "^FTSE": "100.FTSE",
  "^STOXX50E": "100.SX5E",
  "^GSPC": "100.SPX",
  "^DJI": "100.DJIA",
  "CL=F": "102.CL00Y",
};
export const hasEastmoney = (s: string) => !!EM_SECID[s];

export interface EmSession {
  symbol: string;
  /** The previous session's close. */
  preClose: number;
  /** Minute prices of the latest session: [unix seconds, price]. */
  points: [number, number][];
  /** Exchange-local date of that session. */
  session: string;
  last: number;
  asOf: number;
  /** Served from the last good answer saved in the store (the live request failed); when it was fetched. */
  savedAt?: number;
}

/** "2026-11-17 09:31" in Beijing time (UTC+8) → unix seconds. Exported for tests. */
export const beijingToUnix = (s: string) => Date.parse(`${s.replace(" ", "T")}:00+08:00`) / 1000;

/** Parse a trends2 reply. Exported for tests. */
export function parseTrends(j: unknown, symbol: string): EmSession | null {
  const d = (j as { data?: { preClose?: number; trends?: string[] } })?.data;
  if (!d || !Number.isFinite(d.preClose) || !Array.isArray(d.trends) || !d.trends.length) return null;
  const points = d.trends
    .map((row) => row.split(","))
    .map(([t, p]) => [beijingToUnix(t), Number(p)] as [number, number])
    .filter(([t, p]) => Number.isFinite(t) && Number.isFinite(p) && p > 0);
  if (!points.length) return null;
  const [asOf, last] = points.at(-1)!;
  // Futures trade nearly around the clock: a CME session opens at 18:00 New York the evening before,
  // so its trading day is the New York date six hours later.
  const futures = symbol.endsWith("=F");
  return { symbol, preClose: d.preClose!, points, session: dayIn(exchangeTz(symbol), (asOf + (futures ? 6 * 3600 : 0)) * 1000), last, asOf };
}

const cache = new Map<string, { at: number; v: EmSession | null }>();
const TTL_MS = 60_000;
const FAIL_TTL_MS = 15_000;
/** One request at a time: parallel bursts were what timed out. */
let queue: Promise<unknown> = Promise.resolve();

async function fetchTrends(secid: string, symbol: string): Promise<{ v: EmSession | null; retry: boolean }> {
  try {
    const r = await fetch(`https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f8&fields2=f51,f53&ndays=1&iscr=0`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (r.status === 429) return { v: null, retry: false };
    if (!r.ok) return { v: null, retry: r.status >= 500 };
    return { v: parseTrends(await r.json().catch(() => null), symbol), retry: false };
  } catch {
    return { v: null, retry: true };
  }
}

/** The latest session of a symbol, or null (unsupported, unreachable, or empty). */
export async function emSession(symbol: string): Promise<EmSession | null> {
  const secid = EM_SECID[symbol];
  if (!secid) return null;
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < (hit.v ? TTL_MS : FAIL_TTL_MS)) return hit.v;
  const job = queue.then(async () => {
    let r = await fetchTrends(secid, symbol);
    if (!r.v && r.retry) {
      await new Promise((ok) => setTimeout(ok, 1500));
      r = await fetchTrends(secid, symbol);
    }
    // A good answer is saved; when a request fails, the saved one from the same session still gives the
    // previous close (callers decide whether it's fresh enough to count as live: see `savedAt`).
    let v = r.v;
    if (v) await setJSON(`em:${symbol}`, { ...v, fetchedAt: Date.now() }).catch(() => {});
    else {
      const saved = await getJSON<EmSession & { fetchedAt: number }>(`em:${symbol}`).catch(() => null);
      if (saved && Date.now() - saved.fetchedAt < 12 * 3600_000) v = { ...saved, savedAt: saved.fetchedAt };
    }
    cache.set(symbol, { at: Date.now(), v });
    return v;
  });
  queue = job.catch(() => null);
  return job;
}

/** Tests only. */
export const clearEmCache = () => cache.clear();
