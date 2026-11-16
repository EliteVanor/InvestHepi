/**
 * v16: track record. Each exchange's own close decides when a call can be graded; flat calls use a
 * band from the ticker's typical move; stats report skill over "always up", a Wilson range, Brier,
 * per action and horizon, and when pending calls grade; confidence is pulled toward the record once a
 * level has 20+ graded calls, and the model's own number is what gets recorded.
 * `npx tsx scripts/v16test.ts`
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";

process.env.VERCEL = "1";
delete process.env.KV_REST_API_URL;

// Daily closes for AAA (US): Nov 2-17 2026 weekdays, +1% a day; Nov 17 is still trading until 21:00 UTC.
const days = ["02", "03", "04", "05", "06", "09", "10", "11", "12", "13", "16", "17"].map((d) => `2026-11-${d}`);
const closes = days.map((_, i) => 100 * 1.01 ** i);
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("/spark?")) {
    const ts = days.map((d) => Date.parse(`${d}T15:00:00Z`) / 1000);
    return new Response(JSON.stringify({ AAA: { timestamp: ts, close: closes, chartPreviousClose: 99 } }), { status: 200 });
  }
  return new Response("", { status: 404 });
}) as typeof fetch;

(async () => {
  await fs.rm("/tmp/invest-helper", { recursive: true, force: true });
  const T = await import("../src/lib/track");
  const { setJSON, getJSON } = await import("../src/lib/store");
  type Call = import("../src/lib/types").Call;

  /* ---------------- each exchange's own close */
  const at = (iso: string) => new Date(iso);
  assert.equal(T.sessionClosed("2026-11-17", "Asia/Ho_Chi_Minh", at("2026-11-17T07:59:00Z")), false, "HOSE: 14:59 Hanoi, still settling");
  assert.equal(T.sessionClosed("2026-11-17", "Asia/Ho_Chi_Minh", at("2026-11-17T08:00:00Z")), true, "15:00 Hanoi: graded within the hour, not after New York closes");
  assert.equal(T.sessionClosed("2026-11-17", "America/New_York", at("2026-11-17T21:14:00Z")), false);
  assert.equal(T.sessionClosed("2026-11-17", "America/New_York", at("2026-11-17T21:15:00Z")), true, "16:15 New York (EST)");
  assert.equal(T.sessionClosed("2026-11-16", "America/New_York", at("2026-11-17T01:00:00Z")), true, "an earlier day is always over");
  assert.equal(T.gradesAfter({ date: "2026-11-17", ticker: "^VNINDEX.VN", id: "2026-11-17:^VNINDEX.VN:d" }), "2026-11-17T08:00:00.000Z");
  assert.equal(T.gradesAfter({ date: "2026-11-17", ticker: "SPY", id: "2026-11-17:SPY:d" }), "2026-11-17T21:15:00.000Z");
  assert.equal(T.gradesAfter({ date: "2026-07-17", ticker: "SPY", id: "2026-07-17:SPY:d" }), "2026-07-17T20:15:00.000Z", "summer time (EDT)");
  assert.equal(T.gradesAfter({ date: "2026-11-17", ticker: "FPT.VN", id: "2026-11-17:FPT.VN:w" }), "2026-11-23T08:00:00.000Z", "weekly: the 5th session, weekends skipped");

  /* ---------------- flat band from the typical daily move */
  const series = (move: number) => Array.from({ length: 22 }, (_, i) => 100 * (1 + move / 100) ** i);
  assert.equal(T.flatBand(series(1), false), 0.35, "1% typical move: a third of it");
  assert.equal(T.flatBand(series(1), true), 0.78, "weekly: x sqrt 5");
  assert.equal(T.flatBand(series(0.1), false), 0.15, "floor for very quiet tickers");
  assert.equal(T.flatBand(series(8), false), 1.5, "cap for wild ones");
  assert.equal(T.flatBand([100, 101], false), 0.35, "too little history: assume a 1% day");

  /* ---------------- Wilson range */
  const r = T.rate(10, 7);
  assert.equal(r.rate, 0.7);
  assert.ok(r.low! > 0.4 && r.low! < 0.5 && r.high! > 0.85 && r.high! < 0.92, `7/10 is anywhere from ~45% to ~89% (${r.low}-${r.high})`);
  assert.deepEqual(T.rate(0, 0), { n: 0, hits: 0, rate: null, low: null, high: null });
  assert.ok(T.rate(400, 280).high! - T.rate(400, 280).low! < 0.1, "the range narrows as calls accumulate");

  /* ---------------- stats: skill over "always up", flat apart, Brier, actions, pending */
  const call = (i: number, o: Partial<Call>): Call => ({ id: `2026-11-${10 + i}:T${i}:d`, date: `2026-11-${10 + i}`, madeAt: "2026-11-01T00:00:00Z", interest: "x", ticker: `T${i}`, direction: "up", confidence: 70, action: "BUY", provider: "groq", ...o });
  const calls: Call[] = [
    call(0, { returnPct: 1, correct: true }),
    call(1, { returnPct: 2, correct: true }),
    call(2, { returnPct: -1, correct: false }),
    call(3, { direction: "down", action: "SELL", returnPct: -2, correct: true }),
    call(4, { direction: "flat", action: "HOLD", confidence: 60, returnPct: 0.1, correct: true, band: 0.3 }),
    call(5, { direction: "down", action: "WAIT", returnPct: 3, correct: false }),
    { ...call(6, {}), id: "2026-11-30:VNM.VN:d", date: "2026-11-30", ticker: "VNM.VN" }, // pending
  ];
  const s = T.computeStats(calls);
  assert.deepEqual([s.direction.n, s.direction.hits, s.flat.n, s.flat.hits], [5, 3, 1, 1], "flat calls are scored apart from up/down calls");
  assert.equal(s.direction.base, 0.6, "'always up' would have been right on 3 of the 5");
  assert.ok(Math.abs(s.direction.skill!) < 1e-9, "60% right = no edge over always-up");
  assert.ok(s.brier! > 0 && s.brier! < 0.5);
  const sell = s.byAction.find((a) => a.action === "SELL")!;
  assert.equal(sell.avgReturn, 2, "Sell before a 2% drop: +2 avoided");
  assert.equal(s.byAction.find((a) => a.action === "WAIT")!.avgReturn, -3, "Wait before a 3% rise: -3 (missed); positive always means the action paid off");
  assert.deepEqual(s.pending.map((p) => [p.ticker, p.gradesAfter]), [["VNM.VN", "2026-11-30T08:00:00.000Z"]], "pending calls say when they grade");
  assert.ok(s.recent.every((c) => c.correct !== undefined), "recent = graded calls; pending are listed apart");

  /* ---------------- calibration: the record moves the shown confidence once it's big enough */
  const bucket = (n: number, hits: number, avg: number) => ({ buckets: [{ label: "<60%", n: 0, hits: 0, avgConfidence: 0 }, { label: "60-69%", n: 0, hits: 0, avgConfidence: 0 }, { label: "70-79%", n, hits, avgConfidence: avg }, { label: "80%+", n: 0, hits: 0, avgConfidence: 0 }] });
  assert.deepEqual(T.calibrate(75, bucket(0, 0, 0)), { confidence: 75, record: null }, "no record: the AI's number");
  assert.deepEqual(T.calibrate(75, bucket(10, 4, 75)), { confidence: 75, record: { n: 10, hits: 4 } }, "under 20 graded: shown, not applied");
  assert.equal(T.calibrate(75, bucket(40, 20, 75)).confidence, 58, "75% claims right 50% of 40 times: pulled two-thirds of the way down");
  assert.equal(T.calibrate(72, bucket(400, 300, 72)).confidence, 75, "a strong record nudges up");
  assert.equal(T.calibrate(62, bucket(40, 20, 75)).confidence, 62, "other levels untouched");

  /* ---------------- what the model is told */
  assert.match(T.trackRecordText(T.computeStats(calls.slice(0, 3))), /Not enough graded calls/);
  const many = Array.from({ length: 12 }, (_, i) => call(i % 6, { id: `x${i}:T${i % 3}:d`, ticker: `T${i % 3}`, returnPct: i % 3 ? 1 : -1, correct: i % 3 !== 0 }));
  const text = T.trackRecordText(T.computeStats(many));
  assert.match(text, /"always up" would have been right/);
  assert.match(text, /Per ticker \(right\/graded\): T0 0\/4/);
  assert.match(text, /lower confidence where your record/);

  /* ---------------- grading end to end (mocked Yahoo batch) */
  const store = "calls:test";
  await setJSON(store, [
    call(0, { id: "2026-11-16:AAA:d", date: "2026-11-16", ticker: "AAA", direction: "up", returnPct: undefined }),
    call(0, { id: "2026-11-16:AAA:w", date: "2026-11-16", ticker: "AAA", direction: "flat", action: "HOLD", returnPct: undefined }),
    call(0, { id: "2026-11-17:AAA:d", date: "2026-11-17", ticker: "AAA", direction: "down", returnPct: undefined }),
  ]);
  assert.equal(await T.gradeCalls(at("2026-11-17T20:00:00Z"), store), 1, "15:00 New York: Nov 16 graded, Nov 17 still trading, the week not done");
  let got = await getJSON<Call[]>(store);
  const d16 = got!.find((c) => c.id === "2026-11-16:AAA:d")!;
  assert.deepEqual([d16.correct, Number(d16.returnPct!.toFixed(2)), d16.baseClose === closes[9]], [true, 1, true], "Nov 16 close vs Nov 13 close");
  assert.ok(d16.band! > 0, "the band is stored with the grade");
  assert.equal(got!.find((c) => c.id === "2026-11-17:AAA:d")!.correct, undefined, "today's live price is never a close");
  assert.equal(await T.gradeCalls(at("2026-11-17T21:20:00Z"), store), 1, "after the close: Nov 17 graded");
  got = await getJSON<Call[]>(store);
  assert.equal(got!.find((c) => c.id === "2026-11-17:AAA:d")!.correct, false, "it rose 1%: a down call is wrong");

  /* ---------------- the raw AI confidence is what gets recorded */
  await T.recordCalls([{ interest: "x", ticker: "AAA", direction: "up", confidence: 58, aiConfidence: 75, horizon: "today", action: "BUY", actionTrigger: "", rationale: "", risks: "" }], [{ id: "x", name: "x", query: "x", tickers: ["AAA"] }], "groq", at("2026-11-18T10:00:00Z"), "calls:raw");
  assert.equal((await getJSON<Call[]>("calls:raw"))![0].confidence, 75, "calibration learns from the model's own numbers, not the adjusted ones");

  console.log("V16 OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
