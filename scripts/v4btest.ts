/** Chart source fallbacks and guest (viewer) access. `npx tsx scripts/v4btest.ts` */
import assert from "node:assert/strict";
import { promises as fs } from "fs";

delete process.env.VERCEL;
const hits: string[] = [];
let mode: "yahoo-blocked" | "all-blocked" = "yahoo-blocked";
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  hits.push(url.split("/")[2]);
  if (url.includes("finance.yahoo.com")) return new Response("Too Many Requests", { status: 429 });
  if (url.includes("api.nasdaq.com") && mode === "yahoo-blocked") {
    if (url.includes("assetclass=stocks")) return new Response(JSON.stringify({ data: null }), { status: 200 }); // ETF: stocks class empty
    if (url.includes("/chart")) return new Response(JSON.stringify({ data: { lastSalePrice: "$679.89", previousClose: "$688.10", chart: [{ x: 1763389800000, y: "686.00" }, { x: 1763389860000, y: "684.10" }, { x: 1763393400000, y: "679.89" }] } }), { status: 200 });
    return new Response(JSON.stringify({ data: { tradesTable: { rows: [{ date: "11/14/2025", close: "$679.89", open: "$690", high: "$691", low: "$677", volume: "50,000,000" }, { date: "11/13/2025", close: "$688.10", open: "$1", high: "$1", low: "$1", volume: "1" }] } } }), { status: 200 });
  }
  if (url.includes("api.nasdaq.com")) return new Response("forbidden", { status: 403 });
  if (url.includes("stooq.com")) return new Response("Exceeded the daily hits limit", { status: 200 });
  return new Response("", { status: 404 });
}) as typeof fetch;

(async () => {
  await fs.rm(".data", { recursive: true, force: true });
  const C = await import("../src/lib/chart");
  const d1 = await C.getChart("QQQ", "1d");
  assert.equal(d1.price, 679.89);
  assert.equal(d1.prevClose, 688.1);
  assert.equal(d1.bars.length, 3);
  assert.ok(hits.includes("query1.finance.yahoo.com"), "Yahoo tried first");
  assert.ok(!hits.includes("query2.finance.yahoo.com"), "a 429 isn't retried on the second host (same per-IP limit)");
  const yahooBefore = hits.filter((h) => h.includes("yahoo")).length;
  const d6 = await C.getChart("QQQ", "6mo");
  assert.deepEqual(d6.bars.map((b) => b.c), [688.1, 679.89], "Nasdaq history parsed and sorted oldest first");
  assert.equal(hits.filter((h) => h.includes("yahoo")).length, yahooBefore, "during the cooldown Yahoo isn't called at all");
  assert.equal(d6.bars[1].v, 50_000_000);
  mode = "all-blocked";
  await assert.rejects(C.getChart("SPY", "1y"), (e: Error) => /yahoo: rate-limited/.test(e.message) && /nasdaq 403/.test(e.message), "error lists every source's reason");

  // ---- guest access
  process.env.APP_PASSWORD = "owner-pw";
  process.env.VIEWER_PASSWORD = "guest-pw";
  const A = await import("../src/lib/auth");
  const r = (pw: string) => new Request("http://x/", { headers: { "x-app-password": encodeURIComponent(pw) } });
  assert.equal(A.role(r("owner-pw")), "owner");
  assert.equal(A.role(r("guest-pw")), "viewer");
  assert.equal(A.role(r("nope")), null);
  const req = (url: string, pw: string, init: RequestInit = {}) => new Request(`http://x${url}`, { ...init, headers: { "x-app-password": encodeURIComponent(pw), ...(init.headers ?? {}) } });
  const pf = await import("../src/app/api/portfolio/route");
  assert.equal((await pf.GET(req("/api/portfolio", "guest-pw"))).status, 403, "guests can't see holdings");
  assert.equal((await pf.GET(req("/api/portfolio", "owner-pw"))).status, 200);
  const al = await import("../src/app/api/alerts/route");
  assert.equal((await al.GET(req("/api/alerts", "guest-pw"))).status, 403, "guests can't see alert settings or email");
  const ask = await import("../src/app/api/ask/route");
  assert.equal((await ask.POST(req("/api/ask", "guest-pw", { method: "POST", body: JSON.stringify({ question: "hi?" }) }))).status, 403, "guests can't use Ask AI");
  const rf = await import("../src/app/api/refresh/route");
  assert.equal((await rf.POST(req("/api/refresh", "guest-pw", { method: "POST" }))).status, 403, "guests can't refresh");
  const it = await import("../src/app/api/interests/route");
  assert.equal((await it.PUT(req("/api/interests", "guest-pw", { method: "PUT", body: "[]" }))).status, 403, "guests can't edit interests");
  assert.equal((await it.GET(req("/api/interests", "guest-pw"))).status, 200, "guests can read");
  const st = await import("../src/app/api/status/route");
  assert.equal((await (await st.GET(req("/api/status", "guest-pw"))).json()).role, "viewer");
  // Held-only tickers are hidden from guests.
  const { setJSON } = await import("../src/lib/store");
  await setJSON("digest:interests", { section: "interests", generatedAt: "", provider: "x", news: [], feedErrors: [], quotes: [{ symbol: "SPY" }, { symbol: "TSLA" }], technicals: { SPY: {}, TSLA: {} }, analysis: {} });
  const dg = await import("../src/app/api/digest/route");
  const guestView = (await (await dg.GET(req("/api/digest?section=interests", "guest-pw"))).json()).digest;
  assert.deepEqual(guestView.quotes.map((q: { symbol: string }) => q.symbol), ["SPY"], "held-only ticker (TSLA) hidden from guests");
  assert.deepEqual(Object.keys(guestView.technicals), ["SPY"]);
  const ownerView = (await (await dg.GET(req("/api/digest?section=interests", "owner-pw"))).json()).digest;
  assert.equal(ownerView.quotes.length, 2, "owner sees everything");
  console.log("V4B OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
