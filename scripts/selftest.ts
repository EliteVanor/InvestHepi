/**
 * Offline end-to-end test: mocks fetch with RSS + price fixtures, runs every section through the
 * rule-based provider, then checks call logging and grading. `npx tsx scripts/selftest.ts`
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";

process.env.LLM_PROVIDER = "rules";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;

const now = Date.now();
const iso = (minAgo: number) => new Date(now - minAgo * 60000).toUTCString();
const rss = (items: [string, string][]) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items
    .map(([t, src], i) => `<item><title>${t} - ${src}</title><link>https://example.com/${i}</link><pubDate>${iso(i * 30)}</pubDate><source url="https://x">${src}</source></item>`)
    .join("")}</channel></rss>`;

const FIXTURE = rss([
  ["Nvidia beats estimates as data center demand soars", "Reuters"],
  ["Nvidia tops estimates on soaring data center demand", "CNBC"], // near-dup
  ["US weighs new export controls on AI chips to China", "Bloomberg"],
  ["Inflation cools more than expected in October, CPI eases", "AP"],
  ["S&P 500 hits record as tech stocks rally", "MarketWatch"],
  ["Local bakery wins award", "Some Paper"],
]);

function chart(sym: string) {
  const days: number[] = [];
  const closes: number[] = [];
  const base = sym === "NVDA" ? 140 : 500;
  for (let i = 25; i >= 1; i--) {
    days.push(Math.floor((now - i * 86400_000) / 1000));
    closes.push(base + (25 - i));
  }
  return { chart: { result: [{ meta: { regularMarketPrice: closes.at(-1), regularMarketTime: days.at(-1), chartPreviousClose: closes[0] }, timestamp: days, indicators: { quote: [{ close: closes }] } }] } };
}

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("query1.finance.yahoo.com")) {
    const sym = decodeURIComponent(url.split("/chart/")[1].split("?")[0]);
    return new Response(JSON.stringify(chart(sym)), { status: 200 });
  }
  if (url.includes("aljazeera")) return new Response("nope", { status: 503 });
  if (url.includes("/rss/search") || url.includes("feeds.finance.yahoo.com"))
    return new Response(FIXTURE.replace(/<item><title>Local bakery[\s\S]*?<\/item>/, ""), { status: 200 });
  return new Response(FIXTURE, { status: 200, headers: { "content-type": "application/rss+xml" } });
}) as typeof fetch;

async function main() {
  await fs.rm(".data", { recursive: true, force: true });
  const { parseFeed, dedupe } = await import("../src/lib/news");
  const items = parseFeed(FIXTURE, "Google News: test");
  assert.equal(items.length, 6);
  assert.equal(items[0].source, "Reuters");
  assert.ok(!items[0].title.endsWith("Reuters"), "publisher suffix stripped");
  assert.equal(dedupe(items).length, 5, "near-duplicate Nvidia headline merged");

  const { refreshAll, loadDigest } = await import("../src/lib/pipeline");
  const r = await refreshAll();
  console.log(JSON.stringify(r));
  assert.ok(r.results.every((x) => x.ok));

  const d = (await loadDigest("interests"))!;
  assert.equal(d.provider, "rules");
  assert.ok(d.news.every((n) => (n.tags?.length ?? 0) > 0), "interest news all tagged");
  assert.ok(!d.news.some((n) => n.title.includes("bakery")), "irrelevant item filtered");
  assert.ok(d.quotes.find((q) => q.symbol === "NVDA"), "quotes fetched");
  assert.equal(d.analysis.outlook.length, 3, "one outlook per interest");
  console.log("Headline:", d.analysis.headline);
  console.log("Events:", d.analysis.events.map((e) => `${e.title} [${e.impacts.map((i) => i.interest + ":" + i.direction).join(", ")}]`));
  const w = (await loadDigest("world"))!;
  assert.ok(w.feedErrors.some((e) => e.includes("Al Jazeera")), "feed errors reported");

  // Track record: rules calls are not logged; simulate an AI call and grade it.
  const { recordCalls, gradeCalls, loadCalls, computeStats, targetSession } = await import("../src/lib/track");
  assert.equal((await loadCalls()).length, 0);
  const past = new Date(now - 10 * 86400_000);
  await recordCalls(
    [{ interest: "Chip stocks", ticker: "NVDA", direction: "up", confidence: 72, horizon: "today", action: "BUY", actionTrigger: "", rationale: "", risks: "" }],
    [{ id: "chips", name: "Chip stocks", query: "x", tickers: ["SOXX", "NVDA"] }],
    "groq:test",
    past,
  );
  const calls = await loadCalls();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].date, targetSession(past));
  const g = await gradeCalls(new Date(now));
  assert.equal(g, 1, "call graded");
  const graded = (await loadCalls())[0];
  assert.equal(graded.correct, true, "rising fixture prices make an up call correct");
  console.log("Graded call:", graded);
  console.log("Stats:", computeStats(await loadCalls()).buckets);
  console.log("\nALL CHECKS PASSED");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
