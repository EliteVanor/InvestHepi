/** v19b D7: concept cards: slugs, one small call after the story call, the 10/day cap, failure, translate once. */
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
delete process.env.CONCEPTS_DAILY_LIMIT;

type NewsItem = import("../../src/lib/types").NewsItem;

// ---- fetch mock: Gemini answers the story call, the concepts call and translations by what the prompt says
const ai: { system: string; user: string }[] = [];
let down = false;
let storyConcepts: string[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("generativelanguage") || url.includes("api.groq.com")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const system: string = body.messages?.[0]?.content ?? "";
    const user: string = body.messages?.[1]?.content ?? "";
    ai.push({ system, user });
    let content: string;
    if (system.includes("concept cards")) {
      if (down) return new Response("down", { status: 503 });
      const terms = [...user.matchAll(/^\d+\. (.*)$/gm)].map((m) => m[1]);
      content = JSON.stringify({ concepts: terms.map((t) => ({ term: t, plain: `${t} means something simple.`, example: `Example of ${t}.` })) });
    } else if (system.startsWith("You translate")) {
      content = JSON.stringify((JSON.parse(user) as string[]).map((s) => `[vi] ${s}`));
    } else {
      const stories = [...user.matchAll(/^S(\d+) \(/gm)].map((m) => m[1]);
      const blocks = user.split(/^S\d+ \(/m).slice(1);
      content = JSON.stringify({
        big_picture: ["Markets weighed the news.", "Rates mattered.", "Prices moved."],
        stories: stories.map((n, i) => {
          const [, id, title] = blocks[i].match(/\[([^\]]+)\] [^:]*: ([^\n|]*)/)!;
          return { story: `S${n}`, title: `Card ${n}: ${title.trim()}`, what: "They reported it.", why: "It may matter.", markets: [], world: "Beyond markets.", past_id: null, different: "", concepts: storyConcepts, source_ids: [id] };
        }),
        movers: [],
        watch: ["The next data release."],
      });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 100 } }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;

const T = (iso: string) => new Date(iso);
const conceptCalls = () => ai.filter((a) => a.system.includes("concept cards"));
const trCalls = () => ai.filter((a) => a.system.startsWith("You translate"));
const termsOf = (c: { user: string }) => [...c.user.matchAll(/^\d+\. (.*)$/gm)].map((m) => m[1]);
const item = (id: string, source: string, title: string): NewsItem => ({ id, title, source, link: `https://x/${id}`, publishedAt: "2026-11-27T09:30:00.000Z" });

(async () => {
  await fs.rm(process.env.STORE_DIR || "/tmp/invest-helper", { recursive: true, force: true });
  const C = await import("../../src/lib/stories/concepts");
  const { getJSON } = await import("../../src/lib/store");

  // ---- 1. slug folding
  assert.equal(C.conceptSlug("Lãi suất"), "lai-suat");
  assert.equal(C.conceptSlug("lai suat"), "lai-suat");
  assert.equal(C.conceptSlug("  Đồng  USD!! "), "dong-usd");
  assert.equal(C.conceptSlug("Quantitative Easing (QE)"), "quantitative-easing-qe");
  assert.equal(C.conceptSlug("???"), "");

  // ---- 2. one call for all new terms; deduped by slug; blank terms ignored
  const now = T("2026-11-25T14:00:00Z");
  let got = await C.writeConcepts(["Inflation", "inflation", "Lãi suất", "lai suat", "  "], "en", "shared", now);
  assert.equal(conceptCalls().length, 1, "one call for all");
  assert.deepEqual(termsOf(conceptCalls()[0]), ["Inflation", "Lãi suất"], "deduped by slug, first spelling kept");
  assert.deepEqual(got, ["inflation", "lai-suat"]);
  const stored = await getJSON<import("../../src/lib/stories/concepts").Concept>("concept:inflation");
  assert.equal(stored!.lang, "en");
  assert.equal(stored!.term, "Inflation");
  assert.match(stored!.plain, /means something simple/);
  assert.equal(stored!.example, "Example of Inflation.");
  assert.equal(stored!.writtenAt, now.toISOString());
  assert.deepEqual(await getJSON("concepts:new:2026-11-25"), { n: 2 });

  // ---- 3. already stored: not asked again; only the new one goes
  ai.length = 0;
  got = await C.writeConcepts(["Inflation", "Yield curve"], "en", "shared", now);
  assert.deepEqual(termsOf(conceptCalls()[0]), ["Yield curve"]);
  assert.deepEqual(got, ["inflation", "yield-curve"]);
  ai.length = 0;
  got = await C.writeConcepts(["inflation", "YIELD CURVE"], "en", "shared", now);
  assert.equal(ai.length, 0, "nothing new: no call");
  assert.deepEqual(got, ["inflation", "yield-curve"]);
  assert.deepEqual(await getJSON("concepts:new:2026-11-25"), { n: 3 });

  // ---- 4. the cap: 10 new a day across calls; the next UTC day starts again
  ai.length = 0;
  const many = Array.from({ length: 12 }, (_, i) => `Term ${String.fromCharCode(97 + i)}`);
  got = await C.writeConcepts(many, "en", "shared", now);
  assert.equal(termsOf(conceptCalls()[0]).length, 7, "10 - 3 already written today");
  assert.deepEqual(termsOf(conceptCalls()[0]), many.slice(0, 7));
  assert.deepEqual(await getJSON("concepts:new:2026-11-25"), { n: 10 });
  ai.length = 0;
  got = await C.writeConcepts(many, "en", "shared", T("2026-11-25T23:59:00Z"));
  assert.equal(ai.length, 0, "cap reached: no call");
  assert.deepEqual(got, many.slice(0, 7).map(C.conceptSlug), "only what is stored comes back");
  got = await C.writeConcepts(many, "en", "shared", T("2026-11-26T00:01:00Z"));
  assert.deepEqual(termsOf(conceptCalls()[0]), many.slice(7), "next UTC day: the rest go");
  assert.equal(got.length, 12);
  assert.deepEqual(await getJSON("concepts:new:2026-11-26"), { n: 5 });

  // ---- 5. AI failure: [] and no count spent; the story run still succeeds (and the stored cards are kept)
  ai.length = 0;
  down = true;
  assert.deepEqual(await C.writeConcepts(["Brand new idea"], "en", "shared", T("2026-11-26T10:00:00Z")), []);
  assert.ok(conceptCalls().length >= 1);
  assert.deepEqual(await getJSON("concepts:new:2026-11-26"), { n: 5 }, "a failed call spends nothing");
  assert.equal(await getJSON("concept:brand-new-idea"), null);
  down = false;

  const J = await import("../../src/lib/stories/job");
  const run = (at: string, headlines: NewsItem[]) => J.runStories("world", { section: "world", headlines, route: "shared", now: T(at), market: { quotes: [] }, calendar: [] });
  const h1 = [item("a1", "Reuters", "Fed holds rates steady as inflation cools"), item("a2", "BBC", "Fed holds rates steady as inflation cools")];
  ai.length = 0;
  storyConcepts = ["Yield spread", "Soft landing"];
  const ok = await run("2026-11-27T10:00:00Z", h1);
  assert.equal(ok.cards.length, 1, "the story run succeeds");
  assert.deepEqual(ok.cards[0].concepts, ["Yield spread", "Soft landing"]);
  assert.equal(conceptCalls().length, 1, "the concepts call follows the story call in the same run");
  assert.deepEqual(termsOf(conceptCalls()[0]), ["Yield spread", "Soft landing"]);
  assert.ok(await getJSON("concept:soft-landing"));

  const h2 = [item("b1", "Reuters", "Tokyo stocks slide on weak exports"), item("b2", "BBC", "Tokyo stocks slide on weak exports")];
  ai.length = 0;
  down = true;
  storyConcepts = ["Trade deficit"];
  const ok2 = await run("2026-11-27T11:00:00Z", h2).catch((e) => e);
  assert.ok(!(ok2 instanceof Error), "concept failure never fails the run");
  down = false;
  assert.equal(ok2.cards.length, 1);
  assert.equal(await getJSON("concept:trade-deficit"), null, "not written");

  // ---- 6. loadConcepts: same language as written is free; another language is translated once, then cached
  ai.length = 0;
  const en = await C.loadConcepts(["inflation", "nope", "yield-curve"], "en");
  assert.deepEqual(en.map((c) => c.slug), ["inflation", "yield-curve"], "unknown slugs skipped");
  assert.equal(ai.length, 0, "no call in the written language");
  const vi1 = await C.loadConcepts(["inflation", "yield-curve", "nope"], "vi");
  assert.equal(trCalls().length, 1, "one translation request for both");
  assert.deepEqual(vi1.map((c) => c.slug), ["inflation", "yield-curve"]);
  assert.equal(vi1[0].term, "[vi] Inflation");
  assert.equal(vi1[0].plain, "[vi] Inflation means something simple.");
  assert.equal(vi1[0].example, "[vi] Example of Inflation.");
  assert.equal(vi1[0].lang, "vi");
  assert.equal((await getJSON<{ term: string }>("concept:inflation:vi"))!.term, "[vi] Inflation", "cached at concept:<slug>:<lang>");
  assert.equal((await getJSON<{ lang: string }>("concept:inflation"))!.lang, "en", "the original is untouched");
  ai.length = 0;
  const vi2 = await C.loadConcepts(["inflation", "yield-curve"], "vi");
  assert.equal(ai.length, 0, "second read sends nothing");
  assert.deepEqual(vi2, vi1);
  // a translation failure skips the concept instead of throwing
  down = true;
  const globalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;
  assert.deepEqual(await C.loadConcepts(["term-a"], "fr"), []);
  globalThis.fetch = globalFetch;

  console.log("D7 CONCEPTS OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
