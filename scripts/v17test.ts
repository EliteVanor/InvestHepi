/**
 * v17: an up/down call whose move stays inside the ticker's usual range is "no result" (not a miss),
 * also for calls graded before; an action that contradicts its direction is replaced (and the prompt
 * forbids it). `npx tsx scripts/v17test.ts`
 */
import assert from "node:assert/strict";
import { promises as fs, readFileSync } from "fs";
import path from "path";

process.env.VERCEL = "1";
delete process.env.KV_REST_API_URL;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.LLM_PROVIDER;
process.env.GROQ_API_KEY = "g";

// AAA: flat for 20 sessions with ~1% daily swings, then Nov 16 closes exactly where Nov 13 did.
const days = Array.from({ length: 21 }, (_, i) => new Date(Date.UTC(2026, 9, 19) + i * 86400_000).toISOString().slice(0, 10)).filter((d) => ![0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay()));
days.push("2026-11-16");
const closes = days.map((_, i) => (i === days.length - 1 ? 0 : i % 2 ? 101 : 100));
closes[closes.length - 1] = closes[closes.length - 2]; // 0.00% on Nov 16
const outlook = { interest: "S&P 500", ticker: "^GSPC", direction: "down", confidence: 60, horizon: "today", action: "BUY", action_trigger: "t", rationale: "r", risks: "k" };
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("/spark?")) return new Response(JSON.stringify({ AAA: { timestamp: days.map((d) => Date.parse(`${d}T15:00:00Z`) / 1000), close: closes } }), { status: 200 });
  if (url.includes("api.groq.com")) {
    const content = JSON.stringify({ headline: "h", mood: "mixed", summary: ["s"], events: [], watch_next: [], movers: [], scenarios: [], outlook: [outlook] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 3000 } }), { status: 200 });
  }
  if (/rss|news\.google|feeds|\.xml/.test(url)) return new Response(`<?xml version="1.0"?><rss><channel><item><title>Stocks</title><link>https://n/0</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`, { status: 200 });
  return new Response("", { status: 404 });
}) as typeof fetch;

(async () => {
  await fs.rm("/tmp/invest-helper", { recursive: true, force: true });
  const T = await import("../src/lib/track");
  const P = await import("../src/lib/pipeline");
  const { setJSON, getJSON } = await import("../src/lib/store");
  type Call = import("../src/lib/types").Call;
  const base = { madeAt: "2026-11-15T00:00:00Z", interest: "x", ticker: "AAA", confidence: 60, provider: "groq" };

  /* ---------------- a move inside the band: no result, not a miss */
  await setJSON("calls:t", [
    { ...base, id: "2026-11-16:AAA:d", date: "2026-11-16", direction: "up", action: "ADD" },
    // graded before v17 as wrong on a 0.00% move: fixed on the next pass
    { ...base, id: "2026-11-13:AAA:d", date: "2026-11-13", direction: "up", action: "ADD", returnPct: 0, band: 0.49, correct: false, gradedAt: "2026-11-13T22:00:00Z" },
    { ...base, id: "2026-11-12:AAA:d", date: "2026-11-12", direction: "down", action: "SELL", returnPct: -1.4, band: 0.58, correct: true, gradedAt: "2026-11-12T22:00:00Z" },
  ] as Call[]);
  assert.equal(await T.gradeCalls(new Date("2026-11-17T01:00:00Z"), "calls:t"), 1);
  const got = (await getJSON<Call[]>("calls:t"))!;
  const nov16 = got.find((c) => c.date === "2026-11-16")!;
  assert.deepEqual([nov16.noResult, nov16.correct, nov16.returnPct, !!nov16.gradedAt], [true, undefined, 0, true], "0.00% on an up call: graded, no result");
  const old = got.find((c) => c.date === "2026-11-13")!;
  assert.deepEqual([old.noResult, old.correct], [true, undefined], "the old 0.00% 'miss' is now no result");
  assert.equal(got.find((c) => c.date === "2026-11-12")!.correct, true, "a real move keeps its grade");
  assert.equal(await T.gradeCalls(new Date("2026-11-17T02:00:00Z"), "calls:t"), 0, "no-result calls aren't pending forever");

  const s = T.computeStats(got);
  assert.deepEqual([s.direction.n, s.direction.hits, s.direction.noResult, s.pending.length], [1, 1, 2, 0], "left out of the hit rate, counted apart, not pending");
  assert.ok(s.recent.some((c) => c.noResult), "and listed with the graded calls");
  const many = Array.from({ length: 6 }, (_, i) => ({ ...base, id: `x${i}:AAA:d`, date: "2026-11-02", direction: "up", action: "BUY", returnPct: 1, band: 0.3, correct: true, gradedAt: "x" }) as Call);
  assert.match(T.trackRecordText(T.computeStats([...many, ...got])), /2 up\/down calls moved less than the ticker's usual range and were not counted/);

  /* ---------------- actions agree with directions */
  assert.equal(P.alignAction("down", "BUY"), "WAIT");
  assert.equal(P.alignAction("down", "ADD"), "WAIT");
  assert.equal(P.alignAction("down", "HOLD"), "WAIT", "down + hold (no positions): wait");
  assert.equal(P.alignAction("down", "HOLD", true), "HOLD", "someone who holds it may hold through a dip");
  assert.equal(P.alignAction("up", "SELL"), "HOLD");
  assert.equal(P.alignAction("up", "AVOID"), "HOLD");
  for (const [d, a] of [["up", "BUY"], ["up", "WAIT"], ["down", "SELL"], ["down", "WAIT"], ["flat", "HOLD"], ["flat", "WAIT"]] as const) assert.equal(P.alignAction(d, a), a, `${d} + ${a} is fine`);
  const prompt = readFileSync(path.join(__dirname, "../src/lib/llm/prompt.ts"), "utf8");
  assert.match(prompt, /The action must agree with the direction/, "the prompt asks for it");

  // End to end: the model says "down" + BUY; readers see WAIT, the model's own action is kept, the record has WAIT.
  const d = await P.refreshShared("us", "en", new Date("2026-11-16T12:30:00Z"));
  const o = d.analysis.outlook.find((x) => x.ticker === "^GSPC")!;
  assert.deepEqual([o.direction, o.action, o.aiAction], ["down", "WAIT", "BUY"]);
  const rec = (await getJSON<Call[]>("calls:us"))!.find((c) => c.ticker === "^GSPC")!;
  assert.equal(rec.action, "WAIT", "graded as shown");

  console.log("V17 OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
