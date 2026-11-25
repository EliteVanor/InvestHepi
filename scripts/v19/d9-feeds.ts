/** v19 D9 (owner Q17): science and culture feeds per shared section, marked "interesting", capped per fetch. */
import assert from "node:assert/strict";
import { pinClock } from "../clock";
pinClock("2026-11-25T03:00:00Z");

const rss = (n: number) =>
  `<?xml version="1.0"?><rss><channel>${Array.from({ length: n }, (_, i) => `<item><title>Science story number ${i} about comets</title><link>https://example.com/${i}</link><pubDate>${new Date(Date.UTC(2026, 10, 25, 2, 59 - i)).toUTCString()}</pubDate></item>`).join("")}</channel></rss>`;
globalThis.fetch = (async () => new Response(rss(20), { status: 200 })) as typeof fetch;

(async () => {
  const { SECTION_FEEDS } = await import("../../src/lib/config");
  const { fetchFeeds } = await import("../../src/lib/news");
  for (const s of ["world", "us", "vn"] as const) {
    const n = SECTION_FEEDS[s].filter((f) => f.kind === "interesting").length;
    assert.ok(n >= 2 && n <= 3, `${s}: 2-3 interesting feeds (has ${n})`);
    // No section depends on one host for its news or its interesting stories (Nov 25: Google News answered
    // production with 429 and World lost all four Google feeds at once).
    const hosts = (fs: { url: string }[]) => new Set(fs.map((f) => new URL(f.url).host));
    assert.ok(hosts(SECTION_FEEDS[s].filter((f) => f.kind === "interesting")).size >= 2, `${s}: interesting feeds span 2+ hosts`);
    assert.ok(hosts(SECTION_FEEDS[s].filter((f) => !f.kind)).size >= 2, `${s}: news feeds span 2+ hosts`);
    assert.ok(SECTION_FEEDS[s].filter((f) => f.kind === "interesting").every((f) => f.max === 8), `${s}: each capped at 8`);
  }
  assert.equal(SECTION_FEEDS.interests.filter((f) => f.kind).length, 0, "My Interests gets no interesting feeds");

  const capped = await fetchFeeds([{ name: "Sci", url: "https://example.com/a.rss", kind: "interesting", max: 8 }]);
  assert.equal(capped.items.length, 8, "an interesting feed gives at most 8 items");
  assert.ok(capped.items.every((i) => i.feedKind === "interesting"), "items carry the feed's kind");
  assert.equal(capped.items[0].title, "Science story number 0 about comets", "the newest are kept");
  const plain = await fetchFeeds([{ name: "News", url: "https://example.com/b.rss" }]);
  assert.equal(plain.items.length, 20, "a feed without max is not capped");
  assert.ok(plain.items.every((i) => !i.feedKind), "no kind, no feedKind");
  console.log("D9 FEEDS OK");
})();
