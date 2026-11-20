/**
 * Yahoo Finance's public endpoints (no key), used carefully. Yahoo rate-limits cloud IPs hard: a
 * burst of ~60 parallel requests from one server gets "429 Too Many Requests" for a few minutes,
 * for every symbol. So:
 *   - prefer the batch "spark" endpoint (up to 20 symbols per request, closes only);
 *   - at most YAHOO_CONCURRENCY requests in flight per server instance;
 *   - after a 429, skip Yahoo entirely for a cooldown so callers go straight to fallbacks.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const YAHOO_CONCURRENCY = 3;
const COOLDOWN_MS = 90_000;
export const SPARK_MAX = 20;

let coolUntil = 0;
let active = 0;
const queue: (() => void)[] = [];

export const yahooCooling = () => Date.now() < coolUntil;
/** Tests only. */
export function resetYahoo() {
  coolUntil = 0;
}

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= YAHOO_CONCURRENCY) await new Promise<void>((r) => queue.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

/** GET a Yahoo path (e.g. "/v8/finance/chart/SPY?range=1d"), trying both hosts. */
export async function yahooJson(path: string, ms = 8000): Promise<unknown> {
  if (yahooCooling()) throw new Error("yahoo: rate-limited, cooling down");
  return slot(async () => {
    let last = "";
    for (const host of HOSTS) {
      if (yahooCooling()) break;
      try {
        const res = await fetch(`https://${host}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(ms) });
        if (res.status === 429) {
          coolUntil = Date.now() + COOLDOWN_MS;
          last = `${host.split(".")[0]} 429`;
          break; // both hosts share the same per-IP limit
        }
        if (res.ok) return await res.json();
        last = `${host.split(".")[0]} ${res.status}`;
        if (res.status === 404) break; // unknown symbol: the other host says the same
      } catch (e) {
        last = `${host.split(".")[0]} ${(e as Error).message}`;
      }
    }
    throw new Error(`yahoo: ${last || "rate-limited"}`);
  });
}

export interface SparkSeries {
  symbol: string;
  /** [unix seconds, close] pairs, nulls removed, oldest first. */
  points: [number, number][];
  /** Close before the window (for range=1d: the previous session's close). */
  chartPreviousClose?: number;
}

/** Parse a spark response; handles both the flat and the {spark:{result}} shapes. Exported for tests. */
export function parseSpark(j: unknown): Map<string, SparkSeries> {
  const out = new Map<string, SparkSeries>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const any = j as any;
  const entries: [string, any][] = any?.spark?.result
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any.spark.result.map((r: any) => [r.symbol, { ...r.response?.[0]?.meta, timestamp: r.response?.[0]?.timestamp, close: r.response?.[0]?.indicators?.quote?.[0]?.close }])
    : Object.entries(any ?? {});
  for (const [symbol, v] of entries) {
    if (!v || typeof v !== "object") continue;
    const ts: number[] = v.timestamp ?? [];
    const cs: (number | null)[] = v.close ?? [];
    const points: [number, number][] = [];
    ts.forEach((t, i) => {
      const c = cs[i];
      if (c != null && Number.isFinite(c)) points.push([t, c]);
    });
    if (points.length) out.set(symbol.toUpperCase(), { symbol: symbol.toUpperCase(), points, chartPreviousClose: v.chartPreviousClose ?? v.previousClose ?? undefined });
  }
  return out;
}

/** Closes for many symbols in as few requests as possible (20 per request). Missing symbols are simply absent. */
export async function yahooSpark(symbols: string[], range: "1d" | "5d" | "1mo" | "3mo" | "1y", interval: "5m" | "15m" | "1d"): Promise<Map<string, SparkSeries>> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const out = new Map<string, SparkSeries>();
  const batches: string[][] = [];
  for (let i = 0; i < uniq.length; i += SPARK_MAX) batches.push(uniq.slice(i, i + SPARK_MAX));
  await Promise.all(
    batches.map(async (b) => {
      try {
        const j = await yahooJson(`/v8/finance/spark?symbols=${b.map(encodeURIComponent).join(",")}&range=${range}&interval=${interval}`, 10_000);
        for (const [k, v] of parseSpark(j)) out.set(k, v);
      } catch {}
    }),
  );
  return out;
}
