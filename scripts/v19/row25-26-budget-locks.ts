/**
 * v19 audit rows 25 and 26.
 *  - row 25: Flash-Lite reserve for the scheduled shared and admin briefings (visitor routes refused
 *    when the requests left on both Flash-Lite models fall below it; it shrinks as the day's slots pass;
 *    shown in aiUsage);
 *  - row 26: cross-instance store locks: two concurrent catch-ups make one briefing, two concurrent
 *    headline translations call the translator once, two concurrent concept loads translate once.
 * Instances are simulated by concurrent calls sharing one store (the lock lives in the store).
 * `npx tsx scripts/v19/row25-26-budget-locks.ts`
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "fs";
import { pinClock } from "../clock";
import { isStoryCall, storyReply } from "../story-reply";

pinClock("2026-11-24T09:00:00Z"); // a Tuesday

process.env.VERCEL = "1";
delete process.env.KV_REST_API_URL;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LLM_PROVIDER;
for (const k of ["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "APP_PASSWORD"]) delete process.env[k];
process.env.GROQ_API_KEY = "g";
process.env.GEMINI_API_KEY = "m";
process.env.GEMINI_RPD = "100";
process.env.AI_USER_CEILING = "1"; // isolate the reserve from the visitor ceiling
delete process.env.BIG_STORY_DAILY_LIMIT;

let storyCalls = 0;
let translatorCalls = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("api.groq.com") || url.includes("generativelanguage")) {
    const body = JSON.parse(String(init?.body));
    const system: string = body.messages[0].content;
    let content = "plain";
    if (isStoryCall(system)) {
      storyCalls++;
      await sleep(250); // long enough for the second caller to arrive while the first is working
      content = storyReply(body.messages[1].content);
    } else if (system.startsWith("You translate")) {
      translatorCalls++;
      await sleep(250);
      content = JSON.stringify((JSON.parse(body.messages[1].content) as string[]).map((s) => `vi:${s}`));
    } else if (/concept cards/.test(system)) content = JSON.stringify({ concepts: [] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 6000 } }), { status: 200 });
  }
  if (/rss|news\.google|feeds|\.xml/.test(url)) {
    const items = Array.from({ length: 12 }, (_, i) => `<item><title>Stocks rise on day ${i}</title><link>https://n/${i}</link><pubDate>${new Date().toUTCString()}</pubDate></item>`).join("");
    return new Response(`<?xml version="1.0"?><rss><channel>${items}</channel></rss>`, { status: 200 });
  }
  return new Response("", { status: 404 });
}) as typeof fetch;

(async () => {
  await fs.rm(process.env.STORE_DIR || "/tmp/invest-helper", { recursive: true, force: true });
  const { getJSON, setJSON, takeLock } = await import("../../src/lib/store");
  const { lockWait } = await import("../../src/lib/lock-wait");
  lockWait.pollMs = 50;
  lockWait.waitMs = 10_000;

  /* ---------------- row 25: the Flash-Lite reserve */
  const M = await import("../../src/lib/llm/models");
  const T = await import("../../src/lib/timetable");
  const { withUser, withCeiling, OWNER } = await import("../../src/lib/context");
  const at = (hhmm: string) => new Date(`2026-11-24T${hhmm}:00Z`);
  const seed = (r35: number, r31: number) => {
    const day = "2026-11-24"; // America/Los_Angeles is still the same date between 09:00 and 20:00 UTC
    return Promise.all([setJSON("llm:usage:gem35", { day, tokens: 0, requests: r35, byRoute: {} }), setJSON("llm:usage:gem31", { day, tokens: 0, requests: r31, byRoute: {} })]);
  };
  const ok = async (key: "gem35" | "gem31", route: import("../../src/lib/llm/models").Route, now: Date, uid = "visitor") =>
    withUser(uid, async () => (await M.available(M.modelDef(key)!, route, now)).ok);

  // The timetable is the one source: units after 09:00 UTC = 10:30 admin + 12:30 (4) + 15:30 + 17:00 + 21:20 (4) = 11
  assert.equal(T.briefingUnitsLeft(at("09:00")), 11);
  assert.equal(M.reserveForFlash(at("09:00")), 11 * 2 + Math.min(6 * 3, 11), "units x (story + concepts) + big-story margin");
  assert.equal(M.reserveForFlash(at("09:00")), 33);

  await seed(90, 80); // 97-90 + 97-80 = 24 left < 33
  for (const key of ["gem35", "gem31"] as const) {
    assert.equal(await ok(key, "userAuto", at("09:00")), false, `${key}: a visitor's automatic briefing is refused below the reserve`);
    assert.equal(await ok(key, "userManual", at("09:00")), false, `${key}: and their refresh button`);
    assert.equal(await ok(key, "shared", at("09:00")), true, `${key}: shared briefings never refused by the reserve`);
    assert.equal(await ok(key, "adminAuto", at("09:00")), true, `${key}: nor the admin's scheduled one`);
    assert.equal(await ok(key, "adminManual", at("09:00")), true);
    assert.equal(await ok(key, "predShared", at("09:00")), true);
    assert.equal(await ok(key, "translate", at("09:00")), true, "scheduled translation is not a visitor route");
    assert.equal(await ok(key, "userAuto", at("09:00"), OWNER), true, "the owner is exempt like with the ceiling");
  }
  assert.equal(await withUser("visitor", () => withCeiling(async () => (await M.available(M.modelDef("gem35")!, "translate", at("09:00"))).ok)), false, "a guest's translation (withCeiling) is a visitor route");

  // The reserve shrinks as the day's slots pass; the same 24 requests are enough in the evening.
  assert.equal(T.briefingUnitsLeft(at("20:00")), 4);
  assert.equal(M.reserveForFlash(at("20:00")), 4 * 2 + 4, "21:20 only: 12");
  assert.equal(await ok("gem35", "userAuto", at("20:00")), true, "allowed in the evening with the same requests left");
  assert.equal(M.reserveForFlash(at("23:00")), 0, "nothing left to schedule");
  assert.ok(M.reserveForFlash(at("09:00")) > M.reserveForFlash(at("16:00")) && M.reserveForFlash(at("16:00")) > M.reserveForFlash(at("22:00")));
  await seed(60, 30); // 37 + 67 = 104 left >= 33: both models count together
  assert.equal(await ok("gem35", "userAuto", at("09:00")), true, "plenty left: allowed");
  process.env.BIG_STORY_DAILY_LIMIT = "1"; // the big-story margin follows BIG_STORY_DAILY_LIMIT
  assert.equal(M.reserveForFlash(at("09:00")), 22 + 3);
  delete process.env.BIG_STORY_DAILY_LIMIT;
  const rep = await M.usageReport(at("09:00"));
  assert.deepEqual(rep.find((r) => r.key === "gem35")!.reserve, { requests: 33 }, "the admin status shows the reserve");
  assert.deepEqual(rep.find((r) => r.key === "gem31")!.reserve, { requests: 33 });
  assert.equal(typeof rep.find((r) => r.key === "groq120")!.reserve?.tokens, "number", "120b reserve shown too");

  /* ---------------- row 26a: two concurrent catch-ups -> one briefing */
  const C = await import("../../src/lib/config");
  const P = await import("../../src/lib/pipeline");
  await seed(0, 0);
  await P.refreshInterestSet(C.DEFAULT_INTERESTS, "en", [OWNER]);
  const hash = (await import("../../src/lib/interests")).interestHash(C.DEFAULT_INTERESTS, "en");
  const last = (await getJSON<{ at: string; provider: string; ok: boolean }>(`ib:${hash}:last`))!;
  const old = new Date(Date.now() - 20 * 3600_000).toISOString();
  await setJSON(`ib:${hash}:last`, { ...last, at: old });
  storyCalls = 0;
  const both = await withUser("alice", () => Promise.all([P.ensureInterestBriefing("alice", undefined, P.CATCH_UP_AFTER_MS), P.ensureInterestBriefing("alice", undefined, P.CATCH_UP_AFTER_MS)]));
  assert.deepEqual([...both].sort(), ["fresh", "refreshed"], "one instance refreshed, the other found it fresh");
  assert.equal(storyCalls, 1, "one AI story call for two concurrent catch-ups");
  assert.notEqual((await getJSON<{ at: string }>(`ib:${hash}:last`))!.at, old);
  assert.equal(await getJSON(`ib:${hash}:lock`), null, "the winner released its lock");

  /* ---------------- row 26b: two concurrent headline translations -> one translator call */
  const HL = await import("../../src/lib/headline-translate");
  const mk = () => ["h1", "h2", "h3"].map((id) => ({ id, title: `Oil falls on supply news ${id}`, link: "https://e.com/" + id, source: "S", publishedAt: "2026-11-24T08:00:00Z" }));
  translatorCalls = 0;
  const [a, b] = await Promise.all([HL.translateHeadlines(mk(), "vi"), HL.translateHeadlines(mk(), "vi")]);
  assert.equal(translatorCalls, 1, "one translator call for two concurrent batches");
  // Either request can win the lock (whichever store write lands first): exactly one comes back translated,
  // the loser at once and untranslated (no polling).
  const done = (xs: typeof a) => xs.every((n) => n.title.startsWith("vi:"));
  const none = (xs: typeof a) => xs.every((n) => !n.title.startsWith("vi:"));
  assert.ok((done(a) && none(b)) || (done(b) && none(a)), "one winner translated, the loser returned untranslated");
  const again = await HL.translateHeadlines(mk(), "vi");
  assert.ok(again.every((n) => n.title.startsWith("vi:")), "the next poll gets the winner's cached translations");
  assert.equal(translatorCalls, 1, "...without a second translator call");
  // A loser with nothing cached after the wait (winner failed) returns the list as it was
  const stuck = await takeLock(`tr:hl:lock:vi:${createHash("sha1").update("z1").digest("hex").slice(0, 16)}`, 30);
  assert.ok(stuck);
  lockWait.waitMs = 200;
  const left = await HL.translateHeadlines([{ id: "z1", title: "Gold edges higher today", link: "https://e.com/z1", source: "S", publishedAt: "2026-11-24T08:00:00Z" }], "vi");
  assert.equal(left[0].title, "Gold edges higher today");
  assert.equal(translatorCalls, 1);
  lockWait.waitMs = 10_000;

  /* ---------------- row 26c: two concurrent concept loads -> one translation */
  const K = await import("../../src/lib/stories/concepts");
  await setJSON(K.conceptKey("inflation"), { slug: "inflation", term: "Inflation", plain: "Prices rise over time.", example: "Bread costs more.", lang: "en", writtenAt: "2026-11-20T00:00:00Z" });
  translatorCalls = 0;
  const [c1, c2] = await Promise.all([K.loadConcepts(["inflation"], "vi"), K.loadConcepts(["inflation"], "vi")]);
  assert.equal(translatorCalls, 1, "one translation for two concurrent loads");
  assert.equal(c1[0].plain, "vi:Prices rise over time.");
  assert.equal(c2[0].plain, "vi:Prices rise over time.", "the loser reads the cached translation");
  assert.equal(await getJSON(`${K.conceptTrKey("inflation", "vi")}:lock`), null, "locks released");
  translatorCalls = 0;
  await K.loadConcepts(["inflation"], "vi");
  assert.equal(translatorCalls, 0, "cached afterwards");

  console.log("ROW25-26 OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
