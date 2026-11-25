/** v19b D5: explainStories, the one AI call for story cards: prompt, fitting (row 22), schema and guards a-e. */
import assert from "node:assert/strict";
import { pinClock } from "../clock";

pinClock("2026-11-25T14:00:00Z");
process.env.VERCEL = "1";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LLM_PROVIDER;
delete process.env.GROQ_TPM;

const sent: { url: string; system: string; user: string }[] = [];
let reply = "{}";
let failAll = false;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("api.groq.com") || url.includes("generativelanguage")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    sent.push({ url, system: body.messages?.[0]?.content ?? "", user: body.messages?.[1]?.content ?? "" });
    if (failAll) return new Response("boom", { status: 500 });
    return new Response(JSON.stringify({ choices: [{ message: { content: reply } }], usage: { total_tokens: 100 } }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;

type NewsItem = import("../../src/lib/types").NewsItem;
type Story = import("../../src/lib/stories/types").Story;
type Quote = import("../../src/lib/types").Quote;

const item = (id: string, source: string, title: string, summary?: string): NewsItem => ({ id, title, source, link: `https://x/${id}`, publishedAt: "2026-11-25T12:00:00.000Z", summary });
const story = (id: string, members: NewsItem[], kind: "important" | "interesting" = "important"): Story => ({
  id,
  members,
  outlets: [...new Set(members.map((m) => m.source))],
  firstSeen: members[0].publishedAt,
  lastSeen: members[0].publishedAt,
  lang: "en",
  kind,
});
const quote = (symbol: string, price: number, changePct: number): Quote => ({ symbol, price, prevClose: price / (1 + changePct / 100), changePct, history: [["2026-11-24", price]], source: "nasdaq" });

const S = Array.from({ length: 10 }, (_, i) =>
  story(
    `st${i}`,
    Array.from({ length: 4 }, (_, j) =>
      item(`st${i}m${j}`, `Outlet${j}`, `Story ${i} headline ${j}: oil and rates move as markets weigh the news`, `Snippet ${i}.${j} with detail for readers, unique text marker SNIP${i}x${j} ${"lorem ipsum dolor ".repeat(6)}`),
    ),
  ),
);
S[0] = story("oil", [item("oil1", "Reuters", "Oil jumps 4.3% after OPEC+ cuts output by 1,700 barrels", "Brent rose to 82.15 dollars as OPEC+ agreed to cut 20% of the planned increase."), item("oil2", "AP", "OPEC+ agrees surprise cut; oil prices rise")]);
const quotes = [quote("CL=F", 71.2, 3.9), quote("SPY", 600.5, -0.4)];
const base = (over: Record<string, unknown> = {}) =>
  ({ scope: "world", section: "world", stories: S, covered: [], market: { quotes, macro: [] }, calendar: [{ date: "2026-12-10", kind: "macro", title: "FOMC decision", importance: 3 }], lang: "en", now: new Date("2026-11-25T14:00:00Z"), ...over }) as never;

const card = (o: Record<string, unknown> = {}) => ({ story: "S1", title: "Oil jumps after OPEC+ cut", what: "OPEC+ agreed to cut output.", why: "Fuel costs matter.", markets: [], world: "Drivers pay more.", past_id: null, different: "", concepts: ["OPEC+"], source_ids: ["oil1"], ...o });

(async () => {
  const E = await import("../../src/lib/stories/explain");
  const P = await import("../../src/lib/stories/past");
  const { HEADLINES_ARE_DATA, VN_RULES } = await import("../../src/lib/llm/prompt");

  // --- guards, pure ---
  // a. source ids must be members of that story
  assert.deepEqual(E.memberSources(["oil1", "st3m0", "x", "oil2", "oil1"], S[0]), ["oil1", "oil2"], "only members, deduped");
  assert.deepEqual(E.memberSources(["st3m0"], S[0]), [], "another story's id is not a source");
  // b. past id must be one of that story's candidates
  const ev = { id: "opec-2020", type: "oil_supply", date: "2020-04-12", region: "global", event: "OPEC+ record cut", move: "WTI -X%", source: "https://example.org", lesson: "l", keywords: ["opec"] };
  assert.equal(E.pastFor("opec-2020", [ev]), "opec-2020");
  assert.equal(E.pastFor("P:opec-2020", [ev]), "opec-2020", "the P: prefix is tolerated");
  assert.equal(E.pastFor("gfc-2008", [ev]), null, "an id that wasn't offered is dropped");
  assert.equal(E.pastFor(null, [ev]), null);
  // c. markets: tickers from the snapshot only, % from the snapshot
  const m = E.alignMarkets([{ ticker: "cl=f", direction: "up", text: "Oil rose." }, { ticker: "XOM", direction: "up", text: "Exxon." }], quotes);
  assert.deepEqual(m, [{ symbol: "CL=F", direction: "up", changePct: 3.9, text: "Oil rose." }], "XOM not in the snapshot; the model's % is never used");
  // d. untraceable numbers
  const hay = "Oil jumps 4,3% after OPEC+ cuts output by 1.700 barrels. Index at 25,668.12. 3 bn deal. Up 20%.";
  assert.deepEqual(E.untraceableNumbers("Oil rose 4.3% on a cut of 1,700 barrels; up 20% and 25,668 points in 2026 with 3 bn.", hay), [], "1.700 = 1,700, 4,3 = 4.3, rounding of 25,668.12, years and one digit ignored");
  assert.deepEqual(E.untraceableNumbers("Oil rose 5.1% and 12 ships sank; 1,800 barrels.", hay), ["5.1", "12", "1,800"]);
  assert.deepEqual(E.untraceableNumbers("In 1987 it fell 9 points.", ""), ["1987"], "1987 is outside 1990-2035");
  assert.equal(E.dropUntraceable("Oil rose 4.3%. Analysts expect 15% more. Drivers pay more.", hay), "Oil rose 4.3%. Drivers pay more.");
  assert.equal(E.dropUntraceable("Analysts expect 15% more.", hay), "");

  // --- past.ts ---
  assert.equal(P.LIBRARY_APPROVED, true, "approved by the owner");
  assert.ok(P.candidates(S[0], "world").every((e) => P.PAST_EVENTS.some((x) => x.id === e.id)), "candidates come only from the library");
  const evVn = { ...ev, id: "opec-vn", region: "vn", date: "2019-01-01", keywords: ["OPEC"] };
  const evOther = { ...ev, id: "fed", keywords: ["federal reserve"] };
  assert.deepEqual(P.candidates(S[0], "world", 3, { approved: true, events: [ev, evVn, evOther] }).map((e) => e.id), ["opec-2020", "opec-vn"]);
  assert.deepEqual(P.candidates(S[0], "vn", 3, { approved: true, events: [ev, evVn, evOther] }).map((e) => e.id), ["opec-vn", "opec-2020"], "vn section: region vn first");
  const vnStory = story("vn", [item("v1", "VnExpress", "Ngân hàng Nhà nước giảm lãi suất")]);
  assert.deepEqual(P.candidates(vnStory, "vn", 3, { approved: true, events: [{ ...ev, id: "sbv", keywords: ["lai suat"] }] }).map((e) => e.id), ["sbv"], "accent-insensitive");
  assert.equal(P.resolve("opec-2020", [ev])?.event, "OPEC+ record cut");

  // --- Gemini: full prompt, every story with its snippets ---
  process.env.GEMINI_API_KEY = "g";
  delete process.env.GROQ_API_KEY;
  reply = JSON.stringify({
    big_picture: ["Oil jumped 4.3% on an OPEC+ cut.", "Stocks slipped. Analysts see 15% more upside.", "Rates in focus before the Fed."],
    stories: [
      card({
        markets: [{ ticker: "CL=F", direction: "up", text: "Oil rose about 4%." }, { ticker: "XOM", direction: "up", text: "x" }],
        what: "OPEC+ cut output by 1,700 barrels. Some say 9,999 barrels.",
        past_id: "anything",
        source_ids: ["oil1", "st2m0"],
      }),
      card({ story: "S2", title: "Story 1", source_ids: ["oil1"] }),
      card({ story: 3, title: "Story 2", source_ids: ["st2m1"], concepts: ["a", "b", "c", "d"] }),
      card({ story: "S3", title: "duplicate", source_ids: ["st2m2"] }),
      card({ story: "S4", title: "Story 3", what: "It rose 9,999 points.", source_ids: ["st3m0"] }),
    ],
    movers: [{ ticker: "CL=F", why: "OPEC+ cut.", source_ids: ["oil1"] }, { ticker: "SPY", why: "Earnings beat.", source_ids: ["st1m0"] }, { ticker: "TSLA", why: "x", source_ids: [] }],
    watch: ["FOMC decision on 2026-12-10.", "A 77% chance of a cut."],
  });
  sent.length = 0;
  const r = await E.explainStories(base(), "shared");
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /generativelanguage/);
  for (let i = 1; i < 10; i++) for (let j = 0; j < 4; j++) assert.ok(sent[0].user.includes(`SNIP${i}x${j}`), `Gemini sees snippet ${i}.${j}`);
  assert.ok(sent[0].user.includes("[oil1] Reuters: Oil jumps 4.3% after OPEC+ cuts output by 1,700 barrels | Brent rose"), "member line: [id] outlet: title | snippet");
  assert.ok(sent[0].user.includes("[oil2] AP: OPEC+ agrees surprise cut; oil prices rise\n"), "no snippet, no bar");
  assert.match(sent[0].user, /S1 \(2 outlets/);
  assert.ok(sent[0].system.includes(HEADLINES_ARE_DATA), "headlines are data");
  assert.match(sent[0].system, /not clear from the reports/);
  assert.ok(!sent[0].system.includes(VN_RULES), "no Vietnam rules for World");
  assert.ok(sent[0].user.includes("FOMC decision"), "calendar in the prompt");
  assert.deepEqual(r.leftOut, [], "nothing left out for Gemini");
  assert.ok(!r.cards.some((c) => c.title === "Story 3"), "a card whose 'what happened' fails the number guard is dropped");
  assert.equal(r.provider.startsWith("gemini"), true);
  // cards: S1 kept (st2m0 dropped from sources), S2 dropped (oil1 isn't its member), S3 kept, duplicate S3 dropped
  assert.deepEqual(r.cards.map((c) => c.id), ["oil", "st2"]);
  const c0 = r.cards[0];
  assert.deepEqual(c0.markets, [{ symbol: "CL=F", direction: "up", changePct: 3.9, text: "Oil rose about 4%." }]);
  assert.equal(c0.what, "OPEC+ cut output by 1,700 barrels.", "the 9,999 sentence is dropped");
  assert.equal(c0.past, null, "a past_id that isn't one of the story's candidates is dropped");
  assert.deepEqual([c0.scope, c0.kind, c0.lang, c0.explainedAt, c0.outletsAtExplain], ["world", "important", "en", "2026-11-25T14:00:00.000Z", 2]);
  assert.deepEqual(c0.memberIds, ["oil1", "oil2"]);
  assert.deepEqual(c0.outlets, ["Reuters", "AP"]);
  assert.equal(r.cards[1].concepts.length, 3, "at most 3 concepts");
  assert.deepEqual(r.bigPicture, ["Oil jumped 4.3% on an OPEC+ cut.", "Stocks slipped.", "Rates in focus before the Fed."]);
  assert.deepEqual(r.watch, ["FOMC decision on 2026-12-10."]);
  // e. movers through alignMovers: snapshot %, backed reason only, unknown ticker dropped
  assert.deepEqual(r.movers.map((x) => [x.ticker, x.changePct]), [["CL=F", 3.9], ["SPY", -0.4]]);
  assert.equal(r.movers[0].why, "OPEC+ cut.");
  assert.match(r.movers[1].why, /No clear news/, "a headline that doesn't name SPY doesn't back its move");

  // --- Groq with a small budget: lowest-ranked stories drop whole ---
  delete process.env.GEMINI_API_KEY;
  process.env.GROQ_API_KEY = "q";
  process.env.GROQ_TPM = "5600";
  sent.length = 0;
  const g = await E.explainStories(base(), "shared");
  assert.match(sent[0].url, /groq/);
  assert.ok(g.leftOut.length > 0 && g.leftOut.length < 10, `some stories left out (${g.leftOut})`);
  const kept = S.filter((s) => !g.leftOut.includes(s.id));
  assert.deepEqual(kept.map((s) => s.id), S.slice(0, kept.length).map((s) => s.id), "the dropped ones are the lowest ranked");
  for (const s of S) {
    const shown = s.members.filter((mm) => sent[0].user.includes(`[${mm.id}]`)).length;
    assert.ok(shown === 0 || shown === s.members.length, `story ${s.id} is whole or absent (${shown})`);
    assert.equal(shown === 0, g.leftOut.includes(s.id), `leftOut matches the prompt for ${s.id}`);
  }
  const limit = 5600 * 0.94 - E.EXPLAIN_MAX_TOKENS;
  assert.ok(Math.ceil((sent[0].system + sent[0].user).length / 3) <= limit, "input + output fits the budget");
  process.env.GROQ_TPM = "100000";
  sent.length = 0;
  assert.deepEqual((await E.explainStories(base(), "shared")).leftOut, [], "a large budget keeps every story");
  delete process.env.GROQ_TPM;

  // --- Vietnam: Vietnamese text, VN rules ---
  sent.length = 0;
  await E.explainStories(base({ scope: "vn", section: "vn", lang: "vi" }), "shared");
  assert.ok(sent[0].system.includes(VN_RULES), "VN rules");
  assert.match(sent[0].system, /Vietnamese/);
  assert.ok(sent[0].system.includes(HEADLINES_ARE_DATA));

  // --- every model fails: throws ---
  failAll = true;
  await assert.rejects(E.explainStories(base(), "shared"), /All AI providers failed/);
  failAll = false;
  // a reply with no cards and no big picture is a failure, not an empty run
  reply = JSON.stringify({ big_picture: [], stories: [], movers: [], watch: [] });
  await assert.rejects(E.explainStories(base(), "shared"), /All AI providers failed/);

  console.log("D5 EXPLAIN OK");
})();
