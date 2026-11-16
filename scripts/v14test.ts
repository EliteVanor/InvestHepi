/**
 * v14: behavior pinned before the refactor, so moving code can't change it.
 *  - Golden values: the interest hash (changing it would orphan every stored briefing), what each
 *    section prices (`coverage`, fixtures/coverage.json), the list of API routes.
 *  - The storage-key contract a refresh writes.
 *  - The 1-day scheduling cutoff and the catch-up briefing for a user back after longer.
 * `npx tsx scripts/v14test.ts`
 */
import assert from "node:assert/strict";
import { promises as fs, readFileSync } from "fs";
import path from "path";

process.env.AUTH_SECRET = "test-secret";
process.env.AUTH_GOOGLE_ID = "gid";
process.env.AUTH_GOOGLE_SECRET = "gsecret";
process.env.OWNER_EMAIL = "owner@example.com";
process.env.VERCEL = "1";
process.env.GROQ_API_KEY = "g";
delete process.env.KV_REST_API_URL;
delete process.env.GEMINI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LLM_PROVIDER;
delete process.env.APP_URL;
delete process.env.AUTOGEN_DAILY_LIMIT;

let aiCalls = 0;
const analysisJson = JSON.stringify({
  headline: "AI headline", mood: "mixed", summary: ["s"], events: [], watch_next: [], movers: [], scenarios: [],
  outlook: [{ interest: "S&P 500", ticker: "SPY", direction: "up", confidence: 60, horizon: "today", action: "HOLD", action_trigger: "t", rationale: "r", risks: "k" }],
});
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("api.groq.com")) {
    aiCalls++;
    const body = JSON.parse(String(init?.body));
    const content = String(body.messages[0].content).startsWith("You translate") ? JSON.stringify((JSON.parse(body.messages[1].content) as string[]).map((s) => `vi:${s}`)) : analysisJson;
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 5000 } }), { status: 200 });
  }
  if (/rss|news\.google|feeds|\.xml/.test(url)) {
    return new Response(`<?xml version="1.0"?><rss><channel><item><title>Stocks rise</title><link>https://n/0</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`, { status: 200 });
  }
  return new Response("", { status: 404 });
}) as typeof fetch;

const ROOT = path.join(__dirname, "..");
const until = async (cond: () => Promise<boolean>, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (await cond()) return true;
  return false;
};

(async () => {
  await fs.rm("/tmp/invest-helper", { recursive: true, force: true });
  const P = await import("../src/lib/pipeline");
  const C = await import("../src/lib/config");
  const U = await import("../src/lib/users");
  const { getJSON, setJSON } = await import("../src/lib/store");

  /* ---------------- golden values */
  assert.equal(P.interestHash(C.DEFAULT_INTERESTS, "en"), "758fbb61a1ae6585", "the default set's hash (production keys use it)");
  assert.equal(P.interestHash([{ id: "a", name: "FPT", query: "FPT", tickers: ["FPT.VN"] }], "en"), "755a0537e8f7a28e");
  const golden = JSON.parse(readFileSync(path.join(ROOT, "scripts/fixtures/coverage.json"), "utf8"));
  for (const s of ["interests", "world", "us", "vn"] as const) {
    assert.deepEqual(JSON.parse(JSON.stringify(P.coverage(s, s === "interests" ? C.DEFAULT_INTERESTS : C.SECTION_GROUPS[s]))), golden[s], `what ${s} prices is unchanged`);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(P.coverage("interests", C.DEFAULT_INTERESTS, ["FPT.VN", "AAPL"]))), golden.interestsWithHoldings);

  const routes: string[] = [];
  const walk = async (dir: string) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.isDirectory()) await walk(path.join(dir, e.name));
      else if (e.name === "route.ts") routes.push(path.relative(path.join(ROOT, "src/app"), dir));
    }
  };
  await walk(path.join(ROOT, "src/app/api"));
  assert.deepEqual(routes.sort(), [
    "api/alerts", "api/alerts/test", "api/ask", "api/auth/[...nextauth]", "api/calendar", "api/chart", "api/chats", "api/cron/tick",
    "api/digest", "api/history", "api/interests", "api/me", "api/portfolio", "api/quotes", "api/refresh", "api/search", "api/settings",
    "api/status", "api/track", "api/translate",
  ], "API surface unchanged (add new routes here on purpose)");

  /* ---------------- storage-key contract */
  await P.refreshShared("world", "en");
  for (const k of ["digest:world:en", "digest:world:en:last", "digest:world:en:history"]) assert.ok(await getJSON(k), `${k} written`);
  const hash = P.interestHash(C.DEFAULT_INTERESTS, "en");
  await P.refreshInterestSet(C.DEFAULT_INTERESTS, "en", ["owner"]);
  for (const k of [`ib:${hash}`, `ib:${hash}:last`, `ib:${hash}:history`]) assert.ok(await getJSON(k), `${k} written`);
  const last = await getJSON<{ at: string; provider: string; ok: boolean }>(`ib:${hash}:last`);
  assert.deepEqual(Object.keys(last!).sort(), ["at", "ok", "provider"]);

  /* ---------------- 1-day cutoff for scheduled refreshes; alerts keep 30 days */
  assert.equal(U.SCHEDULED_ACTIVE_DAYS, 1);
  const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  await setJSON("users", [
    { uid: U.uidFor("today@example.com"), email: "today@example.com", lastSeen: ago(2) },
    { uid: U.uidFor("away@example.com"), email: "away@example.com", lastSeen: ago(30) },
  ]);
  const active = await U.activeUsers();
  assert.ok(active.includes("owner"), "the owner is always refreshed");
  assert.ok(active.includes(U.uidFor("today@example.com")), "seen 2 h ago: refreshed");
  assert.ok(!active.includes(U.uidFor("away@example.com")), "seen 30 h ago: not refreshed by the timetable");
  assert.ok((await U.activeUsers(30)).includes(U.uidFor("away@example.com")), "but still gets price alerts");

  /* ---------------- staleness */
  assert.equal(await P.interestBriefingStale(hash, P.CATCH_UP_AFTER_MS), null, "just written: fresh");
  assert.deepEqual(await P.interestBriefingStale("nope", P.CATCH_UP_AFTER_MS), { at: null }, "missing: stale, no time");
  const old = ago(13);
  await setJSON(`ib:${hash}:last`, { ...last, at: old });
  assert.deepEqual(await P.interestBriefingStale(hash, P.CATCH_UP_AFTER_MS), { at: old }, "13 h old: stale");
  assert.equal(await P.interestBriefingStale(hash), null, "without a max age only a missing briefing is stale (new sets)");

  /* ---------------- catch-up via /api/me */
  U.setSessionResolver(async (req) => {
    const who = req.headers.get("x-who");
    return who ? { user: { email: who, name: who } } : null;
  });
  const me = await import("../src/app/api/me/route");
  const ask = async (who?: string) => (await me.GET(new Request("http://x/api/me", { headers: who ? { "x-who": who } : {} }))).json();
  assert.equal((await ask()).catchUp, undefined, "guests: nothing");
  assert.equal((await ask("owner@example.com")).catchUp, undefined, "the admin is always on the timetable");
  aiCalls = 0;
  const back = await ask("away@example.com");
  assert.equal(back.catchUp, old, "a returning user is told which version is being replaced");
  assert.ok(await until(async () => (await getJSON<{ at: string }>(`ib:${hash}:last`))!.at !== old), "and a new briefing is written in the background");
  assert.ok(aiCalls >= 1);
  aiCalls = 0;
  assert.equal((await ask("away@example.com")).catchUp, undefined, "fresh again: no second refresh");
  assert.equal(aiCalls, 0);

  /* ---------------- the daily cap applies to catch-ups too */
  await setJSON(`ib:${hash}:last`, { ...last, at: old });
  const U2 = "capped@example.com";
  const uid2 = U.uidFor(U2);
  const { withUser } = await import("../src/lib/context");
  const R = await import("../src/lib/ratelimit");
  const results: string[] = [];
  for (let i = 0; i < 7; i++) {
    await setJSON(`ib:${hash}:last`, { ...last, at: old });
    results.push(await withUser(uid2, () => P.ensureInterestBriefing(uid2, R.autogenAllowed, P.CATCH_UP_AFTER_MS)));
  }
  assert.deepEqual(results, ["refreshed", "refreshed", "refreshed", "refreshed", "refreshed", "refreshed", "capped"], "6 background briefings a day per user");
  assert.equal(await withUser(uid2, () => P.ensureInterestBriefing(uid2, R.autogenAllowed)), "fresh", "a set that has a briefing needs no first one");

  console.log("V14 OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
