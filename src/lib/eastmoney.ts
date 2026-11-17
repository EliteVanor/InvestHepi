/**
 * Eastmoney's public intraday series (the data behind its own web charts; keyless JSON) for markets
 * that have no other intraday source reachable from a cloud server: Nikkei 225, Hang Seng, DAX,
 * FTSE 100, Euro Stoxx 50, S&P 500, Dow and WTI. One request returns the latest session's minute
 * prices (Beijing time) and the previous session's close.
 *
 * Checked from a cloud sandbox Nov 17 2026: previous closes matched our official ones exactly for
 * S&P 500, Dow, DAX and FTSE. Rejected: its "NDX" is the Nasdaq Composite (25,136 vs the Nasdaq 100
 * at ~27,944), Shanghai (1.000001) and KOSPI timed out every time, gold was unreliable. The service is
 * flaky from abroad, so a failure just falls through to the next source; one request per symbol, no
 * retries, cached a minute.
 */
import { exchangeTz } from "./symbols";
import { dayIn } from "./dates";

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
  return { symbol, preClose: d.preClose!, points, session: dayIn(exchangeTz(symbol), asOf * 1000), last, asOf };
}

const cache = new Map<string, { at: number; v: EmSession | null }>();
const TTL_MS = 60_000;

/** The latest session of a symbol, or null (unsupported, unreachable, or empty). */
export async function emSession(symbol: string): Promise<EmSession | null> {
  const secid = EM_SECID[symbol];
  if (!secid) return null;
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v;
  let v: EmSession | null = null;
  try {
    const r = await fetch(`https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f8&fields2=f51,f53&ndays=1&iscr=0`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (r.ok) v = parseTrends(await r.json(), symbol);
  } catch {}
  cache.set(symbol, { at: Date.now(), v });
  return v;
}

/** Tests only. */
export const clearEmCache = () => cache.clear();
