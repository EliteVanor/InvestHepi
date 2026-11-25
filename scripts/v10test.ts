/**
 * Prices must match everywhere: the strip shows exactly what the chart sheet shows (same function),
 * today's session wins over DNSE's lagging daily bars, real world levels from VNDirect with their
 * dates, ETF estimates only for same-hours markets and only one session ahead, Treasury yields, and
 * price formatting. `npx tsx scripts/v10test.ts`
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import { pinClock } from "./clock";

// Fixtures and code under test share one clock, so the result never depends on when this runs.
pinClock("2026-11-17T12:00:00Z");

process.env.VERCEL = "1";
process.env.APP_PASSWORD = "pw";
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
  await fs.rm(process.env.STORE_DIR || "/tmp/invest-helper", { recursive: true, force: true });
  const C = await import("../src/lib/chart");
  const W = await import("../src/lib/worldmarket");
  const M = await import("../src/lib/market");

  /* ---------------- Vietnam: strip == chart sheet, today's session, not DNSE's lagging daily bar */
  const [lq] = await (await import("../src/lib/quote")).currentQuotes(["^UPCOM.VN"]);
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
  assert.equal(vnd.history.length, 30, "30 sessions: enough for 1M across a long holiday (v19 row 4)");
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

  /* ---------------- feed times: Hanoi time mislabeled as UTC */
  const N = await import("../src/lib/news");
  const at = new Date("2026-11-16T04:00:55Z");
  const item = (iso: string) => ({ id: iso, title: "t", link: "", source: "Tuổi Trẻ", publishedAt: iso });
  const fixed = N.fixFeedTimes([item("2026-11-16T09:40:00.000Z"), item("2026-11-16T03:00:00.000Z")], "https://tuoitre.vn/rss/kinh-doanh.rss", at);
  assert.deepEqual(fixed.map((i) => i.publishedAt), ["2026-11-16T02:40:00.000Z", "2026-11-15T20:00:00.000Z"], "a Vietnamese feed in the future is Hanoi time: every item moves back 7 h");
  const ok = [item("2026-11-16T03:00:00.000Z")];
  assert.equal(N.fixFeedTimes(ok, "https://tuoitre.vn/rss", at), ok, "feeds with sane times are untouched");
  assert.equal(N.fixFeedTimes([item("2026-11-16T09:00:00.000Z")], "https://example.com/rss", at)[0].publishedAt, at.toISOString(), "elsewhere: clamped to now");

  /* ---------------- yields move in basis points */
  const mt = M.macroAsText([{ symbol: "^TNX", price: 5.15, prevClose: 5.1, changePct: 0.98, history: [["2026-11-06", 4.84], ["2026-11-09", 4.88], ["2026-11-10", 4.98], ["2026-11-11", 5.0], ["2026-11-12", 5.1], ["2026-11-13", 5.15]], source: "vndirect-world", dailyOnly: true }], ["^TNX"]);
  assert.match(mt, /\(1d \+5 bp, 5d \+31 bp\)/, "not a percent of the yield");

  /* ---------------- formatting */
  const P = await import("../src/components/primitives");
  const S = await import("../src/lib/symbols");
  assert.equal(P.fmtPrice(1734.93), "1,734.93", "index levels keep their decimals");
  assert.equal(P.fmtPrice(53800), "53,800", "whole-number share prices stay whole");
  assert.equal(P.fmtPrice(1.1023, S.priceDigits("EURUSD=X", 1.1023)), "1.1023", "currency pairs: 4 decimals");
  assert.equal(P.fmtPrice(25707, S.priceDigits("VND=X", 25707)), "25,707.00");

  /* ---------------- movers use the snapshot's numbers */
  const Pl = { ...(await import("../src/lib/pipeline")), ...(await import("../src/lib/movers")), ...(await import("../src/lib/briefings")), ...(await import("../src/lib/interests")) }; // pipeline.ts was split in v14
  const quotes = [{ symbol: "KDH.VN", price: 15550, prevClose: 15300, changePct: 1.63, history: [], source: "vndirect" as const }];
  const aligned = Pl.alignMovers([{ ticker: "kdh.vn", changePct: 15.2, why: "5-day gain" }, { ticker: "MADEUP", changePct: 9, why: "x" }], quotes);
  assert.deepEqual(aligned.map((m) => [m.ticker, m.changePct]), [["KDH.VN", 1.63]], "last-session change from the data; tickers not in the snapshot dropped");

  /* ---------------- movers: a reason only when a cited headline is about the company */
  const hq = [
    { symbol: "VHM.VN", price: 62800, prevClose: 62200, changePct: 0.96, history: [], source: "vndirect" as const },
    { symbol: "VIC.VN", price: 248300, prevClose: 243000, changePct: 2.18, history: [], source: "vndirect" as const },
    { symbol: "NVDA", price: 162.85, prevClose: 166.2, changePct: -2.0, history: [], source: "nasdaq" as const },
  ];
  const hn = [
    { id: "0", title: "Novaland chuyển đổi trái phiếu quốc tế thành cổ phiếu", link: "", source: "x", publishedAt: "" },
    { id: "1", title: "Vingroup lãi đột biến quý III, cổ phiếu VIC tăng mạnh", link: "", source: "x", publishedAt: "" },
    { id: "2", title: "Nvidia shares slide as chip export curbs tighten", link: "", source: "x", publishedAt: "" },
  ];
  const mv = Pl.alignMovers(
    [
      { ticker: "VHM.VN", changePct: 1, why: "Recent earnings beat", sourceIds: [] },
      { ticker: "VIC.VN", changePct: 1, why: "Novaland conversion boosts the sector", sourceIds: [0] },
      { ticker: "VIC.VN", changePct: 1, why: "Q3 profit jump", sourceIds: [1] },
      { ticker: "NVDA", changePct: 1, why: "Export curbs", sourceIds: [2] },
    ],
    hq,
    hn,
  );
  assert.equal(mv[0].why, "No clear news in today's headlines.", "no cited headline: no invented cause");
  assert.equal(mv[1].why, "No clear news in today's headlines.", "a headline about another company doesn't count");
  assert.equal(mv[2].why, "Q3 profit jump", "a headline naming the stock keeps the reason");
  assert.equal(mv[3].why, "Export curbs", "company name (Nvidia) matches NVDA");
  assert.ok(Pl.headlineMentions("Cổ phiếu VIC tăng trần", "VIC.VN") && !Pl.headlineMentions("VICTORY Securities tăng", "VIC.VN"), "codes match as whole words only");

  /* ---------------- live overlay: a real level may replace an ETF stand-in, never the reverse */
  const V3 = await import("../src/lib/quote-view");
  assert.equal(V3.canOverlay("SPY", undefined), true, "real S&P level replaces SPY's price");
  assert.equal(V3.canOverlay(undefined, "SPY"), false, "SPY's price never replaces the real level");
  assert.equal(V3.canOverlay("EWJ", "EWJ"), true);
  assert.equal(V3.canOverlay(undefined, undefined), true);

  /* ---------------- Ask AI: suggestions from the briefing, saved chats */
  const A = await import("../src/components/ask");
  const { makeT } = await import("../src/lib/i18n");
  const tv = makeT("vi");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dg: any = { analysis: { outlook: [{ interest: "Banks", action: "TRIM" }], events: [{ title: "SBV buys USD", importance: 4, impacts: [{ interest: "Banks" }] }], movers: [{ ticker: "VCB.VN", changePct: -0.37 }] } };
  const cal = [{ date: "2026-11-17", kind: "earnings" as const, title: "NVDA earnings (EPS est. 2.52)", importance: 2 as const }, { date: "2026-11-19", kind: "macro" as const, title: "VN30 futures expiry", importance: 2 as const }];
  const predCalls = [{ interest: "Banks", ticker: "VCB.VN", action: "TRIM", horizon: "today" }] as never[];
  const sug = A.suggestionsFor(tv, dg, cal, "vn", predCalls);
  assert.ok(sug[0].includes("Ngân hàng") && sug[0].includes(tv("act.TRIM")), `the call, in Vietnamese: ${sug[0]}`);
  assert.ok(sug.some((x) => x.includes("SBV buys USD")), "the top event");
  assert.ok(sug.some((x) => x.includes("VCB") && x.includes("-0.37%")), "the biggest mover with its real change");
  assert.ok(sug.some((x) => x.includes("Đáo hạn phái sinh VN30")) && !sug.some((x) => x.includes("NVDA")), "shared tabs: macro events only, not personal earnings");
  assert.ok(A.suggestionsFor(tv, dg, cal, "interests").some((x) => x.includes("NVDA")), "My Interests: the reader's own earnings dates");

  const Ch = await import("../src/lib/chats");
  const id = await Ch.appendToChat(undefined, "Why TRIM banks?", { role: "assistant", content: "Because..." }, "vn");
  await Ch.appendToChat(id, "What would change it?", { role: "assistant", content: "If SBV..." });
  const saved = await Ch.getChat(id);
  assert.deepEqual([saved?.title, saved?.messages.length, saved?.section], ["Why TRIM banks?", 4, "vn"], "questions and answers kept in order");
  for (let i = 0; i < 35; i++) await Ch.appendToChat(undefined, `q${i}`, { role: "assistant", content: "a" });
  assert.equal((await Ch.listChats()).length, Ch.MAX_CHATS, "capped for the free Redis tier");
  const route = await import("../src/app/api/chats/route");
  const auth = { headers: { "x-app-password": "pw" } };
  const list = await (await route.GET(new Request("http://localhost/api/chats", auth))).json();
  assert.equal(list.chats[0].title, "q34", "newest first");
  assert.ok(!("messages" in list.chats[0]) && list.chats[0].count === 2, "the list sends titles and counts, not whole chats");
  await route.DELETE(new Request(`http://localhost/api/chats?id=${list.chats[0].id}`, { method: "DELETE", ...auth }));
  assert.equal((await route.GET(new Request("http://localhost/api/chats"))).status, 401, "no password, no chats");
  assert.equal((await Ch.listChats())[0].title, "q33", "deleted");

  console.log("V10 OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
