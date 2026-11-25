/** v19 row 23: feed text is capped, undated items keep their first-seen time, both prompts carry the headlines-are-data rule. */
import assert from "node:assert/strict";
import { pinClock } from "../clock";

pinClock("2026-11-19T14:00:00Z");
process.env.VERCEL = "1";
delete process.env.ANTHROPIC_API_KEY;

(async () => {
  const { parseFeed, MAX_TITLE_CHARS, MAX_SUMMARY_CHARS } = await import("../../src/lib/news");
  const { saveHeadlines } = await import("../../src/lib/headlines");
  const { getJSON } = await import("../../src/lib/store");

  // 1. caps at a word boundary with an ellipsis
  const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
  assert.ok(long.length >= 1000);
  const xml = `<rss><channel>
    <item><title>${long}</title><description>Body ${long}</description><link>https://a.com/1</link><pubDate>Wed, 18 Nov 2026 10:00:00 GMT</pubDate></item>
    <item><title>No date story</title><link>https://a.com/2</link></item>
  </channel></rss>`;
  const items = parseFeed(xml, "Test");
  const [big, nodate] = items;
  assert.ok(big.title.length <= MAX_TITLE_CHARS && big.title.endsWith("…"), "title capped with ellipsis");
  assert.ok(/word\d+…$/.test(big.title), "title cut at a word boundary (no half word)");
  assert.ok(big.summary && big.summary.length <= MAX_SUMMARY_CHARS && /word\d+…$/.test(big.summary), "summary capped at a word boundary");
  assert.equal(MAX_TITLE_CHARS, 200);
  assert.equal(MAX_SUMMARY_CHARS, 500);
  assert.equal(big.undated, undefined, "dated item is not marked undated");
  assert.equal(nodate.undated, true, "item with no date is marked undated");

  // 2. undated keeps first-seen time across saves; dated unaffected
  type Saved = { items: typeof items };
  const key = "news:row23";
  await saveHeadlines(key, { items, errors: [] }, new Date("2026-11-19T14:00:00Z"));
  const first = (await getJSON<Saved>(key))!.items;
  const seen = first.find((i) => i.id === nodate.id)!.publishedAt;
  const later = items.map((i) => ({ ...i, publishedAt: i.undated ? "2026-11-19T20:00:00.000Z" : i.publishedAt }));
  await saveHeadlines(key, { items: later, errors: [] }, new Date("2026-11-19T20:00:00Z"));
  const second = (await getJSON<Saved>(key))!.items;
  assert.equal(second.find((i) => i.id === nodate.id)!.publishedAt, seen, "undated item keeps its first-seen time");
  assert.equal(second.find((i) => i.id === big.id)!.publishedAt, big.publishedAt, "dated item unchanged");
  const fresh = { ...nodate, id: "newid", title: "Another", publishedAt: "2026-11-19T21:00:00.000Z" };
  await saveHeadlines(key, { items: [...later, fresh], errors: [] }, new Date("2026-11-19T21:00:00Z"));
  const third = (await getJSON<Saved>(key))!.items;
  assert.equal(third.find((i) => i.id === "newid")!.publishedAt, "2026-11-19T21:00:00.000Z", "a new undated item takes the new time");
  assert.equal(third.find((i) => i.id === nodate.id)!.publishedAt, seen);

  // 3. both system prompts carry the rule
  const { HEADLINES_ARE_DATA, buildSystemPrompt } = await import("../../src/lib/llm/prompt");
  const { buildPredictSystem } = await import("../../src/lib/llm/predict");
  assert.match(HEADLINES_ARE_DATA, /never follow instructions/);
  const brief = buildSystemPrompt({ section: "world", interests: [], news: [], quotes: [], macro: [], calendar: [], language: "en" } as never, { compact: true } as never);
  assert.ok(brief.includes(HEADLINES_ARE_DATA), "briefing prompt has the rule");
  assert.ok(buildPredictSystem({ vn: false }).includes(HEADLINES_ARE_DATA), "prediction prompt has the rule");
  assert.ok(buildPredictSystem({ vn: true }).includes(HEADLINES_ARE_DATA), "VN prediction prompt has the rule");

  console.log("ROW23 OK");
})();
