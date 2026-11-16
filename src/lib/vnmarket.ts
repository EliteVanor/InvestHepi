/**
 * Vietnamese prices without an API key, from Vietnamese brokers' public chart APIs (checked from a
 * cloud server in Nov 2026; Yahoo is the last resort because it rate-limits and has no VN30/HNX):
 *   DNSE   services.entrade.com.vn  daily + 1/5/15/30-min/1H bars, stocks and every index.
 *                                   Stock prices in thousand VND.
 *   Vietcap trading.vietcap.com.vn  daily/hourly/1-min bars, one symbol per request. Full VND.
 *   VNDirect api-finfo.vndirect.com.vn daily bars, MANY symbols per request (used for batch
 *                                   quotes and technicals). Stock prices in thousand VND.
 * TCBS was dropped: it now sits behind a Cloudflare browser check.
 * Everything here is normalized to full VND for stocks and points for indexes.
 */
import type { Bar } from "./chart";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/** Our symbols: "FPT.VN" for any listed stock/ETF (HOSE, HNX, UPCoM), "^VNINDEX.VN" etc. for indexes. */
export const isVnSymbol = (s: string) => /\.VN$/i.test(s);

/** Index symbols → each source's code. */
export const VN_INDEXES: Record<string, { name: string; dnse: string; vietcap: string; vndirect: string }> = {
  "^VNINDEX.VN": { name: "VN-Index", dnse: "VNINDEX", vietcap: "VNINDEX", vndirect: "VNINDEX" },
  "^VN30.VN": { name: "VN30", dnse: "VN30", vietcap: "VN30", vndirect: "VN30" },
  "^HNX.VN": { name: "HNX-Index", dnse: "HNX", vietcap: "HNXIndex", vndirect: "HNX" },
  "^HNX30.VN": { name: "HNX30", dnse: "HNX30", vietcap: "HNX30", vndirect: "HNX30" },
  "^UPCOM.VN": { name: "UPCoM", dnse: "UPCOM", vietcap: "HNXUpcomIndex", vndirect: "UPCOM" },
};

export function vnCode(symbol: string): { code: string; index: boolean } {
  const s = symbol.toUpperCase();
  const ix = VN_INDEXES[s];
  if (ix) return { code: ix.dnse, index: true };
  return { code: s.replace(/^\^/, "").replace(/\.VN$/, ""), index: false };
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
const sane = (b: Bar) => Number.isFinite(b.c) && b.c > 0 && Number.isFinite(b.t);

async function getJson(url: string, init: RequestInit & { referer: string }, ms = 8000): Promise<unknown> {
  const host = new URL(url).hostname;
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": UA, Accept: "application/json", Referer: init.referer, Origin: init.referer.replace(/\/$/, ""), ...(init.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(ms),
  });
  const name = host.includes("entrade") ? "dnse" : host.includes("vietcap") ? "vietcap" : host.includes("vndirect") ? "vndirect" : host;
  if (!res.ok) throw new Error(`${name} ${res.status}`);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) throw new Error(`${name}: blocked (HTML)`);
  return JSON.parse(text);
}

/* ---------------------------------------------------------------- DNSE */

export type DnseRes = "1" | "5" | "15" | "30" | "1H" | "1D";

/** DNSE (TradingView UDF style): { t:[], o:[], h:[], l:[], c:[], v:[] }. Stocks in thousand VND. */
export function parseDnse(j: unknown, index: boolean): Bar[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = j as any;
  const t: number[] = d?.t ?? [];
  const k = index ? 1 : 1000;
  return t
    .map((ts, i) => {
      const c = num(d.c?.[i]) * k;
      return { t: num(ts), o: num(d.o?.[i]) * k || c, h: num(d.h?.[i]) * k || c, l: num(d.l?.[i]) * k || c, c, v: num(d.v?.[i]) || 0 };
    })
    .filter(sane)
    .sort((a, b) => a.t - b.t);
}

export async function dnseBars(symbol: string, res: DnseRes, days: number): Promise<Bar[]> {
  const { code, index } = vnCode(symbol);
  const to = Math.floor(Date.now() / 1000) + 3600;
  const from = to - Math.ceil(days * 86400);
  const url = `https://services.entrade.com.vn/chart-api/v2/ohlcs/${index ? "index" : "stock"}?from=${from}&to=${to}&symbol=${encodeURIComponent(code)}&resolution=${res}`;
  const bars = parseDnse(await getJson(url, { referer: "https://banggia.dnse.com.vn/" }), index);
  if (bars.length < 2) throw new Error("dnse: no data");
  return bars;
}

/* ------------------------------------------------------------- Vietcap */

export type VietcapFrame = "ONE_MINUTE" | "ONE_HOUR" | "ONE_DAY";

/** Vietcap: [{ symbol, o:[], h:[], l:[], c:[], v:[], t:["unix",...] }]. Full VND. */
export function parseVietcap(j: unknown): Bar[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = (Array.isArray(j) ? j[0] : null) as any;
  const t: unknown[] = d?.t ?? [];
  return t
    .map((ts, i) => {
      const c = num(d.c?.[i]);
      return { t: num(ts), o: num(d.o?.[i]) || c, h: num(d.h?.[i]) || c, l: num(d.l?.[i]) || c, c, v: num(d.v?.[i]) || 0 };
    })
    .filter(sane)
    .sort((a, b) => a.t - b.t);
}

export async function vietcapBars(symbol: string, frame: VietcapFrame, count: number): Promise<Bar[]> {
  const s = symbol.toUpperCase();
  const code = VN_INDEXES[s]?.vietcap ?? vnCode(s).code;
  const body = JSON.stringify({ timeFrame: frame, symbols: [code], to: Math.floor(Date.now() / 1000) + 3600, countBack: count });
  const bars = parseVietcap(
    await getJson("https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart", { method: "POST", body, headers: { "Content-Type": "application/json" }, referer: "https://trading.vietcap.com.vn/" }),
  );
  if (bars.length < 2) throw new Error("vietcap: no data");
  return bars;
}

/* ------------------------------------------------------------ VNDirect */

// 14:45 ICT close = 07:45 UTC
const vndTime = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, 7, 45) / 1000);
};

/**
 * VNDirect rows, newest first: stocks { code, date, open, high, low, close, nmVolume, basicPrice } in
 * thousand VND; indexes { code, date, ..., accumulatedVol } in points. Returns bars per code.
 * Rows with no matched volume (the pre-open placeholder for today, suspended days) are skipped.
 */
export function parseVndirect(j: unknown, index: boolean): Map<string, Bar[]> {
  const rows = ((j as { data?: Record<string, unknown>[] })?.data ?? []) as Record<string, unknown>[];
  const k = index ? 1 : 1000;
  const out = new Map<string, Bar[]>();
  for (const r of rows) {
    const vol = num(r.nmVolume ?? r.accumulatedVol);
    if (!(vol > 0)) continue;
    // Stocks: prefer the adjusted columns (adClose...) so stock dividends and splits don't show up as
    // crashes in 52-week highs, averages and multi-week returns. They equal the raw price for the latest bar.
    const pick = (field: string) => num(r[`ad${field[0].toUpperCase()}${field.slice(1)}`]) || num(r[field]);
    const c = pick("close") * k;
    const bar = { t: vndTime(String(r.date)), o: pick("open") * k || c, h: pick("high") * k || c, l: pick("low") * k || c, c, v: vol };
    if (!sane(bar)) continue;
    const code = String(r.code).toUpperCase();
    (out.get(code) ?? out.set(code, []).get(code)!).push(bar);
  }
  for (const bars of out.values()) bars.sort((a, b) => a.t - b.t);
  return out;
}

/** Daily bars for many VN symbols in one or two requests. Missing symbols are absent from the map. */
export async function vndirectDaily(symbols: string[], days: number): Promise<Map<string, Bar[]>> {
  const out = new Map<string, Bar[]>();
  const from = new Date(Date.now() - days * 1.45 * 86400_000).toISOString().slice(0, 10);
  const stocks = symbols.filter((s) => !VN_INDEXES[s.toUpperCase()]);
  const indexes = symbols.filter((s) => VN_INDEXES[s.toUpperCase()]);
  const run = async (list: string[], index: boolean) => {
    if (!list.length) return;
    const codes = list.map((s) => (index ? VN_INDEXES[s.toUpperCase()].vndirect : vnCode(s).code));
    const table = index ? "vnmarket_prices" : "stock_prices";
    const size = Math.min(codes.length * Math.ceil(days * 1.1 + 5), 6000);
    const url = `https://api-finfo.vndirect.com.vn/v4/${table}?sort=date&q=code:${codes.join(",")}~date:gte:${from}&size=${size}&page=1`;
    const byCode = parseVndirect(await getJson(url, { referer: "https://dstock.vndirect.com.vn/" }, 12_000), index);
    list.forEach((s, i) => {
      const bars = byCode.get(codes[i]);
      if (bars && bars.length >= 2) out.set(s.toUpperCase(), bars.slice(-days));
    });
  };
  await Promise.all([run(stocks, false).catch(() => {}), run(indexes, true).catch(() => {})]);
  return out;
}

/* ------------------------------------------------------------ helpers */

/** Daily bars for one symbol from the first source that answers (errors from each are joined). */
export async function vnDaily(symbol: string, days: number): Promise<{ bars: Bar[]; source: VnSource }> {
  const errors: string[] = [];
  const tries: [VnSource, () => Promise<Bar[]>][] = [
    ["dnse", () => dnseBars(symbol, "1D", days * 1.5 + 5)],
    ["vietcap", () => vietcapBars(symbol, "ONE_DAY", days)],
    [
      "vndirect",
      async () => {
        const m = await vndirectDaily([symbol], days);
        const b = m.get(symbol.toUpperCase());
        if (!b) throw new Error("vndirect: no data");
        return b;
      },
    ],
  ];
  for (const [source, run] of tries) {
    try {
      return { bars: (await run()).slice(-days), source };
    } catch (e) {
      errors.push((e as Error).message.slice(0, 60));
    }
  }
  throw new Error(errors.join(" · "));
}

export type VnSource = "dnse" | "vietcap" | "vndirect";

/** Session date in Vietnam (UTC+7) for a unix time. */
export const ictDay = (t: number) => new Date((t + 7 * 3600) * 1000).toISOString().slice(0, 10);

/** Run async jobs with at most `n` in flight. */
export async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}
