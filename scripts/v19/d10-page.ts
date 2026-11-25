/**
 * v19b D10: the news-first page. Pure parts (which layout a digest gets, related stories for a
 * prediction call, the past-event block, concept chip slugs, the folded call on phones, shared
 * headline matching) and GET /api/concepts (validation, max 10, unknown slugs, translate once).
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import { pinClock } from "../clock";

pinClock("2026-11-25T14:00:00Z");
process.env.VERCEL = "1";
process.env.GEMINI_API_KEY = "g";
delete process.env.GROQ_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LLM_PROVIDER;
delete process.env.APP_PASSWORD;
delete process.env.AUTH_SECRET;

type NewsItem = import("../../src/lib/types").NewsItem;
type StoryCard = import("../../src/lib/stories/types").StoryCard;
type Outlook = import("../../src/lib/types").Outlook;

let trCalls = 0;
let trDown = false;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("generativelanguage") || url.includes("api.groq.com")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const system: string = body.messages?.[0]?.content ?? "";
    const user: string = body.messages?.[1]?.content ?? "";
    if (system.startsWith("You translate")) {
      trCalls++;
      if (trDown) return new Response("down", { status: 503 });
      const content = JSON.stringify((JSON.parse(user) as string[]).map((s) => `[vi] ${s}`));
      return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 50 } }), { status: 200 });
    }
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;

const item = (id: string, source: string, title: string, titleOrig?: string): NewsItem => ({ id, title, source, link: `https://x.example/${id}`, publishedAt: "2026-11-25T09:30:00.000Z", ...(titleOrig ? { titleOrig } : {}) });
const card = (id: string, memberIds: string[], extra: Partial<StoryCard> = {}): StoryCard => ({
  id, scope: "us", kind: "important", lang: "en", explainedAt: "2026-11-25T12:00:00.000Z", outletsAtExplain: 2, title: `Card ${id}`, outlets: ["A", "B"],
  what: "w", why: "y", markets: [], world: "", past: null, concepts: [], memberIds, ...extra,
});
const call = (ticker: string, interest: string): Outlook => ({ interest, ticker, direction: "up", confidence: 60, horizon: "today", action: "HOLD", actionTrigger: "", rationale: "", risks: "" });

(async () => {
  await fs.rm(process.env.STORE_DIR || "/tmp/invest-helper", { recursive: true, force: true });
  const V = await import("../../src/lib/stories/view");
  const C = await import("../../src/lib/stories/concepts");
  const { headlineMentions } = await import("../../src/lib/pipeline");
  const { mentionsIn } = await import("../../src/lib/mentions");
  const { US_GROUPS, VN_GROUPS } = await import("../../src/lib/config");

  /* ---------------- which layout a digest gets (decision 10: v18 digests keep today's layout) */
  assert.equal(V.layoutOf(undefined), "classic");
  assert.equal(V.layoutOf({}), "classic", "v18 digest (no stories field)");
  assert.equal(V.layoutOf({ stories: [], bigPicture: [] }), "classic", "empty v19 fields fall back");
  assert.equal(V.layoutOf({ stories: [card("s1", [])] }), "stories");
  assert.equal(V.layoutOf({ stories: [], bigPicture: ["One line."] }), "stories", "a big picture alone is v19");

  /* ---------------- concept chip → slug (the same function the server stores under) */
  assert.equal(V.conceptSlug, C.conceptSlug, "one conceptSlug: concepts.ts re-exports the browser-safe one");
  assert.equal(V.conceptSlug("Lãi suất"), "lai-suat");
  assert.equal(V.conceptSlug("Quantitative Easing (QE)"), "quantitative-easing-qe");
  assert.ok(V.SLUG_RE.test(V.conceptSlug("Đồng USD")), "every slug conceptSlug makes is one /api/concepts accepts");
  assert.equal(V.conceptSlug("???"), "", "a chip with no slug (disabled in the UI)");

  /* ---------------- past-event block: library fields from resolve(), "no close precedent" otherwise */
  assert.deepEqual(V.pastView(null), { kind: "none" });
  assert.deepEqual(V.pastView({ id: "unknown", different: "x" }), { kind: "none" }, "the library is empty today: an id reads as no precedent");
  const ev = { id: "fed-2022", type: "rates", date: "2022-06-15", region: "us", event: "Fed raises rates 75 bp", move: "S&P 500 +1.5% that day", source: "https://www.federalreserve.gov/x", lesson: "l", keywords: [] };
  const lib = (id: string) => (id === ev.id ? ev : undefined);
  assert.deepEqual(V.pastView({ id: "fed-2022", different: "Inflation is lower." }, lib), { kind: "event", date: ev.date, event: ev.event, move: ev.move, source: ev.source, lesson: "l", different: "Inflation is lower." });
  assert.equal((V.pastView({ id: "fed-2022", different: "" }, (id) => (id === ev.id ? { ...ev, source: "javascript:alert(1)" } : undefined)) as { source: string }).source, "", "unsafe source link dropped");

  /* ---------------- related stories for a prediction call (decision 11) */
  const news = [
    item("n1", "Reuters", "Nvidia shares jump on record chip demand"),
    item("n2", "CNBC", "Fed holds rates steady"),
    item("n3", "VnExpress", "[vi] Cổ phiếu ngân hàng tăng", "Vietcombank (VCB) lãi kỷ lục"),
    item("n4", "AP", "Wall Street rallies as S&P 500 hits a record"),
  ];
  const cards = [card("c1", ["n1"]), card("c2", ["n2"], { markets: [{ symbol: "^TNX", direction: "up", changePct: 0.4, text: "Yields rose." }] }), card("c3", ["n3"]), card("c4", ["n4"]), card("c5", ["gone"])];
  assert.deepEqual(V.relatedStories("NVDA", cards, news).map((c) => c.id), ["c1"], "member title names the company (alias)");
  assert.deepEqual(V.relatedStories("^tnx", cards, news).map((c) => c.id), ["c2"], "a card's markets name the ticker");
  assert.deepEqual(V.relatedStories("VCB.VN", cards, news).map((c) => c.id), ["c3"], "the original title matches when the shown one is translated");
  assert.deepEqual(V.relatedStories("^GSPC", cards, news).map((c) => c.id), ["c4"], "index label (S&P 500)");
  assert.deepEqual(V.relatedStories("AAPL", cards, news), [], "nothing related");
  assert.deepEqual(V.relatedStories("NVDA", undefined, news), [], "v18 digest: no cards");
  const many = ["a", "b", "c", "d"].map((x) => card(x, [], { markets: [{ symbol: "SPY", direction: "up", text: "" }] }));
  assert.deepEqual(V.relatedStories("SPY", many, []).map((c) => c.id), ["a", "b", "c"], "best-ranked first, at most 3");
  assert.deepEqual(V.cardMembers(card("x", ["n2", "missing", "n1"]), news).map((n) => n.id), ["n2", "n1"], "members in the card's order, missing ones skipped");
  assert.equal(V.storyDomId("ab:c/1"), "story-ab_c_1");

  /* ---------------- headline matching moved to a browser-safe module without changing the server's rule */
  for (const [title, sym] of [["Nvidia beats", "NVDA"], ["VCB lãi lớn", "VCB.VN"], ["Hòa Phát tăng vốn", "HPG.VN"], ["The S&P 500 slips", "^GSPC"], ["Apple pie recipes", "AAPL"], ["Applebee's", "AAPL"]] as const) {
    assert.equal(headlineMentions(title, sym), mentionsIn(title, sym, sym === "HPG.VN" ? ["Hòa Phát"] : []), `${title} / ${sym}`);
  }
  assert.ok(headlineMentions("Hòa Phát tăng vốn", "HPG.VN"), "server adds the VN listing's short name");

  /* ---------------- the call a folded market shows on phones */
  assert.equal(V.mainCall([call("VCB.VN", "Banks"), call("^VNINDEX.VN", "VN-Index")], VN_GROUPS)?.ticker, "^VNINDEX.VN", "first group's benchmark");
  assert.equal(V.mainCall([call("QQQ", "Nasdaq 100"), call("^NDX", "Nasdaq 100")], US_GROUPS)?.ticker, "^NDX", "no S&P call: the next group's benchmark");
  assert.equal(V.mainCall([call("SPY", "S&P 500"), call("^NDX", "Nasdaq 100")], US_GROUPS)?.ticker, "SPY", "group without its benchmark call: that group's first call");
  assert.equal(V.mainCall([call("AAPL", "Apple")])?.ticker, "AAPL", "interest sets: the first call");
  assert.equal(V.mainCall([]), undefined);

  /* ---------------- GET /api/concepts */
  const store = await import("../../src/lib/store");
  await store.setJSON(C.conceptKey("inflation"), { slug: "inflation", term: "Inflation", plain: "Prices rising over time.", example: "A coffee costs more each year.", lang: "en", writtenAt: "2026-11-25T10:00:00Z" });
  await store.setJSON(C.conceptKey("lai-suat"), { slug: "lai-suat", term: "Lãi suất", plain: "Giá của tiền vay.", lang: "vi", writtenAt: "2026-11-25T10:00:00Z" });
  const route = await import("../../src/app/api/concepts/route");
  const get = async (qs: string) => {
    const r = await route.GET(new Request(`http://x/api/concepts?${qs}`));
    return { status: r.status, body: await r.json() };
  };
  for (const bad of ["", "slugs=", "slugs=inflation&lang=xx", "slugs=Inflation", "slugs=a_b", "slugs=..%2Fetc", `slugs=${"a".repeat(81)}`, `slugs=${Array.from({ length: 11 }, (_, i) => `s${i}`).join(",")}`]) {
    const r = await get(bad);
    assert.equal(r.status, 400, `rejects ${bad}`);
    assert.deepEqual(r.body, { error: "bad request" }, "generic error");
  }
  assert.equal((await get(`slugs=${Array.from({ length: 10 }, (_, i) => `s${i}`).join(",")}&lang=en`)).status, 200, "10 slugs is the max, allowed");
  let r = await get("slugs=inflation,unknown-thing&lang=en");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.concepts, [{ slug: "inflation", term: "Inflation", plain: "Prices rising over time.", example: "A coffee costs more each year.", lang: "en" }], "unknown slugs left out, no internal fields");
  assert.equal(trCalls, 0, "same language: no AI");
  r = await get("slugs=inflation&lang=vi");
  assert.equal(r.body.concepts[0].plain, "[vi] Prices rising over time.", "translated on first read");
  assert.equal(trCalls, 1);
  r = await get("slugs=inflation&lang=vi");
  assert.equal(trCalls, 1, "then cached for good");
  trDown = true;
  r = await get("slugs=lai-suat,inflation&lang=fr");
  assert.equal(r.status, 200, "a failed translation is not an error");
  assert.deepEqual(r.body.concepts, [], "untranslatable concepts are skipped");
  r = await get("slugs=lai-suat&lang=vi");
  assert.equal(r.body.concepts[0].term, "Lãi suất", "written in Vietnamese: served as is");

  // The card's % follows the strip's current quote; its snapshot only without one (prices agree everywhere).
{
  const { marketChange } = await import("../../src/lib/stories/view");
  assert.equal(marketChange({ changePct: 0.19 }, { changePct: -1.16 }), -1.16, "current quote wins");
  assert.equal(marketChange({ changePct: 0.19 }, undefined), 0.19, "snapshot without a quote");
  assert.equal(marketChange({ changePct: 0.19 }, { changePct: NaN }), 0.19, "a broken quote falls back");
}
console.log("D10 PAGE OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
