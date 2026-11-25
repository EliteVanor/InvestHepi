/**
 * v19 row 28 (TESTS-05): code that had no direct test.
 *  - ukey isolation (owner = bare keys, others u:<uid>:k; two users never read each other through gate/withUser);
 *  - touchUser (seen time, hourly throttle) and the SCHEDULED_ACTIVE_DAYS boundary (23 h in, 25 h out);
 *  - the tick chain: runTick calls the next tick through appUrl() with the bearer secret only when it ran a unit;
 *  - the rules variant of /api/digest: cached 15 min, rebuilt on demand within RULES_DAILY_LIMIT, refused past it.
 * Fake sessions, mocked fetch, no network. `npx tsx scripts/v19/row28-coverage.ts`
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import { pinClock } from "../clock";

pinClock("2026-11-16T01:16:00Z");

process.env.VERCEL = "1";
delete process.env.KV_REST_API_URL;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.VERCEL_URL;
delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
process.env.AUTH_SECRET = "s";
process.env.AUTH_GOOGLE_ID = "g";
process.env.AUTH_GOOGLE_SECRET = "gs";
process.env.OWNER_EMAIL = "owner@example.com";
process.env.APP_URL = "https://app.example.test/";
process.env.CRON_SECRET = "cron-secret";
process.env.RULES_DAILY_LIMIT = "2";
process.env.GROQ_API_KEY = "g";
process.env.GEMINI_API_KEY = "m";

const fetched: { url: string; auth?: string }[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("/api/cron/tick")) {
    fetched.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.authorization });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  return new Response("", { status: 404 }); // no prices, no feeds, no AI: everything falls back
}) as typeof fetch;

const T = (s: string) => Date.parse(s);
const HOUR = 3600_000;
const A = "alice@example.com";
const B = "bob@example.com";

(async () => {
  await fs.rm(process.env.STORE_DIR || "/tmp/invest-helper", { recursive: true, force: true });
  const ctx = await import("../../src/lib/context");
  const U = await import("../../src/lib/users");
  const { getJSON, setJSON } = await import("../../src/lib/store");

  /* ---------------- ukey */
  assert.equal(ctx.ukey("k"), "k", "outside any user: the owner's bare key");
  assert.equal(await ctx.withUser(ctx.OWNER, async () => ctx.ukey("k")), "k", "the owner keeps the legacy unprefixed key");
  assert.equal(await ctx.withUser("abc", async () => ctx.ukey("k")), "u:abc:k", "anyone else is namespaced");
  assert.equal(await ctx.withUser("abc", () => ctx.withUser("xyz", async () => ctx.ukey("k"))), "u:xyz:k", "the inner user wins, and ends with it");

  U.setSessionResolver(async (req) => {
    const who = req.headers.get("x-who");
    return who ? { user: { email: who, name: who.split("@")[0] } } : null;
  });
  const req = (who?: string) => new Request("http://x/api/test", { headers: who ? { "x-who": who } : {} });
  const write = (who: string, v: string) => U.gate(req(who), { user: true }, async () => (await setJSON(ctx.ukey("note"), v), Response.json({ ok: true })));
  const read = (who: string) => U.gate(req(who), { user: true }, async () => Response.json({ v: await getJSON<string>(ctx.ukey("note")) }));
  assert.equal((await write(A, "alice-secret")).status, 200);
  assert.deepEqual(await (await read(B)).json(), { v: null }, "bob does not see alice's key");
  assert.equal((await write(B, "bob-secret")).status, 200);
  assert.deepEqual(await (await read(A)).json(), { v: "alice-secret" }, "bob's write did not touch alice's");
  assert.deepEqual(await (await read(B)).json(), { v: "bob-secret" });
  assert.equal(await getJSON("note"), null, "neither user wrote the owner's bare key");
  assert.equal(await getJSON(`u:${U.uidFor(A)}:note`), "alice-secret", "stored under the user's own prefix");
  assert.equal((await U.gate(req(), { user: true }, async () => Response.json({}))).status, 401, "signed out: sign-in required");
  assert.equal(await ctx.withUser(U.uidFor("owner@example.com"), async () => ctx.ukey("note")), "note", "OWNER_EMAIL maps to the bare key");

  /* ---------------- touchUser and the active window */
  const now = new Date("2026-11-16T12:00:00Z");
  const user = (email: string) => ({ uid: U.uidFor(email), email, admin: false });
  await U.touchUser({ uid: "x", admin: false }, now); // no email: nothing recorded
  assert.deepEqual(await U.listUsers(), [], "a user without an address is not recorded");
  await U.touchUser(user(A), now);
  assert.equal((await U.listUsers())[0].lastSeen, now.toISOString(), "seen time recorded");
  await U.touchUser(user(A), new Date(now.getTime() + 30 * 60_000));
  assert.equal((await U.listUsers())[0].lastSeen, now.toISOString(), "within the hour: not rewritten");
  await U.touchUser(user(A), new Date(now.getTime() + 61 * 60_000));
  assert.equal((await U.listUsers())[0].lastSeen, new Date(now.getTime() + 61 * 60_000).toISOString(), "after the hour: updated");
  await setJSON("users", []);
  await U.touchUser(user(A), new Date(now.getTime() - 23 * HOUR));
  await U.touchUser(user(B), new Date(now.getTime() - 25 * HOUR));
  assert.equal(U.SCHEDULED_ACTIVE_DAYS, 1);
  const active = await U.activeUsers(U.SCHEDULED_ACTIVE_DAYS, now);
  assert.ok(active.includes(U.uidFor(A)), "seen 23 h ago: scheduled");
  assert.ok(!active.includes(U.uidFor(B)), "seen 25 h ago: not scheduled (gets a catch-up instead)");
  assert.ok(active.includes("owner"), "the owner is always active");

  /* ---------------- the tick chain */
  const TT = await import("../../src/lib/timetable");
  const S = await import("../../src/lib/scheduler");
  S.setTimetableSince(0);
  let t = T("2026-11-16T01:16:00Z");
  const opts = { now: () => new Date(t), sleep: async (ms: number) => void (t += ms), chain: true };
  for (const o of TT.occurrences(T("2026-11-13T00:00:00Z"), T("2026-11-16T00:00:00Z") - 1)) if (!(await getJSON(TT.runKey(o)))) await setJSON(TT.runKey(o), { items: {}, sets: {}, done: "seed" });
  const r1 = await S.runTick(opts);
  assert.ok(r1.unit, "a slot was due: a unit ran");
  assert.equal(r1.chained, true, "and the next tick was started");
  assert.equal(fetched.length, 1, "exactly one chained call");
  assert.equal(fetched[0].url, "https://app.example.test/api/cron/tick?src=chain", "through appUrl()");
  assert.equal(fetched[0].auth, "Bearer cron-secret", "with the cron secret");
  // Run everything that is due (chain off), then seed the rest as done: nothing left to run.
  for (let i = 0; i < 60; i++) {
    const r = await S.runTick({ ...opts, chain: false });
    t += 30_000;
    if (!r.unit) break;
  }
  fetched.length = 0;
  for (const o of TT.occurrences(t - 3 * 86400_000, t + 86400_000)) await setJSON(TT.runKey(o), { items: {}, sets: {}, done: "seed" });
  const r2 = await S.runTick(opts);
  assert.equal(r2.unit, undefined, "nothing was due");
  assert.equal(r2.chained, undefined, "no chain call decided");
  assert.equal(fetched.length, 0, "and none made: the chain ends");
  // Without a secret or a URL the chain is skipped quietly.
  delete process.env.CRON_SECRET;
  delete process.env.TICK_SECRET;
  for (const o of TT.occurrences(t, t + 86400_000)) await setJSON(TT.runKey(o), { items: {}, sets: {} });
  t += 3 * HOUR;
  const r3 = await S.runTick(opts);
  if (r3.unit) assert.equal(r3.chained, false, "no secret: no call");
  assert.equal(fetched.length, 0, "no call without a secret");
  process.env.CRON_SECRET = "cron-secret";

  /* ---------------- rules variant */
  const digestRoute = await import("../../src/app/api/digest/route");
  const rules = async (section: string, who = A) => {
    const r = await digestRoute.GET(new Request(`http://x/api/digest?section=${section}&variant=rules`, { headers: { "x-who": who } }));
    assert.equal(r.status, 200);
    return (await r.json()).digest as { generatedAt: string; provider: string } | null;
  };
  const { basePrefix } = await import("../../src/lib/briefings");
  const d1 = await rules("world");
  assert.ok(d1 && d1.provider === "rules", "built on demand: rule-based, no AI");
  const d2 = await rules("world");
  assert.equal(d2!.generatedAt, d1!.generatedAt, "within 15 minutes: the cached copy, no rebuild");
  const rk = `${await basePrefix("world")}:rules`;
  const age = async (min: number) => setJSON(rk, { ...(await getJSON<object>(rk)), generatedAt: new Date(Date.now() - min * 60_000).toISOString() });
  await age(10);
  assert.equal((await rules("world"))!.generatedAt, (await getJSON<{ generatedAt: string }>(rk))!.generatedAt, "10 minutes old: still served from cache");
  const stale = new Date(Date.now() - 20 * 60_000).toISOString();
  await age(20);
  const d3 = await rules("world");
  assert.ok(d3!.generatedAt > stale, "over 15 minutes: rebuilt on demand (second of 2 a day)");
  await age(20);
  const d4 = await rules("world");
  assert.equal(d4!.generatedAt, (await getJSON<{ generatedAt: string }>(rk))!.generatedAt, "past RULES_DAILY_LIMIT: the cached copy comes back, no rebuild");
  assert.ok(d4!.generatedAt <= stale || Date.parse(d4!.generatedAt) < Date.now() - 19 * 60_000, "still the 20-minute-old copy");
  assert.equal(await rules("us"), null, "past the cap with nothing cached: nothing built");
  assert.ok(await rules("us", B), "another person has their own daily count");
  console.log("ROW28 OK");
})();
