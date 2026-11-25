/** v19 F: loose ends. F1 catch-up, morning email and Ask AI read story cards (v18 digests unchanged). */
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

type Digest = import("../../src/lib/types").Digest;
type StoryCard = import("../../src/lib/stories/types").StoryCard;

const card = (id: string, title: string, what: string, why: string): StoryCard => ({ id, scope: "world", kind: "important", lang: "en", explainedAt: "2026-11-25T12:00:00Z", outletsAtExplain: 3, title, outlets: ["Reuters"], what, why, markets: [], world: "", past: null, concepts: [], memberIds: [] });
const base = (over: Partial<Digest>): Digest =>
  ({
    section: "interests", generatedAt: "2026-11-25T12:00:00Z", provider: "gemini:x", news: [], quotes: [], feedErrors: [],
    analysis: { headline: "Head", mood: "mixed", summary: ["s1"], events: [], outlook: [], watchNext: [], movers: [] },
    ...over,
  }) as unknown as Digest;
const v19 = base({
  bigPicture: ["Big one."],
  stories: [card("s1", "Chipmaker beats forecasts", "The chipmaker reported record sales.", "Chip demand drives indexes."), card("s2", "Oil slips", "Crude fell 2%.", "Cheaper fuel eases inflation.")],
});
const v18 = base({
  analysis: { headline: "Head", mood: "mixed", summary: ["s1"], events: [{ title: "Fed holds rates", whyItMatters: "Rates steady.", importance: 4, impacts: [{ interest: "Banks", direction: "up", confidence: 60 }], whatCouldGoWrong: "x" }], outlook: [], watchNext: [], movers: [] },
} as unknown as Partial<Digest>);

// ---- fetch mock for F2: Gemini answers the story call, the concepts call and translations by what the prompt says
const ai: { system: string; user: string }[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("generativelanguage") || url.includes("api.groq.com")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const system: string = body.messages?.[0]?.content ?? "";
    const user: string = body.messages?.[1]?.content ?? "";
    ai.push({ system, user });
    let content: string;
    if (system.includes("concept cards")) {
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
          return { story: `S${n}`, title: `Card ${n}: ${title.trim()}`, what: "They reported it.", why: "It may matter.", markets: [], world: "Beyond markets.", past_id: null, different: "", concepts: [CONCEPT[0]], source_ids: [id] };
        }),
        movers: [],
        watch: ["The next data release."],
      });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 100 } }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;
const CONCEPT = ["Yield curve"];
const trCalls = () => ai.filter((a) => a.system.startsWith("You translate"));

(async () => {
  await fs.rm(process.env.STORE_DIR || "/tmp/invest-helper", { recursive: true, force: true });
  const { newsItemsOf } = await import("../../src/lib/stories/view");
  const { makeT } = await import("../../src/lib/i18n");
  const t = makeT("en");

  // ---- F1a. the one helper
  assert.deepEqual(newsItemsOf(v19).map((i) => [i.key, i.title, i.detail, i.why]), [
    ["s1", "Chipmaker beats forecasts", "The chipmaker reported record sales.", "Chip demand drives indexes."],
    ["s2", "Oil slips", "Crude fell 2%.", "Cheaper fuel eases inflation."],
  ], "v19: story cards (title, what, why)");
  assert.deepEqual(newsItemsOf(v18).map((i) => [i.title, i.detail]), [["Fed holds rates", "Rates steady."]], "v18: key events");
  assert.deepEqual(newsItemsOf(null), []);
  assert.equal(newsItemsOf({ ...v19, stories: [] }).length, 0, "a v19 digest with no cards and no events is empty");

  // ---- F1b. catch-up diff: the same filter the component runs (titles seen at the last visit)
  const seen = newsItemsOf(v19).slice(0, 1).map((i) => i.title);
  assert.deepEqual(newsItemsOf(v19).filter((e) => !seen.includes(e.title)).map((e) => e.title), ["Oil slips"], "a new story is listed");
  const cu = await fs.readFile("src/components/catchup.tsx", "utf8");
  assert.ok(cu.includes("newsItemsOf(digest)") && cu.includes("newsItemsOf(d)") && cu.includes("digest.stories"), "catch-up diff and slides read stories");

  // ---- F1c. morning email
  const { renderMorning } = await import("../../src/lib/alerts");
  const ctxOf = (d: Digest) => ({ interests: [], calls: [], digests: { interests: d }, calendar: [], trackSummary: undefined }) as never;
  const m19 = renderMorning(ctxOf(v19), t, "en", new Date());
  assert.ok(m19.html.includes("Chipmaker beats forecasts") && m19.html.includes("Chip demand drives indexes."), "v19 email lists the top story and why");
  assert.ok(m19.html.includes(t("story.heading")) && !m19.html.includes(t("events.title")), "v19 section title");
  const m18 = renderMorning(ctxOf(v18), t, "en", new Date());
  assert.ok(m18.html.includes("Fed holds rates") && m18.html.includes(t("events.title")), "v18 email still lists events");
  const many = base({ stories: Array.from({ length: 6 }, (_, i) => card(`m${i}`, `Story number ${i}`, "w", "y")) });
  const mm = renderMorning(ctxOf(many), t, "en", new Date()).html;
  assert.ok(mm.includes("Story number 2") && !mm.includes("Story number 3"), "up to 3 stories");

  // ---- F1d. Ask context and suggestions
  const { buildAskContext } = await import("../../src/lib/ask");
  const c19 = buildAskContext([v19], [], "n/a").text;
  assert.ok(c19.includes("The chipmaker reported record sales.") && c19.includes("Chipmaker beats forecasts") && c19.includes("Cheaper fuel eases inflation."), "Ask context has story cards");
  const c7 = buildAskContext([base({ stories: Array.from({ length: 9 }, (_, i) => card(`k${i}`, `Card title ${i}`, "w", "y")) })], [], "n/a").text;
  assert.ok(c7.includes("Card title 6") && !c7.includes("Card title 7"), "max 7 cards");
  assert.ok(!buildAskContext([v18], [], "n/a").text.includes("Stories:"), "v18 context unchanged");
  const { suggestionsFor } = await import("../../src/components/ask");
  const calls = [{ interest: "Banks", ticker: "X", action: "WAIT", horizon: "week", direction: "flat" }] as never[];
  const s19 = suggestionsFor(t, v19, [], "world", calls);
  assert.ok(s19[0].includes("Chipmaker beats forecasts"), `first suggestion names the top story: ${s19[0]}`);
  const s18 = suggestionsFor(t, v18, [], "world", calls);
  assert.ok(s18[0].includes("Fed holds rates"), `v18 still the top event: ${s18[0]}`);

  // ---- F2. World and US pre-translate the run's new concepts into Vietnamese; Vietnam and interest sets don't
  const J = await import("../../src/lib/stories/job");
  const { getJSON } = await import("../../src/lib/store");
  const item = (id: string, source: string, title: string) => ({ id, title, source, link: `https://x/${id}`, publishedAt: "2026-11-25T12:00:00.000Z" });
  const run = (scope: "world" | "us" | "vn" | `ib:${string}`, section: "world" | "us" | "vn" | "interests", title: string) =>
    J.runStories(scope, { section, headlines: [item(`${scope}-${title.length}a`, "Reuters", title), item(`${scope}-${title.length}b`, "AP", title)], route: "shared", now: new Date("2026-11-25T14:00:00Z"), market: { quotes: [] }, calendar: [] });

  CONCEPT[0] = "Yield curve";
  ai.length = 0;
  await run("world", "world", "Treasury yields move after the auction");
  assert.equal(trCalls().length, 1, "World: one translation call for the new concept");
  assert.equal((await getJSON<{ lang: string; plain: string }>("concept:yield-curve:vi"))?.lang, "vi", "cached at concept:<slug>:vi");
  assert.match((await getJSON<{ plain: string }>("concept:yield-curve:vi"))!.plain, /^\[vi\]/);

  ai.length = 0;
  CONCEPT[0] = "Yield curve";
  await run("us", "us", "Wall Street ends flat as bond yields settle");
  assert.equal(trCalls().length, 0, "US: the concept is already stored and translated, so nothing is asked again (cached forever)");

  CONCEPT[0] = "Stock buyback";
  ai.length = 0;
  await run("us", "us", "Apple announces a large share repurchase program");
  assert.equal(trCalls().length, 1, "US: a new concept is translated once");
  assert.ok(await getJSON("concept:stock-buyback:vi"));

  CONCEPT[0] = "Lam phat";
  ai.length = 0;
  await run("vn", "vn", "Lạm phát tháng 11 tăng nhẹ so với tháng trước");
  assert.equal(trCalls().length, 0, "Vietnam: written in Vietnamese, nothing to translate");
  assert.equal(await getJSON("concept:lam-phat:vi"), null);

  CONCEPT[0] = "Dividend";
  ai.length = 0;
  await run("ib:abc123", "interests", "Nvidia declares a quarterly dividend");
  assert.equal(trCalls().length, 0, "interest sets: no pre-translation");
  assert.equal(await getJSON("concept:dividend:vi"), null);

  console.log("F-LOOSE OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
