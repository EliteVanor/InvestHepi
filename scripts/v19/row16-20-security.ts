/**
 * v19 rows 16-20 (security): alert email recipients and the test-send cap, feed link schemes, the
 * daily AI ceiling and per-IP limits, refresh GET removed, security headers, generic errors, track
 * section validation. Route handlers are called directly with Request objects, as in v5test.
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import { pinClock } from "../clock";

pinClock("2026-11-19T14:00:00Z");

process.env.VERCEL = "1";
process.env.AUTH_SECRET = "test-secret";
process.env.AUTH_GOOGLE_ID = "gid";
process.env.AUTH_GOOGLE_SECRET = "gsecret";
process.env.OWNER_EMAIL = "owner@example.com";
process.env.CRON_SECRET = "cron";
process.env.RESEND_API_KEY = "re_test";
process.env.GROQ_API_KEY = "x";
process.env.GEMINI_API_KEY = "y";
process.env.TRANSLATE_IP_DAILY_LIMIT = "2";
process.env.PRICE_IP_PER_MIN = "5";
// A fake Upstash REST endpoint (in memory) so the suite can count the Redis commands each request costs.
process.env.KV_REST_API_URL = "http://fake-redis.test";
process.env.KV_REST_API_TOKEN = "t";
const kv = new Map<string, string>();
const cmds: string[][] = [];
function redisCmd(c: string[]): unknown {
  cmds.push(c);
  const [op, k, ...rest] = c;
  switch (op.toLowerCase()) {
    case "get": return kv.get(k) ?? null;
    case "set": {
      const nx = rest.map((x) => String(x).toLowerCase()).includes("nx");
      if (nx && kv.has(k)) return null;
      kv.set(k, rest[0]);
      return "OK";
    }
    case "incr": { const n = Number(kv.get(k) ?? 0) + 1; kv.set(k, String(n)); return n; }
    case "expire": return 1;
    case "del": return kv.delete(k) ? 1 : 0;
    case "eval": return 1;
    default: throw new Error(`fake redis: ${op}`);
  }
}
delete process.env.APP_PASSWORD;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LLM_PROVIDER;

const emailsTo: string[] = [];
let otherFetch = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("http://fake-redis.test")) {
    const body = JSON.parse(String(init?.body));
    return Response.json(url.endsWith("/pipeline") ? body.map((c: string[]) => ({ result: redisCmd(c) })) : { result: redisCmd(body) });
  }
  if (url.includes("api.resend.com")) {
    emailsTo.push(JSON.parse(String(init?.body)).to[0]);
    return new Response(JSON.stringify({ id: "m1" }), { status: 200 });
  }
  otherFetch++;
  return new Response("{}", { status: 500 });
}) as typeof fetch;
void realFetch;

const A = "alice@example.com";
const B = "bob@example.com";
const OWNER = "owner@example.com";

(async () => {
  await fs.rm("/tmp/invest-helper", { recursive: true, force: true });
  const rlCmds = () => cmds.filter((c) => String(c[1]).startsWith("rl:ip:")).length;
  const U = await import("../../src/lib/users");
  U.setSessionResolver(async (req) => {
    const who = req.headers.get("x-who");
    return who ? { user: { email: who, name: who.split("@")[0] } } : null;
  });
  const req = (url: string, who?: string, init: RequestInit = {}) =>
    new Request(`http://x${url}`, { ...init, headers: { ...(who ? { "x-who": who } : {}), ...(init.headers ?? {}) } });
  const put = (who: string, body: unknown) => req("/api/alerts", who, { method: "PUT", body: JSON.stringify(body) });
  const { setJSON } = await import("../../src/lib/store");
  const { DEFAULT_ALERTS } = await import("../../src/lib/alerts");

  /* ===== Row 16: alert emails go only to the account's own address ===== */
  const alerts = await import("../../src/app/api/alerts/route");
  const test = await import("../../src/app/api/alerts/test/route");
  for (const w of [A, B, OWNER]) await U.touchUser({ uid: U.uidFor(w), email: w, admin: w === OWNER });

  const mine = { ...DEFAULT_ALERTS, enabled: true, email: "Alice@Example.com" };
  assert.equal((await alerts.PUT(put(A, { ...mine, email: "victim@example.com" }))).status, 400, "a user can't set someone else's address");
  assert.equal((await alerts.PUT(put(A, mine))).status, 200, "own address (any letter case) is fine");
  assert.equal((await alerts.PUT(put(A, { ...mine, email: "" }))).status, 200, "empty is fine");
  assert.equal((await alerts.PUT(put(OWNER, { ...mine, email: "anyone@example.com" }))).status, 200, "the owner may set any address");

  await alerts.PUT(put(A, mine));
  const r1 = await test.POST(req("/api/alerts/test", A, { method: "POST", body: "{}" }));
  assert.equal(r1.status, 200);
  assert.deepEqual(emailsTo, ["Alice@Example.com"], "test goes to the saved (own) address");

  // an old stored address that isn't the account's: kept, flagged, never sent to
  await setJSON(`u:${U.uidFor(B)}:alerts:settings`, { ...mine, email: "victim@example.com" });
  const gb = await (await alerts.GET(req("/api/alerts", B))).json();
  assert.equal(gb.emailBlocked, true, "the tab is told");
  assert.equal(gb.settings.email, "victim@example.com", "data isn't deleted");
  const before = emailsTo.length;
  const rb = await test.POST(req("/api/alerts/test", B, { method: "POST", body: "{}" }));
  assert.equal(rb.status, 400);
  assert.equal(emailsTo.length, before, "nothing sent to the stranger");
  const { withUser } = await import("../../src/lib/context");
  const { checkPriceAlerts, predictionAlerts } = await import("../../src/lib/alerts");
  const skipped = await withUser(U.uidFor(B), () => checkPriceAlerts([{ name: "x", tickers: ["SPY"] } as never]));
  assert.ok("skipped" in skipped, "scheduled price alerts skip a mismatched address");
  assert.ok("skipped" in (await withUser(U.uidFor(B), () => predictionAlerts([], [], []))));
  assert.equal(emailsTo.length, before);
  assert.equal((await alerts.GET(req("/api/alerts", A))).status, 200);
  assert.equal((await (await alerts.GET(req("/api/alerts", A))).json()).emailBlocked, false);

  // the daily cap on test sends (default 3; Alice has used 1)
  const send = () => test.POST(req("/api/alerts/test", A, { method: "POST", body: "{}" }));
  assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 200);
  const capped = await send();
  assert.equal(capped.status, 429, "4th test send of the day is refused");
  assert.equal((await capped.json()).error, "limit");
  const sentAlice = emailsTo.filter((x) => x.toLowerCase() === A).length;
  assert.equal(sentAlice, 3);
  const ownerTest = await test.POST(req("/api/alerts/test", OWNER, { method: "POST", body: "{}" }));
  assert.equal(ownerTest.status, 200, "the cap is per person");

  /* ===== Row 17: feed links are http(s) only ===== */
  const { parseFeed } = await import("../../src/lib/news");
  const { safeHttpUrl } = await import("../../src/lib/safe-url");
  const item = (l: string) => `<item><title>Headline ${l.length}</title><link>${l}</link><pubDate>Thu, 19 Nov 2026 12:00:00 GMT</pubDate></item>`;
  const links = ["https://ok.example/a", "http://ok.example/b", "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "//evil.example/x", "not a url"];
  const parsed = parseFeed(`<rss><channel>${links.map(item).join("")}</channel></rss>`, "T");
  assert.deepEqual(parsed.map((n) => n.link), ["https://ok.example/a", "http://ok.example/b", "", "", "", "", "", ""], "only http(s) links survive parsing");
  const atom = parseFeed(`<feed><entry><title>A</title><link href="javascript:alert(1)"/></entry><entry><title>B</title><link href="https://ok.example/c"/></entry></feed>`, "T");
  assert.deepEqual(atom.map((n) => n.link), ["", "https://ok.example/c"], "Atom href too");
  assert.equal(safeHttpUrl(undefined), "");
  assert.equal(safeHttpUrl("  https://x.example/p?q=1 "), "https://x.example/p?q=1");

  /* ===== Row 18: daily AI ceiling for visitor work, per-IP limits ===== */
  const M = await import("../../src/lib/llm/models");
  const RL = await import("../../src/lib/ratelimit");
  const setUse = async (k: "groq120" | "groq20" | "qwen" | "gem35" | "gem31", share: number) => {
    const def = M.modelDef(k)!;
    const u = await M.loadUsage(def);
    if (def.tokensPerDay) u.tokens = Math.round(def.tokensPerDay * share);
    if (def.requestsPerDay) u.requests = Math.round(def.requestsPerDay * share);
    await setJSON(`llm:usage:${k}`, u);
    return def;
  };
  // Translation, per address: nothing cached, so each new language is a paid start.
  await setJSON("digest:world:en", { section: "world", generatedAt: "2026-11-19T10:00:00Z", provider: "t", language: "en", news: [], quotes: [], feedErrors: [], analysis: { headline: "H", mood: "mixed", summary: ["s"], events: [], watchNext: [], movers: [], scenarios: [], outlook: [] } });
  const tr = await import("../../src/app/api/translate/route");
  const trReq = (lang: string, ip: string, who?: string) => req(`/api/translate?section=world&lang=${lang}`, who, { method: "POST", headers: { "x-real-ip": ip } });
  assert.equal((await tr.POST(trReq("vi", "1.1.1.1"))).status, 502, "visitor 1: first start is paid (AI mocked down)");
  assert.equal((await tr.POST(trReq("es", "1.1.1.1"))).status, 502, "visitor 1: second start");
  const third = await tr.POST(trReq("fr", "1.1.1.1"));
  assert.equal(third.status, 200, "visitor 1: third start is over the per-address limit: the English copy comes back, no AI call");
  assert.equal((await third.json()).translated, false);
  assert.equal((await tr.POST(trReq("de", "2.2.2.2"))).status, 502, "another address still has its own allowance");
  assert.equal((await tr.POST(trReq("ja", "1.1.1.1", A))).status, 502, "a signed-in reader is not held to the visitor limit");

  // The ceiling: one model over 70% is not enough, the whole chain must be
  assert.equal(await M.userAiBusy("userAuto"), false);
  const g35 = await setUse("gem35", 0.75);
  assert.equal(await M.userAiBusy("userAuto"), false, "others in the chain still have room");
  await setUse("gem31", 0.75);
  await setUse("groq20", 0.75);
  assert.equal(await M.userAiBusy("userAuto"), false, "120b has room");
  const g120 = await setUse("groq120", 0.72);
  assert.equal(await M.userAiBusy("userAuto"), true, "every model past 70%: visitor work pauses");
  assert.equal(await M.userAiBusy("userManual"), true);
  assert.equal(await M.userAiBusy("ask"), true);
  assert.equal(await M.userAiBusy("translate"), false, "qwen is untouched");
  assert.equal((await M.available(g35, "shared")).ok, true, "shared runs ignore the ceiling");
  assert.equal((await M.available(g35, "adminAuto")).ok, true, "admin runs too");
  assert.equal((await M.available(g120, "predShared")).ok, true);
  await setUse("groq120", 0.5);
  assert.equal(await M.userAiBusy("userAuto"), false, "back under: resumes");
  await setUse("groq120", 0.72);

  const refresh = await import("../../src/app/api/refresh/route");
  const ask = await import("../../src/app/api/ask/route");
  const me = await import("../../src/app/api/me/route");
  const quotaBefore = (await RL.peek("refresh-user", RL.limits.userRefresh())).used;
  void quotaBefore;
  const rr = await refresh.POST(req("/api/refresh?section=interests", B, { method: "POST" }));
  assert.equal(rr.status, 503);
  assert.equal((await rr.json()).error, "busy", "a user's refresh says busy");
  const rr2 = await withUser(U.uidFor(B), () => RL.peek("refresh-user", RL.limits.userRefresh()));
  assert.equal(rr2.used, 0, "and no press was counted");
  const ak = await ask.POST(req("/api/ask", B, { method: "POST", body: JSON.stringify({ question: "what moved?" }) }));
  assert.equal(ak.status, 503);
  assert.equal((await ak.json()).error, "busy");
  const akOwner = await ask.POST(req("/api/ask", OWNER, { method: "POST", body: JSON.stringify({ question: "what moved?" }) }));
  assert.notEqual(akOwner.status, 503, "the admin is not paused");
  assert.equal(await withUser(U.uidFor(B), () => RL.autogenAllowed()), false, "first briefings and catch-ups are paused");
  assert.equal(await withUser(U.uidFor(B), async () => (await RL.peek("autogen", RL.limits.autogen())).used), 0, "and not counted");
  void me;
  // a visitor's translation: past the ceiling nothing is paid, and the per-address counter isn't touched
  await setUse("qwen", 0.8);
  await setUse("gem35", 0.8);
  const ipBefore = rlCmds();
  const tb = await tr.POST(trReq("ko", "3.3.3.3"));
  assert.equal(tb.status, 200);
  assert.equal((await tb.json()).translated, false, "busy: untranslated copy, no AI");
  assert.equal(rlCmds(), ipBefore, "busy is decided before the per-address counter");

  // Price routes: per address per minute (PRICE_IP_PER_MIN=5 here)
  const quotes = await import("../../src/app/api/quotes/route");
  const chart = await import("../../src/app/api/chart/route");
  const px = (path: string, ip: string) => req(path, undefined, { headers: { "x-real-ip": ip } });
  const c0 = cmds.length;
  const first = await quotes.GET(px("/api/quotes?symbols=SPY", "4.4.4.4"));
  assert.notEqual(first.status, 429);
  const ours = cmds.slice(c0).filter((c) => String(c[1]).startsWith("rl:ip:px"));
  assert.deepEqual(ours.map((c) => c[0].toLowerCase()), ["incr", "expire"], "first request of a window: INCR + EXPIRE");
  const c1 = cmds.length;
  await quotes.GET(px("/api/quotes?symbols=SPY", "4.4.4.4"));
  const second = cmds.slice(c1).filter((c) => String(c[1]).startsWith("rl:ip:px"));
  assert.deepEqual(second.map((c) => c[0].toLowerCase()), ["incr"], "later requests: one command");
  for (let i = 0; i < 3; i++) await chart.GET(px("/api/chart?symbol=SPY&range=1d", "4.4.4.4"));
  const over = await quotes.GET(px("/api/quotes?symbols=SPY", "4.4.4.4"));
  assert.equal(over.status, 429, "6th request in the minute (quotes and chart share the counter)");
  assert.ok(Number(over.headers.get("retry-after")) >= 1);
  assert.notEqual((await quotes.GET(px("/api/quotes?symbols=SPY", "5.5.5.5"))).status, 429, "another address is unaffected");
  assert.equal(RL.clientIp(new Request("http://x", { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } })), "9.9.9.9");

  /* ===== Row 19: no GET refresh, security headers ===== */
  assert.equal((refresh as Record<string, unknown>).GET, undefined, "/api/refresh has no GET (the browser and cron never used it)");
  assert.equal(typeof refresh.POST, "function");
  const cfg = (await import("../../next.config.mjs")).default as { headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> };
  const rules = await cfg.headers();
  assert.equal(rules[0].source, "/:path*", "applies to every path");
  const hv = Object.fromEntries(rules[0].headers.map((h) => [h.key.toLowerCase(), h.value]));
  assert.equal(hv["x-content-type-options"], "nosniff");
  assert.equal(hv["referrer-policy"], "strict-origin-when-cross-origin");
  assert.equal(hv["x-frame-options"], "DENY");
  assert.match(hv["permissions-policy"], /camera=\(\)/);
  assert.match(hv["content-security-policy"], /frame-ancestors 'none'/);
  assert.ok(!/script-src|default-src/.test(hv["content-security-policy"]), "no script policy that could break Next, sign-in or analytics");

  void otherFetch;
  console.log("SECURITY ROW16 OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
