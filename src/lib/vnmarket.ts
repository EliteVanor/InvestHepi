/**
 * Vietnamese prices without an API key. Yahoo covers many HOSE stocks (".VN"), but cloud IPs
 * get refused often and its index coverage is patchy, so two local public endpoints back it up:
 *   TCBS  (apipubaws.tcbs.com.vn): daily and 5-minute bars, prices in VND, indexes in points.
 *   VNDirect (api-finfo.vndirect.com.vn): daily bars, stock prices in thousand VND.
 * Both are unofficial; if one changes its format, the others still run.
 */
import type { Bar } from "./chart";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/** Our symbols: "FPT.VN" for stocks, "^VNINDEX.VN" / "^VN30.VN" / "^HNX.VN" for indexes. */
export const isVnSymbol = (s: string) => /\.VN$/i.test(s);
const INDEXES: Record<string, string> = { "^VNINDEX.VN": "VNINDEX", "^VN30.VN": "VN30", "^HNX.VN": "HNX" };

export function vnCode(symbol: string): { code: string; index: boolean } {
  const s = symbol.toUpperCase();
  if (INDEXES[s]) return { code: INDEXES[s], index: true };
  return { code: s.replace(/\.VN$/, ""), index: false };
}

async function getJson(url: string, referer: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", Referer: referer, Origin: referer.replace(/\/$/, "") },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${new URL(url).hostname.split(".").slice(-3, -2)[0]} ${res.status}`);
  return res.json();
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v));

/** TCBS bars: { data: [{ open, high, low, close, volume, tradingDate }] } */
export function parseTcbs(j: unknown): Bar[] {
  const rows = ((j as { data?: Record<string, unknown>[] })?.data ?? []) as Record<string, unknown>[];
  return rows
    .map((r) => {
      const c = num(r.close);
      const t = Math.floor(Date.parse(String(r.tradingDate)) / 1000);
      return { t, o: num(r.open) || c, h: num(r.high) || c, l: num(r.low) || c, c, v: num(r.volume) || 0 };
    })
    .filter((b) => Number.isFinite(b.c) && b.c > 0 && Number.isFinite(b.t))
    .sort((a, b) => a.t - b.t);
}

export async function tcbsBars(symbol: string, intraday: boolean, days: number): Promise<Bar[]> {
  const { code, index } = vnCode(symbol);
  const to = Math.floor(Date.now() / 1000);
  const path = intraday ? "bars" : "bars-long-term";
  const url = `https://apipubaws.tcbs.com.vn/stock-insight/v2/stock/${path}?ticker=${code}&type=${index ? "index" : "stock"}&resolution=${intraday ? 5 : "D"}&to=${to}&countBack=${intraday ? 300 : days}`;
  const bars = parseTcbs(await getJson(url, "https://tcinvest.tcbs.com.vn/"));
  if (bars.length < 2) throw new Error("tcbs: no data");
  return bars;
}

/** VNDirect: { data: [{ date: "2026-11-13", open, high, low, close, nmVolume | accumulatedVol }] }, newest first. */
export function parseVndirect(j: unknown, index: boolean): Bar[] {
  const rows = ((j as { data?: Record<string, unknown>[] })?.data ?? []) as Record<string, unknown>[];
  const k = index ? 1 : 1000; // stock prices come in thousand VND
  return rows
    .map((r) => {
      const [y, m, d] = String(r.date).split("-").map(Number);
      const c = num(r.close) * k;
      // 14:45 ICT close = 07:45 UTC
      return { t: Math.floor(Date.UTC(y, m - 1, d, 7, 45) / 1000), o: num(r.open) * k || c, h: num(r.high) * k || c, l: num(r.low) * k || c, c, v: num(r.nmVolume ?? r.accumulatedVol) || 0 };
    })
    .filter((b) => Number.isFinite(b.c) && b.c > 0 && Number.isFinite(b.t))
    .sort((a, b) => a.t - b.t);
}

export async function vndirectBars(symbol: string, days: number): Promise<Bar[]> {
  const { code, index } = vnCode(symbol);
  const from = new Date(Date.now() - days * 1.5 * 86400_000).toISOString().slice(0, 10);
  const table = index ? "vnmarket_prices" : "stock_prices";
  const url = `https://api-finfo.vndirect.com.vn/v4/${table}?sort=date&q=code:${code}~date:gte:${from}&size=${Math.min(days * 2, 400)}&page=1`;
  const bars = parseVndirect(await getJson(url, "https://dstock.vndirect.com.vn/"), index);
  if (bars.length < 2) throw new Error("vndirect: no data");
  return bars;
}

/** Daily bars from the first local source that answers. */
export async function vnDaily(symbol: string, days: number): Promise<Bar[]> {
  const errors: string[] = [];
  for (const run of [() => tcbsBars(symbol, false, days), () => vndirectBars(symbol, days)]) {
    try {
      return await run();
    } catch (e) {
      errors.push((e as Error).message.slice(0, 60));
    }
  }
  throw new Error(errors.join(" · "));
}
