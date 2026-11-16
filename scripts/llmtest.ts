/** Checks the free-provider path: a sloppy JSON reply from "Groq" gets normalized, validated, and logged as calls. */
import assert from "node:assert/strict";
import { promises as fs } from "fs";
process.env.GROQ_API_KEY = "test";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LLM_PROVIDER;

let lastBody: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
const sloppy = "Here you go:\n```json\n" + JSON.stringify({
  headline: "Chips lead as Nvidia beats",
  mood: "Risk On",
  summary: "Nvidia beat",
  events: [{ title: "Nvidia beat", what_happened: "x", why_it_matters: "y", importance: "5", source_ids: ["0"],
    impacts: [{ interest: "Chip stocks", direction: "Bullish", magnitude: "LARGE", confidence: "74", reasoning: "z" }],
    analog: { event: "NVDA May 2023 guide", date: "2023-05-25", what_happened_next: "+24%" }, what_could_go_wrong: "CPI" }],
  movers: [{ ticker: "nvda", change_pct: "3.2", why: "beat" }],
  outlook: [
    { interest: "Chip stocks", ticker: "soxx", direction: "up", confidence: 70, horizon: "today", action: "buy", action_trigger: "t", rationale: "r", risks: "k" },
    { interest: "Nasdaq", ticker: "QQQ", direction: "flat", confidence: 55, horizon: "This Week", action: "WAIT", action_trigger: "t", rationale: "r", risks: "k" },
  ],
}) + "\n```";

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("api.groq.com")) {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "openai/gpt-oss-120b");
    assert.ok(body.messages[1].content.includes("HEADLINES"));
    assert.ok(body.messages[1].content.includes("UPCOMING CATALYSTS"), "calendar in prompt");
    assert.ok(body.messages[1].content.includes("MACRO:"), "macro in prompt");
    assert.ok(!body.messages[0].content.includes("LANGUAGE:"), "briefings are always generated in English (readers get translations), even with Vietnamese chosen");
    assert.equal(body.reasoning_effort, "low", "low reasoning effort on free Groq");
    assert.ok(body.max_tokens <= 4096, "output capped for free-tier TPM");
    assert.ok(body.messages[0].content.length + body.messages[1].content.length < 14000, "compact prompt stays small");
    lastBody = body;
    return new Response(JSON.stringify({ choices: [{ message: { content: sloppy } }] }), { status: 200 });
  }
  return new Response("<rss><channel></channel></rss>", { status: 200 });
}) as typeof fetch;

(async () => {
  await fs.rm(".data", { recursive: true, force: true });
  const { refreshSection, saveSettings } = await import("../src/lib/pipeline");
  await saveSettings({ briefingLanguage: "vi" });
  const d = await refreshSection("interests");
  assert.equal(d.provider, "groq:openai/gpt-oss-120b");
  assert.equal(d.analysis.mood, "risk-on");
  assert.equal(d.analysis.events[0].impacts[0].direction, "up");
  assert.equal(d.analysis.events[0].importance, 5);
  assert.equal(d.analysis.outlook[0].action, "BUY");
  assert.equal(d.analysis.outlook[1].horizon, "this week");
  assert.equal(d.language, "en", "generated in English; readers get it translated into their language");
  assert.ok(lastBody, "groq was called");

  // Fallback: Groq rate-limited -> Gemini used, note explains why.
  process.env.GEMINI_API_KEY = "test";
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("api.groq.com")) return new Response('{"error":"rate_limit_exceeded"}', { status: 429 });
    if (url.includes("generativelanguage")) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.reasoning_effort, undefined, "no Groq-only params sent to Gemini");
      return new Response(JSON.stringify({ choices: [{ message: { content: sloppy } }] }), { status: 200 });
    }
    return real(input, init);
  }) as typeof fetch;
  const d2 = await refreshSection("world");
  assert.equal(d2.provider, "gemini:gemini-3.5-flash-lite", "falls back to Gemini (Flash-Lite: 500 requests a day) on Groq 429");
  assert.ok(d2.providerNote?.includes("429"), "fallback note mentions the 429");
  assert.equal(d2.analysis.movers.length, 1, "movers parsed");
  const { loadCalls } = await import("../src/lib/track");
  const { currentCallsKey } = await import("../src/lib/pipeline");
  const calls = await loadCalls(await currentCallsKey());
  assert.deepEqual(calls.map((c) => c.id.split(":").slice(1).join(":")).sort(), ["QQQ:w", "SOXX:d"]);
  console.log("LLM PATH OK", calls.map((c) => c.id));
})().catch((e) => { console.error(e); process.exit(1); });
