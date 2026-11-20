/**
 * v19 rows 8, 10, 12, 13, 14 (audit TIME-C1..C5, TIME-T3): the scheduler and the grading it drives.
 *  - row 8: a grading error is recorded and retried after a short back-off, the hourly mark is written
 *    only after success, and the failure shows in the schedule report;
 *  - row 10: a slot with an item that failed for good counts for the late-slot 503 window;
 *  - row 12: `closed` needs a later bar (or a known holiday); an outage stays pending with a capped
 *    retry and ends as "expired, not graded" after 10 days;
 *  - row 13: the grade time of an ETF stand-in follows New York, where grading happens;
 *  - row 14: the deadline is checked after the lane's 65 s wait;
 *  - TIME-T3: DST days for a prediction slot, lock expiry, lateNow.
 * Fake clock, no network. `npx tsx scripts/v19/row08-14-scheduler.ts`
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import { pinClock } from "../clock";

pinClock("2026-11-17T12:00:00Z");

process.env.VERCEL = "1";
delete process.env.KV_REST_API_URL;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.APP_URL;
delete process.env.VERCEL_URL;
delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
for (const k of ["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"]) delete process.env[k];
process.env.GROQ_API_KEY = "g";
process.env.GEMINI_API_KEY = "m";

/** Daily closes per symbol, served as a Yahoo spark batch; `chartBars` for the single-symbol chart. */
const closes: Record<string, [string, number][]> = {};
const chartBars: Record<string, [string, number][]> = {};
let sparkHits = 0;
/** A price request that never answers (the function being cut off at its time limit). */
let hangSpark = false;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("/spark?")) {
    sparkHits++;
    if (hangSpark) return new Promise<Response>(() => {});
    const syms = decodeURIComponent(url.match(/symbols=([^&]+)/)![1]).split(",");
    const out: Record<string, unknown> = {};
    for (const s of syms) {
      const h = closes[s];
      if (h) out[s] = { timestamp: h.map(([d]) => Date.parse(`${d}T15:00:00Z`) / 1000), close: h.map(([, c]) => c), chartPreviousClose: h[0][1] };
    }
    return new Response(JSON.stringify(out), { status: 200 });
  }
  const m = url.match(/\/v8\/finance\/chart\/([^?]+)/);
  if (m && chartBars[decodeURIComponent(m[1])]) {
    const h = chartBars[decodeURIComponent(m[1])];
    const ts = h.map(([d]) => Date.parse(`${d}T15:00:00Z`) / 1000);
    return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: h.at(-1)![1], chartPreviousClose: h[0][1] }, timestamp: ts, indicators: { quote: [{ close: h.map(([, c]) => c) }] } }] } }), { status: 200 });
  }
  return new Response("", { status: 404 });
}) as typeof fetch;

const T = (s: string) => Date.parse(s);
const at = (s: string) => new Date(s);
const MIN = 60_000;

(async () => {
  await fs.rm(process.env.STORE_DIR || "/tmp/invest-helper", { recursive: true, force: true });
  const TT = await import("../../src/lib/timetable");
  const S = await import("../../src/lib/scheduler");
  const TR = await import("../../src/lib/track");
  const { getJSON, setJSON, delJSON, takeLock, releaseLock } = await import("../../src/lib/store");
  type Call = import("../../src/lib/types").Call;
  S.setTimetableSince(0);
  const doneBefore = async (ms: number) => {
    for (const o of TT.occurrences(ms - 3 * 86400_000, ms - 1)) if (!(await getJSON(TT.runKey(o)))) await setJSON(TT.runKey(o), { items: {}, sets: {}, done: "seed" });
  };

  /* ---------------- row 8: a grading error is recorded, retried after a short back-off, the mark follows success */
  await doneBefore(T("2026-11-17T14:00:00Z"));
  await setJSON("calls:world", {}); // not a list: grading that store throws
  let t = T("2026-11-17T12:00:00Z");
  const opts = { now: () => new Date(t), sleep: async (ms: number) => void (t += ms) };
  const r1 = await S.runTick(opts);
  assert.ok(r1.gradeError, "the failure is reported on the tick");
  assert.equal(await getJSON("sched:graded"), null, "no 'graded at' mark after a failed pass: it can't hide results for 55 min");
  const f1 = await getJSON<{ n: number; error: string; retryAt: string }>("sched:gradeFail");
  assert.equal(f1?.n, 1);
  assert.ok(f1!.error.length > 0 && f1!.error.length <= 160, "a short message, no stack");
  assert.equal(Date.parse(f1!.retryAt) - t, 5 * MIN, "first retry in 5 min");
  let rep = await S.scheduleReport(t);
  assert.equal(rep.grading.failing?.n, 1, "visible in /api/status?schedule=1 and the admin's Status panel");
  t += 2 * MIN;
  assert.equal((await S.runTick(opts)).gradeError, undefined, "pokes inside the back-off don't retry");
  assert.equal((await getJSON<{ n: number }>("sched:gradeFail"))!.n, 1);
  t += 4 * MIN;
  assert.ok((await S.runTick(opts)).gradeError, "after 5 min: retried, failed again");
  const f2 = (await getJSON<{ n: number; retryAt: string }>("sched:gradeFail"))!;
  assert.equal(f2.n, 2);
  assert.equal(Date.parse(f2.retryAt) - t, 10 * MIN, "the delay doubles");
  await setJSON("calls:world", []);
  t += 10 * MIN;
  const ok = await S.runTick(opts);
  assert.equal(ok.gradeError, undefined);
  assert.equal(typeof ok.graded, "number");
  assert.ok(await getJSON("sched:graded"), "the mark is written after a success");
  assert.equal(await getJSON("sched:gradeFail"), null, "and the failure record is cleared");
  rep = await S.scheduleReport(t);
  assert.equal(rep.grading.failing, null);

  // A pass that never finishes (cut off at the time limit) leaves its mark first, so chained ticks don't rerun it.
  await TR.recordCalls([{ interest: "X", ticker: "AAA", direction: "up" as const, confidence: 62, horizon: "today" as const, action: "HOLD" as const, actionTrigger: "", rationale: "", risks: "" }], [{ id: "x", name: "X", query: "x", tickers: ["AAA"] }], "groq", at("2026-11-16T12:30:00Z"), "calls:world", { phase: "pre" });
  await delJSON("sched:graded");
  await doneBefore(T("2026-11-17T18:00:00Z")); // no units to run: only grading matters here
  hangSpark = true;
  sparkHits = 0;
  t = T("2026-11-17T16:00:00Z");
  void S.runTick(opts); // never resolves
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(sparkHits > 0, "the pass started and is stuck");
  const stuck = await getJSON<{ n: number; retryAt: string }>("sched:gradeFail");
  assert.equal(Date.parse(stuck!.retryAt) - t, 5 * MIN, "marked before the pass: retry in 5 min");
  await delJSON("sched:lock"); // the killed function's lock has expired
  const hitsBefore = sparkHits;
  t += 60_000;
  await S.runTick(opts);
  assert.equal(sparkHits, hitsBefore, "the next tick doesn't start the same pass again");
  hangSpark = false;
  t += 5 * MIN;
  await S.runTick(opts);
  assert.ok(sparkHits > hitsBefore, "after the delay it tries again");
  assert.equal(await getJSON("sched:gradeFail"), null, "and clears the mark on success");

  /* ---------------- row 10 + TIME-T3 lateNow: a slot with an item that failed for good is reported like late/missed */
  const occ = TT.occurrences(T("2026-11-17T12:30:00Z"), T("2026-11-17T12:30:00Z")).find((o) => o.slot.id === "p-us-pre")!;
  const key = TT.runKey(occ);
  await setJSON(key, { items: { "p:us:pre": { at: "2026-11-17T12:50:00Z", n: 2, ok: false, note: "Groq 503" }, "p:wus:pre": { at: "2026-11-17T12:31:00Z", n: 1, ok: true } }, sets: {}, done: "2026-11-17T12:51:00Z" });
  const start = occ.start;
  assert.deepEqual(await S.lateNow(start + 30 * MIN), [], "30 min in: not in the window yet");
  const lateIds = async (ms: number) => (await S.lateNow(ms)).map((r) => `${r.slot}:${r.state}`);
  assert.ok((await lateIds(start + 70 * MIN)).includes("p-us-pre:partial"), "failed for good: counts for the 503 window");
  assert.ok(!(await lateIds(start + 130 * MIN)).includes("p-us-pre:partial"), "reported for an hour only, like late/missed");
  assert.ok((await S.scheduleReport(start + 70 * MIN)).late.includes("p-us-pre"), "and listed as late in the report");
  await setJSON(key, { items: { "p:us:pre": { at: "2026-11-17T12:31:00Z", n: 1, ok: true } }, sets: {}, done: "2026-11-17T12:51:00Z" });
  assert.ok(!(await lateIds(start + 70 * MIN)).includes("p-us-pre:done"), "a clean slot is not reported");
  await setJSON(key, { items: { "p:us:pre": { at: "2026-11-17T12:50:00Z", n: 2, ok: false, note: "unavailable: SPY no live price" }, "p:oil:pre": { at: "2026-11-17T13:00:00Z", n: 2, ok: false, note: "gave up: unavailable: CL=F no 2026-11-16 close" } }, sets: {}, done: "x" });
  assert.ok(!(await lateIds(start + 70 * MIN)).includes("p-us-pre:partial"), "a data gap ('unavailable', shown on the card) is not a missed run");
  assert.ok(!(await S.scheduleReport(start + 70 * MIN)).late.includes("p-us-pre"));
  await setJSON(key, { items: { "p:us:pre": { at: "2026-11-17T12:50:00Z", n: 2, ok: false, note: "unavailable: x" }, "p:oil:pre": { at: "2026-11-17T13:00:00Z", n: 2, ok: false, note: "Groq 503" } }, sets: {}, done: "x" });
  assert.ok((await lateIds(start + 70 * MIN)).includes("p-us-pre:partial"), "a real failure next to a data gap still counts");
  await setJSON(key, { items: {}, sets: {} });
  assert.ok((await lateIds(start + 70 * MIN)).includes("p-us-pre:late"), "not done 60 min after its time: late");
  assert.ok(!(await lateIds(start + 150 * MIN)).includes("p-us-pre:late"), "outside the window");

  /* ---------------- holidays: no slot, so no late or partial report can come from a closed market */
  // Thanksgiving: NYSE is closed, so the slot keeps only oil and gold (CME trades that day, early close); no US-equity item exists.
  const itemsOn = (id: string, day: string) => TT.occurrences(T(day + "T00:00:00Z"), T(day + "T23:59:00Z")).find((o) => o.slot.id === id)?.slot.items ?? [];
  assert.deepEqual(itemsOn("p-us-pre", "2026-11-26"), ["p:oil:pre", "p:gold:pre"], "Thanksgiving: no US-equity prediction items, only CME oil and gold");
  assert.ok(itemsOn("p-us-pre", "2026-11-27").includes("p:us:pre"), "the day after: the US run is back");
  // Once oil and gold have run, nothing is reported for the day: there is no US-equity item to be late.
  const tgOcc = TT.occurrences(T("2026-11-26T00:00:00Z"), T("2026-11-26T23:59:00Z")).find((o) => o.slot.id === "p-us-pre")!;
  await setJSON(TT.runKey(tgOcc), { items: { "p:oil:pre": { at: "2026-11-26T12:31:00Z", n: 1, ok: true }, "p:gold:pre": { at: "2026-11-26T12:33:00Z", n: 1, ok: true } }, sets: {}, done: "2026-11-26T12:33:00Z" });
  assert.deepEqual(await S.lateNow(T("2026-11-26T13:45:00Z")).then((r) => r.filter((x) => x.slot.startsWith("p-us"))), [], "nothing to report for it");
  // The day's slot holds only oil and gold, so no US-equity item can be reported late or partial.

  /* ---------------- TIME-T3: summer-time switch moves a prediction slot, not its meaning */
  const usPre = (from: string) => TT.occurrences(T(from + "T00:00:00Z"), T(from + "T23:59:00Z")).find((o) => o.slot.id === "p-us-pre");
  const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
  assert.equal(hhmm(usPre("2026-10-30")!.start), "11:30", "Fri before the clocks go back: 07:30 EDT = 11:30 UTC");
  assert.equal(hhmm(usPre("2026-11-02")!.start), "12:30", "Mon after: 07:30 EST = 12:30 UTC");
  assert.equal(hhmm(usPre("2026-03-06")!.start), "12:30", "Fri before the clocks go forward");
  assert.equal(hhmm(usPre("2026-03-09")!.start), "11:30", "Mon after");
  assert.equal(hhmm(TT.itemEnd(usPre("2026-03-09")!, "p:us:pre")), "13:30", "the deadline (the open) moves with it");
  assert.equal(hhmm(TT.itemEnd(usPre("2026-11-02")!, "p:us:pre")), "14:30");

  /* ---------------- TIME-T3: lock expiry and ownership */
  const a = await takeLock("t:lock", 1);
  assert.ok(a);
  assert.equal(await takeLock("t:lock", 1), null, "held: a second taker gets nothing");
  await new Promise((r) => setTimeout(r, 1200));
  const b = await takeLock("t:lock", 5);
  assert.ok(b, "an expired lock can be taken again");
  await releaseLock("t:lock", a!); // the old holder letting go late
  assert.equal(await takeLock("t:lock", 5), null, "must not delete the new holder's lock");
  await releaseLock("t:lock", b!);
  assert.ok(await takeLock("t:lock", 5), "released by its owner: free");

  /* ---------------- row 14: the deadline is checked after the lane's wait */
  await fs.rm(process.env.STORE_DIR || "/tmp/invest-helper", { recursive: true, force: true });
  await doneBefore(T("2026-11-16T12:29:00Z"));
  const pre = TT.occurrences(T("2026-11-16T12:30:00Z"), T("2026-11-16T12:30:00Z")).find((o) => o.slot.id === "p-us-pre")!;
  assert.equal(TT.itemEnd(pre, "p:us:pre"), T("2026-11-16T14:30:00Z"));
  // 30 s before the open, the lane's gap would end after it: don't wait, run now.
  t = T("2026-11-16T14:29:30Z");
  const sleeps: number[] = [];
  const o2 = { now: () => new Date(t), sleep: async (ms: number) => { sleeps.push(ms); t += ms; } };
  await setJSON("sched:lastUnit:pred", t - 1000);
  await setJSON("sched:lastUnit:brief", t - 1000);
  const u1 = await S.runTick(o2);
  assert.ok(u1.unit?.item.startsWith("p:"), "a before-market run goes first");
  assert.equal(sleeps.length, 0, "no 64 s wait that would carry it past the open");
  assert.ok(!/too late/.test(u1.unit?.note ?? ""), "it was tried before the open");
  const cool = (await getJSON<{ cooldownUntil?: number }>("llm:usage:groq120"))?.cooldownUntil ?? 0;
  assert.ok(cool > T("2026-11-16T14:29:30Z") && cool <= T("2026-11-16T14:29:30Z") + 65_000, "the previous unit may have used 120b: it sits out the rest of the gap, the run starts on the next model");
  const mark = await getJSON<{ at: number; used120: boolean }>("sched:lastUnit:pred");
  assert.equal(typeof mark?.used120, "boolean", "the lane's mark records whether the unit used 120b");
  // The previous unit did not use 120b: no reason to hold it off.
  await fs.rm(process.env.STORE_DIR || "/tmp/invest-helper", { recursive: true, force: true });
  await doneBefore(T("2026-11-16T12:29:00Z"));
  t = T("2026-11-16T14:29:30Z");
  await setJSON("sched:lastUnit:pred", { at: t - 1000, used120: false });
  await setJSON("sched:lastUnit:brief", { at: t - 1000, used120: false });
  const u1b = await S.runTick(o2);
  assert.ok(u1b.unit?.item.startsWith("p:") && sleeps.length === 0, "run at once");
  assert.equal((await getJSON<{ cooldownUntil?: number }>("llm:usage:groq120"))?.cooldownUntil ?? 0, 0, "120b isn't held off when it wasn't used just before");
  // A wait that fits but whose sleep overshoots the deadline: not started, marked missed.
  await fs.rm(process.env.STORE_DIR || "/tmp/invest-helper", { recursive: true, force: true });
  await doneBefore(T("2026-11-16T12:29:00Z"));
  t = T("2026-11-16T14:29:50Z");
  await setJSON("sched:lastUnit:pred", { at: t - 60_000, used120: false }); // 5 s left of the gap, 10 s left to the open
  await setJSON("sched:lastUnit:brief", t - 1000);
  const o3 = { now: () => new Date(t), sleep: async (ms: number) => { sleeps.push(ms); t += 20_000; } };
  const u2 = await S.runTick(o3);
  assert.equal(sleeps.length, 1, "it waited");
  assert.ok(u2.unit && !u2.unit.ok && /too late/.test(u2.unit.note ?? ""), `after the wait the open had passed: missed, not started (${JSON.stringify(u2.unit)})`);
  const run = (await getJSON<{ items: Record<string, { n: number; ok: boolean; note?: string }> }>(TT.runKey(pre)))!;
  assert.ok(Object.values(run.items).some((x) => x.n === 2 && !x.ok && /missed/.test(x.note ?? "")), "recorded as missed so the chain ends");

  /* ---------------- row 12: closed needs proof; an outage stays pending, then expires */
  await fs.rm(process.env.STORE_DIR || "/tmp/invest-helper", { recursive: true, force: true });
  const I = [{ id: "x", name: "X", query: "x", tickers: ["AAA"] }];
  const out = (ticker: string, horizon: "today" | "this week" = "today") => ({ interest: "X", ticker, direction: "up" as const, confidence: 62, horizon, action: "HOLD" as const, actionTrigger: "", rationale: "", risks: "" });
  await TR.recordCalls([out("AAA")], I, "groq", at("2026-11-18T12:30:00Z"), "calls:o", { phase: "pre" });
  closes.AAA = [["2026-11-13", 100], ["2026-11-16", 100], ["2026-11-17", 100]]; // the source stopped at the 17th
  const load = async () => (await getJSON<Call[]>("calls:o"))!;
  sparkHits = 0;
  assert.equal(await TR.gradeCalls(at("2026-11-21T00:00:00Z"), "calls:o"), 0);
  let c = (await load())[0];
  assert.ok(!c.closed && !c.gradedAt, "3 days with no bar and no later bar: an outage, not 'market closed'");
  const hitsAfterFirst = sparkHits;
  assert.ok(hitsAfterFirst > 0);
  await TR.gradeCalls(at("2026-11-21T01:00:00Z"), "calls:o");
  assert.equal(sparkHits, hitsAfterFirst, "an hour later: not fetched again (capped retry)");
  await TR.gradeCalls(at("2026-11-21T07:00:00Z"), "calls:o");
  assert.ok(sparkHits > hitsAfterFirst, "6 h later: tried again");
  assert.equal(TR.computeStats(await load()).pending.length, 1, "still shown as waiting");
  closes.AAA.push(["2026-11-19", 101]); // a later bar, none for the 18th: the market was closed
  await TR.gradeCalls(at("2026-11-21T14:00:00Z"), "calls:o");
  c = (await load())[0];
  assert.equal(c.closed, true, "a later bar is proof the market traded without that day");
  // A listed holiday is closed at once, with no later bar to wait for (holidays.ts; Thanksgiving 2026 for NYSE).
  await TR.recordCalls([out("AAA")], I, "groq", at("2026-11-25T12:30:00Z"), "calls:hol", { phase: "pre" });
  const hc = (await getJSON<Call[]>("calls:hol"))!;
  hc[0].date = "2026-11-26";
  hc[0].id = "2026-11-26:AAA:d";
  await setJSON("calls:hol", hc);
  closes.AAA = [["2026-11-24", 100], ["2026-11-25", 100]];
  assert.equal(await TR.gradeCalls(at("2026-11-26T22:00:00Z"), "calls:hol"), 1, "no later bar needed on a listed holiday");
  assert.equal((await getJSON<Call[]>("calls:hol"))![0].closed, true);

  await TR.recordCalls([out("AAA")], I, "groq", at("2026-11-23T12:30:00Z"), "calls:e", { phase: "pre" });
  closes.AAA = [["2026-11-13", 100], ["2026-11-16", 100], ["2026-11-17", 100]];
  assert.equal(await TR.gradeCalls(at("2026-12-01T00:00:00Z"), "calls:e"), 0);
  assert.ok(!(await getJSON<Call[]>("calls:e"))![0].expired, "8 days: still waiting");
  await TR.gradeCalls(at("2026-12-04T12:00:00Z"), "calls:e");
  const e = (await getJSON<Call[]>("calls:e"))![0];
  assert.deepEqual([e.expired, e.closed, !!e.gradedAt, e.correct], [true, undefined, true, undefined], "10+ days with no data: expired, not graded, not 'closed'");
  const es = TR.computeStats([e]);
  assert.deepEqual([es.expired, es.closed, es.pending.length, es.uncounted, es.graded], [1, 0, 0, 0, 0], "counted separately");
  // A call older than the price history can reach (no bar before it) ends the same way, not pending forever.
  await TR.recordCalls([out("AAA")], I, "groq", at("2026-11-02T12:30:00Z"), "calls:old", { phase: "pre" });
  closes.AAA = [["2026-11-12", 100], ["2026-11-13", 101], ["2026-11-16", 102], ["2026-11-17", 103], ["2026-11-18", 104]];
  await TR.gradeCalls(at("2026-11-20T00:00:00Z"), "calls:old");
  assert.equal((await getJSON<Call[]>("calls:old"))![0].expired, true, "no base bar and 18 days old: expired");

  /* ---------------- row 13: an ETF stand-in grades on New York's clock, and says so */
  await TR.recordCalls([out("^STOXX50E")], [{ id: "s", name: "S", query: "", tickers: ["^STOXX50E"] }], "groq", at("2026-11-18T06:30:00Z"), "calls:p", { phase: "pre" });
  let p = (await getJSON<Call[]>("calls:p"))![0];
  const idxClose = TR.gradesAfter(p);
  assert.ok(idxClose < "2026-11-18T18:00:00.000Z", `before the proxy is known: the index's own close (${idxClose})`);
  chartBars.FEZ = [["2026-11-16", 50], ["2026-11-17", 50], ["2026-11-18", 51]];
  await TR.gradeCalls(at("2026-11-18T17:30:00Z"), "calls:p"); // Europe has closed, New York hasn't
  p = (await getJSON<Call[]>("calls:p"))![0];
  assert.equal(p.proxy, "FEZ", "the stand-in is remembered on the call");
  assert.equal(p.correct, undefined, "not graded before New York closes");
  assert.equal(TR.gradesAfter(p), "2026-11-18T21:15:00.000Z", "shown grade time: New York's close + settling");
  assert.equal(TR.computeStats([p]).pending[0].gradesAfter, "2026-11-18T21:15:00.000Z", "the pending list agrees");
  assert.equal(TR.computeStats([p]).pending[0].closesAt, "2026-11-18T21:00:00.000Z");
  sparkHits = 0;
  await TR.gradeCalls(at("2026-11-18T19:00:00Z"), "calls:p");
  assert.equal(sparkHits, 0, "no hourly fetches while New York is still open");

  console.log("ROW08-14 OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
