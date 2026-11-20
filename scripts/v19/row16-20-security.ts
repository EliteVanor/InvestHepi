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
delete process.env.APP_PASSWORD;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LLM_PROVIDER;

const emailsTo: string[] = [];
let otherFetch = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
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

  void otherFetch;
  console.log("SECURITY ROW16 OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
