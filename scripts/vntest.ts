/**
 * Vietnam section: price fallbacks (Yahoo → TCBS → VNDirect), units, Vietnam-specific analysis.
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
let tcbsDown = false;
let lastPrompt = { sys: "", user: "" };
const day = (i: number) => new Date(Date.now() - (30 - i) * 86400_000).toISOString().slice(0, 10);

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  hits.push(url);
  if (url.includes("finance.yahoo.com")) {
    if (url.includes(".VN")) return new Response("Too Many Requests", { status: 429 }); // cloud IP refused
    const ts = Array.from({ length: 30 }, (_, i) => Math.floor(Date.parse(day(i)) / 1000));
    const c = ts.map((_, i) => 500 + i);
    return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 530, chartPreviousClose: 528, regularMarketTime: ts.at(-1) }, timestamp: ts, indicators: { quote: [{ close: c, open: c, high: c, low: c, volume: c }] } }] } }), { status: 200 });
  }
  if (url.includes("tcbs.com.vn")) {
    if (tcbsDown) return new Response("", { status: 403 });
    const index = url.includes("type=index");
    const base = index ? 1250 : 95000;
    return new Response(JSON.stringify({ data: Array.from({ length: 30 }, (_, i) => ({ open: base + i, high: base + i, low: base + i, close: base + i * 100 * (index ? 0.01 : 1), volume: 1000, tradingDate: `${day(i)}T00:00:00.000Z` })) }), { status: 200 });
  }
  if (url.includes("vndirect.com.vn")) {
    const index = url.includes("vnmarket_prices");
    // newest first; stocks in thousand VND
    return new Response(JSON.stringify({ data: Array.from({ length: 30 }, (_, i) => ({ code: "X", date: day(29 - i), open: index ? 1260 : 96.5, high: 0, low: 0, close: index ? 1260 - i : 96.5 - i * 0.1, nmVolume: 5 })) }), { status: 200 });
  }
  if (url.includes("api.groq.com")) {
    const msgs = JSON.parse(String(init?.body)).messages;
    lastPrompt = { sys: msgs[0].content, user: msgs[1].content };
    const outlook = ["VN-Index", "Banks", "Real estate", "Securities firms", "Tech & retail", "Steel & industrials"].map((n, i) => ({
      interest: n, ticker: ["^VNINDEX.VN", "VCB.VN", "VHM.VN", "SSI.VN", "FPT.VN", "HPG.VN"][i], direction: "up", confidence: 60, horizon: "today", action: "HOLD", action_trigger: "t", rationale: "r", risks: "k",
    }));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ headline: "VN up", mood: "risk-on", summary: ["s"], events: [], watch_next: [], movers: [], scenarios: [], outlook }) } }] }), { status: 200 });
  }
  return new Response(`<?xml version="1.0"?><rss><channel><item><title>VN-Index tăng điểm nhờ nhóm ngân hàng</title><link>https://cafef.vn/1</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`, { status: 200 });
}) as typeof fetch;

(async () => {
  await fs.rm("/tmp/invest-helper", { recursive: true, force: true });
  const V = await import("../src/lib/vnmarket");
  assert.deepEqual(V.vnCode("^VNINDEX.VN"), { code: "VNINDEX", index: true });
  assert.deepEqual(V.vnCode("fpt.vn"), { code: "FPT", index: false });

  // VNDirect stock prices are in thousand VND → normalized to VND, sorted oldest first
  const vb = V.parseVndirect({ data: [{ date: "2026-11-13", close: 96.5, open: 95 }, { date: "2026-11-12", close: 95, open: 94 }] }, false);
  assert.deepEqual(vb.map((b) => b.c), [95000, 96500]);
  assert.equal(V.parseVndirect({ data: [{ date: "2026-11-13", close: 1260.5 }] }, true)[0].c, 1260.5, "index points unchanged");
  assert.equal(V.parseTcbs({ data: [{ close: 95100, tradingDate: "2026-11-13T00:00:00.000Z" }] })[0].c, 95100);
  assert.equal(V.parseTcbs({ nothing: true }).length, 0, "bad shape → empty, not a crash");

  // quotes: Yahoo refused → TCBS
  const { getQuote } = await import("../src/lib/market");
  const q = await getQuote("FPT.VN");
  assert.ok(q && q.price > 90000, "FPT priced in VND via TCBS");
  assert.ok(hits.some((u) => u.includes("tcbs") && u.includes("ticker=FPT&type=stock")));
  const vi = await getQuote("^VNINDEX.VN");
  assert.ok(vi && vi.price > 1000 && vi.price < 2000, "VN-Index in points");
  // TCBS down too → VNDirect
  tcbsDown = true;
  const q2 = await getQuote("HPG.VN");
  assert.ok(q2 && q2.price > 90000, "VNDirect fallback, thousand VND converted");
  assert.ok(hits.some((u) => u.includes("vndirect") && u.includes("code:HPG")));

  // charts
  const { getChart } = await import("../src/lib/chart");
  const c = await getChart("VCB.VN", "6mo");
  assert.equal(c.source, "vndirect");
  assert.equal(c.currency, "VND");
  tcbsDown = false;
  const c1 = await getChart("SSI.VN", "1mo");
  assert.equal(c1.source, "tcbs");
  await assert.rejects(getChart("NOPE", "1mo").then(() => { throw new Error("yahoo 429"); }));

  // Vietnam briefing: Vietnamese groups, Vietnam hours/rules, own track record
  const P = await import("../src/lib/pipeline");
  const d = await P.refreshShared("vn", "vi");
  assert.equal(d.analysis.outlook.length, 6, "one prediction per Vietnamese group");
  assert.ok(lastPrompt.user.includes("VN-Index (benchmark ^VNINDEX.VN") && lastPrompt.user.includes("Banks (benchmark VCB.VN"), "groups in prompt");
  assert.ok(!lastPrompt.user.includes("- Nasdaq (benchmark"), "US interests not predicted in the Vietnam tab");
  assert.ok(lastPrompt.user.includes("ICT") && /HOSE/.test(lastPrompt.user), "Vietnam clock and session");
  assert.ok(lastPrompt.sys.includes("VIETNAM SECTION") && lastPrompt.sys.includes("Vietnamese"), "Vietnam rules + Vietnamese output");
  assert.ok(lastPrompt.user.includes("USD/VND"), "exchange rate in macro");
  assert.equal(d.quotes[0].symbol, "^VNINDEX.VN", "VN-Index leads the strip");
  const { loadCalls } = await import("../src/lib/track");
  const calls = await loadCalls(P.VN_CALLS);
  assert.ok(calls.length >= 6, "Vietnam calls logged for grading");
  await P.refreshShared("vn", "en");
  assert.equal((await loadCalls(P.VN_CALLS)).length, calls.length, "a second language doesn't double-count");
  const us = await P.refreshShared("us", "en");
  assert.ok(!lastPrompt.sys.includes("VIETNAM SECTION") && us.quotes[0].symbol === "SPY", "other sections unchanged");

  console.log("VN OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
