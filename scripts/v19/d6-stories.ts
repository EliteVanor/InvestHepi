/** v19b D6: the story job, step 1: pickForRun (ranking, quotas, fresh cards, My Interests). */
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import { pinClock } from "../clock";

pinClock("2026-11-25T14:00:00Z");
process.env.VERCEL = "1";
process.env.GEMINI_API_KEY = "g";
delete process.env.GROQ_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LLM_PROVIDER;
delete process.env.GROQ_TPM;

type NewsItem = import("../../src/lib/types").NewsItem;
type Story = import("../../src/lib/stories/types").Story;
type StoryCard = import("../../src/lib/stories/types").StoryCard;
type Quote = import("../../src/lib/types").Quote;

// ---- fetch mock: one feed (BBC World / VnExpress) carries the headlines, prices from a Yahoo spark batch, the AI is Gemini
const ai: { system: string; user: string }[] = [];
let aiDown = false;
let reply: (system: string, user: string) => string = () => "{}";
let feed: { title: string; source: string; at: string }[] = [];
const rss = (items: typeof feed) =>
  `<?xml version="1.0"?><rss><channel>${items.map((i) => `<item><title>${i.title}</title><link>https://n/${encodeURIComponent(i.title)}</link><source>${i.source}</source><pubDate>${new Date(i.at).toUTCString()}</pubDate></item>`).join("")}</channel></rss>`;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("generativelanguage") || url.includes("api.groq.com")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const system = body.messages?.[0]?.content ?? "";
    const user = body.messages?.[1]?.content ?? "";
    ai.push({ system, user });
    if (aiDown) return new Response("down", { status: 503 });
    return new Response(JSON.stringify({ choices: [{ message: { content: reply(system, user) } }], usage: { total_tokens: 100 } }), { status: 200 });
  }
  if (url.includes("/v8/finance/spark")) {
    const syms = decodeURIComponent(url.split("symbols=")[1].split("&")[0]).split(",");
    const day = Date.UTC(2026, 10, 24, 21) / 1000;
    const ts = Array.from({ length: 30 }, (_, i) => day - (29 - i) * 86400);
    return new Response(JSON.stringify(Object.fromEntries(syms.map((s) => [s, { timestamp: ts, close: ts.map((_, i) => (s === "TSM" && i === 29 ? 105 : 100)), chartPreviousClose: 100 }]))), { status: 200 });
  }
  if (url.includes("bbci.co.uk") || url.includes("vnexpress.net")) return new Response(rss(feed), { status: 200 });
  if (/rss|news\.google|feeds|\.xml|\/rss/.test(url)) return new Response(rss([]), { status: 200 });
  return new Response("{}", { status: 404 });
}) as typeof fetch;

const T = (iso: string) => new Date(iso);
const item = (id: string, source: string, title: string, at = "2026-11-25T12:00:00Z", tags?: string[]): NewsItem => ({ id, title, source, link: `https://x/${id}`, publishedAt: new Date(at).toISOString(), ...(tags ? { tags } : {}) });
const story = (id: string, outlets: number, kind: "important" | "interesting" = "important", title = `Story ${id} news`, tags?: string[]): Story => {
  const members = Array.from({ length: outlets }, (_, j) => item(`${id}m${j}`, `Outlet${j}`, title, undefined, tags));
  return { id, members, outlets: members.map((m) => m.source), firstSeen: members[0].publishedAt, lastSeen: members[0].publishedAt, lang: "en", kind };
};
const quote = (symbol: string, changePct: number): Quote => ({ symbol, price: 100, prevClose: 100, changePct, history: [["2026-11-24", 100]], source: "nasdaq" });
const card = (id: string, explainedAt: string, outletsAtExplain: number): StoryCard => ({ id, scope: "world", kind: "important", lang: "en", explainedAt, outletsAtExplain, title: id, outlets: [], what: "w", why: "y", markets: [], world: "", past: null, concepts: [], memberIds: [] });

/** A reply that explains every story in the prompt (cites its first headline) and names the movers asked for. */
const explainReply = (bigPicture: string[], movers: (user: string) => { ticker: string; why: string; source_ids: string[] }[] = () => []) => (_s: string, user: string) => {
  const stories = [...user.matchAll(/^S(\d+) \(/gm)].map((m) => m[1]);
  const blocks = user.split(/^S\d+ \(/m).slice(1);
  return JSON.stringify({
    big_picture: bigPicture,
    stories: stories.map((n, i) => ({ story: `S${n}`, title: `Card ${n}`, what: "The outlets reported it.", why: "It matters.", markets: [], world: "Not clear from the reports.", past_id: null, different: "", concepts: [], source_ids: [blocks[i].match(/\[([^\]]+)\]/)![1]] })),
    movers: movers(user),
    watch: ["The next data release."],
  });
};

(async () => {
  await fs.rm(process.env.STORE_DIR || "/tmp/invest-helper", { recursive: true, force: true });
  const P = await import("../../src/lib/stories/pick");

  // ---- 1. pick: ranking, quotas, fresh cards, My Interests
  const now = T("2026-11-25T14:00:00Z");
  const quotes = [quote("TSM", 6), quote("SPY", -0.4)];
  const S = [
    story("a", 2), story("b", 5), story("c", 1, "important", "TSM shares jump on chip demand"), story("d", 3), story("e", 4), story("f", 1), story("g", 2),
    story("i1", 1, "interesting"), story("i2", 2, "interesting"), story("i3", 1, "interesting"),
  ];
  assert.equal(P.storyScore(S[2], quotes), 1 + 6, "outlets + the largest move of a ticker its headlines name");
  assert.equal(P.storyScore(S[0], quotes), 2);
  const r1 = P.pickForRun(S, {}, quotes, now, P.SHARED_PICK);
  assert.deepEqual(r1.explain.map((s) => s.id), ["c", "b", "e", "d", "a", "i2", "i1"], "5 important by score + the 2 best interesting, in rank order (ties: clustering order)");
  assert.deepEqual(r1.keep, []);
  // fewer interesting than the quota: important fill in
  const onlyOne = S.filter((s) => s.id !== "i1" && s.id !== "i3");
  assert.deepEqual(P.pickForRun(onlyOne, {}, quotes, now).explain.map((s) => s.id), ["c", "b", "e", "d", "a", "g", "i2"], "one interesting: a 6th important fills the 7th place");
  // toModel caps the candidates (interesting ones are still offered)
  assert.deepEqual(P.pickForRun(S, {}, quotes, now, { important: 5, interesting: 2, toModel: 3 }).explain.map((s) => s.id), ["c", "b", "e", "i2", "i1"], "only the top 3 by score compete for the important places");
  // fresh cards are kept: under 12 h and fewer than 3 new outlets since; otherwise re-explained
  const cards = {
    b: card("b", "2026-11-25T08:00:00Z", 3), // 6 h old, 2 new outlets: fresh
    e: card("e", "2026-11-25T01:00:00Z", 4), // 13 h old: stale
    d: card("d", "2026-11-25T12:00:00Z", 0), // 3 new outlets: stale
  };
  const r2 = P.pickForRun(S, cards, quotes, now);
  assert.deepEqual(r2.keep.map((c) => c.id), ["b"]);
  assert.deepEqual(r2.keep[0].outlets, S[1].outlets, "a kept card shows the story's current outlets");
  assert.deepEqual(r2.explain.map((s) => s.id), ["c", "e", "d", "a", "i2", "i1"]);
  // My Interests: tagged stories only, up to 6, no interesting quota
  const I = [story("x", 3), story("t1", 1, "important", "Nvidia earnings", ["chips"]), story("t2", 2, "interesting", "Nvidia museum", ["chips"]), ...Array.from({ length: 6 }, (_, k) => story(`u${k}`, 1, "important", `Tagged ${k}`, ["chips"]))];
  const ri = P.pickForRun(I, {}, quotes, now, P.INTERESTS_PICK);
  assert.equal(ri.explain.length, 6, "at most 6");
  assert.ok(!ri.explain.some((s) => s.id === "x"), "untagged stories are left out");
  assert.equal(ri.explain[0].id, "t2", "interesting counts like any other story there (2 outlets ranks first)");

  console.log("D6 STORIES OK");
})();
