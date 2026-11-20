/**
 * v19 audit row 4 (also rows 6, 7, 15; PX-1..PX-7, PX-9, PX-11): one current quote that every screen
 * reads. Pins the owner's rules (HANDOFF "Design decisions, Nov 20", Q1-Q8):
 *   the regular-session price after the close and before the open, with after hours / pre-market apart;
 *   the previous close never from a 04:00 pre-market bar; stale = 15 min without an update in session,
 *   or a daily close older than the latest finished session, and an overlay never drops it; an ETF
 *   stand-in is never a level (level alerts pause, % alerts work); portfolio subtotals per currency;
 *   the chart header shows the same price on every range; 5D = 5 sessions back, 1M = the same calendar
 *   date a month back (holiday gaps, month ends); polling follows each symbol's own hours.
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import { pinClock } from "../clock";

pinClock("2026-11-20T18:00:00Z"); // Friday 13:00 New York, session open
process.env.VERCEL = "1"; // store in /tmp/invest-helper, wiped below
delete process.env.KV_REST_API_URL;
delete process.env.AUTH_SECRET;
delete process.env.APP_PASSWORD;

/* ---------------- Nasdaq fixture: New York wall-clock written as UTC, as Nasdaq does */
const ny = (date: string, hh: number, mm: number) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), hh, mm);
type Pt = { x: number; y: string };
const nas = {
  chart: [] as Pt[],
  lastSale: "",
  previousClose: "" as string | undefined,
  /** Daily closes, newest first: [MM/DD/YYYY, close]. */
  days: [] as [string, number][],
  down: false,
};
const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
/** Weekdays ending at `last` (inclusive), newest first, closes from `lastClose` down by 0.5 per day. */
function weekdays(last: string, n: number, lastClose: number): [string, number][] {
  const out: [string, number][] = [];
  const d = new Date(last + "T12:00:00Z");
  while (out.length < n) {
    if (d.getUTCDay() % 6 !== 0) out.push([usDate(d.toISOString().slice(0, 10)), lastClose - out.length * 0.5]);
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("finance.yahoo.com")) return new Response("Too Many Requests", { status: 429 });
  if (url.includes("api.nasdaq.com")) {
    if (nas.down) return new Response("unavailable", { status: 503 });
    if (url.includes("/chart")) return new Response(JSON.stringify({ data: { lastSalePrice: nas.lastSale, ...(nas.previousClose ? { previousClose: nas.previousClose } : {}), chart: nas.chart } }), { status: 200 });
    return new Response(JSON.stringify({ data: { tradesTable: { rows: nas.days.map(([date, c]) => ({ date, close: `$${c.toFixed(2)}`, open: "", high: "", low: "", volume: "1" })) } } }), { status: 200 });
  }
  return new Response("", { status: 404 });
}) as typeof fetch;

(async () => {
  await fs.rm("/tmp/invest-helper", { recursive: true, force: true });
  const Q = await import("../../src/lib/quote");
  const V = await import("../../src/lib/quote-view");
  const C = await import("../../src/lib/chart");
  const Y = await import("../../src/lib/yahoo");
  const reset = () => {
    C.clearPriceCaches();
    Q.clearQuoteCaches();
    Y.resetYahoo();
  };

  /* ---------------- stale: a live price in session, then the source fails (expired cache) */
  nas.days = weekdays("2026-11-19", 30, 98);
  nas.chart = [ny("2026-11-20", 4, 0), ny("2026-11-20", 9, 30), ny("2026-11-20", 12, 59)].map((x, i) => ({ x, y: String([95, 99, 99.5][i]) }));
  nas.lastSale = "$99.50";
  nas.previousClose = "$98.00";
  let [m] = await Q.currentQuotes(["MSFT"]);
  assert.deepEqual([m.price, m.prevClose, m.state, m.intraday, m.stale], [99.5, 98, "open", true, false], "live in session, one minute old: not stale");
  nas.down = true;
  pinClock("2026-11-20T18:20:00Z"); // 20 minutes later, every source failing
  [m] = await Q.currentQuotes(["MSFT"]);
  assert.equal(m.price, 99.5, "the last good price is still shown");
  assert.equal(m.stale, true, "but an expired cache is stale, not live (21 min without an update in session)");
  assert.equal((await C.getChart("MSFT", "1d")).stale, true, "the chart series served from an expired cache says so too");
  nas.down = false;

  /* ---------------- after the close: the regular close is the price, after hours apart */
  pinClock("2026-11-20T22:30:00Z"); // Friday 17:30 New York
  reset();
  nas.chart = [
    { x: ny("2026-11-20", 4, 0), y: "95.00" }, // pre-market print: never the previous close
    { x: ny("2026-11-20", 9, 30), y: "99.00" },
    { x: ny("2026-11-20", 15, 59), y: "100.00" },
    { x: ny("2026-11-20", 16, 30), y: "101.50" },
    { x: ny("2026-11-20", 17, 29), y: "102.00" },
  ];
  nas.lastSale = "$102.00"; // Nasdaq's last sale includes after hours
  nas.previousClose = undefined; // and its previous close is unreliable or missing
  const [a] = await Q.currentQuotes(["AAPL"], { windows: true });
  assert.equal(a.price, 100, "the regular-session close, not the after-hours print");
  assert.equal(a.prevClose, 98, "previous close from the daily history, not the 04:00 bar (95)");
  assert.ok(Math.abs(a.changePct - (100 / 98 - 1) * 100) < 1e-9, "day change vs the previous close");
  assert.deepEqual([a.session, a.state, a.basis, a.stale], ["2026-11-20", "after", "level", false]);
  assert.equal(a.extended?.kind, "after");
  assert.equal(a.extended?.price, 102, "after hours shown separately");
  assert.ok(Math.abs(a.extended!.changePct - 2) < 1e-9, "after-hours move vs the regular close");
  // 5D and 1M from the same daily series, through the module.
  const closes: [string, number][] = nas.days.map(([d, c]) => [`${d.slice(6)}-${d.slice(0, 2)}-${d.slice(3, 5)}`, c] as [string, number]).reverse();
  assert.equal(a.changes?.["5d"], V.windowChange(closes, 100, "5d", "2026-11-20"));
  assert.equal(a.changes?.["1mo"], V.windowChange(closes, 100, "1mo", "2026-11-20"));

  /* ---------------- the chart header: the current quote on every range */
  const route = await import("../../src/app/api/chart/route");
  const heads: number[][] = [];
  for (const range of ["1d", "5d", "1mo"]) {
    const j = await (await route.GET(new Request(`http://x/api/chart?symbol=AAPL&range=${range}`))).json();
    heads.push([j.quote.price, j.quote.changePct]);
    if (range === "1d") {
      assert.equal(j.prevClose, 98, "the 1-day chart's previous-close line is the quote's");
      assert.ok(j.bars.every((b: { t: number }) => { const h = new Date(b.t * 1000).getUTCHours(); return h >= 14 && h <= 21; }), "1-day bars: regular session only");
    }
    if (range === "5d") assert.equal(j.rangeChangePct, a.changes?.["5d"], "5D change beside the price");
    if (range === "1mo") assert.equal(j.rangeChangePct, a.changes?.["1mo"], "1M change beside the price");
  }
  assert.deepEqual(heads[1], heads[0], "5D header = 1D header");
  assert.deepEqual(heads[2], heads[0], "1M header = 1D header (not the last daily bar, 98)");

  // Nasdaq's daily row for the same evening carried the 20:00 after-hours print (SPY, Nov 19 2026): never the price.
  reset();
  nas.days = [[usDate("2026-11-20"), 102], ...weekdays("2026-11-19", 30, 98)];
  assert.equal((await Q.currentQuotes(["AAPL"]))[0].price, 100, "the same evening's daily row doesn't replace the regular-session close");

  /* ---------------- pre-market: same rule */
  reset();
  nas.days = weekdays("2026-11-20", 30, 100);
  nas.chart = [{ x: ny("2026-11-23", 4, 0), y: "101.00" }, { x: ny("2026-11-23", 7, 59), y: "103.00" }];
  nas.lastSale = "$103.00";
  nas.previousClose = undefined;
  const [p] = await Q.currentQuotes(["AAPL"], { now: new Date("2026-11-23T13:00:00Z") }); // Monday 08:00 New York
  assert.deepEqual([p.price, p.prevClose, p.session, p.state, p.intraday], [100, 99.5, "2026-11-20", "pre", false], "before the open: Friday's close and its change");
  assert.deepEqual([p.extended?.kind, p.extended?.price], ["pre", 103], "pre-market shown separately");
  assert.ok(Math.abs(p.extended!.changePct - 3) < 1e-9);
  assert.equal(p.stale, false, "Friday's close is the latest finished session");

  /* ---------------- stale rule (pure) */
  const base = { symbol: "AAPL", intraday: true, session: "2026-11-20", asOf: Date.parse("2026-11-20T17:44:00Z") / 1000 };
  assert.equal(V.isStale(base, Date.parse("2026-11-20T18:00:00Z")), true, "live, 16 min old in session: stale");
  assert.equal(V.isStale({ ...base, asOf: Date.parse("2026-11-20T17:50:00Z") / 1000 }, Date.parse("2026-11-20T18:00:00Z")), false, "10 min old: live");
  assert.equal(V.isStale({ ...base, session: "2026-11-19", asOf: Date.parse("2026-11-19T21:00:00Z") / 1000 }, Date.parse("2026-11-20T14:40:00Z")), false, "10 min after the open with no print yet: not stale");
  const daily = { symbol: "^N225", intraday: false, asOf: 0 };
  assert.equal(V.isStale({ ...daily, session: "2026-11-19" }, Date.parse("2026-11-20T08:00:00Z")), true, "daily close older than Tokyo's finished Friday session: stale");
  assert.equal(V.isStale({ ...daily, session: "2026-11-20" }, Date.parse("2026-11-20T08:00:00Z")), false);
  assert.equal(V.isStale({ ...daily, session: "2026-11-19" }, Date.parse("2026-11-20T03:00:00Z")), false, "during Friday's session, Thursday's close is the latest finished one");
  assert.equal(V.isStale({ ...daily, session: "2026-11-20", stale: true }, Date.parse("2026-11-20T08:00:00Z")), true, "a source's own stale flag wins");

  /* ---------------- overlays keep the stale label */
  const snap = { symbol: "SPY", price: 500, prevClose: 495, changePct: 1, history: [["2026-11-19", 495], ["2026-11-20", 500]] as [string, number][], source: "nasdaq" as const };
  const cur = (o: Partial<import("../../src/lib/quote-view").CurrentQuote> = {}) => ({ symbol: "SPY", price: 510, prevClose: 500, changePct: 2, session: "2026-11-20", state: "open" as const, intraday: true, basis: "level" as const, stale: true, asOf: 0, source: "nasdaq", spark: [1, 2], ...o });
  assert.equal(V.overlayQuote(snap, cur()).stale, true, "overlay keeps stale");
  const S = await import("../../src/components/shell/strip");
  const rows = S.stripRows({ quotes: [snap], macro: [] } as never, { groups: [{ symbols: ["SPY"] }], macro: [] }, new Map([["SPY", cur()]]));
  assert.deepEqual([rows.groups[0].quotes[0].price, rows.groups[0].quotes[0].stale], [510, true], "the strip shows the stale label from the live quote");
  assert.equal(V.overlayQuote({ ...snap, symbol: "^GSPC" }, cur({ symbol: "^GSPC", basis: "proxy", via: "SPY", stale: false })).price, 500, "an ETF price never replaces a real level");
  assert.equal(V.showsLevel(V.quoteFromCurrent(cur({ symbol: "^STOXX50E", basis: "proxy", via: "FEZ" }))), false, "an ETF stand-in's price is never shown as a level");

  /* ---------------- alerts on an ETF stand-in: % rules only, level rules paused */
  const A = await import("../../src/lib/alerts");
  const t = ((k: string) => k) as never;
  const settings = {
    ...A.DEFAULT_ALERTS, enabled: true,
    priceAlerts: [
      { id: "lvl", symbol: "^GSPC", op: "below" as const, value: 6000, repeat: true, active: true, createdAt: "" },
      { id: "pct", symbol: "^GSPC", op: "pct_down" as const, value: 1, repeat: true, active: true, createdAt: "" },
      { id: "real", symbol: "^N225", op: "below" as const, value: 60000, repeat: true, active: true, createdAt: "" },
    ],
  };
  const r = A.evaluatePriceRules(settings, [cur({ symbol: "^GSPC", price: 680, prevClose: 690, changePct: -1.45, basis: "proxy", via: "SPY" }), cur({ symbol: "^N225", price: 50000, basis: "level" })], [], "2026-11-20", t);
  assert.deepEqual(r.fired.sort(), ["pct", "real"], "S&P below 6000 doesn't fire on SPY at 680; the % rule and real levels still work");
  assert.deepEqual(r.paused, ["lvl"], "the level rule is reported paused");

  /* ---------------- briefings: a snapshot with a stale price is reused for a minute, not 10 */
  const Pl = await import("../../src/lib/pipeline");
  const fresh = { symbol: "SPY", price: 1, prevClose: 1, changePct: 0, history: [], source: "nasdaq" as const };
  assert.equal(Pl.marketTtl({ quotes: [fresh], macro: [], sectors: [] }), 10 * 60_000);
  assert.equal(Pl.marketTtl({ quotes: [fresh], macro: [], sectors: [{ ...fresh, symbol: "XLK", stale: true }] }), 60_000, "a stale sector price expires after a minute");

  /* ---------------- portfolio: subtotals per currency, never summed across */
  const PM = await import("../../src/lib/portfolioMath");
  const s = PM.summarize([{ symbol: "AAPL", shares: 10, cost: 100 }, { symbol: "FPT.VN", shares: 100, cost: 90000 }], [{ symbol: "AAPL", price: 150, prevClose: 140 }, { symbol: "FPT.VN", price: 100000, prevClose: 98000 }]);
  assert.deepEqual(s.groups.map((g) => [g.currency, g.value, g.dayPnl]), [["USD", 1500, 100], ["VND", 10_000_000, 200_000]], "one subtotal per currency");
  assert.ok(!Number.isFinite(s.value), "no total across currencies");
  assert.equal(s.positions.find((x) => x.symbol === "FPT.VN")!.weight, 100, "weights within the currency");

  /* ---------------- window changes (Q7) */
  // Weekdays Jan 2 - Mar 31 2026 with a Tet-like gap: Feb 16-24 (7 weekdays) have no bar.
  const hist: [string, number][] = [];
  for (let d = new Date("2026-01-02T12:00:00Z"); d <= new Date("2026-03-31T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (d.getUTCDay() % 6 === 0 || (iso >= "2026-02-16" && iso <= "2026-02-24")) continue;
    hist.push([iso, 100 + hist.length]);
  }
  const at = (iso: string) => hist.find(([d]) => d === iso)![1];
  const chg = (from: number, to: number) => ((to - from) / from) * 100;
  const h27 = hist.filter(([d]) => d <= "2026-02-27");
  assert.equal(V.windowChange(h27, 500, "5d", "2026-02-27"), chg(at("2026-02-11"), 500), "5D across Tet: 5 sessions back (Feb 26, 25, 13, 12, 11)");
  assert.equal(V.windowChange(h27, 500, "1mo", "2026-02-27"), chg(at("2026-01-27"), 500), "1M = Jan 27, not 21 sessions back");
  const h05 = hist.filter(([d]) => d <= "2026-03-05");
  assert.equal(V.windowChange(h05, 500, "1mo", "2026-03-05"), chg(at("2026-02-05"), 500), "1M spanning Tet: Feb 5");
  assert.equal(V.monthBefore("2026-03-31"), "2026-02-28");
  assert.equal(V.monthBefore("2028-03-31"), "2028-02-29");
  assert.equal(V.monthBefore("2026-01-15"), "2025-12-15");
  assert.equal(V.windowChange(hist, 500, "1mo", "2026-03-31"), chg(at("2026-02-27"), 500), "Mar 31 → Feb 28 is a Saturday → Friday Feb 27's close");
  assert.equal(V.windowChange(hist.slice(-15), 500, "1mo", "2026-03-31"), null, "history too short: unknown, not a guess");
  assert.equal(V.windowChange(hist, 500, "5d", "2026-03-31"), chg(at("2026-03-24"), 500), "the session's own close isn't a base");

  /* ---------------- polling follows each symbol's own hours (Q8) */
  const T = (iso: string) => Date.parse(iso);
  assert.equal(V.liveHours("FPT.VN", T("2026-11-20T03:00:00Z")), true, "Hanoi 10:00: Vietnam polls");
  assert.equal(V.liveHours("AAPL", T("2026-11-20T03:00:00Z")), false, "while New York sleeps");
  assert.equal(V.liveHours("FPT.VN", T("2026-11-20T05:00:00Z")), false, "Hanoi lunch break");
  assert.equal(V.liveHours("BTC-USD", T("2026-11-21T12:00:00Z")), true, "Bitcoin on a Saturday");
  assert.equal(V.liveHours("EURUSD=X", T("2026-11-21T12:00:00Z")), false, "FX closed Saturday");
  assert.equal(V.liveHours("EURUSD=X", T("2026-11-22T23:00:00Z")), true, "FX opens Sunday 17:00 New York");
  assert.equal(V.liveHours("CL=F", T("2026-11-18T21:30:00Z")), true, "oil futures at 16:30 New York");
  assert.equal(V.liveHours("CL=F", T("2026-11-18T22:30:00Z")), false, "futures' daily pause 17:00-18:00");
  assert.equal(V.pollInterval(["AAPL", "FPT.VN"], T("2026-11-20T03:00:00Z")), 60_000, "a strip with one open market polls every minute");
  assert.equal(V.pollInterval(["AAPL", "^GSPC"], T("2026-11-20T03:00:00Z")), 300_000, "every 5 minutes when none is open");

  console.log("ROW04 QUOTE OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
