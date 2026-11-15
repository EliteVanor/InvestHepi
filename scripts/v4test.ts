/**
 * Offline tests for v4: technicals, mood gauge, scenarios, equity curve, holdings privacy,
 * ticker search, rate limits, and the prompt wiring. `npx tsx scripts/v4test.ts`
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";

process.env.GROQ_API_KEY = "test";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.LLM_PROVIDER;
delete process.env.VERCEL;
delete process.env.APP_PASSWORD;
delete process.env.CRON_SECRET;

const near = (a: number | undefined, b: number, tol = 1e-6) => assert.ok(a != null && Math.abs(a - b) <= tol, `${a} ≈ ${b}`);
let groqBody: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
let yahooSearchDown = false;

const now = Math.floor(Date.now() / 1000);
function yearChart(price: number) {
  const ts = Array.from({ length: 260 }, (_, i) => now - (260 - i) * 86400);
  const closes = ts.map((_, i) => price * (0.8 + (0.2 * i) / 259));
  return { chart: { result: [{ meta: { regularMarketPrice: price, chartPreviousClose: closes.at(-2), regularMarketTime: now }, timestamp: ts, indicators: { quote: [{ close: closes, open: closes, high: closes.map((c) => c * 1.01), low: closes.map((c) => c * 0.99), volume: ts.map(() => 1) }] } }] } };
}

const modelReply = {
  headline: "h", mood: "mixed", summary: ["s"], events: [], watch_next: [], movers: [],
  outlook: [{ interest: "Chip stocks", ticker: "SOXX", direction: "up", confidence: 66, horizon: "today", action: "ADD", action_trigger: "above the 50-day average", rationale: "r", risks: "k" }],
  scenarios: [
    { catalyst: "CPI", when: "Thu 8:30 ET", cases: [{ label: "Hot", probability: "30%", reaction: "down", action: "wait" }, { label: "In line", probability: 90, reaction: "flat", action: "hold" }, { label: "Cool", probability: 30, reaction: "up", action: "add" }] },
    { catalyst: "Second set should be dropped", when: "x", cases: [{ label: "a", probability: 50, reaction: "", action: "" }, { label: "b", probability: 50, reaction: "", action: "" }] },
    { catalyst: "One case only", when: "x", cases: [{ label: "a", probability: 100, reaction: "", action: "" }] },
  ],
};

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("/v1/finance/search")) {
    if (yahooSearchDown) return new Response("blocked", { status: 429 });
    return new Response(JSON.stringify({ quotes: [{ symbol: "MSFT", shortname: "Microsoft Corporation", quoteType: "EQUITY", exchDisp: "NASDAQ" }, { symbol: "MSFT.MX", shortname: "Microsoft MX", quoteType: "EQUITY" }, { symbol: "BAD SYMBOL", quoteType: "EQUITY" }, { symbol: "OPT1", quoteType: "OPTION" }] }), { status: 200 });
  }
  if (url.includes("query1.finance.yahoo.com")) {
    const sym = decodeURIComponent(url.split("/chart/")[1].split("?")[0]);
    return new Response(JSON.stringify(yearChart(sym === "NVDA" ? 200 : 100)), { status: 200 });
  }
  if (url.includes("api.groq.com")) {
    groqBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelReply) } }] }), { status: 200 });
  }
  return new Response("<rss><channel></channel></rss>", { status: 200 });
}) as typeof fetch;

async function main() {
  await fs.rm(".data", { recursive: true, force: true });

  // ---- technicals
  const T = await import("../src/lib/technicals");
  near(T.sma([1, 2, 3, 4, 5], 3), 4);
  assert.equal(T.sma([1, 2], 3), undefined);
  assert.equal(T.rsi(Array.from({ length: 30 }, (_, i) => 100 + i)), 100, "all gains → RSI 100");
  near(T.rsi(Array.from({ length: 30 }, (_, i) => 100 - i)), 0, 1e-9);
  const zig = Array.from({ length: 60 }, (_, i) => 100 + (i % 2 ? 1 : -1));
  const r = T.rsi(zig)!;
  assert.ok(r > 40 && r < 60, `alternating series → RSI near 50 (${r})`);
  const bars = Array.from({ length: 260 }, (_, i) => ({ t: i * 86400, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1 }));
  const tech = T.computeTechnicals("X", bars)!;
  assert.equal(tech.trend, "up");
  near(tech.sma20, 100 + 259 - 9.5);
  assert.equal(tech.resistance20, 101 + 258, "20-day high excludes the latest bar");
  assert.equal(tech.support20, 99 + 239);
  assert.equal(tech.high52, 101 + 259);
  assert.ok(tech.atrPct! > 0.5 && tech.atrPct! < 0.6, `ATR% (${tech.atrPct})`);
  assert.equal(T.computeTechnicals("X", bars.slice(0, 10)), null, "too little history → null");
  const down = T.computeTechnicals("Y", bars.map((b, i) => ({ ...b, c: 400 - i, h: 401 - i, l: 399 - i })))!;
  assert.equal(down.trend, "down");
  assert.ok(T.technicalsAsText({ X: tech }).includes("trend up") && T.technicalsAsText({}).includes("unavailable"));

  // ---- mood gauge
  const M = await import("../src/lib/mood");
  const hist = (vals: number[]) => vals.map((v, i) => [`2026-10-${String(i + 1).padStart(2, "0")}`, v] as [string, number]);
  const q = (symbol: string, price: number, changePct: number, h: number[]) => ({ symbol, price, prevClose: price, changePct, history: hist(h), source: "yahoo" as const });
  const flat = Array.from({ length: 22 }, () => 100);
  const greedy = M.computeMood({
    spy: { ...tech, price: 110, sma125: 100, rsi14: 72 },
    sectors: Array.from({ length: 12 }, (_, i) => q(`S${i}`, 105, 1, flat)),
    macro: [q("^VIX", 12, -3, Array.from({ length: 22 }, () => 15)), q("GC=F", 95, 0, flat)],
    quotes: [q("SPY", 108, 1, flat)],
  })!;
  assert.ok(greedy.score > 80 && greedy.label === "extreme-greed", `greedy tape → ${greedy.score} ${greedy.label}`);
  assert.equal(greedy.parts.length, 5);
  const fearful = M.computeMood({
    spy: { ...tech, price: 90, sma125: 100, rsi14: 28 },
    sectors: Array.from({ length: 12 }, (_, i) => q(`S${i}`, 95, -2, flat)),
    macro: [q("^VIX", 34, 20, Array.from({ length: 22 }, () => 20)), q("GC=F", 108, 1, flat)],
    quotes: [q("SPY", 92, -2, flat)],
  })!;
  assert.ok(fearful.score < 20 && fearful.label === "extreme-fear", `fearful tape → ${fearful.score}`);
  assert.equal(M.computeMood({ sectors: [], macro: [], quotes: [] }), undefined, "too few inputs → no gauge");
  assert.equal(M.moodLabel(50), "neutral");

  // ---- equity curve and per-ticker stats
  const K = await import("../src/lib/track");
  const call = (date: string, ticker: string, direction: "up" | "down" | "flat", returnPct: number, id = "d") =>
    ({ id: `${date}:${ticker}:${id}`, date, madeAt: date, interest: ticker, ticker, direction, confidence: 60, action: "HOLD", provider: "x", returnPct, correct: direction === "up" ? returnPct > 0 : direction === "down" ? returnPct < 0 : true }) as never;
  const calls = [
    call("2026-11-02", "A", "up", 2), call("2026-11-02", "B", "down", -1), // day 1: AI (2+1)/2=1.5, hold (2-1)/2=0.5
    call("2026-11-03", "A", "up", -1), call("2026-11-03", "B", "flat", 3), // day 2: AI (-1+0)/2=-0.5, hold (−1+3)/2=1
    call("2026-11-03", "A", "up", 50, "w"), // weekly calls are excluded from the curve
  ];
  const eq = K.equityCurve(calls);
  assert.equal(eq.length, 2);
  near(eq[0].ai, 1.5, 1e-9);
  near(eq[0].hold, 0.5, 1e-9);
  near(eq[1].ai, (1.015 * 0.995 - 1) * 100, 1e-9);
  near(eq[1].hold, (1.005 * 1.01 - 1) * 100, 1e-9);
  const stats = K.computeStats(calls);
  const a = stats.byTicker.find((b) => b.ticker === "A")!;
  assert.equal(a.n, 3);
  near(a.avgReturn, (2 - 1 + 50) / 3, 1e-9);
  near(stats.byTicker.find((b) => b.ticker === "B")!.avgReturn, (1 + 0) / 2, 1e-9);

  // ---- holdings math and what the AI may see
  const P = await import("../src/lib/portfolio");
  const s = P.summarize(
    [{ symbol: "NVDA", shares: 10, cost: 100 }, { symbol: "SOXX", shares: 5, cost: 200 }, { symbol: "NOPE", shares: 1, cost: 1 }],
    [{ symbol: "NVDA", price: 150, prevClose: 140 }, { symbol: "SOXX", price: 100, prevClose: 110 }],
  );
  assert.equal(s.value, 2000);
  assert.equal(s.dayPnl, 100 - 50);
  near(s.dayPct, (50 / 1950) * 100, 1e-9);
  assert.equal(s.totalPnl, 0);
  assert.equal(s.positions.length, 2, "holdings without a quote are skipped");
  near(s.positions[0].weight, 75, 1e-9);
  const text = P.positionsAsText([{ symbol: "NVDA", shares: 1234, cost: 100 }], [{ symbol: "NVDA", price: 150, prevClose: 140, changePct: 0, history: [], source: "yahoo" }])!;
  assert.equal(text, "NVDA: 100% of portfolio, +50% vs cost");
  assert.ok(!/1234|\$|185100|123400/.test(text), "no share counts or dollar amounts reach the AI");
  assert.equal(P.positionsAsText([], []), undefined);

  // ---- portfolio route merges duplicates
  const pr = await import("../src/app/api/portfolio/route");
  const put = await pr.PUT(new Request("http://x/api/portfolio", { method: "PUT", body: JSON.stringify([{ symbol: "nvda", shares: 10, cost: 100 }, { symbol: "NVDA", shares: 30, cost: 200 }]) }));
  assert.deepEqual((await put.json()).holdings, [{ symbol: "NVDA", shares: 40, cost: 175 }]);
  assert.equal((await pr.PUT(new Request("http://x/api/portfolio", { method: "PUT", body: JSON.stringify([{ symbol: "bad symbol", shares: 1, cost: 1 }]) }))).status, 400);

  // ---- end to end: technicals, mood, positions and scenarios through the pipeline
  const { refreshSection } = await import("../src/lib/pipeline");
  const d = await refreshSection("interests");
  const sys: string = groqBody.messages[0].content;
  const user: string = groqBody.messages[1].content;
  assert.ok(user.includes("TECHNICALS:") && user.includes("SOXX: trend up"), "technicals in prompt");
  assert.ok(!user.includes("AMD: trend"), "free-tier prompt only carries benchmark technicals");
  assert.ok(user.includes("MOOD GAUGE:"), "mood in prompt");
  assert.ok(user.includes("POSITIONS (weights only):") && user.includes("NVDA: 100% of portfolio"), "position weights in prompt");
  assert.ok(!user.includes("40 shares") && !/\$\s?\d/.test(user.split("POSITIONS")[1].split("UPCOMING")[0]), "no amounts in the positions block");
  assert.ok(sys.includes("SCENARIOS:") && sys.includes('"scenarios"'), "scenario rule and schema in system prompt");
  assert.ok(d.technicals?.NVDA && d.technicals.SPY, "technicals stored on digest (holdings ticker included)");
  assert.ok(d.quotes.some((x) => x.symbol === "NVDA"));
  const sc = d.analysis.scenarios!;
  assert.equal(sc.length, 1, "only one scenario set kept; malformed ones dropped");
  assert.deepEqual(sc[0].cases.map((c) => c.probability), [20, 60, 20], "probabilities rescaled to sum to 100 ('30%' string handled)");

  // ---- ticker search: Yahoo parse, filtering, local fallback
  const S = await import("../src/lib/search");
  const hits = await S.searchTickers("micros");
  assert.deepEqual(hits.map((h) => h.symbol), ["MSFT", "MSFT.MX"], "invalid symbols and options filtered out");
  assert.equal(hits[0].exchange, "NASDAQ");
  yahooSearchDown = true;
  const local = await S.searchTickers("nvid");
  assert.equal(local[0]?.symbol, "NVDA", "falls back to the built-in list when Yahoo is unavailable");
  assert.deepEqual(await S.searchTickers("  "), []);

  // ---- rate limit
  const R = await import("../src/lib/ratelimit");
  const day = new Date("2026-11-16T15:00:00Z");
  assert.equal((await R.hit("t", 2, day)).ok, true);
  assert.equal((await R.hit("t", 2, day)).ok, true);
  assert.equal((await R.hit("t", 2, day)).ok, false, "third hit in a day is refused");
  assert.equal((await R.hit("t", 2, new Date("2026-11-17T15:00:00Z"))).ok, true, "resets the next day");

  // ---- CSV export and per-ticker calls
  const { setJSON } = await import("../src/lib/store");
  await setJSON("calls", calls);
  const tr = await import("../src/app/api/track/route");
  const csv = await (await tr.GET(new Request("http://x/api/track?format=csv"))).text();
  assert.equal(csv.split("\n").length, 6, "header + 5 calls");
  assert.ok(csv.startsWith("session,horizon,ticker") && csv.includes("2026-11-03,week,A"));
  const per = await (await tr.GET(new Request("http://x/api/track?ticker=b"))).json();
  assert.equal(per.calls.length, 2);

  console.log("V4 OK");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
