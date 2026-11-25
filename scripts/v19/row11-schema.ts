/** v19 row 11 (NEWS-5): an empty or placeholder model reply is a failure, never a briefing; source_ids stay inside the headlines shown. */
import assert from "node:assert/strict";
import { pinClock } from "../clock";

pinClock("2026-11-19T14:00:00Z");
process.env.VERCEL = "1";
process.env.GROQ_API_KEY = "x";
process.env.GEMINI_API_KEY = "y";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LLM_PROVIDER;

let reply = "{}";
let calls = 0;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url.includes("api.groq.com") || url.includes("generativelanguage")) {
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;

(async () => {
  const S = await import("../../src/lib/llm/schema");
  const parse = (o: unknown) => S.toAnalysis(S.AnalysisSchema.parse(S.normalizeRaw(o)), 5);
  for (const bad of [{}, { summary: "" }, { headline: "  ", summary: ["N/A", " "], events: [] }, { headline: "n/a", summary: ["-"], events: [{ title: "None", what_happened: "TBD" }] }]) {
    assert.throws(() => parse(bad), /no usable content/, JSON.stringify(bad));
  }
  const ok = parse({ headline: "Stocks rise on a soft CPI print", mood: "risk-on" });
  assert.equal(ok.headline, "Stocks rise on a soft CPI print", "a minimal real reply is accepted");
  const ev = parse({ headline: "h", events: [{ title: "CPI", what_happened: "cooler", source_ids: [0, 0, 99, -1, "3"] }], movers: [{ ticker: "nvda", change_pct: 1, why: "x", source_ids: [1, 1, 7, 2.5, "", 4] }] });
  assert.deepEqual(ev.events[0].sourceIds, [0, 3], "duplicates, out-of-range, negative dropped; numeric strings kept");
  assert.deepEqual(ev.movers[0].sourceIds, [1, 4]);
  const many = parse({ headline: "h", events: [{ title: "t", source_ids: Array.from({ length: 30 }, (_, i) => i) }] });
  assert.deepEqual(many.events[0].sourceIds, [0, 1, 2, 3, 4], "limited by the headlines shown");
  assert.equal(S.clampSourceIds(Array.from({ length: 30 }, (_, i) => i), 30).length, 8, "at most 8 per item");

  // End to end: every model answers with an empty reply -> rules; the stored AI briefing stays.
  const { analyze } = await import("../../src/lib/llm");
  const { storeBriefing } = await import("../../src/lib/briefings");
  const { getJSON } = await import("../../src/lib/store");
  const news = Array.from({ length: 3 }, (_, i) => ({ id: `n${i}`, title: `Headline ${i}`, link: `https://n/${i}`, source: "S", publishedAt: "2026-11-19T12:00:00.000Z" }));
  const input = { section: "world", interests: [], news, quotes: [], macro: [], calendar: [], language: "en" } as never;
  const good = { section: "world", generatedAt: "2026-11-19T10:00:00.000Z", provider: "gemini:test", analysis: { ...ok, summary: ["kept"] }, news, quotes: [], feedErrors: [] } as never;
  await storeBriefing("digest:row11", good);
  for (const empty of ["{}", '{"summary":""}', '{"headline":"N/A","summary":["N/A"],"events":[]}']) {
    reply = empty;
    calls = 0;
    const r = await analyze(input, "shared");
    assert.equal(r.provider, "rules", `empty reply ${empty} falls through to rules`);
    assert.ok(calls >= 2, `the next model was tried (${calls})`);
    const rules = { section: "world", generatedAt: "2026-11-19T14:00:00.000Z", provider: r.provider, providerNote: r.note, analysis: r.analysis, news, quotes: [], feedErrors: [] } as never;
    const { shown, keptAi } = await storeBriefing("digest:row11", rules);
    assert.equal(keptAi, true);
    assert.equal((shown as { provider: string }).provider, "gemini:test");
  }
  const stored = await getJSON<{ provider: string; analysis: { summary: string[] } }>("digest:row11");
  assert.deepEqual([stored!.provider, stored!.analysis.summary], ["gemini:test", ["kept"]], "the previous AI briefing is still in place");
  // A real reply is used, and ids beyond the headlines shown are dropped.
  reply = JSON.stringify({ headline: "Real", mood: "mixed", summary: ["a"], events: [{ title: "t", what_happened: "w", why_it_matters: "m", importance: 3, source_ids: [0, 9], impacts: [], analog: null, what_could_go_wrong: "" }] });
  const r2 = await analyze(input, "shared");
  assert.notEqual(r2.provider, "rules");
  assert.deepEqual(r2.analysis.events[0].sourceIds, [0], "id 9 is beyond the 3 headlines shown");
  console.log("ROW11 OK");
})();
