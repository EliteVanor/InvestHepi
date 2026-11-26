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
    stories: stories.map((n, i) => {
      const [, id, title] = blocks[i].match(/\[([^\]]+)\] [^:]*: ([^\n|]*)/)!;
      return { story: `S${n}`, title: `Card ${n}: ${title.trim()}`, what: `They reported: ${title.trim()}.`, why: `Why it matters: ${title.trim()}.`, markets: [], world: `Beyond markets: ${title.trim()}.`, past_id: null, different: "", concepts: [], source_ids: [id] };
    }),
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
  // Candidates (owner Q16): up to 10 important + twice the interesting quota go to the model, in rank order (ties:
  // clustering order); the model scores them and selectCards keeps 5 + 2 (pinned in scripts/v19/audit-q16.ts).
  assert.deepEqual(r1.explain.map((s) => s.id), ["c", "b", "e", "d", "a", "g", "i2", "f", "i1", "i3"], "candidates in rank order (ties: clustering order)");
  assert.deepEqual(r1.keep, []);
  // fewer interesting stories: every important candidate is still offered
  const onlyOne = S.filter((s) => s.id !== "i1" && s.id !== "i3");
  assert.deepEqual(P.pickForRun(onlyOne, {}, quotes, now).explain.map((s) => s.id), ["c", "b", "e", "d", "a", "g", "i2", "f"], "one interesting: all important candidates offered");
  // toModel caps the important candidates (interesting ones are still offered, up to twice their quota)
  assert.deepEqual(P.pickForRun(S, {}, quotes, now, { important: 5, interesting: 2, toModel: 3 }).explain.map((s) => s.id), ["c", "b", "e", "i2", "i1", "i3"], "only the top 3 important by score are candidates");
  // fresh cards are kept: under 12 h and fewer than 3 new outlets since; otherwise re-explained
  const cards = {
    b: card("b", "2026-11-25T08:00:00Z", 3), // 6 h old, 2 new outlets: fresh
    e: card("e", "2026-11-25T01:00:00Z", 4), // 13 h old: stale
    d: card("d", "2026-11-25T12:00:00Z", 0), // 3 new outlets: stale
  };
  const r2 = P.pickForRun(S, cards, quotes, now);
  assert.deepEqual(r2.keep.map((c) => c.id), ["b"]);
  assert.deepEqual(r2.keep[0].outlets, S[1].outlets, "a kept card shows the story's current outlets");
  assert.deepEqual(r2.explain.map((s) => s.id), ["c", "e", "d", "a", "g", "i2", "f", "i1", "i3"]);
  // My Interests: tagged stories only, up to 6, no interesting quota
  const I = [story("x", 3), story("t1", 1, "important", "Nvidia earnings", ["chips"]), story("t2", 2, "interesting", "Nvidia museum", ["chips"]), ...Array.from({ length: 6 }, (_, k) => story(`u${k}`, 1, "important", `Tagged ${k}`, ["chips"]))];
  const ri = P.pickForRun(I, {}, quotes, now, P.INTERESTS_PICK);
  assert.equal(ri.explain.length, 8, "all 8 tagged stories are candidates (up to 10); selectCards keeps 6");
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
  assert.match(d1.stories![0].title, /^Card 1:/, "cards in rank order");
  assert.ok(d1.stories![0].memberIds.some((id) => d1.news.find((n) => n.id === id)?.title.startsWith("TSM")), "TSM (6+% move named) ranks first");
  // v18 shape for old readers
  assert.equal(d1.analysis.headline, "Oil rose on an OPEC+ cut.");
  assert.deepEqual(d1.analysis.summary, d1.bigPicture!.slice(1), "the rest of the big picture: the headline isn't repeated (catch-up showed it twice, Nov 26)");
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
  // Every shown card fresh: still one AI call (owner Q14) for today's big picture, movers and watch line;
  // the fresh stories are only named as covered, and no card is rewritten.
  ai.length = 0;
  const d2b = await Pl.refreshShared("world", "en", T("2026-11-25T14:30:00Z"));
  assert.equal(ai.length, 1, "one call per run, even with nothing new to explain");
  assert.match(ai[0].user, /ALREADY COVERED[\s\S]*\n- /, "fresh stories are named as covered");
  assert.ok(!/\[[^\]]+\] Reuters: Central bank of Brazil/.test(ai[0].user), "no fresh story's headlines are sent again");
  assert.equal(d2b.stories!.length, 3);
  assert.deepEqual(d2b.stories!.map((c) => c.explainedAt), d2.stories!.map((c) => c.explainedAt), "no card rewritten");
  // D10: a kept card can still list its sources: every shown card's members are in Digest.news, once each.
  for (const c of d2b.stories!) assert.ok(c.memberIds.every((id) => d2b.news.some((n) => n.id === id)), `card ${c.id}: members in Digest.news`);
  assert.equal(new Set(d2b.news.map((n) => n.id)).size, d2b.news.length, "Digest.news has no duplicates with kept cards' members");

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

  const worldFeed = feed;
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

  // ---- 7. per-card translation: a card already translated is never sent again
  const Tr = await import("../../src/lib/translate");
  reply = (system, user) => (system.startsWith("You translate") ? JSON.stringify((JSON.parse(user) as string[]).map((t) => `vi:${t}`)) : explainReply(["Oil steadied.", "Japan exports fell.", "Rates in focus."])(system, user));
  const sentTexts = () => ai.filter((c) => c.system.startsWith("You translate")).flatMap((c) => JSON.parse(c.user) as string[]);
  const before = (await Pl.loadDigest("world", undefined, "en"))!;
  ai.length = 0;
  const t1 = await Pl.translateLatest("world", "vi");
  for (const c of before.stories!) assert.ok(sentTexts().includes(c.what), `card ${c.id} sent the first time`);
  assert.equal(sentTexts().filter((t) => t === before.bigPicture![0]).length, 1, "the big picture line and the v18 headline repeating it are sent once");
  assert.equal(t1!.analysis.headline, `vi:${before.bigPicture![0]}`);
  assert.equal(t1!.bigPicture![0], `vi:${before.bigPicture![0]}`);
  assert.equal(t1!.stories![0].what, `vi:${before.stories![0].what}`, "cards are translated");
  for (const c of before.stories!) assert.ok(await getJSON(Tr.cardTrKey(c, "vi")), "each card's translation is cached at tr:card:<scope>:<id>:<explainedAt>:<lang>");
  // A new run keeps those cards and adds new ones: translating it sends only the new cards' text.
  feed = [...worldFeed, { title: "Gold climbs as the dollar slips", source: "Reuters", at: "2026-11-25T15:30:00Z" }];
  const next = await Pl.refreshShared("world", "en", T("2026-11-25T16:00:00Z"));
  const keptIds = before.stories!.map((c) => c.id);
  const newCards = next.stories!.filter((c) => !keptIds.includes(c.id));
  assert.ok(newCards.length >= 1 && next.stories!.filter((c) => keptIds.includes(c.id)).length === 3, "3 cards kept, new ones added");
  ai.length = 0;
  const t2 = await Pl.translateLatest("world", "vi");
  const sent2 = sentTexts();
  for (const c of before.stories!) for (const sl of Tr.cardSlots(JSON.parse(JSON.stringify(c)))) assert.ok(!sent2.includes(sl.text), `kept card ${c.id}: "${sl.text}" not sent again`);
  assert.ok(!sent2.some((t) => before.stories!.some((c) => c.what === t)), "no kept card's text is sent");
  for (const c of newCards) assert.ok(sent2.includes(c.what), `new card ${c.id} is sent`);
  for (const c of t2!.stories!) assert.equal(c.what, `vi:${next.stories!.find((x) => x.id === c.id)!.what}`, "every card translated (kept ones from the cache)");
  const rs = await J.readStories("world", "vi");
  assert.ok(rs!.cards.every((c) => c.what.startsWith("vi:")), "readStories applies the cached card translations");
  assert.ok((await J.readStories("world", "en"))!.cards.every((c) => !c.what.startsWith("vi:")), "and the originals for English");

  console.log("D6 STORIES OK");
})();
