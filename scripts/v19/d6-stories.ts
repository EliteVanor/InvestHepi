/** v19b D6: the story job (pick, store, runStories), wired into buildDigest; Vietnam written in Vietnamese. */
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

  // ---- 2. ids carry over from the tick to the run
  const H = await import("../../src/lib/headlines");
  const { getJSON } = await import("../../src/lib/store");
  feed = [
    { title: "Oil jumps after OPEC+ agrees surprise output cut", source: "Reuters", at: "2026-11-25T10:00:00Z" },
    { title: "Oil jumps after OPEC+ agrees surprise output cut today", source: "AP", at: "2026-11-25T11:00:00Z" },
    { title: "TSM shares jump on record chip demand", source: "Bloomberg", at: "2026-11-25T11:30:00Z" },
  ];
  await H.refreshHeadlines(T("2026-11-25T12:00:00Z"));
  const idx1 = await getJSON<{ stories: { id: string; memberIds: string[] }[] }>("stories:world");
  assert.ok(idx1, "the tick saves the story index");
  const oil = idx1!.stories.find((s) => s.memberIds.length === 2)!;
  assert.ok(oil, "the two oil headlines are one story");
  const live = await H.loadHeadlines("world");
  assert.equal(live!.items.length, 2, "the live list has one headline per story");
  // The first outlet's copy drops out of the feed; the story keeps its id (it shares the AP headline).
  feed = feed.slice(1);

  // ---- 3. a World run end to end
  const Pl = { ...(await import("../../src/lib/pipeline")), ...(await import("../../src/lib/briefings")) };
  reply = explainReply(["Oil rose on an OPEC+ cut.", "Chip stocks gained.", "Rates in focus."], (user) => {
    const tsmId = user.match(/\[([^\]]+)\] Bloomberg: TSM/)?.[1];
    if (!tsmId) return [];
    return [{ ticker: "TSM", why: "Record chip demand.", source_ids: [tsmId] }, { ticker: "BABA", why: "x", source_ids: [tsmId] }];
  });
  ai.length = 0;
  const d1 = await Pl.refreshShared("world", "en", T("2026-11-25T13:00:00Z"));
  assert.equal(ai.length, 1, "one AI call");
  assert.match(ai[0].system, /news explainer/);
  assert.ok(!/LANGUAGE:/.test(ai[0].system), "World is written in English");
  assert.equal(d1.provider, "gemini:gemini-3.5-flash-lite");
  assert.equal(d1.language, "en");
  assert.deepEqual(d1.stories!.map((c) => c.id).sort(), [oil.id, idx1!.stories.find((s) => s.id !== oil.id)!.id].sort(), "card ids are the tick's story ids (carried over)");
  assert.deepEqual(d1.bigPicture, ["Oil rose on an OPEC+ cut.", "Chip stocks gained.", "Rates in focus."]);
  assert.equal(d1.stories![0].title, "Card 1", "cards in rank order");
  assert.ok(d1.stories![0].memberIds.some((id) => d1.news.find((n) => n.id === id)?.title.startsWith("TSM")), "TSM (6+% move named) ranks first");
  // v18 shape for old readers
  assert.equal(d1.analysis.headline, "Oil rose on an OPEC+ cut.");
  assert.deepEqual(d1.analysis.summary, d1.bigPicture);
  assert.deepEqual(d1.analysis.events, []);
  assert.deepEqual(d1.analysis.watchNext, ["The next data release."]);
  assert.ok(["risk-on", "risk-off", "mixed"].includes(d1.analysis.mood));
  assert.equal(d1.analysis.mood, Pl.moodOf(d1.gauge?.score));
  assert.deepEqual([Pl.moodOf(60), Pl.moodOf(59), Pl.moodOf(40), Pl.moodOf(41), Pl.moodOf(undefined)], ["risk-on", "mixed", "risk-off", "mixed", "mixed"]);
  // movers: snapshot %, and sourceIds point at the right Digest.news items
  const tsm = d1.analysis.movers.find((m) => m.ticker === "TSM")!;
  assert.ok(Math.abs(tsm.changePct - 5) < 1e-9, `TSM's % from the snapshot (${tsm.changePct})`);
  assert.equal(tsm.why, "Record chip demand.");
  assert.equal(d1.news[tsm.sourceIds![0]].title, "TSM shares jump on record chip demand", "the mover's sourceId indexes Digest.news");
  assert.match(d1.analysis.movers.find((m) => m.ticker === "BABA")!.why, /No clear news/, "alignMovers' headline guard still applies (the TSM headline doesn't name BABA)");
  assert.equal(new Set(d1.news.map((n) => n.id)).size, d1.news.length, "Digest.news has no duplicates");
  assert.equal((await getJSON<{ cardIds: string[] }>("stories:world:run"))!.cardIds.length, 2);
  assert.ok(await getJSON(`story:world:${oil.id}`), "cards stored at story:<scope>:<id>");

  // ---- 4. an hour later, same headlines plus a new story: cards kept, only the new story goes to the model
  feed = [...feed, { title: "Central bank of Brazil holds rates steady", source: "Reuters", at: "2026-11-25T13:30:00Z" }];
  ai.length = 0;
  const d2 = await Pl.refreshShared("world", "en", T("2026-11-25T14:00:00Z"));
  assert.equal(ai.length, 1);
  assert.match(ai[0].user, /Central bank of Brazil/, "the new story is sent");
  assert.ok(!/OPEC|TSM shares/.test(ai[0].user.split("STORIES")[1]), "stories with fresh cards are not sent again");
  assert.equal(d2.stories!.length, 3, "kept + new cards");
  const keptOil = d2.stories!.find((c) => c.id === oil.id)!;
  assert.equal(keptOil.explainedAt, d1.stories!.find((c) => c.id === oil.id)!.explainedAt, "the oil card is the earlier one");
  // Every shown card fresh: no AI call, the last lines kept.
  ai.length = 0;
  const d2b = await Pl.refreshShared("world", "en", T("2026-11-25T14:30:00Z"));
  assert.equal(ai.length, 0, "nothing new: no AI call");
  assert.equal(d2b.stories!.length, 3);
  assert.deepEqual(d2b.bigPicture, d2.bigPicture);
  assert.match(d2b.providerNote ?? "", /No new stories/);

  // ---- 5. AI down: rule-based analysis, the stored AI briefing (with its stories) kept
  feed = [...feed, { title: "Japan exports fall for a third month", source: "Nikkei", at: "2026-11-25T14:40:00Z" }];
  aiDown = true;
  const d3 = await Pl.refreshShared("world", "en", T("2026-11-25T15:00:00Z"));
  aiDown = false;
  assert.equal(d3.provider, "rules");
  assert.equal(d3.keptAi, true);
  assert.equal(d3.stories, undefined, "the rule-based copy has no cards");
  assert.ok(d3.analysis.summary.length > 0, "rule-based summary as before");
  const shown = await Pl.loadDigest("world", undefined, "en");
  assert.equal(shown!.generatedAt, d2b.generatedAt, "readers keep the last AI briefing");
  assert.equal(shown!.stories!.length, 3, "with its stories");
  const J = await import("../../src/lib/stories/job");
  const read = await J.readStories("world", "en");
  assert.deepEqual(read!.cards.map((c) => c.id), d2b.stories!.map((c) => c.id), "readStories: the last run's cards, in order");

  // ---- 6. Vietnam: written in Vietnamese, not pre-translated into Vietnamese, translated on read
  feed = [
    { title: "VN-Index tăng mạnh nhờ nhóm ngân hàng", source: "VnExpress", at: "2026-11-25T08:00:00Z" },
    { title: "Ngân hàng Nhà nước giữ nguyên lãi suất điều hành", source: "VnExpress", at: "2026-11-25T07:00:00Z" },
  ];
  reply = (system, user) => (system.startsWith("You translate") ? JSON.stringify((JSON.parse(user) as string[]).map((t) => `en:${t}`)) : explainReply(["Thị trường tăng.", "Ngân hàng dẫn dắt.", "Chờ dữ liệu."])(system, user));
  ai.length = 0;
  const v = await Pl.refreshShared("vn", "en", T("2026-11-25T09:00:00Z"));
  assert.equal(ai.length, 1);
  assert.match(ai[0].system, /LANGUAGE: Write every text value .* in Vietnamese/, "the Vietnam run asks for Vietnamese");
  assert.equal(v.language, "vi");
  assert.equal(v.analysis.headline, "Thị trường tăng.");
  assert.equal(v.stories![0].lang, "vi");
  ai.length = 0;
  const vi = await Pl.translateLatest("vn", "vi");
  assert.equal(ai.length, 0, "Vietnamese readers get the original: nothing to translate");
  assert.equal(vi!.generatedAt, v.generatedAt);
  const enRead = await Pl.loadDigest("vn", undefined, "en");
  assert.equal(enRead!.language, "vi", "before a translation exists, English readers get the original (the page then asks for one)");
  const en = await Pl.translateLatest("vn", "en");
  assert.ok(ai.length > 0 && ai.every((c) => c.system.includes("into English")), "translated from Vietnamese into English on read");
  assert.equal(en!.language, "en");
  assert.equal(en!.translatedFrom, "vi");
  assert.equal(en!.analysis.headline, "en:Thị trường tăng.");
  const enAgain = await Pl.loadDigest("vn", undefined, "en");
  assert.equal(enAgain!.analysis.headline, "en:Thị trường tăng.", "the cached English copy is what English readers then get");

  console.log("D6 STORIES OK");
})();
