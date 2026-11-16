/**
 * Prices must match everywhere: the strip shows exactly what the chart sheet shows (same function),
 * today's session wins over DNSE's lagging daily bars, real world levels from VNDirect with their
 * dates, ETF estimates only for same-hours markets and only one session ahead, Treasury yields, and
 * price formatting. `npx tsx scripts/v10test.ts`
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";

process.env.VERCEL = "1";
delete process.env.KV_REST_API_URL;

const DAY = 86400;
const now = Math.floor(Date.now() / 1000);
/** Last N weekdays (ICT dates), oldest first, ending yesterday-or-earlier. */
function sessions(n: number, includeToday: boolean): string[] {
  const out: string[] = [];
  for (let i = includeToday ? 0 : 1; out.length < n; i++) {
    const d = new Date((now - i * DAY + 7 * 3600) * 1000);
    if (d.getUTCDay() % 6 !== 0) out.unshift(d.toISOString().slice(0, 10));
  }
  return out;
}
const ict = (date: string, hhmm: string) => Math.floor(Date.parse(`${date}T${hhmm}:00+07:00`) / 1000);

const past = sessions(12, false); // completed sessions, for DNSE's daily (which lacks today)
const today = new Date((now + 7 * 3600) * 1000).toISOString().slice(0, 10);
const yahooDown = true;

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("finance.yahoo.com")) return new Response("Too Many Requests", { status: yahooDown ? 429 : 200 });
  if (url.includes("services.entrade.com.vn")) {
    const res = url.match(/resolution=([^&]+)/)![1];
    if (res === "1D") {
      // DNSE's daily series: completed sessions only (no bar for today while it trades).
      const t = past.map((d) => ict(d, "00:00"));
      return new Response(JSON.stringify({ t, o: t.map(() => 120), h: t.map(() => 122), l: t.map(() => 119), c: t.map((_, i) => 120 + i * 0.1), v: t.map(() => 9) }), { status: 200 });
    }
    // 1-minute bars: yesterday and today's live session.
    const days = [past.at(-1)!, today];
    const t = days.flatMap((d) => ["09:15", "09:16", "10:05", "10:06"].map((h) => ict(d, h)));
    const c = t.map((_, i) => (i < 4 ? 121 : [121.2, 121.4, 120.9, 121.27][i - 4]));
    return new Response(JSON.stringify({ t, o: c, h: c, l: c, c, v: t.map(() => 5) }), { status: 200 });
  }
  if (url.includes("api-finfo.vndirect.com.vn/v4/stock_prices")) {
    const codes = decodeURIComponent(url.split("q=code:")[1].split("~")[0]).split(",");
    const rows = codes.flatMap((code) => sessions(30, false).map((date, i) => ({ code, date, time: "11:11:09", open: 7000 + i, high: 7010 + i, low: 6990 + i, close: code === "S&P500" ? 7500 + i : 60000 + i * 10, nmVolume: 1 })));
    return new Response(JSON.stringify({ data: rows }), { status: 200 });
  }
  if (url.includes("api-finfo.vndirect.com.vn/v4/currencies")) {
    // Two rows per day (Vietnamese and English labels): must be merged, not doubled.
    const rows = sessions(30, false).flatMap((d, i) => ["VN", "EN_GB"].map((locale) => ({ code: "USD_VND", tradingDate: d, openPrice: 25600 + i, highPrice: 25610 + i, lowPrice: 25590 + i, closePrice: 25600 + i, locale })));
    return new Response(JSON.stringify({ data: rows }), { status: 200 });
  }
  if (url.includes("home.treasury.gov")) {
    const ds = sessions(5, false).reverse().map((d) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`);
    return new Response(`Date,"1 Mo","2 Yr","10 Yr"\n${ds.map((d, i) => `${d},4.10,4.88,${(5.15 - i * 0.05).toFixed(2)}`).join("\n")}\n`, { status: 200 });
  }
  if (url.includes("api.nasdaq.com")) return new Response(JSON.stringify({ data: null }), { status: 200 });
  return new Response("", { status: 404 });
}) as typeof fetch;

(async () => {
  await fs.rm("/tmp/invest-helper", { recursive: true, force: true });
  const C = await import("../src/lib/chart");
  const W = await import("../src/lib/worldmarket");
  const M = await import("../src/lib/market");

  /* ---------------- Vietnam: strip == chart sheet, today's session, not DNSE's lagging daily bar */
  const [lq] = await C.getLiveQuotes(["^UPCOM.VN"]);
  const chart = await C.getChart("^UPCOM.VN", "1d");
  assert.equal(lq.price, 121.27, "live price is today's last minute, not Friday's daily close");
  assert.equal(lq.prevClose, chart.prevClose, "same previous close as the chart sheet");
  assert.equal(lq.changePct, chart.changePct, "same change as the chart sheet");
  assert.equal(lq.session, today, "dated to today's HOSE session");
  assert.equal(lq.intraday, true);
  assert.equal(lq.spark.length, 4, "the sparkline is today's path");
  assert.ok(lq.prevClose > 121 && lq.changePct < 0 === lq.price < lq.prevClose, "direction and sign agree");

  /* ---------------- world: real levels with their dates */
  C.clearPriceCaches();
  W.clearWorldCache();
  const q = await M.getQuotes(["^N225", "VND=X", "^TNX"]);
  const nk = q.find((x) => x.symbol === "^N225")!;
  assert.ok(nk.price > 60000 && !nk.proxy, "Nikkei at its real level, not EWJ's price");
  assert.equal(nk.dailyOnly, true);
  assert.equal(nk.history.at(-1)![0], sessions(30, false).at(-1), "dated to its last close");
  assert.match(M.levelText(nk), /\[close of \d{4}-\d{2}-\d{2}\]/, "the AI is told the date");
  const vnd = q.find((x) => x.symbol === "VND=X")!;
  assert.equal(vnd.history.length, 22, "one month of sessions");
  const dup = W.parseWorld({ data: ["VN", "EN_GB"].flatMap((locale) => [{ code: "USD_VND", tradingDate: "2026-11-12", closePrice: 25684, locale }, { code: "USD_VND", tradingDate: "2026-11-13", closePrice: 25707, locale }]) }, "currencies");
  assert.equal(dup.get("USD_VND")!.length, 2, "duplicate language rows merged into one per day");
  const tnx = q.find((x) => x.symbol === "^TNX")!;
  assert.equal(tnx.price, 5.15, "10-year yield from the Treasury file");
  assert.equal(W.parseTreasuryCsv('Date,"10 Yr"\n11/13/2026,5.15\n11/12/2026,5.10\n').get("10 Yr")!.map((b) => b.c).join(), "5.1,5.15", "oldest first");

  /* ---------------- ETF estimates: same-hours ETF, exactly one session newer */
  const official = [{ t: 1, o: 1, h: 1, l: 1, c: 7500, v: 0 }, { t: 2, o: 1, h: 1, l: 1, c: 7561.67, v: 0 }];
  const dateOf = (t: number) => (t === 1 ? "2026-11-12" : "2026-11-13");
  const est = W.estimateFromEtf(official, [["2026-11-13", 754.37], ["2026-11-16", 758.14]], dateOf)!;
  assert.ok(Math.abs(est.price - 7561.67 * (758.14 / 754.37)) < 1e-6 && est.date === "2026-11-16", "official close × the ETF's move");
  assert.equal(W.estimateFromEtf(official, [["2026-11-12", 750], ["2026-11-13", 754.37]], dateOf), null, "same session: use the official close, no estimate");
  assert.equal(W.estimateFromEtf(official, [["2026-11-16", 754], ["2026-11-17", 758]], dateOf), null, "gap of more than one session: no guessing");
  assert.ok(!("^N225" in W.SAME_HOURS_ETF) && !("^HSI" in W.SAME_HOURS_ETF), "non-US indexes are never estimated from US-hours ETFs");
  assert.match(M.levelText({ symbol: "^GSPC", price: 7599.5, prevClose: 7561.67, changePct: 0.5, history: [["2026-11-13", 7561.67], ["2026-11-16", 7599.5]], source: "vndirect-world", estimatedVia: "SPY" }), /^≈7599\.50 \[estimate .*SPY.*say "about"\]/);

  /* ---------------- formatting */
  const P = await import("../src/components/primitives");
  const S = await import("../src/lib/symbols");
  assert.equal(P.fmtPrice(1734.93), "1,734.93", "index levels keep their decimals");
  assert.equal(P.fmtPrice(53800), "53,800", "whole-number share prices stay whole");
  assert.equal(P.fmtPrice(1.1023, S.priceDigits("EURUSD=X", 1.1023)), "1.1023", "currency pairs: 4 decimals");
  assert.equal(P.fmtPrice(25707, S.priceDigits("VND=X", 25707)), "25,707.00");

  console.log("V10 OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
