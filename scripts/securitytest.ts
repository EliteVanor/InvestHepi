/** Public-URL safety: costly/mutating endpoints are locked on Vercel until APP_PASSWORD is set. */
import assert from "node:assert/strict";

process.env.VERCEL = "1";
delete process.env.APP_PASSWORD;
process.env.CRON_SECRET = "s3cret";
const sent: string[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  if (String(input).includes("api.resend.com")) sent.push(JSON.parse(String(init?.body)).to[0]);
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const req = (url: string, init: RequestInit = {}) => new Request(`http://x${url}`, init);

(async () => {
  await (await import("fs")).promises.rm("/tmp/invest-helper", { recursive: true, force: true });
  const ask = await import("../src/app/api/ask/route");
  const r1 = await ask.POST(req("/api/ask", { method: "POST", body: JSON.stringify({ question: "hi?" }) }));
  assert.equal(r1.status, 403, "Ask AI locked without APP_PASSWORD on Vercel");

  const refresh = await import("../src/app/api/refresh/route");
  assert.equal((await refresh.POST(req("/api/refresh?section=us", { method: "POST" }))).status, 403, "refresh locked without APP_PASSWORD (403, not a 401 password loop)");

  const interests = await import("../src/app/api/interests/route");
  assert.equal((await interests.PUT(req("/api/interests", { method: "PUT", body: "[]" }))).status, 403, "interests edit locked");

  const settings = await import("../src/app/api/settings/route");
  assert.equal((await settings.PUT(req("/api/settings", { method: "PUT", body: "{}" }))).status, 403, "settings edit locked");

  const alerts = await import("../src/app/api/alerts/route");
  assert.equal((await alerts.PUT(req("/api/alerts", { method: "PUT", body: "{}" }))).status, 403, "alerts edit locked");

  const test = await import("../src/app/api/alerts/test/route");
  assert.equal((await test.POST(req("/api/alerts/test", { method: "POST", body: JSON.stringify({ email: "stranger@example.com" }) }))).status, 403, "test email locked");

  // With a password set: test email ignores a body address and only goes to the saved one.
  process.env.APP_PASSWORD = "pw";
  process.env.RESEND_API_KEY = "re_x";
  const { saveAlertSettings, DEFAULT_ALERTS } = await import("../src/lib/alerts");
  await saveAlertSettings({ ...DEFAULT_ALERTS, email: "owner@example.com" });
  const ok = await test.POST(req("/api/alerts/test", { method: "POST", headers: { "x-app-password": "pw" }, body: JSON.stringify({ email: "stranger@example.com" }) }));
  assert.equal(ok.status, 200);
  assert.deepEqual(sent, ["owner@example.com"], "test email only goes to the saved address");
  const wrong = await test.POST(req("/api/alerts/test", { method: "POST", headers: { "x-app-password": "nope" } }));
  assert.equal(wrong.status, 401, "wrong password rejected");
  // Regression: only CRON_SECRET set (no APP_PASSWORD). The browser must get a clear 403, not a 401
  // that makes it ask for a password the server can't check.
  delete process.env.APP_PASSWORD;
  const r403 = await refresh.POST(req("/api/refresh?section=us", { method: "POST", headers: { "x-app-password": "anything" } }));
  assert.equal(r403.status, 403, "no APP_PASSWORD: refresh says 'set APP_PASSWORD' (403), never 401");
  assert.ok(String((await r403.json()).error).includes("APP_PASSWORD"));
  const status = await import("../src/app/api/status/route");
  assert.equal((await status.GET(req("/api/status"))).status, 200, "reads stay open without a password");

  // Password matching: trimmed, URI-encoded, any characters.
  process.env.APP_PASSWORD = "  mật khẩu ✓ ";
  const enc = encodeURIComponent("mật khẩu ✓");
  assert.equal((await status.GET(req("/api/status", { headers: { "x-app-password": enc } }))).status, 200, "non-Latin password works when URI-encoded");
  assert.equal((await status.GET(req("/api/status", { headers: { "x-app-password": encodeURIComponent(" mật khẩu ✓  ") } }))).status, 200, "surrounding spaces ignored");
  assert.equal((await status.GET(req("/api/status", { headers: { "x-app-password": encodeURIComponent("mat khau") } }))).status, 401, "wrong password still rejected");
  assert.equal((await status.GET(req("/api/status", { headers: { "x-app-password": "%E0%A4%A" } }))).status, 401, "malformed encoding rejected, not a crash");
  process.env.APP_PASSWORD = "pw";
  assert.equal((await status.GET(req("/api/status", { headers: { "x-app-password": "pw" } }))).status, 200, "plain ASCII password unchanged");

  console.log("SECURITY OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
