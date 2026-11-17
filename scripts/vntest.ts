/**
 * Prices and shared-section coverage: Vietnamese sources (DNSE → Vietcap → VNDirect), Yahoo batching
 * and its rate-limit cooldown, last-good (stale) fallback, per-section strips/groups/mood.
 * `npx tsx scripts/vntest.ts`
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";

delete process.env.AUTH_SECRET;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.LLM_PROVIDER;
process.env.VERCEL = "1"; // store in /tmp/invest-helper, wiped below, so no stale cache
delete process.env.KV_REST_API_URL;
process.env.GROQ_API_KEY = "x";

const hits: string[] = [];
const down = { yahoo: false, dnse: false, vietcap: false, vndirect: false };
let lastPrompt = { sys: "", user: "" };
let translateCalls = 0;
const NOW = Math.floor(Date.now() / 1000);
const dayTs = (i: number) => NOW - (40 - i) * 86400; // 40 daily bars ending today
const isoDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

function yahooSpark(url: string) {
  const syms = decodeURIComponent(url.split("symbols=")[1].split("&")[0]).split(",");
  const intraday = url.includes("interval=5m");
  const body: Record<string, unknown> = {};
  for (const s of syms) {
    const ts = intraday ? Array.from({ length: 30 }, (_, i) => NOW - (30 - i) * 300) : Array.from({ length: 40 }, (_, i) => dayTs(i));
    body[s] = { symbol: s, timestamp: ts, close: ts.map((_, i) => 100 + i), chartPreviousClose: 99 };
  }
  return new Response(JSON.stringify(body), { status: 200 });
}

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  hits.push(url);
  if (url.includes("finance.yahoo.com")) {
    if (down.yahoo) return new Response("Too Many Requests", { status: 429 });
    if (url.includes("/spark?")) return yahooSpark(url);
    const ts = Array.from({ length: 40 }, (_, i) => dayTs(i));
    const c = ts.map((_, i) => 500 + i);
    return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 539, chartPreviousClose: 538, regularMarketTime: ts.at(-1) }, timestamp: ts, indicators: { quote: [{ close: c, open: c, high: c, low: c, volume: c }] } }] } }), { status: 200 });
  }
  if (url.includes("entrade.com.vn")) {
    if (down.dnse) return new Response("<html>blocked</html>", { status: 200 });
    const index = url.includes("/ohlcs/index");
    const res = url.split("resolution=")[1];
    const base = index ? 1700 : 50; // DNSE stocks: thousand VND
    // Intraday: two sessions of 1-minute bars (yesterday and today), ending 07:00 UTC (14:00 Hanoi), so
    // a session never straddles Hanoi midnight whatever time the test runs; daily: 40 days.
    const close07 = Math.floor(NOW / 86400) * 86400 + 7 * 3600;
    const close = close07 > NOW ? close07 - 86400 : close07; // the latest 07:00 UTC, never in the future
    const t = res === "1D" ? Array.from({ length: 40 }, (_, i) => dayTs(i)) : [1, 0].flatMap((d) => Array.from({ length: 30 }, (_, i) => close - d * 86400 - (30 - i) * 60));
    return new Response(JSON.stringify({ t, o: t.map(() => base), h: t.map(() => base + 1), l: t.map(() => base - 1), c: t.map((_, i) => base + i * 0.1), v: t.map(() => 1000), nextTime: 0 }), { status: 200 });
  }
  if (url.includes("vietcap.com.vn")) {
    if (down.vietcap) return new Response("", { status: 403 });
    const body = JSON.parse(String(init?.body));
    const index = /INDEX|VN30|HNX/.test(body.symbols[0]);
    const base = index ? 1710 : 51000;
    const t = Array.from({ length: 20 }, (_, i) => String(dayTs(20 + i)));
    return new Response(JSON.stringify([{ symbol: body.symbols[0], o: t.map(() => base), h: t.map(() => base), l: t.map(() => base), c: t.map((_, i) => base + i), v: t.map(() => 9), t }]), { status: 200 });
  }
  if (url.includes("vndirect.com.vn")) {
    if (down.vndirect) return new Response("", { status: 503 });
    const index = url.includes("vnmarket_prices");
    const codes = decodeURIComponent(url.split("q=code:")[1].split("~")[0]).split(",");
    const rows = codes.flatMap((code) => [
      // today's pre-open placeholder (no volume) must be ignored
      { code, date: isoDay(NOW), close: index ? 1 : 0.1, nmVolume: 0, accumulatedVol: 0 },
      ...Array.from({ length: 30 }, (_, i) => ({ code, date: isoDay(dayTs(39 - i)), open: index ? 1720 : 52.5, high: 0, low: 0, close: index ? 1720 - i : 52.5 - i * 0.1, nmVolume: 5, accumulatedVol: 5 })),
    ]);
    return new Response(JSON.stringify({ data: rows }), { status: 200 });
  }
  if (url.includes("api.nasdaq.com")) {
    // US-listed ETFs/ADRs (stand-ins for Yahoo-only symbols): two daily closes.
    const sym = url.split("/api/quote/")[1].split("/")[0];
    if (!/^(SPY|EWJ|GLD|FEZ|QQQ|DIA|IWM)$/.test(sym)) return new Response(JSON.stringify({ data: null }), { status: 200 });
    if (url.includes("assetclass=stocks")) return new Response(JSON.stringify({ data: null }), { status: 200 }); // ETFs: etf class only
    const d = (i: number) => { const x = new Date((NOW - i * 86400) * 1000); return `${String(x.getUTCMonth() + 1).padStart(2, "0")}/${String(x.getUTCDate()).padStart(2, "0")}/${x.getUTCFullYear()}`; };
    return new Response(JSON.stringify({ data: { tradesTable: { rows: [{ date: d(1), close: "$102.00" }, { date: d(2), close: "$100.00" }] }, chart: [] } }), { status: 200 });
  }
  if (url.includes("api.groq.com")) {
    const msgs = JSON.parse(String(init?.body)).messages;
    if (msgs[0].content.startsWith("You translate")) {
      translateCalls++;
      const arr: string[] = JSON.parse(msgs[1].content);
      return new Response(JSON.stringify({ choices: [{ message: { content: "```json\n" + JSON.stringify(arr.map((s) => `vi:${s}`)) + "\n```" } }] }), { status: 200 });
    }
    lastPrompt = { sys: msgs[0].content, user: msgs[1].content };
    const names = [...lastPrompt.user.matchAll(/^- (.+?) \(benchmark (\S+?)[;)]/gm)].map((m) => [m[1], m[2]]);
    const outlook = names.map(([n, t]) => ({ interest: n, ticker: t, direction: "up", confidence: 60, horizon: "today", action: "HOLD", action_trigger: "t", rationale: "r", risks: "k" }));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ headline: "ok", mood: "risk-on", summary: ["s"], events: [], watch_next: [], movers: [], scenarios: [], outlook }) } }] }), { status: 200 });
  }
  return new Response(`<?xml version="1.0"?><rss><channel><item><title>VN-Index tăng điểm nhờ nhóm ngân hàng</title><link>https://cafef.vn/1</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`, { status: 200 });
}) as typeof fetch;

const count = (re: RegExp) => hits.filter((u) => re.test(u)).length;

(async () => {
  await fs.rm("/tmp/invest-helper", { recursive: true, force: true });
  const V = await import("../src/lib/vnmarket");
  const C = await import("../src/lib/chart");
  const M = await import("../src/lib/market");
  const Y = await import("../src/lib/yahoo");

  // ---- parsers and units
  assert.deepEqual(V.vnCode("^VNINDEX.VN"), { code: "VNINDEX", index: true });
  assert.deepEqual(V.vnCode("fpt.vn"), { code: "FPT", index: false });
  assert.equal(V.parseDnse({ t: [1, 2], o: [50, 51], h: [51, 52], l: [49, 50], c: [50.1, 51.2], v: [1, 1] }, false)[1].c, 51200, "DNSE stocks: thousand VND → VND");
  assert.equal(V.parseDnse({ t: [1], c: [1734.9] }, true)[0].c, 1734.9, "DNSE index points unchanged");
  assert.equal(V.parseVietcap([{ symbol: "FPT", c: [50100], t: ["1794528000"] }])[0].c, 50100, "Vietcap already in VND");
  const vb = V.parseVndirect({ data: [{ code: "FPT", date: "2026-11-16", close: 50.1, nmVolume: 0 }, { code: "FPT", date: "2026-11-13", close: 50.1, nmVolume: 9 }, { code: "VCB", date: "2026-11-13", close: 53.8, nmVolume: 9 }, { code: "FPT", date: "2026-11-12", close: 49.55, nmVolume: 9 }] }, false);
  assert.deepEqual(vb.get("FPT")!.map((b) => b.c), [49550, 50100], "VNDirect: per code, oldest first, zero-volume placeholder skipped");
  assert.equal(vb.get("VCB")!.length, 1);
  assert.equal(V.parseDnse({ nothing: true }, false).length, 0, "bad shape → empty, not a crash");
  assert.equal(Y.parseSpark({ spark: { result: [{ symbol: "SPY", response: [{ meta: { chartPreviousClose: 1 }, timestamp: [1, 2], indicators: { quote: [{ close: [5, null] }] } }] }] } }).get("SPY")!.points.length, 1, "spark nested shape, nulls dropped");

  // ---- batch quotes: one VNDirect request per kind for any number of VN symbols
  hits.length = 0;
  const vnSyms = ["^VNINDEX.VN", "^VN30.VN", "VCB.VN", "FPT.VN", "HPG.VN", "VHM.VN"];
  const qs = await M.getQuotes(vnSyms);
  assert.equal(qs.length, 6);
  assert.equal(count(/vndirect/), 2, "stocks and indexes: one request each");
  assert.equal(count(/finance\.yahoo/), 0, "Vietnamese quotes never touch Yahoo");
  assert.ok(qs.find((q) => q.symbol === "FPT.VN")!.price > 40000, "VND");
  assert.ok(qs.find((q) => q.symbol === "^VNINDEX.VN")!.price > 1000 && qs[0].price < 2000, "points");

  // ---- batch quotes for everything else: 1 Yahoo spark request per 20 symbols
  hits.length = 0;
  const us = Array.from({ length: 25 }, (_, i) => `T${i}`);
  const uq = await M.getQuotes(us);
  assert.equal(uq.length, 25);
  assert.equal(count(/\/spark\?/), 2, "25 symbols → 2 spark requests");
  assert.equal(count(/\/chart\//), 0, "no per-symbol requests when the batch works");

  // ---- charts: DNSE intraday (1D = latest session only, previous close from daily bars)
  const c1 = await C.getChart("FPT.VN", "1d");
  assert.equal(c1.source, "dnse");
  assert.equal(c1.bars.length, 30, "only today's session of the two returned");
  assert.ok(c1.prevClose > 40000 && c1.currency === "VND");
  const ci = await C.getChart("^VN30.VN", "6mo");
  assert.equal(ci.source, "dnse");
  assert.equal(ci.name, "VN30");
  down.dnse = true;
  C.clearPriceCaches();
  assert.equal((await C.getChart("VCB.VN", "6mo")).source, "vietcap", "DNSE blocked → Vietcap");
  down.vietcap = true;
  assert.equal((await C.getChart("HPG.VN", "1mo")).source, "vndirect", "then VNDirect");
  down.vndirect = true;
  hits.length = 0;
  await assert.rejects(C.getChart("^HNX.VN", "1mo"), (e: Error) => /dnse/.test(e.message) && /vietcap/.test(e.message) && /vndirect/.test(e.message), "error lists every source");
  assert.equal(count(/finance\.yahoo/), 0, "Yahoo has no usable VN index series, so it isn't tried");
  Object.assign(down, { dnse: false, vietcap: false, vndirect: false });

  // ---- live quotes: one spark for US symbols, DNSE for VN
  C.clearPriceCaches();
  hits.length = 0;
  const lq = await C.getLiveQuotes(["AAPL", "MSFT", "^GSPC", "FPT.VN", "bad symbol!"]);
  assert.deepEqual(lq.map((q) => q.symbol).sort(), ["AAPL", "FPT.VN", "MSFT", "^GSPC"].sort());
  assert.equal(count(/\/spark\?/), 1);
  assert.equal(lq.find((q) => q.symbol === "AAPL")!.prevClose, 99, "previous session close from spark");

  // ---- Yahoo 429: cooldown (no hammering) + last good prices flagged stale; grading refuses stale
  await new Promise((r) => setTimeout(r, 10));
  down.yahoo = true;
  C.clearPriceCaches();
  hits.length = 0;
  const during = await M.getQuotes(["T1", "T2", "NEVERSEEN"]);
  const yahooCalls = count(/finance\.yahoo/);
  assert.ok(Y.yahooCooling(), "429 starts a cooldown");
  assert.ok(yahooCalls <= 3, `stops calling Yahoo after the 429 (made ${yahooCalls})`);
  assert.ok(during.find((q) => q.symbol === "T1")?.stale, "last good price filled in, flagged stale");
  assert.ok(!during.some((q) => q.symbol === "NEVERSEEN"), "nothing invented for symbols never seen");
  assert.deepEqual(await M.getQuotes(["T1"], { allowStale: false }), [], "grading (allowStale: false) never uses stale prices");
  // Yahoo-only symbols, when VNDirect's world closes are also unreachable: a tracking ETF priced by
  // Nasdaq, labeled as such (never mixed with the index level). Real levels: budgettest/v10test.
  down.vndirect = true;
  const px = await M.getQuotes(["^GSPC", "^N225", "GC=F", "^TNX"]);
  const spx = px.find((q) => q.symbol === "^GSPC");
  assert.equal(spx?.proxy, "SPY", "S&P 500 priced via SPY when Yahoo refuses");
  assert.ok(Math.abs(spx!.changePct - 2) < 1e-9, "the ETF's own move (102 vs 100)");
  assert.equal(px.find((q) => q.symbol === "^N225")?.proxy, "EWJ");
  assert.equal(px.find((q) => q.symbol === "GC=F")?.proxy, "GLD");
  assert.ok(!px.some((q) => q.symbol === "^TNX"), "no stand-in for yields (an ETF price isn't a yield)");
  const cpx = await C.getChart("^N225", "6mo");
  assert.equal(cpx.proxy, "EWJ");
  assert.ok(cpx.name?.includes("EWJ"), "chart says it's the ETF");
  down.yahoo = false;
  down.vndirect = false;
  Y.resetYahoo();

  // ---- shared sections: market coverage, no personal stocks
  const P = { ...(await import("../src/lib/pipeline")), ...(await import("../src/lib/briefings")), ...(await import("../src/lib/interests")) }; // pipeline.ts was split in v14
  const { SECTION_STRIPS } = await import("../src/lib/config");
  const d = await P.refreshShared("vn", "vi");
  assert.equal(d.analysis.outlook, undefined, "briefings make no calls (v18)");
  assert.ok(lastPrompt.user.includes("MARKETS COVERED") && lastPrompt.user.includes("VN-Index (benchmark ^VNINDEX.VN"), "groups in the briefing prompt");
  assert.ok(!/SPY|QQQ|SOXX|NVDA/.test(lastPrompt.user.split("MACRO:")[0]), "no US interests or benchmarks in the Vietnam snapshot");
  assert.ok(lastPrompt.user.includes("ICT") && /HOSE/.test(lastPrompt.user), "Vietnam clock and session");
  assert.ok(lastPrompt.sys.includes("VIETNAM SECTION") && lastPrompt.sys.includes("Vietnamese"), "Vietnam rules + Vietnamese output");
  assert.ok(!/TRACK RECORD|action_trigger/.test(lastPrompt.sys + lastPrompt.user), "no calls, no track record in a briefing prompt");
  assert.ok(lastPrompt.user.includes("USD/VND"), "exchange rate in macro");
  assert.ok(!lastPrompt.user.includes("SECTORS"), "US sectors left out of the Vietnam prompt");
  assert.deepEqual(d.strip?.map((g) => g.key), ["indexes", "banks", "largecaps"]);
  assert.equal(d.quotes[0].symbol, "^VNINDEX.VN", "VN-Index leads");
  assert.ok(d.gauge && d.gauge.parts.some((p) => p.key === "breadth"), "mood from the VN-Index and Vietnamese large caps");
  const { loadCalls } = await import("../src/lib/track");
  assert.equal((await loadCalls(P.SHARED_CALLS.vn)).length, 0, "a briefing records no calls");

  // ---- predictions: one market per run, Vietnam on the Hanoi clock
  const PR = await import("../src/lib/predictions");
  const preTime = new Date("2026-11-17T01:16:00Z"); // 08:16 Hanoi, before the open
  const r1 = await PR.runPrediction({ market: "vn", phase: "pre", now: preTime });
  assert.equal(r1.ok, true, r1.note);
  assert.ok(lastPrompt.user.includes("MARKETS TO CALL") && lastPrompt.user.includes("BEFORE-MARKET RUN") && lastPrompt.user.includes("08:16 Hanoi"), "before-market prompt on Hanoi time");
  assert.ok(lastPrompt.sys.includes("VIETNAM SECTION") && lastPrompt.user.includes("YOUR TRACK RECORD"), "Vietnam rules and the track record");
  const calls = await loadCalls(P.SHARED_CALLS.vn);
  assert.equal(calls.length, 6, "one daily call per Vietnamese group");
  assert.ok(calls.every((c) => c.id.endsWith(":d") && c.phase === "pre" && c.date === "2026-11-17" && c.baseChg == null), "graded at today's close from the previous close");
  await PR.runPrediction({ market: "vn", phase: "pre", now: preTime });
  assert.equal((await loadCalls(P.SHARED_CALLS.vn)).length, calls.length, "a rerun replaces, doesn't double-count");

  await PR.runPrediction({ market: "us", phase: "pre", now: new Date("2026-11-17T12:31:00Z") });
  assert.ok(lastPrompt.user.includes("S&P 500 (benchmark ^GSPC") && lastPrompt.user.includes("Dow Jones (benchmark ^DJI"), "US calls on the indexes");
  assert.ok(!/- Chip stocks|SOXX/.test(lastPrompt.user), "no personal interests in US");
  assert.ok(lastPrompt.user.includes("07:31 New York") && !lastPrompt.sys.includes("VIETNAM SECTION"));
  const wr: Record<string, { ok: boolean; note: string }> = {};
  for (const m of ["jp", "cn", "eu", "wus", "oil", "gold"] as const) wr[m] = await PR.runPrediction({ market: m, phase: "pre", now: new Date("2026-11-17T07:31:00Z") });
  const eu = (await import("../src/lib/store")).getJSON;
  const euSet = await eu<{ daily: { items: { ticker: string }[] } }>("pred:world:eu");
  assert.deepEqual(euSet?.daily.items.map((o) => o.ticker), ["^STOXX50E"], "Europe's run calls only Europe");
  const wc = await loadCalls(P.SHARED_CALLS.world);
  assert.deepEqual([...new Set(wc.map((c) => c.ticker))].sort(), ["000001.SS", "CL=F", "GC=F", "^GSPC", "^HSI", "^N225", "^STOXX50E"].filter((x) => wc.some((c) => c.ticker === x)).sort());
  // 07:31 UTC: Tokyo closed an hour ago, but no source here has its close yet: no prediction from older data.
  assert.deepEqual([wr.jp.ok, /\^N225 no 2026-11-17 close/.test(wr.jp.note)], [false, true], `Japan unavailable without Tuesday's close (${wr.jp.note})`);
  const jp = await eu<{ unavailable?: { gaps: { symbol: string; kind: string }[] } }>("pred:world:jp");
  assert.deepEqual(jp?.unavailable?.gaps.map((g) => [g.symbol, g.kind]), [["^N225", "close"]], "the card can say why");
  assert.ok(!wc.some((c) => c.ticker === "^N225"), "and nothing recorded");
  assert.ok(wc.some((c) => c.ticker === "CL=F") && wc.some((c) => c.ticker === "GC=F"), "oil and gold each get their own run");
  const track = await import("../src/app/api/track/route");
  const tv = await (await track.GET(new Request("http://x/api/track?section=vn"))).json();
  assert.ok(tv.total >= 6, "track record API per shared section");
  const csv = await (await track.GET(new Request("http://x/api/track?section=world&format=csv"))).text();
  assert.ok(csv.includes("^STOXX50E"), "CSV export per section");

  // ---- translated predictions: one call for a section's markets, cached per version
  translateCalls = 0;
  const trW = await PR.translatePredictions("world", "vi");
  assert.equal(translateCalls, 1, "every World market in one go");
  assert.ok(trW.every((x) => x.language === "vi" && (x.daily?.items ?? []).every((o) => o.rationale.startsWith("vi:"))));
  assert.deepEqual(trW.flatMap((x) => x.daily?.items.map((o) => [o.ticker, o.confidence, o.action]) ?? []), (await PR.loadPredictions("world")).flatMap((x) => x.daily?.items.map((o) => [o.ticker, o.confidence, o.action]) ?? []), "numbers and tickers unchanged");
  await PR.translatePredictions("world", "vi");
  assert.equal(translateCalls, 1, "cached");
  assert.equal((await PR.loadPredictions("world", "vi"))[0].language, "vi", "readers get the cached translation");

  // ---- translation instead of regeneration: one cheap call per briefing version and language
  const T = await import("../src/lib/translate");
  assert.deepEqual(T.parseTranslations('ok ["a","b"]', 2), ["a", "b"]);
  assert.equal(T.parseTranslations('["a"]', 2), null, "wrong length rejected");
  const base = await P.refreshShared("us", "en");
  translateCalls = 0;
  const tv1 = await P.translateLatest("us", "vi");
  assert.equal(translateCalls, 1);
  assert.equal(tv1!.language, "vi");
  assert.equal(tv1!.translatedFrom, "en");
  assert.equal(tv1!.analysis.headline, `vi:${base.analysis.headline}`);
  assert.equal(tv1!.analysis.summary[0], `vi:${base.analysis.summary[0]}`, "briefing text translated");
  await P.translateLatest("us", "vi");
  assert.equal(translateCalls, 1, "cached: the second reader costs nothing");
  assert.equal((await P.loadDigest("us", undefined, "vi"))!.analysis.headline, tv1!.analysis.headline, "readers get the cached translation");
  assert.equal((await P.loadDigest("us", undefined, "en"))!.language, "en");
  await new Promise((r) => setTimeout(r, 1100));
  await P.refreshShared("us", "en");
  assert.equal((await P.loadDigest("us", undefined, "vi"))!.language, "en", "a newer briefing isn't hidden behind an old translation");
  await P.translateLatest("us", "vi");
  assert.equal(translateCalls, 2, "new briefing version → one new translation");
  const tr = await import("../src/app/api/translate/route");
  assert.equal((await tr.POST(new Request("http://x/api/translate?section=us&lang=xx", { method: "POST" }))).status, 400);
  const ok = await (await tr.POST(new Request("http://x/api/translate?section=us&lang=vi", { method: "POST" }))).json();
  assert.equal(ok.translated, true);
  assert.equal(translateCalls, 2);

  // My Interests is unchanged: the user's tickers plus the benchmarks.
  const { DEFAULT_INTERESTS } = await import("../src/lib/config");
  const i = await P.refreshInterestSet(DEFAULT_INTERESTS, "en", ["owner"]);
  assert.ok(i.quotes.some((q) => q.symbol === "NVDA") && !i.strip, "personal strip = personal tickers");

  console.log("VN OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
