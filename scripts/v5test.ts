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

const feedsHit: string[] = [];
const quoted: string[] = [];
let aiCalls = 0;
const groqModels: string[] = [];
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
    groqModels.push(JSON.parse(String(init?.body)).model);
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
  aiCalls = 0;
  assert.equal((await interests.PUT(req("/api/interests", A, { method: "PUT", body: JSON.stringify(custom) }))).status, 200, "Vietnamese tickers accepted");
  // Users can't refresh, so a brand-new interest set gets its first briefing in the background.
  const { getJSON: gj } = await import("../src/lib/store");
  const Pp = await import("../src/lib/pipeline");
  const { withUser: wu } = await import("../src/lib/context");
  const aliceHash = await wu(U.uidFor(A), async () => (await Pp.currentInterestSet()).hash);
  for (let i = 0; i < 100 && !(await gj(`ib:${aliceHash}`)); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(await gj(`ib:${aliceHash}`), "new interest set → first briefing made automatically");
  assert.equal(aiCalls, 1, "one AI call for it");
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
  const groups = await P.interestGroups();
  const byUids = [...groups.values()].map((g) => g.uids.sort().join(","));
  assert.ok(byUids.includes([U.uidFor(B), U.uidFor(C), "owner"].sort().join(",")), "Bob, Carol (Vietnamese) and the owner share one English briefing: language no longer splits sets");
  assert.ok(byUids.includes(U.uidFor(A)), "Alice (custom) gets her own");
  assert.equal(groups.size, 2, "the default set and Alice's set");

  const refresh = await import("../src/app/api/refresh/route");
  // The tick runs a weekday 12:30 slot (us, world, vn, interest sets), one unit per call.
  const S = await import("../src/lib/scheduler");
  const TT = await import("../src/lib/timetable");
  const slot = TT.occurrences(Date.now() - 8 * 86400_000, Date.now()).filter((o) => o.slot.id === "wd-1230").pop()!;
  let t = slot.start + 60_000;
  const tickOpts = { now: () => new Date(t), sleep: async (ms: number) => void (t += ms) };
  feedsHit.length = 0;
  quoted.length = 0;
  const units: { item: string; set?: string; ok: boolean }[] = [];
  for (let i = 0; i < 10; i++) {
    const r = await S.runTick(tickOpts);
    if (!r.unit) break;
    units.push(r.unit);
    t += 30_000;
  }
  assert.deepEqual(units.map((u) => u.item), ["us", "world", "vn", "interests:all"], "graded US call first, then world, vn, interest sets");
  assert.equal(units.filter((u) => u.set).length, 1, "2 distinct sets for 4 users; Alice's was just made, so only the default set is due");
  assert.ok(units.every((u) => u.ok));
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

  // ---- users refresh only their own My Interests: 5 a day, 90 minutes apart, on the lighter model
  aiCalls = 0;
  assert.equal((await refresh.POST(req("/api/refresh?section=world", B, { method: "POST" }))).status, 403, "users can't refresh shared sections");
  assert.equal(aiCalls, 0);
  groqModels.length = 0;
  const [st1, own] = await json(await refresh.POST(req("/api/refresh?section=interests", B, { method: "POST" })));
  assert.equal(st1, 200, "a user can refresh their own interests");
  assert.ok(own.results[0].ok, "and it writes a new briefing");
  assert.deepEqual([own.quota.left, own.quota.limit], [4, 5], "the reply says how many presses are left");
  assert.ok(own.quota.nextAt, "and when the next one is allowed");
  assert.deepEqual(groqModels.filter((m) => !m.includes("qwen")), ["openai/gpt-oss-20b"], "the button uses the lighter model (Gemini when configured, then 20b), not 120b");
  const [st2, again] = await json(await refresh.POST(req("/api/refresh?section=interests", B, { method: "POST" })));
  assert.deepEqual([st2, again.error], [429, "wait"], "a second press inside 90 minutes is refused");
  const [, meB] = await json(await (await import("../src/app/api/me/route")).GET(req("/api/me", B)));
  assert.equal(meB.refresh.left, 4, "/api/me reports the quota for the button");
  assert.equal((await refresh.POST(req("/api/refresh?section=world", undefined, { method: "POST" }))).status, 401, "guests can't refresh");
  const [, r2] = await json(await refresh.POST(req("/api/refresh?section=world", OWNER_EMAIL, { method: "POST" })));
  assert.equal(r2.results[0].ok && !r2.results[0].cached, true, "the owner can force a refresh");

  // ---- the scheduler tick (alerts run inside it) is scheduler-only, also for signed-in users
  const tick = await import("../src/app/api/cron/tick/route");
  assert.equal((await tick.GET(req("/api/cron/tick", A))).status, 401);

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
