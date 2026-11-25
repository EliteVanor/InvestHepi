/**
 * Free-tier budget: which model each job uses, daily usage tracking, the 120b reserve for shared and
 * admin briefings, cooldowns after a 429, keeping the last AI briefing when AI fails (with a
 * rule-based copy readers can switch to), and translated headlines (the scheduler is in v13test).
 * `npx tsx scripts/budgettest.ts`
 */
import assert from "node:assert/strict";
import { isStoryCall, storyReply } from "./story-reply";
import { promises as fs } from "fs";
import { pinClock } from "./clock";

// Fixtures and code under test share one clock, so the result never depends on when this runs.
pinClock("2026-11-17T09:00:00Z");

process.env.VERCEL = "1";
delete process.env.KV_REST_API_URL;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LLM_PROVIDER;
process.env.GROQ_API_KEY = "g";
process.env.GEMINI_API_KEY = "m";

type Call = { url: string; model: string; system: string };
const calls: Call[] = [];
let feeds = 0;
/** Per model: "ok", a 429 (daily or per-minute), a 400 for the reasoning knob, or "down". */
const mode: Record<string, "ok" | "429day" | "429min" | "down" | "noReasoning"> = {};

const analysisJson = JSON.stringify({
  headline: "AI headline", mood: "mixed", summary: ["s"],
  events: [{ title: "E", what_happened: "w", why_it_matters: "y", importance: 3, source_ids: [0], impacts: [], analog: null, what_could_go_wrong: "c" }],
  watch_next: [], movers: [], scenarios: [],
  outlook: [{ interest: "S&P 500", ticker: "^GSPC", direction: "up", confidence: 60, horizon: "today", action: "HOLD", action_trigger: "t", rationale: "r", risks: "k" }],
});

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("api.groq.com") || url.includes("generativelanguage")) {
    const body = JSON.parse(String(init?.body));
    const system: string = body.messages[0].content;
    calls.push({ url, model: body.model, system });
    const m = mode[body.model] ?? "ok";
    if (m === "down") return new Response("unavailable", { status: 503 });
    if (m === "429day") return new Response("Rate limit reached for model on tokens per day (TPD): Limit 200000", { status: 429, headers: { "retry-after": "200" } });
    if (m === "429min") return new Response("Rate limit reached on tokens per minute", { status: 429, headers: { "retry-after": "7" } });
    if (m === "noReasoning" && "reasoning_effort" in body) return new Response('{"error":"reasoning_effort is not supported"}', { status: 400 });
    let content = analysisJson;
    if (isStoryCall(system)) content = storyReply(body.messages[1].content); // v19b: the briefing is the story call
    else if (system.startsWith("You translate")) content = JSON.stringify((JSON.parse(body.messages[1].content) as string[]).map((s) => `vi:${s}`));
    else if (!body.response_format) content = "plain answer";
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 6000 } }), { status: 200 });
  }
  if (/rss|news\.google|feeds|\.xml/.test(url)) {
    feeds++;
    // Plus one headline new on every fetch, so each run has a story without a card (v19b: fresh cards are kept, not re-sent).
    const items = Array.from({ length: 25 }, (_, i) => `<item><title>${i === 3 ? "Chứng khoán tăng điểm" : `Stocks rise on day ${i}`}</title><link>https://n/${i}</link><pubDate>${new Date().toUTCString()}</pubDate></item>`).join("") + `<item><title>Wire update ${feeds}</title><link>https://n/w${feeds}</link><pubDate>${new Date().toUTCString()}</pubDate></item>`;
    return new Response(`<?xml version="1.0"?><rss><channel>${items}</channel></rss>`, { status: 200 });
  }
  return new Response("", { status: 404 });
}) as typeof fetch;

const reset = () => {
  calls.length = 0;
  for (const k of Object.keys(mode)) delete mode[k];
};

(async () => {
  await fs.rm(process.env.STORE_DIR || "/tmp/invest-helper", { recursive: true, force: true });
  const M = await import("../src/lib/llm/models");
  const { dayIn } = await import("../src/lib/dates");
  const { complete } = await import("../src/lib/llm");

  /* ---------------- routes */
  assert.deepEqual(M.chainFor("translate").map((d) => d.provider.model), ["qwen/qwen3.8-27b", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"], "translation never uses the briefing models");
  assert.deepEqual(M.chainFor("userManual").map((d) => d.provider.model), ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "openai/gpt-oss-20b"], "users' refresh button: Gemini first");
  assert.deepEqual(M.chainFor("predShared").map((d) => d.provider.model), ["openai/gpt-oss-120b", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "openai/gpt-oss-20b"], "shared predictions: 120b first, 20b only as the last resort");
  assert.deepEqual(M.chainFor("shared").map((d) => d.provider.model), ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "openai/gpt-oss-120b", "openai/gpt-oss-20b"], "shared briefings: Flash-Lite first (v18)");
  assert.deepEqual(M.chainFor("userAuto").map((d) => d.provider.model), ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "openai/gpt-oss-20b", "openai/gpt-oss-120b"], "users' briefings: Flash-Lite first, 120b last");
  assert.deepEqual(M.chainFor("predUser")[0].provider.model, "openai/gpt-oss-120b", "users' predictions try 120b (beyond the reserve)");
  assert.deepEqual(M.chainFor("ask").map((d) => d.provider.model), ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]);

  reset();
  const a = await complete("sys", [{ role: "user", content: "q" }]);
  assert.equal(a.provider, "groq:openai/gpt-oss-20b", "Ask AI goes to 20b");

  /* ---------------- usage is recorded from the reply's token count */
  const g20 = M.modelDef("groq20")!;
  const u = await M.loadUsage(g20);
  assert.deepEqual([u.tokens, u.requests, u.byRoute.ask], [6000, 1, 1]);

  /* ---------------- qwen without the reasoning knob: retried once without it */
  reset();
  mode["qwen/qwen3.8-27b"] = "noReasoning";
  const tr = await complete("You translate x", [{ role: "user", content: '["a"]' }], { route: "translate" });
  assert.equal(tr.provider, "groq:qwen/qwen3.8-27b");
  assert.equal(calls.filter((c) => c.model.includes("qwen")).length, 2, "one retry without reasoning_effort");

  /* ---------------- a daily 429 cools the model down: no more requests to it until later */
  reset();
  mode["qwen/qwen3.8-27b"] = "429day";
  const t1 = await complete("You translate x", [{ role: "user", content: '["a"]' }], { route: "translate" });
  assert.equal(t1.provider, "gemini:gemini-3.5-flash-lite", "falls through to Flash-Lite");
  const cool = await M.loadUsage(M.modelDef("qwen")!);
  assert.ok(cool.cooldownUntil! - Date.now() >= 14 * 60_000, "daily quota gone: at least 15 minutes off, not the 200 s Retry-After");
  calls.length = 0;
  await complete("You translate x", [{ role: "user", content: '["a"]' }], { route: "translate" });
  assert.equal(calls.filter((c) => c.model.includes("qwen")).length, 0, "skipped while cooling down");

  /* ---------------- the 120b reserve: users' automatic jobs leave room for shared + admin predictions */
  const g120 = M.modelDef("groq120")!;
  const weekday = new Date("2026-11-17T09:00:00Z");
  const fresh = { day: dayIn("UTC", weekday), tokens: 0, requests: 0, byRoute: {} };
  // A UTC weekday: Vietnam 2, US 2, World 6 markets x 2 = 16 shared runs; the admin's set up to 4 (US + Vietnam parts).
  assert.deepEqual(M.scheduledPerDay(weekday), { shared: 16, admin: 4 });
  assert.equal(M.reserveFor120(fresh, weekday), (16 + 4) * 6000, "nothing done yet: 16 shared + 4 admin at 6K");
  assert.equal(M.reserveFor120({ ...fresh, tokens: 60000, requests: 10, byRoute: { predShared: 8, predAdmin: 2 } }, weekday), (8 + 2) * 6000, "uses the measured average");
  assert.deepEqual(M.scheduledPerDay(new Date("2026-11-21T09:00:00Z")), { shared: 0, admin: 0 }, "Saturday: no predictions");
  assert.deepEqual(M.scheduledPerDay(new Date("2026-11-22T09:00:00Z")), { shared: 0, admin: 0 }, "Sunday UTC: Japan is closed Monday Nov 23 (Labor Thanksgiving Day, holidays.ts), so no run at all");
  assert.deepEqual(M.scheduledPerDay(new Date("2026-11-29T09:00:00Z")), { shared: 1, admin: 0 }, "Sunday UTC: only Japan's Monday before-market run (07:30 Tokyo = 22:30 UTC)");
  const { setJSON } = await import("../src/lib/store");
  await setJSON("llm:usage:groq120", { day: dayIn("UTC"), tokens: 120_000, requests: 17, byRoute: { predShared: 2 } });
  assert.equal((await M.available(g120, "userAuto")).ok, false, "users' sets move off 120b once only the reserve is left");
  assert.equal((await M.available(g120, "predUser")).ok, false, "users' predictions too");
  assert.equal((await M.available(g120, "predShared")).ok, true, "shared predictions can still use it");
  assert.equal((await M.available(g120, "adminManual")).ok, true, "and the admin");
  await setJSON("llm:usage:groq120", { day: dayIn("UTC"), tokens: 0, requests: 0, byRoute: {} });

  /* ---------------- keep the last AI briefing when no AI model works; rule-based copy on request */
  const P = { ...(await import("../src/lib/pipeline")), ...(await import("../src/lib/briefings")), ...(await import("../src/lib/interests")) }; // pipeline.ts was split in v14
  reset();
  const first = await P.refreshShared("us", "en");
  assert.equal(first.provider, "gemini:gemini-3.5-flash-lite");
  const aiAt = first.generatedAt;
  reset();
  for (const m of ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]) mode[m] = "down";
  const failed = await P.refreshShared("us", "en", new Date(Date.now() + 60_000));
  assert.equal(failed.provider, "rules");
  assert.equal(failed.keptAi, true, "the result says the AI briefing was kept");
  const shown = await P.loadDigest("us", undefined, "en");
  assert.equal(shown!.generatedAt, aiAt, "readers keep the last AI briefing");
  assert.equal(shown!.provider, "gemini:gemini-3.5-flash-lite");
  const since = await P.aiFailedSince("us", shown);
  assert.ok(since && since > aiAt, "the failed run is reported so the page can explain it");
  const rules = await P.loadRules("us");
  assert.equal(rules?.provider, "rules", "a rule-based copy is kept beside it");

  const route = await import("../src/app/api/digest/route");
  const req = (path: string) => new Request(`http://localhost${path}`);
  const body = await (await route.GET(req("/api/digest?section=us&lang=en"))).json();
  assert.ok(body.aiFailedAt, "/api/digest tells the page");
  const before = feeds;
  calls.length = 0;
  const r1 = await (await route.GET(req("/api/digest?section=us&lang=en&variant=rules"))).json();
  assert.equal(r1.digest.provider, "rules");
  assert.equal(feeds, before, "a copy under 15 minutes old is reused (no new fetches)");
  await setJSON("digest:us:en:rules", { ...rules, generatedAt: new Date(Date.now() - 16 * 60_000).toISOString() });
  const r2 = await (await route.GET(req("/api/digest?section=us&lang=en&variant=rules"))).json();
  assert.ok(feeds > before, "an older one is rebuilt from the latest headlines");
  assert.ok(new Date(r2.digest.generatedAt).getTime() > Date.now() - 60_000);
  assert.equal(calls.length, 0, "rule-based copies cost no AI calls");

  // A new AI briefing clears the banner.
  reset();
  await P.refreshShared("us", "en", new Date(Date.now() + 120_000));
  assert.equal(await P.aiFailedSince("us", await P.loadDigest("us", undefined, "en")), null);

  // No AI briefing yet and no AI available: the rule-based one is simply the briefing (nothing "kept").
  reset();
  for (const m of ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]) mode[m] = "down";
  const firstEver = await P.refreshShared("vn", "en");
  assert.equal(firstEver.provider, "rules");
  assert.equal(firstEver.keptAi, undefined, "nothing to keep: not reported as kept");
  assert.equal((await P.loadDigest("vn", undefined, "en"))!.provider, "rules");

  /* ---------------- translated headlines: cited + top 20, skipping ones already in the language */
  const T = await import("../src/lib/translate");
  assert.equal(T.headlineLang("Chứng khoán tăng điểm"), "vi");
  assert.equal(T.headlineLang("Stocks rise"), "en");
  assert.equal(T.headlineLang("株価が上昇"), "other");
  const news = Array.from({ length: 30 }, (_, i) => ({ id: `${i}`, title: i === 3 ? "Chứng khoán tăng điểm" : `Stocks rise ${i}`, link: "", source: "s", publishedAt: "" }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const an: any = { events: [{ sourceIds: [25] }] };
  const toVi = T.headlineSlots(news, an, "vi");
  assert.equal(toVi.length, 20, "top 20 minus the one already in Vietnamese, plus the cited #25");
  assert.ok(!toVi.some((s) => s.text === "Chứng khoán tăng điểm"));
  assert.ok(toVi.some((s) => s.text === "Stocks rise 25"), "a cited headline is included even outside the top 20");
  assert.equal(T.headlineSlots(news, an, "en").map((s) => s.text).join(), "Chứng khoán tăng điểm", "English readers only need the Vietnamese one");
  reset();
  await setJSON("llm:usage:qwen", { day: dayIn("UTC"), tokens: 0, requests: 0, byRoute: {} }); // end the cooldown from above
  await P.refreshShared("world", "en", new Date(Date.now() + 180_000));
  const d = await P.loadDigest("world", undefined, "en");
  const vi = await T.translateDigest(d!, "vi");
  const translated = vi.news.filter((n) => n.titleOrig);
  assert.ok(translated.length > 0 && translated.every((n) => n.title.startsWith("vi:")), "headlines come back translated");
  assert.ok(translated.every((n) => !n.titleOrig!.startsWith("vi:")), "and keep the original for the tooltip");

  console.log("BUDGET OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
