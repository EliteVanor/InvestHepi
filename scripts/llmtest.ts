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
  if (url.includes("vndirect.com.vn") && url.includes("q=code:")) {
    // Vietnamese daily closes through Monday Nov 16 2026 (predictions need the latest session's close).
    const codes = decodeURIComponent(url.split("q=code:")[1].split("~")[0]).split(",");
    const days = ["2026-11-16", "2026-11-13", "2026-11-12", "2026-11-11", "2026-11-10", "2026-11-09"];
    return new Response(JSON.stringify({ data: codes.flatMap((code) => days.map((date, i) => ({ code, date, close: 50 - i * 0.2, adClose: 50 - i * 0.2, nmVolume: 9, accumulatedVol: 9 }))) }), { status: 200 });
  }
  return new Response("<rss><channel></channel></rss>", { status: 200 });
}) as typeof fetch;

(async () => {
  await fs.rm(".data", { recursive: true, force: true });
  const { refreshSection } = await import("../src/lib/pipeline");
  const { saveSettings } = await import("../src/lib/interests");
  await saveSettings({ briefingLanguage: "vi" });
  const d = await refreshSection("interests");
  assert.equal(d.provider, "groq:openai/gpt-oss-120b");
  assert.equal(d.analysis.mood, "risk-on");
  assert.equal(d.analysis.events[0].impacts[0].direction, "up");
  assert.equal(d.analysis.events[0].importance, 5);
  assert.equal(d.analysis.outlook, undefined, "briefings make no calls");
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
      if (String(body.messages[0].content).includes("You are the forecaster")) {
        const pred = { calls: [{ interest: "VN-Index", ticker: "^vnindex.vn", horizon: "Today", direction: "Bullish", confidence: "61", action: "buy", action_trigger: "t", rationale: "r", risks: "k" }, { interest: "Banks", ticker: "VCB.VN", horizon: "this week", direction: "down", confidence: 58, action: "BUY", action_trigger: "t", rationale: "r", risks: "k" }, { interest: "x", ticker: "AAPL", horizon: "today", direction: "up", confidence: 70, action: "BUY", action_trigger: "", rationale: "", risks: "" }, { interest: "Banks", ticker: "BID.VN", horizon: "today", direction: "down", confidence: 58, action: "WAIT", action_trigger: "t", rationale: "a headline about BIDV", risks: "k" }, { interest: "Securities firms", ticker: "VND.VN", horizon: "today", direction: "down", confidence: 56, action: "WAIT", action_trigger: "t", rationale: "follows the sector", risks: "k" }] };
        return new Response(JSON.stringify({ choices: [{ message: { content: "```json\n" + JSON.stringify(pred) + "\n```" } }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: sloppy } }] }), { status: 200 });
    }
    return real(input, init);
  }) as typeof fetch;
  const d2 = await refreshSection("world");
  assert.equal(d2.provider, "gemini:gemini-3.5-flash-lite", "shared briefings start on Gemini Flash-Lite (v18)");
  const S = await import("../src/lib/llm/schema");
  const parsed = S.toAnalysis(S.AnalysisSchema.parse(S.normalizeRaw(S.extractJSON(sloppy))));
  assert.deepEqual([parsed.movers[0].ticker, parsed.movers[0].changePct], ["NVDA", 3.2], "movers parsed from the model's reply");
  assert.equal(d2.analysis.movers.length, 0, "but a mover with no price in the snapshot is dropped (this test has no price data)");
  // Predictions start on Groq 120b; a 429 falls back to Gemini, whose sloppy JSON is repaired.
  const { runPrediction } = await import("../src/lib/predictions");
  // The live headline list the run reads: one names BIDV (BID.VN), none names VNDirect (VND.VN).
  const store = await import("../src/lib/store");
  await store.setJSON("news:vn", { at: "2026-11-17T01:00:00.000Z", items: [{ id: "h1", title: "Lãi suất ngân hàng 17/11: VPBank và BIDV cùng giảm", link: "https://n/1", source: "VnExpress", publishedAt: "2026-11-17T00:30:00.000Z" }], errors: [] });
  const r = await runPrediction({ market: "vn", phase: "pre", now: new Date("2026-11-17T01:16:00Z") });
  assert.deepEqual([r.ok, r.note], [true, "gemini:gemini-3.5-flash-lite"], `prediction fell back on the 429 (${r.note})`);
  const { loadCalls } = await import("../src/lib/track");
  const calls = await loadCalls("calls:vn");
  assert.deepEqual(calls.map((c) => c.id).sort(), ["2026-11-17:BID.VN:d", "2026-11-17:VCB.VN:w", "2026-11-17:^VNINDEX.VN:d"], "other markets' tickers dropped; beyond the benchmarks, only a ticker a headline names (BIDV yes, VNDirect no)");
  assert.equal(calls.find((c) => c.id.endsWith(":w"))!.action, "WAIT", "down + Buy becomes Wait");
  // What the model was given is kept for audits: prices, macro, technicals, track record, headlines; no rules.
  const { getJSON } = await import("../src/lib/store");
  const inp = await getJSON<{ data: string; provider: string }>("pred:vn:input:pre");
  assert.ok(inp && inp.data.includes("MARKET SNAPSHOT") && inp.data.includes("TECHNICALS") && inp.data.includes("BIDV cùng giảm") && !inp.data.includes("How you are graded"), "audit data stored with the headlines, without the rules");
  const route = await import("../src/app/api/predictions/route");
  const served = await (await route.GET(new Request("http://x/api/predictions?section=vn&inputs=1"))).json();
  assert.ok(served.inputs["vn:pre"]?.data.includes("^VNINDEX.VN"), "served for audits at /api/predictions?inputs=1");
  console.log("LLM PATH OK", calls.map((c) => c.id));
})().catch((e) => { console.error(e); process.exit(1); });
