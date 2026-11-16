/**
 * v13: the scheduler. Timetable math, one unit per tick with the 65 s gap, skip rules (fresh
 * briefings, manual refreshes), one retry after an AI failure, the lock, late/missed detection,
 * the alerts window, and the tick route (auth, 503 when late). Fake clock, no network.
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
    const content = system.startsWith("You translate") ? JSON.stringify((JSON.parse(body.messages[1].content) as string[]).map((s) => `vi:${s}`)) : analysisJson;
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 6000 } }), { status: 200 });
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
  const M = await import("../src/lib/llm/models");
  const { getJSON, setJSON, takeLock, releaseLock } = await import("../src/lib/store");

  /* ---------------- timetable */
  assert.deepEqual(M.scheduledPerDay(new Date("2026-11-16T09:00:00Z")), { shared: 11, admin: 6 }, "weekday budget comes from the timetable");
  assert.deepEqual(M.scheduledPerDay(new Date("2026-11-22T09:00:00Z")), { shared: 6, admin: 3 }, "Sunday");
  assert.deepEqual(M.scheduledPerDay(new Date("2026-11-21T09:00:00Z")), { shared: 0, admin: 0 }, "Saturday");
  const mon = TT.occurrences(T("2026-11-16T00:00:00Z"), T("2026-11-16T23:59:00Z"));
  assert.deepEqual(mon.map((o) => o.slot.at), ["01:15", "04:35", "08:10", "10:30", "12:30", "21:20"]);
  assert.equal(mon[0].end, T("2026-11-16T04:35:00Z"), "a slot stays open until the next one starts");
  assert.equal(mon[4].end, T("2026-11-16T18:30:00Z"), "... at most 6 hours");
  const fri = TT.occurrences(T("2026-11-20T21:00:00Z"), T("2026-11-20T22:00:00Z"))[0];
  assert.equal(fri.end, T("2026-11-21T03:20:00Z"), "Friday's last slot doesn't run on into Saturday");
  assert.deepEqual(TT.openOccurrences(T("2026-11-16T01:20:00Z")).map((o) => o.slot.id), ["wd-0115"], "Sunday 20:05 closed when Monday 01:15 began");
  assert.deepEqual(TT.openOccurrences(T("2026-11-21T12:00:00Z")), [], "Saturday: nothing open");
  assert.deepEqual(TT.openOccurrences(T("2026-11-16T01:00:00Z")).map((o) => o.slot.id), ["su-2005"], "Sunday 20:05 may catch up until Monday's first slot");

  /* ---------------- a slot runs one unit per tick, in timetable order, 65 s apart */
  let t = T("2026-11-16T01:16:00Z");
  const sleeps: number[] = [];
  const opts = { now: () => new Date(t), sleep: async (ms: number) => { sleeps.push(ms); t += ms; } };
  const tick = async () => {
    const r = await S.runTick(opts);
    t += 30_000; // each unit takes a while
    return r;
  };
  const r1 = await tick();
  assert.deepEqual([r1.unit?.slot, r1.unit?.item, r1.unit?.ok], ["wd-0115", "vn", true], "the graded VN call first");
  assert.ok(calls.some((c) => c.model === "openai/gpt-oss-120b"), "shared briefing on 120b");
  assert.ok(calls.some((c) => c.system.startsWith("You translate")), "then pre-translated into Vietnamese");
  assert.deepEqual(sleeps, [], "no wait before the first unit");
  const r2 = await tick();
  assert.equal(r2.unit?.item, "world");
  assert.equal(sleeps.length, 1, "waited for Groq's per-minute window");
  assert.ok(sleeps[0] > 30_000 && sleeps[0] <= 65_000);
  const r3 = await tick();
  assert.deepEqual([r3.unit?.item, !!r3.unit?.set], ["interests:all", true], "then the interest sets");
  calls.length = 0;
  const r4 = await tick();
  assert.equal(r4.unit, undefined, "nothing left");
  assert.equal(calls.length, 0, "an idle tick costs no AI");
  const run1 = await getJSON<{ done?: string; items: Record<string, { n: number; ok: boolean }> }>("sched:2026-11-16:wd-0115");
  assert.ok(run1?.done, "slot marked done");
  assert.equal(run1!.items["interests:all"].ok, true);
  const again = await tick();
  assert.equal(again.unit, undefined, "a duplicate poke does nothing");

  /* ---------------- next slot: the same sections run again (written before 30 min ahead of it) */
  t = T("2026-11-16T04:36:00Z");
  assert.equal((await tick()).unit?.item, "vn");
  assert.equal((await tick()).unit?.item, "interests:admin", "the admin-only slot");
  assert.equal((await tick()).unit, undefined);

  /* ---------------- skip rule: a briefing written since 30 min before the slot counts (a manual refresh) */
  await setJSON("digest:world:en:last", { at: "2026-11-16T07:50:00.000Z", provider: "groq:openai/gpt-oss-120b", ok: true });
  t = T("2026-11-16T08:11:00Z");
  assert.equal((await tick()).unit?.item, "vn");
  const r6 = await tick();
  assert.equal(r6.unit?.item, "interests:all", "World was refreshed by hand at 07:50: skipped");
  const run2 = await getJSON<{ items: Record<string, { note?: string }> }>("sched:2026-11-16:wd-0810");
  assert.equal(run2!.items.world!.note, "fresh");

  /* ---------------- AI down: the unit is recorded as failed, retried once 20 min later, then given up */
  t = T("2026-11-16T12:31:00Z");
  down = true;
  const f1 = await tick();
  assert.deepEqual([f1.unit?.item, f1.unit?.ok], ["us", false], "AI failed: rule-based copy isn't a success");
  assert.equal((await tick()).unit?.item, "world", "moves on while US waits for its retry");
  assert.equal((await tick()).unit?.item, "vn");
  assert.equal((await tick()).unit?.item, "interests:all", "the admin set fails too");
  assert.equal((await tick()).unit, undefined, "everything is waiting: idle");
  t = T("2026-11-16T12:53:00Z");
  const f2 = await tick();
  assert.deepEqual([f2.unit?.item, f2.unit?.ok], ["us", false], "one retry after 20 min");
  down = false;
  const f3 = await tick();
  assert.deepEqual([f3.unit?.item, f3.unit?.ok], ["world", true], "the retry can succeed");
  assert.equal((await tick()).unit?.item, "vn");
  assert.equal((await tick()).unit?.item, "interests:all");
  calls.length = 0;
  assert.equal((await tick()).unit, undefined, "US gave up after two attempts: no third AI call");
  assert.equal(calls.length, 0);
  const rep = await S.scheduleReport(T("2026-11-16T13:30:00Z"));
  const s1230 = rep.slots.find((x) => x.slot === "wd-1230")!;
  assert.equal(s1230.state, "partial", "finished, with a section that failed twice");
  assert.deepEqual(s1230.failed, ["us"]);
  assert.equal(rep.slots.find((x) => x.slot === "wd-0115")!.state, "done");
  assert.deepEqual(rep.slots.find((x) => x.slot === "wd-0115")!.sets, { ran: 1, ok: 1 }, "set counts, no hashes");

  /* ---------------- a unit cut off by the time limit counts as a try (no endless paid re-runs) */
  await setJSON("sched:2026-11-17:wd-0115", { items: { vn: { at: "2026-11-17T01:16:00.000Z", n: 1, ok: false, note: "started" } }, sets: {} });
  t = T("2026-11-17T01:22:00Z");
  assert.equal((await tick()).unit?.item, "world", "VN was cut off at 01:16: it waits for its retry instead of running again now");
  await setJSON("sched:2026-11-17:wd-0115", { items: { vn: { at: "2026-11-17T01:16:00.000Z", n: 2, ok: false, note: "started" } }, sets: {} });
  t = T("2026-11-17T02:00:00Z");
  assert.notEqual((await tick()).unit?.item, "vn", "cut off twice: given up");

  /* ---------------- the lock: overlapping pokes do nothing */
  const held = await takeLock("sched:lock", 300);
  assert.ok(held);
  assert.deepEqual(await S.runTick(opts), { busy: true });
  await releaseLock("sched:lock", "someone else");
  assert.deepEqual(await S.runTick(opts), { busy: true }, "only the holder can release it");
  await releaseLock("sched:lock", held!);

  /* ---------------- late and missed: nobody poked the 21:20 slot */
  const late = await S.lateNow(T("2026-11-16T22:25:00Z"));
  assert.deepEqual(late.map((x) => [x.slot, x.state]), [["wd-2120", "late"]], "late 60 min after its time");
  assert.deepEqual(await S.lateNow(T("2026-11-16T23:30:00Z")), [], "reported for an hour only, so a watchdog emails once or twice");
  assert.deepEqual(await S.lateNow(T("2026-11-16T21:50:00Z")), [], "not late yet");
  const rep2 = await S.scheduleReport(T("2026-11-17T04:00:00Z"));
  assert.ok(rep2.late.includes("wd-2120"), "the report keeps it for 24 h");
  assert.equal(rep2.slots.find((x) => x.slot === "wd-2120")!.state, "missed", "its window closed");

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
