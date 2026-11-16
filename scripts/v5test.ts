/**
 * Multi-user accounts: isolation, shared briefings, guests, owner continuity, languages, Vietnam.
 * `npx tsx scripts/v5test.ts`
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";

process.env.AUTH_SECRET = "test-secret";
process.env.AUTH_GOOGLE_ID = "gid";
process.env.AUTH_GOOGLE_SECRET = "gsecret";
process.env.OWNER_EMAIL = "Owner@Example.com";
process.env.CRON_SECRET = "cron";
process.env.GROQ_API_KEY = "x";
process.env.VERCEL = "1"; // prove APP_PASSWORD isn't required in multi-user mode
delete process.env.APP_PASSWORD;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.LLM_PROVIDER;
delete process.env.SHARED_LANGUAGES;

const feedsHit: string[] = [];
const quoted: string[] = [];
let aiCalls = 0;
const now = Math.floor(Date.now() / 1000);
const rss = `<?xml version="1.0"?><rss><channel>${[0, 1, 2].map((i) => `<item><title>Chứng khoán tăng điểm phiên ${i} - VnExpress</title><link>https://e/${i}</link><pubDate>${new Date().toUTCString()}</pubDate></item>`).join("")}</channel></rss>`;
const reply = (lang: string) => JSON.stringify({ headline: `headline-${lang}`, mood: "mixed", summary: ["s"], events: [], watch_next: [], movers: [], scenarios: [], outlook: [{ interest: "Nasdaq", ticker: "QQQ", direction: "up", confidence: 60, horizon: "today", action: "HOLD", action_trigger: "t", rationale: "r", risks: "k" }] });

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("finance.yahoo.com/v8/finance/spark")) {
    const syms = decodeURIComponent(url.split("symbols=")[1].split("&")[0]).split(",");
    quoted.push(...syms);
    const ts = Array.from({ length: 30 }, (_, i) => now - (30 - i) * 86400);
    return new Response(JSON.stringify(Object.fromEntries(syms.map((s) => [s, { timestamp: ts, close: ts.map((_, i) => 100 + i), chartPreviousClose: 99 }]))), { status: 200 });
  }
  if (url.includes("vndirect.com.vn")) {
    feedsHit.push(url);
    const codes = decodeURIComponent(url.split("q=code:")[1].split("~")[0]).split(",");
    const rows = codes.flatMap((code) => Array.from({ length: 10 }, (_, i) => ({ code, date: new Date((now - i * 86400) * 1000).toISOString().slice(0, 10), close: 50 + i, nmVolume: 9, accumulatedVol: 9 })));
    return new Response(JSON.stringify({ data: rows }), { status: 200 });
  }
  if (url.includes("finance.yahoo.com/v8")) {
    const sym = decodeURIComponent(url.split("/chart/")[1].split("?")[0]);
    quoted.push(sym);
    const ts = Array.from({ length: 30 }, (_, i) => now - (30 - i) * 86400);
    const c = ts.map((_, i) => 100 + i);
    return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 130, chartPreviousClose: 128, regularMarketTime: now }, timestamp: ts, indicators: { quote: [{ close: c, open: c, high: c, low: c, volume: c }] } }] } }), { status: 200 });
  }
  if (url.includes("api.groq.com")) {
    aiCalls++;
    const msgs = JSON.parse(String(init?.body)).messages;
    const sys: string = msgs[0].content;
    if (sys.startsWith("You translate")) {
      const arr: string[] = JSON.parse(msgs[1].content);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(arr.map((s) => `vi:${s}`)) } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: reply(sys.includes("Vietnamese") ? "vi" : "en") } }] }), { status: 200 });
  }
  feedsHit.push(url);
  return new Response(rss, { status: 200 });
}) as typeof fetch;

const A = "alice@example.com";
const B = "bob@example.com";
const C = "carol@example.com";
const OWNER_EMAIL = "owner@example.com";

(async () => {
  await fs.rm("/tmp/invest-helper", { recursive: true, force: true });
  const U = await import("../src/lib/users");
  // Session = the x-who header in these tests.
  U.setSessionResolver(async (req) => {
    const who = req.headers.get("x-who");
    return who ? { user: { email: who, name: who.split("@")[0] } } : null;
  });
  const req = (url: string, who?: string, init: RequestInit = {}) =>
    new Request(`http://x${url}`, { ...init, headers: { ...(who ? { "x-who": who } : {}), ...(init.headers ?? {}) } });
  const json = async (r: Response) => [r.status, await r.json()] as const;

  assert.equal(U.multiUser(), true);
  assert.equal(U.uidFor(OWNER_EMAIL), "owner", "OWNER_EMAIL (case-insensitive) maps to the owner's existing data");
  assert.notEqual(U.uidFor(A), U.uidFor(B));

  // ---- who am I
  const me = await import("../src/app/api/me/route");
  const [, guestMe] = await json(await me.GET(req("/api/me")));
  assert.deepEqual([guestMe.mode, guestMe.user], ["multi", null]);
  const [, aliceMe] = await json(await me.GET(req("/api/me", A)));
  assert.equal(aliceMe.user.email, A);
  assert.equal(aliceMe.admin, false);
  await me.GET(req("/api/me", B));
  await me.GET(req("/api/me", C));
  assert.equal((await json(await me.GET(req("/api/me", OWNER_EMAIL))))[1].admin, true);
  assert.equal((await U.listUsers()).length, 4, "users registered on first visit");

  // ---- per-user isolation
  const interests = await import("../src/app/api/interests/route");
  const custom = [{ id: "vn", name: "Vietnam stocks", query: '"VN-Index" OR "chứng khoán"', tickers: ["FPT.VN", "VCB.VN", "E1VFVN30.VN"] }];
  assert.equal((await interests.PUT(req("/api/interests", A, { method: "PUT", body: JSON.stringify(custom) }))).status, 200, "Vietnamese tickers accepted");
  assert.equal((await json(await interests.GET(req("/api/interests", A))))[1].interests[0].name, "Vietnam stocks");
  assert.equal((await json(await interests.GET(req("/api/interests", B))))[1].interests[0].name, "Nasdaq", "Bob still has defaults");
  assert.equal((await interests.PUT(req("/api/interests", undefined, { method: "PUT", body: JSON.stringify(custom) }))).status, 401, "guests can't save");
  const pf = await import("../src/app/api/portfolio/route");
  await pf.PUT(req("/api/portfolio", A, { method: "PUT", body: JSON.stringify([{ symbol: "FPT.VN", shares: 100, cost: 120000 }]) }));
  assert.equal((await json(await pf.GET(req("/api/portfolio", B))))[1].holdings.length, 0, "holdings are private");
  const [st, body] = await json(await pf.GET(req("/api/portfolio")));
  assert.deepEqual([st, body.error], [401, "signin"], "guests are asked to sign in (not for a password)");
  const settings = await import("../src/app/api/settings/route");
  await settings.PUT(req("/api/settings", C, { method: "PUT", body: JSON.stringify({ briefingLanguage: "vi" }) }));

  // ---- scheduler: shared sections per language, interests grouped by identical sets
  const P = await import("../src/lib/pipeline");
  assert.deepEqual((await P.sharedLanguages()).sort(), ["en", "vi"], "languages actually in use");
  const groups = await P.interestGroups();
  const byUids = [...groups.values()].map((g) => g.uids.sort().join(","));
  assert.ok(byUids.includes([U.uidFor(B), "owner"].sort().join(",")), "Bob and the owner (both on defaults, English) share one briefing");
  assert.ok(byUids.includes(U.uidFor(A)) && byUids.includes(U.uidFor(C)), "Alice (custom) and Carol (defaults in Vietnamese) get their own");
  assert.equal(groups.size, 3, "default-en (owner, Bob, guests), default-vi (Carol, Vietnamese guests), Alice's set");

  const refresh = await import("../src/app/api/refresh/route");
  const cron = (section: string) => refresh.GET(req(`/api/refresh?section=${section}`, undefined, { headers: { authorization: "Bearer cron" } }));
  aiCalls = 0;
  const [, iv] = await json(await cron("interests"));
  assert.equal(iv.results.length, 2, "batch of 2 per scheduled call");
  const [, iv2] = await json(await cron("interests"));
  assert.equal(iv2.results.length, 1, "next call picks up the remaining set");
  const [, iv3] = await json(await cron("interests"));
  assert.equal(iv3.results.length, 0, "nothing due once all are fresh");
  assert.equal(aiCalls, 3, "3 distinct sets → 3 AI calls for 4 users + guests");
  const [, w] = await json(await cron("world"));
  assert.deepEqual(w.results.map((r: { key: string }) => r.key).sort(), ["world:en", "world:vi"]);
  feedsHit.length = 0;
  quoted.length = 0;
  await cron("vn");
  assert.ok(feedsHit.some((u) => u.includes("vnexpress.net")) && feedsHit.some((u) => u.includes("cafef.vn")), "Vietnamese news feeds used");
  assert.ok(feedsHit.some((u) => u.includes("hl=vi&gl=VN")), "Google News searched in Vietnamese");
  assert.ok(feedsHit.some((u) => u.includes("vndirect") && u.includes("FPT") && u.includes("VCB")), "Vietnam market symbols priced in one VNDirect batch");

  // ---- reading: everyone sees their own interest briefing; shared sections in their language
  const digest = await import("../src/app/api/digest/route");
  const d = async (section: string, who?: string, q = "") => (await json(await digest.GET(req(`/api/digest?section=${section}${q}`, who))))[1].digest;
  const bobI = await d("interests", B);
  const ownerI = await d("interests", OWNER_EMAIL);
  assert.equal(bobI.generatedAt, ownerI.generatedAt, "same interests → same shared briefing");
  assert.ok((await d("interests", A)).quotes.some((q: { symbol: string }) => q.symbol === "FPT.VN"), "Alice's briefing covers her tickers");
  const carolWorld = await d("world", C);
  assert.equal(carolWorld.analysis.headline, "vi:headline-en", "Carol reads World in Vietnamese (a translation of the one English briefing)");
  assert.equal(carolWorld.translatedFrom, "en");
  assert.equal((await d("world", B)).analysis.headline, "headline-en");
  assert.equal((await d("interests")).generatedAt, bobI.generatedAt, "guests see the default briefing");
  assert.equal((await d("world", undefined, "&lang=vi")).analysis.headline, "vi:headline-en", "guests read the cached Vietnamese translation with ?lang=vi");
  assert.equal((await d("world", B, "&lang=vi")).analysis.headline, "vi:headline-en", "signed-in readers follow their interface language too");
  assert.ok(await d("vn", B), "Vietnam section available");

  // ---- track records follow the interest set
  const track = await import("../src/app/api/track/route");
  const tB = (await json(await track.GET(req("/api/track", B))))[1];
  const tA = (await json(await track.GET(req("/api/track", A))))[1];
  assert.equal(tB.total, 1, "Bob's set logged one call (QQQ)");
  assert.equal(tA.total, 0, "Alice's set doesn't follow QQQ, so no call logged for her");

  // ---- manual refresh: cooldowns protect the free AI quota
  aiCalls = 0;
  const [, r1] = await json(await refresh.POST(req("/api/refresh?section=world", B, { method: "POST" })));
  assert.equal(r1.results[0].cached, true, "World refreshed minutes ago → cached copy, no AI call");
  assert.equal(aiCalls, 0);
  assert.equal((await refresh.POST(req("/api/refresh?section=world", undefined, { method: "POST" }))).status, 401, "guests can't refresh");
  const [, r2] = await json(await refresh.POST(req("/api/refresh?section=world", OWNER_EMAIL, { method: "POST" })));
  assert.equal(r2.results[0].ok && !r2.results[0].cached, true, "the owner can force a refresh");

  // ---- alerts check is scheduler-only in multi-user mode
  const check = await import("../src/app/api/alerts/check/route");
  assert.equal((await check.GET(req("/api/alerts/check", A))).status, 401);
  assert.equal((await check.GET(req("/api/alerts/check", undefined, { headers: { authorization: "Bearer cron" } }))).status, 200);

  // ---- owner keeps the original single-user keys
  const { getJSON } = await import("../src/lib/store");
  await interests.PUT(req("/api/interests", OWNER_EMAIL, { method: "PUT", body: JSON.stringify(custom) }));
  assert.equal(((await getJSON<{ name: string }[]>("interests")) ?? [])[0]?.name, "Vietnam stocks", "owner writes to the legacy un-prefixed key");
  assert.ok(await getJSON(`u:${U.uidFor(A)}:interests`), "other users write to their own namespace");

  console.log("V5 OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
