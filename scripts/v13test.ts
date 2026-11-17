/**
 * v13 (updated for v18): the scheduler. Timetable math (UTC briefings, local-time predictions), one
 * unit per tick on two lanes (predictions, briefings) each with the 65 s gap, per-item deadlines, skip
 * rules (fresh briefings, manual refreshes), one retry after an AI failure, the lock, late/missed
 * detection, the alerts window, and the tick route (auth, 503 when late). Fake clock, no network.
 * `npx tsx scripts/v13test.ts`
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";

process.env.VERCEL = "1";
delete process.env.KV_REST_API_URL;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LLM_PROVIDER;
delete process.env.APP_URL;
delete process.env.VERCEL_URL;
delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
for (const k of ["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"]) delete process.env[k];
process.env.GROQ_API_KEY = "g";
process.env.GEMINI_API_KEY = "m";
process.env.CRON_SECRET = "cron";
process.env.TICK_SECRET = "tick";

const calls: { model: string; system: string }[] = [];
/** The fake clock the price mocks follow (set by the tick's `now`). */
let mockNow = Date.now();
let down = false;
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
    calls.push({ model: body.model, system });
    if (down) return new Response("unavailable", { status: 503 });
    const user: string = body.messages[1]?.content ?? "";
    let content = analysisJson;
    if (system.startsWith("You translate")) content = JSON.stringify((JSON.parse(user) as string[]).map((s) => `vi:${s}`));
    else if (system.includes("You are the forecaster")) {
      // One call per market in the prompt (plus a weekly one before the open).
      const marks = [...user.matchAll(/^- (.+?) \(benchmark (\S+?)[;)]/gm)];
      const hz = user.includes("BEFORE-MARKET") ? ["today", "this week"] : ["today"];
      content = JSON.stringify({ calls: marks.flatMap((m) => hz.map((h) => ({ interest: m[1], ticker: m[2], horizon: h, direction: "up", confidence: 60, action: "HOLD", action_trigger: "t", rationale: "r", risks: "k" }))) });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 6000 } }), { status: 200 });
  }
  // Prices, all relative to the test's fake clock (`mockNow`): daily closes up to yesterday, and the
  // last two hours of minute prices for "live" (Yahoo spark, DNSE, Eastmoney). Predictions need both.
  const mins = (n: number, step: number) => Array.from({ length: n }, (_, i) => Math.floor(mockNow / 1000) - (n - 1 - i) * step);
  const days = () => Array.from({ length: 30 }, (_, i) => Math.floor(mockNow / 86400_000) * 86400 - (30 - i) * 86400 + 12 * 3600);
  if (url.includes("/v8/finance/spark")) {
    const syms = decodeURIComponent(url.split("symbols=")[1].split("&")[0]).split(",");
    const ts = url.includes("range=1d") ? mins(24, 300) : days();
    return new Response(JSON.stringify(Object.fromEntries(syms.map((sym) => [sym, { timestamp: ts, close: ts.map((_, i) => 100 + i * 0.1), chartPreviousClose: 99 }]))), { status: 200 });
  }
  if (url.includes("vndirect.com.vn") && url.includes("q=code:")) {
    const codes = decodeURIComponent(url.split("q=code:")[1].split("~")[0]).split(",");
    const rows = codes.flatMap((code) => days().map((ts, i) => ({ code, date: new Date(ts * 1000).toISOString().slice(0, 10), close: 50 + i * 0.1, adClose: 50 + i * 0.1, nmVolume: 9, accumulatedVol: 9 })));
    return new Response(JSON.stringify({ data: rows }), { status: 200 });
  }
  if (url.includes("entrade.com.vn")) {
    const t = mins(120, 60);
    return new Response(JSON.stringify({ t, o: t.map(() => 50), h: t.map(() => 51), l: t.map(() => 49), c: t.map((_, i) => 50 + i * 0.01), v: t.map(() => 9) }), { status: 200 });
  }
  if (url.includes("eastmoney.com")) {
    const bj = (sec: number) => new Date(sec * 1000 + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
    return new Response(JSON.stringify({ data: { preClose: 100, trends: mins(120, 60).map((sec, i) => `${bj(sec)},${100 + i * 0.01}`) } }), { status: 200 });
  }
  if (/rss|news\.google|feeds|\.xml/.test(url)) {
    const items = Array.from({ length: 5 }, (_, i) => `<item><title>Stocks rise on day ${i}</title><link>https://n/${i}</link><pubDate>${new Date().toUTCString()}</pubDate></item>`).join("");
    return new Response(`<?xml version="1.0"?><rss><channel>${items}</channel></rss>`, { status: 200 });
  }
  return new Response("", { status: 404 });
}) as typeof fetch;

const T = (s: string) => Date.parse(s);
const MIN = 60_000;

(async () => {
  await fs.rm("/tmp/invest-helper", { recursive: true, force: true });
  const TT = await import("../src/lib/timetable");
  const S = await import("../src/lib/scheduler");
  S.setTimetableSince(0); // these tests replay mid-November 2026, before the v18 timetable went live
  const M = await import("../src/lib/llm/models");
  const { getJSON, setJSON, takeLock, releaseLock } = await import("../src/lib/store");
  /** Mark every slot that started before `ms` as done (a clean start without old catch-up work). */
  const doneBefore = async (ms: number) => {
    for (const o of TT.occurrences(ms - 3 * 86400_000, ms - 1)) if (!(await getJSON(TT.runKey(o)))) await setJSON(TT.runKey(o), { items: {}, sets: {}, done: "seed" });
  };

  /* ---------------- timetable */
  const day = (from: string, to: string) => TT.occurrences(T(from), T(to));
  const mon = day("2026-11-16T00:00:00Z", "2026-11-16T23:59:00Z");
  assert.deepEqual(mon.filter((o) => o.slot.id.startsWith("b-")).map((o) => o.slot.at), ["01:15", "02:15", "04:35", "08:10", "10:30", "12:30", "15:30", "17:00", "21:20"], "briefings: 9 slots a day");
  assert.equal(day("2026-11-21T00:00:00Z", "2026-11-21T23:59:00Z").filter((o) => o.slot.id.startsWith("b-")).length, 9, "Saturday: the same briefings (v18)");
  assert.equal(day("2026-11-21T00:00:00Z", "2026-11-21T23:59:00Z").filter((o) => o.slot.id.startsWith("p-")).length, 0, "Saturday: no predictions");
  const at = (o: { start: number }) => new Date(o.start).toISOString().slice(11, 16);
  const pmon = mon.filter((o) => o.slot.id.startsWith("p-"));
  assert.deepEqual(pmon.map((o) => `${o.slot.id}@${at(o)}`), ["p-cn-pre@00:00", "p-vn-pre@00:45", "p-jp-mid@02:45", "p-cn-mid@04:15", "p-vn-mid@04:35", "p-eu-pre@06:30", "p-eu-mid@12:00", "p-us-pre@12:30", "p-us-mid@17:00", "p-jp-pre@22:30"], "winter: before-market runs 75-120 min before each open");
  assert.equal(pmon.at(-1)!.date, "2026-11-17", "Japan's 22:30 UTC run is Tuesday's before-market (07:30 Tokyo)");
  assert.ok(day("2026-11-15T22:00:00Z", "2026-11-15T23:59:00Z").some((o) => o.slot.id === "p-jp-pre" && o.date === "2026-11-16"), "Sunday 22:30 UTC: Monday in Tokyo");
  assert.ok(!day("2026-11-20T22:00:00Z", "2026-11-20T23:59:00Z").some((o) => o.slot.id === "p-jp-pre"), "Friday 22:30 UTC is Saturday in Tokyo: none");
  for (const id of ["p-jp-pre", "p-cn-pre", "p-vn-pre", "p-eu-pre", "p-us-pre"]) {
    const o = mon.find((x) => x.slot.id === id) ?? TT.occurrences(T("2026-11-16T00:00:00Z"), T("2026-11-17T23:59:00Z")).find((x) => x.slot.id === id)!;
    const item = o.slot.items[0];
    assert.ok(TT.itemEnd(o, item) - o.start >= 75 * MIN, `${id}: at least 75 minutes before the open, so a missed poke can't miss the run`);
  }
  const jul = day("2026-07-15T00:00:00Z", "2026-07-15T23:59:00Z");
  const s = (id: string) => at(jul.find((o) => o.slot.id === id)!);
  assert.deepEqual([s("p-eu-pre"), s("p-eu-mid"), s("p-us-pre"), s("p-us-mid"), s("p-vn-pre")], ["05:30", "11:00", "11:30", "16:00", "00:45"], "summer: London and New York runs move with their clocks, Hanoi doesn't");
  // Per-item deadlines
  const o = (id: string) => mon.find((x) => x.slot.id === id)!;
  assert.equal(TT.itemEnd(o("p-vn-pre"), "p:vn:pre"), T("2026-11-16T02:00:00Z"), "before market: until the HOSE open");
  assert.equal(TT.itemEnd(o("p-cn-pre"), "p:cn:pre"), T("2026-11-16T01:30:00Z"), "Hong Kong opens 09:30");
  assert.equal(TT.itemEnd(o("p-us-pre"), "p:us:pre"), T("2026-11-16T14:30:00Z"));
  assert.equal(TT.itemEnd(o("p-vn-mid"), "p:vn:mid"), T("2026-11-16T06:05:00Z"), "mid-day: 90 minutes");
  assert.equal(TT.itemEnd(o("b-1530"), "us"), T("2026-11-16T17:00:00Z"), "a briefing runs until the same briefing's next slot");
  assert.equal(TT.itemEnd(o("b-0115"), "vn"), T("2026-11-16T04:35:00Z"));
  assert.equal(TT.itemEnd(o("b-1230"), "interests:all"), T("2026-11-16T18:30:00Z"), "at most 6 hours");
  assert.deepEqual(M.scheduledPerDay(new Date("2026-11-16T09:00:00Z")), { shared: 16, admin: 4 }, "the 120b reserve counts predictions from the timetable");

  /* ---------------- a slot runs one unit per tick on two lanes, each lane 65 s apart */
  await doneBefore(T("2026-11-16T00:00:00Z"));
  let t = T("2026-11-16T01:16:00Z");
  const sleeps: number[] = [];
  const opts = { now: () => ((mockNow = t), new Date(t)), sleep: async (ms: number) => { sleeps.push(ms); t += ms; } };
  const runs: { item: string; at: number; ok: boolean; slot: string; set?: string }[] = [];
  const tick = async () => {
    const r = await S.runTick(opts);
    if (r.unit) runs.push({ ...r.unit, at: t });
    t += 30_000; // each unit takes a while
    return r;
  };
  const drain = async (max = 40) => {
    const out: typeof runs = [];
    for (let i = 0; i < max; i++) {
      const before = runs.length;
      await tick();
      if (runs.length === before) break;
      out.push(runs.at(-1)!);
    }
    return out;
  };
  const u1 = await drain();
  assert.equal(u1[0].item, "p:cn:pre", "predictions first: the oldest open slot (China/HK, 01:00)");
  assert.deepEqual(u1.filter((u) => u.item.startsWith("p:")).map((u) => u.item), ["p:cn:pre", "p:vn:pre"], "the default set has no Vietnamese part: no p:ivn run");
  assert.deepEqual(u1.filter((u) => !u.item.startsWith("p:")).map((u) => u.item), ["vn", "world", "interests:all"], "briefings in timetable order");
  assert.ok(u1.every((u) => u.ok), JSON.stringify(u1));
  for (const lane of ["p:", ""]) {
    const xs = u1.filter((u) => (lane ? u.item.startsWith(lane) : !u.item.startsWith("p:")));
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i].at - xs[i - 1].at >= 65_000, `same lane 65 s apart (${xs[i - 1].item} → ${xs[i].item})`);
  }
  assert.ok(u1[1].at - u1[0].at < 65_000, "the other lane doesn't wait for Groq's per-minute window");
  assert.ok(calls.some((c) => c.model === "gemini-3.5-flash-lite" && !c.system.includes("forecaster")), "briefings on Flash-Lite");
  assert.ok(calls.some((c) => c.model === "openai/gpt-oss-120b" && c.system.includes("forecaster")), "predictions on 120b");
  assert.ok(calls.some((c) => c.system.startsWith("You translate")), "Vietnam pre-translated into Vietnamese");
  const vnCalls = (await getJSON<{ id: string }[]>("calls:vn"))!;
  assert.equal(vnCalls.filter((c) => c.id.endsWith(":d")).length, 6, "Vietnam: a daily call per group");
  assert.equal(vnCalls.filter((c) => c.id.endsWith(":w")).length, 6, "and a weekly one, before the open only");
  calls.length = 0;
  assert.equal((await tick()).unit, undefined, "nothing left");
  assert.equal(calls.length, 0, "an idle tick costs no AI");
  const run1 = await getJSON<{ done?: string; items: Record<string, { n: number; ok: boolean; note?: string }> }>("sched:2026-11-16:p-vn-pre");
  assert.ok(run1?.done, "slot marked done");
  assert.equal(run1!.items["p:ivn:pre"].note, "no sets due");

  /* ---------------- mid-day: daily calls only */
  t = T("2026-11-16T04:36:00Z");
  const u2 = await drain();
  assert.deepEqual(u2.map((u) => u.item).sort(), ["interests:admin", "p:cn:mid", "p:vn:mid", "us", "vn"].sort(), "nobody poked between 01:20 and 04:36: the 02:15 US briefing catches up, Japan's 02:45 mid-day run (90 min) is missed");
  assert.equal((await S.scheduleReport(t)).slots.find((x) => x.slot === "p-jp-mid")!.state, "missed", "and reported as missed");
  assert.equal((await getJSON<{ id: string }[]>("calls:vn"))!.filter((c) => c.id.endsWith(":m")).length, 6, "mid-day calls kept apart from the before-market ones");
  assert.equal((await getJSON<{ id: string }[]>("calls:vn"))!.filter((c) => c.id.endsWith(":w")).length, 6, "no new weekly calls at mid-day");

  /* ---------------- skip rule: a briefing written since 30 min before the slot counts (a manual refresh) */
  await doneBefore(T("2026-11-16T08:00:00Z"));
  await setJSON("digest:world:en:last", { at: "2026-11-16T07:50:00.000Z", provider: "groq:openai/gpt-oss-120b", ok: true });
  t = T("2026-11-16T08:11:00Z");
  const u3 = await drain();
  assert.deepEqual(u3.map((u) => u.item), ["vn", "interests:all"], "World was refreshed by hand at 07:50: skipped");
  const run2 = await getJSON<{ items: Record<string, { note?: string }> }>("sched:2026-11-16:b-0810");
  assert.equal(run2!.items.world!.note, "fresh");

  /* ---------------- AI down: failed (no rule-based predictions), retried once 20 min later, then given up */
  await doneBefore(T("2026-11-16T12:30:00Z"));
  t = T("2026-11-16T12:31:00Z");
  down = true;
  const f1 = await drain();
  assert.ok(f1.length >= 8 && f1.every((u) => !u.ok), "everything failed once");
  assert.ok(f1.some((u) => u.item === "p:oil:pre") && f1.some((u) => u.item === "p:gold:pre"), "oil and gold are their own runs");
  assert.equal((await tick()).unit, undefined, "everything is waiting for its retry: idle");
  assert.equal(await getJSON("pred:oil"), null, "a failed prediction stores nothing");
  t = T("2026-11-16T12:55:00Z");
  const f2 = await tick();
  assert.equal(f2.unit?.ok, false, "one retry after 20 min, still down");
  down = false;
  const rest = await drain();
  assert.ok(rest.length >= 7 && rest.every((u) => u.ok), "the retries can succeed");
  calls.length = 0;
  assert.equal((await tick()).unit, undefined, "the one that failed twice gave up: no third AI call");
  assert.equal(calls.length, 0);
  const rep = await S.scheduleReport(T("2026-11-16T13:30:00Z"));
  const failedSlot = rep.slots.find((x) => x.slot === f2.unit!.slot)!;
  assert.equal(failedSlot.state, "partial", "finished, with an item that failed twice");
  assert.equal(failedSlot.failed?.length, 1, `exactly the item that failed twice (${failedSlot.failed})`);
  assert.equal(rep.slots.find((x) => x.slot === "b-0115")!.state, "done");
  assert.deepEqual(rep.slots.find((x) => x.slot === "b-0115")!.sets, { ran: 1, ok: 1 }, "set counts, no hashes");

  /* ---------------- a before-market prediction past the open is missed, never run late */
  await doneBefore(T("2026-11-18T00:00:00Z"));
  const nu = await S.nextUnits(T("2026-11-18T02:01:00Z"));
  assert.ok(!nu.pred || !["p:vn:pre", "p:cn:pre"].includes(nu.pred.item), "past the HOSE / Hong Kong open: not run");
  const rep3 = await S.scheduleReport(T("2026-11-18T02:30:00Z"));
  assert.equal(rep3.slots.find((x) => x.slot === "p-vn-pre" && x.start.startsWith("2026-11-18"))!.state, "missed", "reported as missed");
  // Inside a slot that's still open, an item past its own deadline is marked and the rest go on.
  await setJSON("sched:2026-11-18:b-1230", { items: {}, sets: {} });
  await S.nextUnits(T("2026-11-18T16:00:00Z"));
  const b1230 = await getJSON<{ items: Record<string, { note?: string }> }>("sched:2026-11-18:b-1230");
  assert.equal(b1230!.items.us!.note, "missed: too late", "US's 12:30 briefing gave way to the 15:30 one");

  /* ---------------- a unit cut off by the time limit counts as a try (no endless paid re-runs) */
  await doneBefore(T("2026-11-17T01:15:00Z"));
  await setJSON("sched:2026-11-17:b-0115", { items: { vn: { at: "2026-11-17T01:16:00.000Z", n: 1, ok: false, note: "started" } }, sets: {} });
  assert.equal((await S.nextUnits(T("2026-11-17T01:22:00Z"))).brief?.item, "world", "VN was cut off at 01:16: it waits for its retry instead of running again now");
  await setJSON("sched:2026-11-17:b-0115", { items: { vn: { at: "2026-11-17T01:16:00.000Z", n: 2, ok: false, note: "started" } }, sets: {} });
  assert.notEqual((await S.nextUnits(T("2026-11-17T02:00:00Z"))).brief?.item, "vn", "cut off twice: given up");

  /* ---------------- the lock: overlapping pokes do nothing */
  const held = await takeLock("sched:lock", 300);
  assert.ok(held);
  assert.deepEqual(await S.runTick(opts), { busy: true });
  await releaseLock("sched:lock", "someone else");
  assert.deepEqual(await S.runTick(opts), { busy: true }, "only the holder can release it");
  await releaseLock("sched:lock", held!);

  /* ---------------- late and missed: nobody poked Thursday's 21:20 slot */
  const late = await S.lateNow(T("2026-11-19T22:25:00Z"));
  assert.deepEqual(late.map((x) => [x.slot, x.state]), [["b-2120", "late"]], "late 60 min after its time");
  assert.deepEqual((await S.lateNow(T("2026-11-19T23:30:00Z"))).filter((x) => x.slot === "b-2120"), [], "reported for an hour only, so a watchdog emails once or twice");
  assert.deepEqual(await S.lateNow(T("2026-11-19T21:50:00Z")), [], "not late yet");
  const rep2 = await S.scheduleReport(T("2026-11-20T04:00:00Z"));
  assert.ok(rep2.late.includes("b-2120"), "the report keeps it for 24 h");
  assert.equal(rep2.slots.find((x) => x.slot === "b-2120")!.state, "missed", "its window closed");

  /* ---------------- slots from before the timetable went live aren't reported (they never existed) */
  S.setTimetableSince(T("2026-11-20T00:00:00Z"));
  assert.ok(!(await S.scheduleReport(T("2026-11-20T04:00:00Z"))).late.includes("b-2120"), "Thursday's 21:20 predates the cut-over: not reported");
  assert.deepEqual(await S.lateNow(T("2026-11-19T22:25:00Z")), [], "and doesn't page the watchdog");
  S.setTimetableSince(0);

  /* ---------------- price alerts: weekdays 13:00-22:00 UTC, every 20 min, inside the tick */
  assert.equal(S.alertsWindow(new Date("2026-11-16T13:05:00Z")), true);
  assert.equal(S.alertsWindow(new Date("2026-11-16T22:00:00Z")), false);
  assert.equal(S.alertsWindow(new Date("2026-11-21T15:00:00Z")), false, "not on Saturday");
  t = T("2026-11-16T15:00:00Z");
  const a1 = await S.runTick(opts);
  assert.equal(typeof a1.alerts, "number", "alerts ran");
  t += 10 * MIN;
  assert.equal((await S.runTick(opts)).alerts, undefined, "not again within 20 min");
  t += 10 * MIN;
  assert.equal(typeof (await S.runTick(opts)).alerts, "number", "20 min later: again");

  /* ---------------- the route: secret required, answers 503 while a slot is late */
  const route = await import("../src/app/api/cron/tick/route");
  const req = (auth?: string) => new Request("http://x/api/cron/tick?src=test", { headers: auth ? { authorization: `Bearer ${auth}` } : {} });
  const lock = await takeLock("sched:lock", 300); // keep the real-clock tick from running units
  assert.equal((await route.GET(req())).status, 401);
  assert.equal((await route.GET(req("wrong"))).status, 401);
  const ok = await route.GET(req("tick"));
  assert.ok([200, 503].includes(ok.status), "TICK_SECRET works");
  assert.ok([200, 503].includes((await route.GET(req("cron"))).status), "CRON_SECRET (what Vercel sends) works");
  const tk = await getJSON<{ src: string }>("sched:tick");
  assert.equal(tk?.src, "test", "the last tick and its source are recorded");
  await releaseLock("sched:lock", lock!);

  /* ---------------- /api/status?schedule=1 is public and has no secrets */
  const status = await import("../src/app/api/status/route");
  const st = await (await status.GET(new Request("http://x/api/status?schedule=1"))).json();
  assert.ok(Array.isArray(st.schedule.slots) && "lastTick" in st.schedule);
  assert.ok(!JSON.stringify(st).includes("tick\""), "no secret values");
  const plain = await (await status.GET(new Request("http://x/api/status"))).json();
  assert.equal(plain.schedule, undefined, "page loads don't pay for the report");

  console.log("V13 OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
