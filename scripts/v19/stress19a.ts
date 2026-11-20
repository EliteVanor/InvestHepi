/**
 * Stress findings (Nov 20, round A), items 1-2: a same-hours ETF whose intraday session is newer than
 * the official close makes the quote an ESTIMATE for the new session (official close x the ETF's move
 * since its own previous close), never the old close relabelled as today; same session in both: the
 * official level, the ETF only gives the shape.
 */
import assert from "node:assert/strict";
import { pinClock } from "../clock";

pinClock("2026-11-20T21:30:00Z"); // Friday 16:30 New York, session over
process.env.VERCEL = "1";
delete process.env.KV_REST_API_URL;
delete process.env.AUTH_SECRET;
delete process.env.APP_PASSWORD;

const ny = (date: string, hh: number, mm: number) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), hh, mm);
const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

type Fx = { etfDays: [string, number][]; intra: { date: string; prev: number; path: number[] }; off: [string, number][]; code: string; table: "stock_prices" | "commodities" };
let fx: Fx;

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("finance.yahoo.com") || url.includes("push2his.eastmoney.com")) return new Response("Too Many Requests", { status: 429 });
  if (url.includes("api.nasdaq.com")) {
    if (url.includes("/chart")) {
      const times = [[9, 30], [12, 0], [15, 59]];
      const chart = fx.intra.path.map((y, i) => ({ x: ny(fx.intra.date, times[Math.min(i, 2)][0], times[Math.min(i, 2)][1]), y: String(y) }));
      return new Response(JSON.stringify({ data: { lastSalePrice: `$${fx.intra.path.at(-1)}`, previousClose: `$${fx.intra.prev}`, chart } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { tradesTable: { rows: fx.etfDays.map(([d, c]) => ({ date: usDate(d), close: `$${c.toFixed(2)}`, open: "", high: "", low: "", volume: "1" })) } } }), { status: 200 });
  }
  if (url.includes("api-finfo.vndirect.com.vn/v4/")) {
    const rows = fx.off.map(([d, c]) => (fx.table === "stock_prices" ? { code: fx.code, date: d, close: c, open: c, high: c, low: c } : { code: fx.code, tradingDate: d, closePrice: c, openPrice: c, highPrice: c, lowPrice: c }));
    return new Response(JSON.stringify({ data: rows }), { status: 200 });
  }
  return new Response("", { status: 404 });
}) as typeof fetch;

// symbol, etf, table, vnd code, official Nov 18, official Nov 19, ETF's Nov 19 close
const PAIRS: [string, string, "stock_prices" | "commodities", string, number, number, number][] = [
  ["GC=F", "GLD", "commodities", "GEN1ST_GOLDS_CMX", 3742, 3685.5, 300],
  ["CL=F", "USO", "commodities", "GEN1ST_WTI_OIL", 82.0, 83.21, 70],
  ["^DJI", "DIA", "stock_prices", "DOWJONES", 45000, 44800, 450],
];

(async () => {
  const Q = await import("../../src/lib/quote");
  const C = await import("../../src/lib/chart");
  const W = await import("../../src/lib/worldmarket");
  const reset = () => {
    C.clearPriceCaches();
    Q.clearQuoteCaches();
    W.clearWorldCache();
  };
  const days = (last: string, lastClose: number): [string, number][] => [[last, lastClose], ["2026-11-18", lastClose + 1], ["2026-11-17", lastClose + 2], ["2026-11-16", lastClose + 3]];

  for (const [sym, etf, table, code, o18, o19, ePrev] of PAIRS) {
    /* A: official close dated Nov 19, ETF daily history not posted for Nov 20 yet, intraday is Nov 20 */
    fx = { etfDays: days("2026-11-19", ePrev), intra: { date: "2026-11-20", prev: ePrev, path: [ePrev, ePrev * 0.98, ePrev * 0.9647] }, off: [["2026-11-17", o18 + 1], ["2026-11-18", o18], ["2026-11-19", o19]], code, table };
    reset();
    const move = (0.9647 - 1) * 100;
    let [q] = await Q.currentQuotes([sym]);
    assert.equal(q.basis, "estimate", `${sym}: ETF session newer than the official close: an estimate`);
    assert.equal(q.via, etf);
    assert.equal(q.session, "2026-11-20", `${sym}: dated by the data used (the ETF's session)`);
    assert.ok(Math.abs(q.prevClose - o19) < 1e-6, `${sym}: previous close is the official Nov 19 close`);
    assert.ok(Math.abs(q.changePct - move) < 0.05, `${sym}: change is the ETF's move (${q.changePct} vs ${move})`);
    assert.ok(Math.abs(q.price - o19 * 0.9647) / o19 < 1e-4, `${sym}: official close x the ETF's move, not the old close`);
    const ch = await C.getChart(sym, "1d");
    assert.equal(ch.estimatedVia, etf);
    assert.ok(!ch.shapeVia, `${sym}: no shape-only label for a newer session`);

    /* B: official close already dated Nov 20 and the ETF's intraday is Nov 20: official level, shape only */
    fx = { etfDays: days("2026-11-19", ePrev), intra: { date: "2026-11-20", prev: ePrev, path: [ePrev, ePrev * 0.98, ePrev * 0.9647] }, off: [["2026-11-18", o19], ["2026-11-19", o19 + 1], ["2026-11-20", o19 * 0.97]], code, table };
    reset();
    [q] = await Q.currentQuotes([sym]);
    assert.notEqual(q.basis, "estimate", `${sym}: official close for the same session`);
    assert.ok(Math.abs(q.price - o19 * 0.97) < 1e-6, `${sym}: official level`);
    assert.equal(q.session, "2026-11-20");
    const ch2 = await C.getChart(sym, "1d");
    assert.equal(ch2.shapeVia, etf, `${sym}: the ETF only gives the shape`);
  }

  /* ---------------- item 2: a day-old number always carries its date, also after a live overlay */
  const V = await import("../../src/lib/quote-view");
  const open = new Date("2026-11-20T18:00:00Z"); // Friday 13:00 New York, open
  const oil = { symbol: "CL=F", price: 83.21, prevClose: 83.26, changePct: -0.06, history: [["2026-11-18", 83.26], ["2026-11-19", 83.21]] as [string, number][], source: "vndirect-world" as const };
  assert.equal(V.staleDayTag(oil, open), "2026-11-19", "the stored digest quote's close of Nov 19 is dated while Nov 20 trades");
  const live = { symbol: "CL=F", price: 83.55, prevClose: 82.44, changePct: 1.35, intraday: true, session: "2026-11-20", state: "open", basis: "level", asOf: 1, source: "yahoo", spark: [1, 2], stale: false } as unknown as import("../../src/lib/quote-view").CurrentQuote;
  assert.equal(V.staleDayTag(V.overlayQuote(oil, live), open), null, "an overlay with today's session drops the tag");
  const staleLive = { ...live, session: "2026-11-19", intraday: false } as typeof live;
  assert.equal(V.staleDayTag(V.overlayQuote(oil, staleLive), open), "2026-11-19", "an overlay that is itself a day old keeps the tag");
  assert.equal(V.staleDayTag(oil, new Date("2026-11-20T13:00:00Z")), null, "before the open the Nov 19 close is the latest session: no tag");
  assert.equal(V.staleDayTag({ ...oil, history: [] }, open), null, "no date, no tag");
  console.log("STRESS19A OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
