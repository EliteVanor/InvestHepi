/**
 * v19 row 21 (audit: Vietnamese headlines): story clustering. The old `tokens()` kept only a-z, so a Vietnamese
 * title shrank to one or two words: unrelated stories merged and real duplicates were missed.
 * Pins: Vietnamese pairs that must merge and must not, no chaining, no cross-language merge, id carry-over,
 * `toHeadlines` (alsoIn, tags), the 36 h cutoff relative to `now`, and the English behaviour of dedupe.
 */
import assert from "node:assert/strict";
import { pinClock } from "../clock";

pinClock("2026-11-19T14:00:00Z");

import type { NewsItem } from "../../src/lib/types";

const NOW = new Date("2026-11-19T14:00:00Z");
const hAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
let n = 0;
const mk = (title: string, source: string, h = 1, extra: Partial<NewsItem> = {}): NewsItem => ({
  id: `id${++n}-${title.length}`,
  title,
  link: `https://example.com/${n}`,
  source,
  publishedAt: hAgo(h),
  ...extra,
});

// The old algorithm, copied from news.ts before this change, to show what it did to the same pairs.
const OLD_STOP = new Set("a an the of to in on for and or with at by from as is are was be after over amid says said new its it this that".split(" "));
const oldTokens = (t: string) =>
  new Set(t.toLowerCase().replace(/[^a-z0-9$% ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !OLD_STOP.has(w)).map((w) => w.replace(/(ing|ed|es|s)$/, "")));
const oldJaccard = (a: Set<string>, b: Set<string>) => {
  let i = 0;
  for (const w of a) if (b.has(w)) i++;
  return i / (a.size + b.size - i || 1);
};
const oldMerges = (a: string, b: string) => oldJaccard(oldTokens(a), oldTokens(b)) >= 0.55;

const MERGE: [string, string][] = [
  ["VN-Index giảm hơn 20 điểm do áp lực bán ngân hàng", "Chứng khoán hôm nay: VN-Index mất 20 điểm, cổ phiếu ngân hàng bị bán mạnh"],
  ["Ngân hàng Nhà nước giảm lãi suất điều hành 0,5 điểm phần trăm", "Ngân hàng Nhà nước hạ lãi suất điều hành 0,5 điểm phần trăm"],
  ["Giá vàng SJC tăng vọt lên 90 triệu đồng một lượng", "Vàng SJC tăng mạnh, vượt mốc 90 triệu đồng một lượng"],
  ["Bão số 9 đổ bộ miền Trung, hàng chục nghìn người phải sơ tán", "Bão số 9 đổ bộ vào miền Trung, hơn chục nghìn người được sơ tán"],
  ["Vingroup công bố lợi nhuận quý 3 tăng 40%", "Lợi nhuận quý 3 của Vingroup tăng 40%"],
];
const SPLIT: [string, string][] = [
  ["VN-Index tăng 15 điểm nhờ nhóm cổ phiếu công nghệ", "VN-Index giảm hơn 20 điểm do áp lực bán ngân hàng"],
  ["Ngân hàng Nhà nước giảm lãi suất điều hành 0,5 điểm phần trăm", "Ngân hàng Vietcombank tăng lãi suất tiền gửi kỳ hạn 12 tháng"],
  ["Lãi suất tiết kiệm tăng mạnh tại nhiều ngân hàng", "Lãi suất cho vay bất động sản giảm xuống dưới 8%"],
  ["Cổ phiếu ngân hàng dẫn dắt thị trường chứng khoán tuần này", "Ngân hàng Nhà nước yêu cầu siết tín dụng bất động sản"],
  ["Giá vàng trong nước tăng 1 triệu đồng một lượng", "Giá xăng dầu trong nước giảm 500 đồng một lít"],
  ["VN-Index tăng điểm nhờ cổ phiếu ngân hàng", "VN-Index giảm điểm vì cổ phiếu bất động sản"],
  ["Lãi suất liên ngân hàng tăng vọt, thanh khoản căng thẳng", "Ngân hàng Nhà nước giảm lãi suất điều hành 0,5 điểm phần trăm"],
];

(async () => {
  const C = await import("../../src/lib/stories/cluster");
  const stories = (items: NewsItem[], prev: import("../../src/lib/stories/cluster").StoryIndex | null = null, now = NOW) => C.clusterStories(items, prev, now);

  // (2) Vietnamese: pairs that must merge, and pairs that must not.
  let oldMergeMiss = 0;
  let oldSplitMiss = 0;
  for (const [a, b] of MERGE) {
    assert.equal(C.detectLang(a), "vi");
    const s = stories([mk(a, "VnExpress", 3), mk(b, "Tuổi Trẻ", 2)]);
    assert.equal(s.length, 1, `must merge: ${a} | ${b}`);
    assert.deepEqual(s[0].outlets.sort(), ["Tuổi Trẻ", "VnExpress"]);
    if (!oldMerges(a, b)) oldMergeMiss++;
  }
  for (const [a, b] of SPLIT) {
    const s = stories([mk(a, "VnExpress", 3), mk(b, "Tuổi Trẻ", 2)]);
    assert.equal(s.length, 2, `must stay apart: ${a} | ${b}`);
    if (oldMerges(a, b)) oldSplitMiss++;
  }
  console.log(`old tokens: ${oldMergeMiss}/${MERGE.length} real duplicates missed, ${oldSplitMiss}/${SPLIT.length} unrelated pairs merged`);
  assert.ok(oldMergeMiss >= 1, "the merge cases show the old bug (duplicates missed)");
  assert.ok(oldSplitMiss >= 1, "the split cases show the old bug (unrelated merged)");

  // (1) English behaviour of today's dedupe stays.
  const en = stories([
    mk("Nvidia shares jump after record quarterly revenue", "Reuters", 2),
    mk("Nvidia shares jump after record quarterly revenue forecast", "CNBC", 1),
    mk("Fed holds rates steady as inflation cools", "AP", 1),
  ]);
  assert.equal(en.length, 2, "English near-duplicate merged, other story kept");
  assert.equal(en[0].lang, "en");

  // (3) No chaining: A~B and B~C but A not~C keeps A and C apart (compared with the first member only).
  const A = "alpine boston carbon dollar energy factory garment harvest island jungle kitchen lumber";
  const B = "dollar energy factory garment harvest island jungle kitchen lumber marble nickel orchard";
  const Cc = "garment harvest island jungle kitchen lumber marble nickel orchard puzzle quartz rocket";
  // Newest first: C(1h) is the first member, B(2h) joins it, A(3h) is compared with C only.
  const chain = stories([mk(A, "o1", 3), mk(B, "o2", 2), mk(Cc, "o3", 1)]);
  const together = (x: string, y: string) => chain.some((s) => s.members.some((m) => m.title === x) && s.members.some((m) => m.title === y));
  const ab = stories([mk(A, "o1", 3), mk(B, "o2", 2)]).length === 1;
  const bc = stories([mk(B, "o2", 3), mk(Cc, "o3", 2)]).length === 1;
  const ac = stories([mk(A, "o1", 3), mk(Cc, "o3", 2)]).length === 1;
  assert.ok(ab && bc && !ac, `fixture is a chain (A~B ${ab}, B~C ${bc}, A~C ${ac})`);
  assert.ok(!together(A, Cc), "A and C are not put together through B");

  // (4) Never across languages, even for the same event.
  const x = stories([mk("VN-Index closes 20 points lower as banks sell off", "Reuters", 2), mk("VN-Index đóng cửa giảm 20 điểm khi nhóm ngân hàng bị bán", "VnExpress", 1)]);
  assert.equal(x.length, 2);
  assert.deepEqual(x.map((s) => s.lang).sort(), ["en", "vi"]);
  // Same id always merges.
  const same = stories([mk("Hello world story one", "a", 2, { id: "same" }), mk("Completely different words here", "b", 1, { id: "same" })]);
  assert.equal(same.length, 1);

  // (5) Ids: earliest member by publishedAt, then carried over through a tick.
  const t1 = stories([mk("Bão số 9 đổ bộ miền Trung, hàng chục nghìn người phải sơ tán", "VnExpress", 5, { id: "m1" }), mk("Bão số 9 đổ bộ vào miền Trung, hơn chục nghìn người được sơ tán", "Tuổi Trẻ", 3, { id: "m2" })]);
  assert.equal(t1.length, 1);
  assert.equal(t1[0].id, "m1", "earliest member's id");
  assert.equal(t1[0].members[0].id, "m2", "members newest first");
  const idx = C.toIndex(t1, NOW);
  assert.equal(idx.at, NOW.toISOString());
  assert.deepEqual(idx.stories[0].memberIds, ["m2", "m1"]);
  // The earliest outlet drops out of the feed and a new one arrives: the story keeps its id.
  const t2 = stories([mk("Bão số 9 đổ bộ vào miền Trung, hơn chục nghìn người được sơ tán", "Tuổi Trẻ", 3, { id: "m2" }), mk("Bão số 9 đổ bộ miền Trung, hàng chục nghìn người phải sơ tán khẩn cấp", "Thanh Niên", 1, { id: "m3" })], idx);
  assert.equal(t2.length, 1);
  assert.equal(t2[0].id, "m1", "id carried over from the previous tick");
  // Two previous stories matched: the one with the earliest firstSeen wins.
  const prev2 = { at: NOW.toISOString(), stories: [{ id: "late", memberIds: ["m2"], outlets: [], firstSeen: hAgo(3) }, { id: "early", memberIds: ["m3"], outlets: [], firstSeen: hAgo(9) }] };
  assert.equal(stories([mk("Bão số 9 đổ bộ vào miền Trung, hơn chục nghìn người được sơ tán", "Tuổi Trẻ", 3, { id: "m2" }), mk("Bão số 9 đổ bộ vào miền Trung, hơn chục nghìn người được sơ tán", "Thanh Niên", 1, { id: "m3" })], prev2)[0].id, "early");

  // lastSeen / firstSeen, kind.
  assert.equal(t1[0].firstSeen, hAgo(5));
  assert.equal(t1[0].lastSeen, hAgo(3));
  assert.equal(t1[0].kind, "important");
  const kind = stories([mk("Astronomers find a new moon around Saturn", "NASA", 2, { feedKind: "interesting" }), mk("Astronomers find a new moon around Saturn today", "BBC", 1)]);
  assert.equal(kind.length, 1);
  assert.equal(kind[0].kind, "interesting");

  // (6) toHeadlines: the first (newest) member, alsoIn = other outlets, tags merged, input not mutated.
  const a = mk("Nvidia shares jump after record quarterly revenue", "Reuters", 3, { tags: ["nvda"] });
  const b = mk("Nvidia shares jump after record quarterly revenue forecast", "CNBC", 2, { tags: ["ai"] });
  const c = mk("Nvidia shares jump after record quarterly revenue, outlook", "Reuters", 1, { tags: ["nvda"] });
  const h = C.toHeadlines(stories([a, b, c]));
  assert.equal(h.length, 1);
  assert.equal(h[0].id, c.id, "keeps the newest-first first item, as dedupe did");
  assert.deepEqual(h[0].alsoIn, ["CNBC"]);
  assert.deepEqual([...(h[0].tags ?? [])].sort(), ["ai", "nvda"]);
  assert.equal(c.alsoIn, undefined, "input items are not mutated");
  const many = Array.from({ length: 15 }, (_, i) => mk("Oil prices surge after pipeline attack in region", `Outlet${i}`, 1 + i / 100));
  const hm = C.toHeadlines(stories(many));
  assert.equal(hm[0].alsoIn?.length, 12, "alsoIn capped at 12");
  assert.equal(stories(many)[0].outlets.length, 12, "outlets capped at 12");

  // (7) 36 h cutoff is relative to `now`, not the real clock.
  const old = mk("Old story from long ago in markets", "x", 37);
  const edge = mk("Fresh story just inside the window of time", "x", 35);
  assert.equal(stories([old, edge]).length, 1);
  assert.equal(stories([old, edge], null, new Date(NOW.getTime() + 10 * 3600_000)).length, 0, "later now drops both");
  assert.equal(stories([old, edge], null, new Date(NOW.getTime() - 10 * 3600_000)).length, 2, "earlier now keeps both (not in the future cutoff)");

  // dedupe wrapper keeps working for both ages.
  const { dedupe } = await import("../../src/lib/news");
  assert.equal(dedupe([old, edge]).length, 1);
  assert.equal(dedupe([old, edge], 12).length, 0);
  assert.equal(dedupe([old, edge], 48).length, 1, "never wider than the 36 h cluster window");

  console.log("ROW21 CLUSTER OK");
})();
