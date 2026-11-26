/**
 * v19 audit 2 (Nov 26, the Nov 25 21:20 runs): a publisher's feeds count as ONE outlet (a BBC story in BBC World
 * and BBC Business counted 2); sections have outlets beyond Google News (US had 15 headlines while Google refused
 * production all day); a host that keeps refusing rests longer each time; market links need a direct tie.
 */
import assert from "node:assert/strict";
import { pinClock } from "../clock";
pinClock("2026-11-26T01:00:00Z");

let googleStatus = 429;
const hits: string[] = [];
const rss = (title: string) => `<?xml version="1.0"?><rss><channel><item><title>${title}</title><link>https://e.com/${encodeURIComponent(title)}</link><pubDate>${new Date(Date.UTC(2026, 10, 26, 0, 30)).toUTCString()}</pubDate></item></channel></rss>`;
globalThis.fetch = (async (u: string | URL) => {
  const url = String(u);
  hits.push(url);
  if (url.includes("news.google.com")) return googleStatus === 200 ? new Response(rss("Google item about markets today"), { status: 200 }) : new Response("", { status: googleStatus });
  return new Response(rss(url.includes("business") ? "Iraq court hands Baghdad control of Kurdish oil fields, borders" : "Iraq court gives Baghdad control of Kurdish oil fields and borders"), { status: 200 });
}) as typeof fetch;

(async () => {
  const { SECTION_FEEDS } = await import("../../src/lib/config");
  const N = await import("../../src/lib/news");
  const { clusterStories } = await import("../../src/lib/stories/cluster");
  const { getJSON } = await import("../../src/lib/store");
  const { EXPLAIN_RULES } = await import("../../src/lib/stories/explain-prompt");

  // The class of bug: two feeds on one host (Google News aside, whose items name their own publisher) must name the
  // same outlet, or one publisher's story counts twice and ranks as "big".
  const outletOf = (f: { name: string; outlet?: string }) => f.outlet ?? f.name;
  for (const [s, feeds] of Object.entries(SECTION_FEEDS)) {
    const byHost = new Map<string, Set<string>>();
    for (const f of feeds) {
      const h = new URL(f.url).host;
      if (h === "news.google.com") continue;
      byHost.set(h, (byHost.get(h) ?? new Set()).add(outletOf(f)));
    }
    for (const [h, outlets] of byHost) assert.equal(outlets.size, 1, `${s}: feeds on ${h} name one outlet (got ${[...outlets].join(", ")})`);
  }
  // Each shared section has 3+ outlets that are not Google News for its important news.
  for (const s of ["world", "us", "vn"] as const) {
    const outlets = new Set(SECTION_FEEDS[s].filter((f) => !f.kind && !f.url.includes("news.google.com")).map(outletOf));
    assert.ok(outlets.size >= 3, `${s}: 3+ non-Google outlets (has ${[...outlets].join(", ")})`);
  }

  // parseFeed: the publisher is the source; an item's own <source> still wins.
  assert.equal(N.parseFeed(rss("A headline here"), "BBC Business", "BBC")[0].source, "BBC");
  assert.equal(N.parseFeed(rss("A headline here"), "Plain feed")[0].source, "Plain feed", "no outlet: the feed's name");

  // One event in BBC World and BBC Business is one outlet.
  const bbc = SECTION_FEEDS.world.filter((f) => f.outlet === "BBC" && !f.kind);
  assert.ok(bbc.length >= 2, "World has two BBC feeds");
  const { items } = await N.fetchFeeds(bbc);
  const stories = clusterStories(items, null, new Date());
  assert.equal(stories.length, 1, "the two BBC headlines are one story");
  assert.deepEqual(stories[0].outlets, ["BBC"], "and one outlet");

  // Back-off: 30 min, then 1 h after the next refusal, ... capped at 6 h; a success resets it.
  assert.deepEqual([1, 2, 3, 4, 5, 9].map((n) => N.coolFor(n) / 60_000), [30, 60, 120, 240, 360, 360]);
  const g = [{ name: "Google News World", url: "https://news.google.com/rss/a" }, { name: "Global macro", url: "https://news.google.com/rss/b" }];
  // Minutes from now the host rests (the pinned clock runs at real speed, so round).
  const until = async () => Math.round(((((await getJSON<Record<string, number>>("news:cool")) ?? {})["news.google.com"] ?? 0) - Date.now()) / 60_000);
  await N.fetchFeeds(g);
  assert.equal(await until(), 30, "first refusal: 30 min (two feeds refused in one run count once)");
  const asked = hits.filter((u) => u.includes("news.google.com")).length;
  await N.fetchFeeds(g);
  assert.equal(hits.filter((u) => u.includes("news.google.com")).length, asked, "not asked while resting");
  pinClock("2026-11-26T01:31:00Z");
  await N.fetchFeeds(g);
  assert.equal(await until(), 60, "refused again after resting: 1 h");
  pinClock("2026-11-26T02:32:00Z");
  googleStatus = 200;
  const ok = await N.fetchFeeds(g);
  assert.ok(ok.items.length > 0 && !ok.errors.length, "answers again");
  assert.equal(((await getJSON<Record<string, number>>("news:strikes")) ?? {})["news.google.com"], undefined, "a success resets the count");
  googleStatus = 429;
  pinClock("2026-11-26T02:47:00Z");
  await N.fetchFeeds(g);
  assert.equal(await until(), 30, "so the next refusal starts at 30 min again");

  // Market links: the prompt forbids tying a story to an index just because it moved (Nov 25: Europe's protests "pushed" the FTSE).
  assert.match(EXPLAIN_RULES, /Never tie a story to an index just because the index moved today/);

  console.log("AUDIT2 FEEDS OK");
})();
