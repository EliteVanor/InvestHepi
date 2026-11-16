/**
 * Real world-market levels from VNDirect's public data API (api-finfo.vndirect.com.vn, the same keyless
 * host used for Vietnamese prices; its data is sourced from Bloomberg). Used when Yahoo refuses the
 * server, so briefings, charts and the strip show the actual S&P 500, Nikkei, oil or USD/VND level
 * instead of a tracking ETF's price.
 *
 * Daily closes only, posted once a day (next day, roughly 03:00-07:00 UTC). So every value carries its
 * date, and nothing here is presented as live. For US-hours markets with a US-listed tracking ETF
 * (S&P 500, Dow, WTI, gold) `estimateFromEtf` extends the last official close by the ETF's move in a
 * newer session, flagged as an estimate. Non-US indexes are never extended from US-hours ETFs (EWJ
 * trades at different hours and in dollars, so its move isn't the Nikkei's).
 *
 * Verified Nov 16 2026: Nasdaq Composite matched Nasdaq's own API to the cent.
 */
import type { Bar } from "./chart";

type Table = "stock_prices" | "currencies" | "commodities";

/** Our symbol → VNDirect table and code. */
export const VND_WORLD: Record<string, { table: Table; code: string }> = {
  "^GSPC": { table: "stock_prices", code: "S&P500" },
  "^DJI": { table: "stock_prices", code: "DOWJONES" },
  "^IXIC": { table: "stock_prices", code: "NASDAQ" },
  "^N225": { table: "stock_prices", code: "NIKKEI225" },
  "^HSI": { table: "stock_prices", code: "HANGSENG" },
  "000001.SS": { table: "stock_prices", code: "SHANGHAI" },
  "^GDAXI": { table: "stock_prices", code: "DAX" },
  "^FTSE": { table: "stock_prices", code: "FTSE100" },
  "^FCHI": { table: "stock_prices", code: "CAC40" },
  "^KS11": { table: "stock_prices", code: "KOSPI" },
  "^NSEI": { table: "stock_prices", code: "NIFTY" },
  "^AXJO": { table: "stock_prices", code: "ASX200" },
  "^TWII": { table: "stock_prices", code: "TAIEX" },
  "^STI": { table: "stock_prices", code: "FSSTI" },
  "CL=F": { table: "commodities", code: "GEN1ST_WTI_OIL" },
  "BZ=F": { table: "commodities", code: "GEN1ST_BRENT_OIL" },
  "GC=F": { table: "commodities", code: "GEN1ST_GOLDS_CMX" },
  "SI=F": { table: "commodities", code: "GEN1ST_SILV_CMX" },
  "HG=F": { table: "commodities", code: "GEN1ST_COPPER" },
  "VND=X": { table: "currencies", code: "USD_VND" },
  "EURUSD=X": { table: "currencies", code: "EUR_USD" },
  "JPY=X": { table: "currencies", code: "USD_JPY" },
  "CNY=X": { table: "currencies", code: "USD_CNY" },
  "KRW=X": { table: "currencies", code: "USD_KRW" },
};

/**
 * Markets whose tracking ETF trades in the same hours and currency, so the ETF's move in a newer
 * session can carry the last official close forward (marked as an estimate).
 */
export const SAME_HOURS_ETF: Record<string, string> = { "^GSPC": "SPY", "^DJI": "DIA", "CL=F": "USO", "GC=F": "GLD" };

/** US Treasury yields (percent) from the Treasury's official daily yield-curve file. */
const TREASURY: Record<string, string> = { "^TNX": "10 Yr", "^FVX": "5 Yr", "2YY=F": "2 Yr", "^TYX": "30 Yr" };

export const hasWorldDaily = (s: string) => !!VND_WORLD[s] || !!TREASURY[s];

/** Parse the Treasury CSV ("Date","1 Mo",...) into bars per column. Exported for tests. */
export function parseTreasuryCsv(csv: string): Map<string, Bar[]> {
  const lines = csv.trim().split(/\r?\n/);
  const head = (lines.shift() ?? "").split(",").map((h) => h.replace(/"/g, "").trim());
  const out = new Map<string, Bar[]>();
  for (const line of lines) {
    const cells = line.split(",");
    const [m, d, y] = (cells[0] ?? "").split("/").map(Number);
    if (!y) continue;
    const t = Math.floor(Date.UTC(y, m - 1, d, 12) / 1000);
    head.forEach((h, i) => {
      const v = Number(cells[i]);
      if (i === 0 || !(v > 0)) return;
      (out.get(h) ?? out.set(h, []).get(h)!).push({ t, o: v, h: v, l: v, c: v, v: 0 });
    });
  }
  for (const bars of out.values()) bars.sort((a, b) => a.t - b.t);
  return out;
}

async function treasuryYear(year: number): Promise<Map<string, Bar[]>> {
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
  const res = await fetch(url, { headers: { "User-Agent": "InvestHepi/1.0 (market news reader)", Accept: "text/csv" }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`treasury ${res.status}`);
  return parseTreasuryCsv(await res.text());
}

/** Treasury yields for the mapped symbols: this year's file, plus last year's when more history is needed. */
async function treasuryDaily(symbols: string[], days: number): Promise<Map<string, Bar[]>> {
  const now = new Date();
  const years = [now.getUTCFullYear()];
  if (now.getTime() - days * 86400_000 < Date.UTC(now.getUTCFullYear(), 0, 1)) years.unshift(now.getUTCFullYear() - 1);
  const files = await Promise.all(years.map((y) => treasuryYear(y).catch(() => new Map<string, Bar[]>())));
  const out = new Map<string, Bar[]>();
  for (const s of symbols) {
    const bars = files.flatMap((f) => f.get(TREASURY[s]) ?? []).filter((b) => b.t * 1000 >= now.getTime() - days * 86400_000);
    if (bars.length >= 2) out.set(s, bars);
  }
  return out;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const n = (v: unknown) => (typeof v === "number" ? v : Number(v));

/** Noon UTC of the trading date: the same calendar day in every exchange's time zone. */
const dayT = (date: string) => {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, 12) / 1000);
};

/** Parse one VNDirect table's rows into bars per code (duplicate language rows merged). Exported for tests. */
export function parseWorld(j: unknown, table: Table): Map<string, Bar[]> {
  const rows = ((j as { data?: Record<string, unknown>[] })?.data ?? []) as Record<string, unknown>[];
  const out = new Map<string, Map<string, Bar>>();
  for (const r of rows) {
    const date = String(table === "stock_prices" ? r.date : r.tradingDate ?? "");
    const c = n(table === "stock_prices" ? r.close : r.closePrice);
    if (!/^\d{4}-\d{2}-\d{2}/.test(date) || !(c > 0)) continue;
    const o = n(table === "stock_prices" ? r.open : r.openPrice) || c;
    const h = n(table === "stock_prices" ? r.high : r.highPrice) || Math.max(o, c);
    const l = n(table === "stock_prices" ? r.low : r.lowPrice) || Math.min(o, c);
    const v = n(table === "stock_prices" ? r.nmVolume : r.volume) || 0;
    const code = String(r.code);
    const byDate = out.get(code) ?? out.set(code, new Map()).get(code)!;
    byDate.set(date.slice(0, 10), { t: dayT(date), o, h: Math.max(h, o, c), l: Math.min(l, o, c), c, v });
  }
  return new Map([...out].map(([code, m]) => [code, [...m.values()].sort((a, b) => a.t - b.t)]));
}

const cache = new Map<string, { at: number; bars: Bar[] }>();
const TTL_MS = 30 * 60_000; // posted once a day

/**
 * Daily bars for the mapped symbols, oldest first, at most one request per table. Cached 30 minutes.
 * Symbols without data are absent from the map.
 */
export async function worldDaily(symbols: string[], days = 400): Promise<Map<string, Bar[]>> {
  const out = new Map<string, Bar[]>();
  const want = [...new Set(symbols)].filter((s) => !!VND_WORLD[s]);
  const yields = [...new Set(symbols)].filter((s) => !!TREASURY[s]);
  const need: string[] = [];
  for (const s of want) {
    const hit = cache.get(`${s}|${days}`) ?? cache.get(`${s}|400`);
    if (hit && Date.now() - hit.at < TTL_MS) out.set(s, hit.bars.slice(-Math.ceil(days * 0.75)));
    else need.push(s);
  }
  const byTable = new Map<Table, string[]>();
  for (const s of need) byTable.set(VND_WORLD[s].table, [...(byTable.get(VND_WORLD[s].table) ?? []), s]);
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const yNeed = yields.filter((s) => {
    const hit = cache.get(`${s}|${days}`) ?? cache.get(`${s}|400`);
    if (hit && Date.now() - hit.at < TTL_MS) out.set(s, hit.bars);
    return !(hit && Date.now() - hit.at < TTL_MS);
  });
  await Promise.all([
    (async () => {
      if (!yNeed.length) return;
      for (const [s, bars] of await treasuryDaily(yNeed, days).catch(() => new Map<string, Bar[]>())) {
        out.set(s, bars);
        cache.set(`${s}|${days}`, { at: Date.now(), bars });
      }
    })(),
    ...[...byTable].map(async ([table, syms]) => {
      const codes = syms.map((s) => encodeURIComponent(VND_WORLD[s].code)).join(",");
      const dateField = table === "stock_prices" ? "date" : "tradingDate";
      // Two rows per day (Vietnamese and English labels) for currencies and commodities.
      const size = Math.min(9000, Math.ceil(days * 0.75) * syms.length * (table === "stock_prices" ? 1 : 2) + 50);
      const url = `https://api-finfo.vndirect.com.vn/v4/${table}?sort=${dateField}&q=code:${codes}~${dateField}:gte:${from}&size=${size}&page=1`;
      try {
        const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://dstock.vndirect.com.vn/" }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
        if (!res.ok) return;
        const parsed = parseWorld(await res.json(), table);
        for (const s of syms) {
          const bars = parsed.get(VND_WORLD[s].code);
          if (bars && bars.length >= 2) {
            out.set(s, bars);
            cache.set(`${s}|${days}`, { at: Date.now(), bars });
          }
        }
      } catch {}
    }),
  ]);
  if (cache.size > 300) for (const k of [...cache.keys()].slice(0, 100)) cache.delete(k);
  return out;
}

/** Tests only. */
export function clearWorldCache() {
  cache.clear();
}

/**
 * Carry an official daily close forward with a same-hours ETF's move: only when the ETF's previous
 * session is exactly the official series' last date (one session newer, no gap to guess across).
 * Returns the estimated level and its date, or null. Exported for tests.
 */
export function estimateFromEtf(official: Bar[], etfDaily: [string, number][], dateOf: (t: number) => string): { price: number; prevClose: number; date: string; changePct: number } | null {
  const last = official.at(-1);
  if (!last || etfDaily.length < 2) return null;
  const lastDate = dateOf(last.t);
  const [etfDate, etfClose] = etfDaily.at(-1)!;
  const [etfPrevDate, etfPrev] = etfDaily.at(-2)!;
  if (etfDate <= lastDate || etfPrevDate !== lastDate || !(etfPrev > 0)) return null;
  const changePct = ((etfClose - etfPrev) / etfPrev) * 100;
  return { price: last.c * (1 + changePct / 100), prevClose: last.c, date: etfDate, changePct };
}
