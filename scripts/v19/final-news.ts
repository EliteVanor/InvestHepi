/**
 * v19 final check (Nov 26): My Interests fetches all of a set's feeds in ONE `fetchFeeds` call (one call per
 * interest asked a refusing host once per interest and raced on `news:cool`), and Finnhub items go through the
 * same guards as RSS items (http(s) links only, capped title and summary, no crash on a missing headline).
 */
import assert from "node:assert/strict";
import { pinClock } from "../clock";
pinClock("2026-11-26T03:00:00Z");

const hits: string[] = [];
const rss = (title: string) => `<?xml version="1.0"?><rss><channel><item><title>${title}</title><link>https://e.com/${encodeURIComponent(title)}</link><pubDate>${new Date(Date.UTC(2026, 10, 26, 2, 30)).toUTCString()}</pubDate></item></channel></rss>`;
globalThis.fetch = (async (u: string | URL) => {
  const url = String(u);
  hits.push(url);
  if (url.includes("news.google.com")) return new Response("", { status: 429 });
  if (url.includes("finnhub.io"))
    return Response.json([
      { headline: `Apple ${"x".repeat(400)}`, url: "javascript:alert(1)", source: "Reuters", datetime: Date.UTC(2026, 10, 26, 2) / 1000, summary: "s".repeat(900) },
      { url: "https://e.com/no-headline", source: "Reuters", datetime: Date.UTC(2026, 10, 26, 2) / 1000 },
      { headline: "Apple supplier ramps output", url: "https://e.com/ok", datetime: 0 },
    ]);
  if (url.includes("yahoo.com")) return new Response(rss(`Yahoo item for ${new URL(url).searchParams.get("s")}`), { status: 200 });
  return new Response(rss("Microsoft and Nvidia lift the market"), { status: 200 });
}) as typeof fetch;

(async () => {
  const N = await import("../../src/lib/news");
  const { getJSON } = await import("../../src/lib/store");
  const interests = [
    { id: "aapl", name: "Apple", query: "Apple", tickers: ["AAPL"] },
    { id: "msft", name: "Microsoft", query: "Microsoft", tickers: ["MSFT"] },
    { id: "nvda", name: "Nvidia", query: "Nvidia", tickers: ["NVDA"] },
  ];
  const general = [{ name: "Market wire", url: "https://wire.example/rss" }];

  const r = await N.fetchInterestNews(interests, general, "k", { raw: true });
  const google = () => hits.filter((u) => u.includes("news.google.com")).length;
  assert.equal(google(), 3, "each interest's Google feed asked once");
  assert.equal(((await getJSON<Record<string, number>>("news:strikes")) ?? {})["news.google.com"], 1, "one refusal counted for the set's run");
  await N.fetchInterestNews(interests, general, "k", { raw: true });
  assert.equal(google(), 3, "the next fetch leaves the resting host alone");

  // Tags: an interest's own feed tags its items; a general item is kept only for the interests it names.
  const yahoo = r.items.find((i) => i.title === "Yahoo item for MSFT");
  assert.deepEqual(yahoo?.tags, ["msft"], "a per-interest feed tags its own items");
  const wire = r.items.find((i) => i.title.startsWith("Microsoft and Nvidia"));
  assert.deepEqual(wire?.tags?.sort(), ["msft", "nvda"], "a general item is tagged by the interests it mentions");

  // Finnhub items: same guards as RSS.
  const fin = r.items.filter((i) => i.title.startsWith("Apple"));
  const long = fin.find((i) => i.title.startsWith("Apple x"))!;
  assert.equal(long.link, "", "a javascript: link is dropped");
  assert.ok(long.title.length <= N.MAX_TITLE_CHARS && (long.summary ?? "").length <= N.MAX_SUMMARY_CHARS, "title and summary capped");
  assert.ok(!r.items.some((i) => i.link === "https://e.com/no-headline"), "an item with no headline is skipped");
  assert.ok(fin.some((i) => i.title === "Apple supplier ramps output" && i.source === "Finnhub" && i.undated), "the other items of the reply survive; no date = undated, no source = Finnhub");
  assert.ok(!r.errors.some((e) => e.startsWith("Finnhub")), "one bad item doesn't fail the ticker");

  console.log("FINAL NEWS OK");
})();
