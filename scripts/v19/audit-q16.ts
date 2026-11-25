/**
 * v19 audit (Nov 25, first real runs): the model scores and picks among candidates (owner Q16) instead of the code
 * showing the newest 7 single-outlet stories; two stories naming the same company code are one subject.
 */
import assert from "node:assert/strict";
import { pinClock } from "../clock";
pinClock("2026-11-25T09:00:00Z");

(async () => {
  const P = await import("../../src/lib/stories/pick");
  const E = await import("../../src/lib/stories/explain");
  const EP = await import("../../src/lib/stories/explain-prompt");
  const C = await import("../../src/lib/stories/cluster");
  type Card = import("../../src/lib/stories/types").StoryCard;
  const card = (id: string, kind: "important" | "interesting", importance?: number): Card => ({ id, scope: "world", kind, lang: "en", explainedAt: "2026-11-25T08:00:00Z", outletsAtExplain: 1, title: id, outlets: ["x"], what: "w", why: "y", markets: [], world: "", past: null, concepts: [], memberIds: [], ...(importance ? { importance } : {}) });

  // selectCards: the quota by the model's importance, ties by candidate rank; interesting shortfall filled by important.
  const cards = [card("flytip", "important", 1), card("energy", "important", 5), card("xmas", "important", 1), card("fed", "important", 4), card("garment", "important", 3), card("gaza", "important", 3), card("tariff", "important", 4), card("nasa", "interesting", 4), card("hummingbird", "interesting", 2), card("museum", "interesting", 3)];
  const shown = P.selectCards(cards, P.SHARED_PICK).map((c) => c.id);
  assert.deepEqual(shown, ["energy", "fed", "tariff", "garment", "gaza", "nasa", "museum"], "top 5 important + top 2 interesting by importance");
  assert.ok(!shown.includes("flytip") && !shown.includes("xmas"), "minor local stories drop out");
  const few = P.selectCards([card("a", "important", 2), card("b", "important"), card("c", "important"), card("d", "important"), card("e", "important"), card("f", "important"), card("g", "important")], P.SHARED_PICK);
  assert.equal(few.length, 7, "no interesting cards: important ones fill all 7");
  assert.equal(P.selectCards(cards, P.SHARED_PICK, new Set(["flytip"]))[0].id, "flytip", "a pinned big story always shows, first");
  assert.equal(P.selectCards(cards, P.INTERESTS_PICK).length, 6, "My Interests: 6 whatever their kind");

  // shownStories now returns candidates: up to 10 important + twice the interesting quota.
  const W = "apple bridge castle desert engine forest garden harbor island jungle kettle lemon meadow needle orange pepper quarry river salmon tunnel umbrella violin walnut yacht zebra anchor".split(" ");
  const mk = (i: number, kind?: "interesting") => C.clusterStories([{ id: `s${i}`, title: `${W[i]} ${W[(i + 7) % 26]} ${W[(i + 13) % 26]} report`, link: "https://e.com", source: `o${i}`, publishedAt: new Date(Date.UTC(2026, 10, 25, 8, i)).toISOString(), ...(kind ? { feedKind: kind } : {}) }], null, new Date())[0];
  const pool = [...Array.from({ length: 14 }, (_, i) => mk(i)), ...Array.from({ length: 6 }, (_, i) => mk(20 + i, "interesting"))];
  const cand = P.shownStories(pool, [], P.SHARED_PICK);
  assert.equal(cand.filter((s) => s.kind === "important").length, 10, "10 important candidates");
  assert.equal(cand.filter((s) => s.kind === "interesting").length, 4, "4 interesting candidates");

  // The prompt asks the model to choose and score; the reply's importance is clamped to 1-5 (missing: 3).
  const parts = { section: "world" as const, lang: "en" as const, now: new Date(), market: { quotes: [] }, calendar: [], covered: [] };
  assert.match(EP.buildExplainUser({ ...parts, want: { important: 5, interesting: 2 } }, cand.slice(0, 2), [[], []]), /CANDIDATES[\s\S]*5 most important[\s\S]*2 most interesting[\s\S]*importance/);
  assert.doesNotMatch(EP.buildExplainUser(parts, cand.slice(0, 1), [[]]), /CANDIDATES/, "no quota: explain every story");
  const norm = (imp: unknown) => (E.normalizeExplain({ stories: [{ story: "S1", importance: imp }] }) as { stories: { importance: number }[] }).stories[0].importance;
  assert.deepEqual([norm(9), norm(0), norm("4"), norm(undefined)], [5, 1, 4, 3]);

  // Same company code + one shared distinctive word = one subject; a different event about the same company is not.
  const one = (t: string, id: string) => C.clusterStories([{ id, title: t, link: "https://e.com", source: id, publishedAt: "2026-11-25T08:00:00Z" }], null, new Date())[0];
  const pnjA = one("PNJ giảm giá vàng nhẫn đáng kể", "p1");
  const pnjB = one("PNJ hạ giá vàng nhẫn trơn xuống thấp hơn nhiều thương hiệu lớn", "p2");
  assert.ok(C.relatedStories(pnjA, pnjB), "two PNJ gold-ring stories are one subject");
  assert.ok(!C.relatedStories(pnjA, one("PNJ báo lãi quý 3 tăng mạnh", "p3")), "PNJ's earnings are a different story");
  assert.ok(!C.relatedStories(pnjA, one("FPT Software kỳ vọng doanh thu kỷ lục trong quý 4", "f1")), "different companies");
  assert.ok(!C.relatedStories(one("USD weakens as GDP data disappoints traders", "u1"), one("USD gains as GDP report beats forecasts today", "u2")), "common acronyms (USD, GDP) are not company codes");
  console.log("AUDIT Q16 OK");
})();
