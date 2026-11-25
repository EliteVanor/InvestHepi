/**
 * v19 audit row 24: the live headline list is translated into the reader's language
 * (/api/news?lang=), once per headline and language, only titles not already in it, at most 40 new
 * per request, never an error for news, and signed-out readers are limited per address.
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import { pinClock } from "../clock";

pinClock("2026-11-19T12:00:00Z");
process.env.VERCEL = "1";
process.env.AUTH_SECRET = "test-secret";
process.env.AUTH_GOOGLE_ID = "gid";
process.env.AUTH_GOOGLE_SECRET = "gsecret";
process.env.OWNER_EMAIL = "owner@example.com";
process.env.GROQ_API_KEY = "x";
process.env.HEADLINE_TRANSLATE_IP_DAILY_LIMIT = "3";
delete process.env.APP_PASSWORD;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.LLM_PROVIDER;

let sent: string[][] = [];
let fail = false;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.includes("api.groq.com")) return new Response("{}", { status: 404 });
  const msgs = JSON.parse(String(init?.body)).messages;
  const arr: string[] = JSON.parse(msgs[1].content);
  sent.push(arr);
  if (fail) return new Response(JSON.stringify({ choices: [{ message: { content: "sorry" } }] }), { status: 200 });
  const lang = String(msgs[0].content.match(/into (\w+)\./)?.[1]);
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(arr.map((s) => `[${lang}] ${s}`)) } }] }), { status: 200 });
}) as typeof fetch;

const item = (id: string, title: string) => ({ id, title, link: "https://e.com/" + id, source: "S", publishedAt: "2026-11-19T10:00:00Z" });
const flat = () => sent.flat();

(async () => {
  await fs.rm(process.env.STORE_DIR || "/tmp/invest-helper", { recursive: true, force: true });
  const U = await import("../../src/lib/users");
  U.setSessionResolver(async (req) => {
    const who = req.headers.get("x-who");
    return who ? { user: { email: who, name: "x" } } : null;
  });
  const { setJSON, getJSON } = await import("../../src/lib/store");
  // A fake clock for the translator's per-minute pacing (waiting a minute costs nothing).
  const TR = await import("../../src/lib/translate");
  let vt = Date.now();
  TR.translateClock.now = () => vt;
  TR.translateClock.sleep = async (ms: number) => {
    vt += ms;
  };
  const news = await import("../../src/app/api/news/route");
  const get = (path: string, who?: string, ip = "9.9.9.9") => news.GET(new Request(`http://x${path}`, { headers: { ...(who ? { "x-who": who } : {}), "x-real-ip": ip } }));
  const put = (section: string, items: ReturnType<typeof item>[]) => setJSON(`news:${section}`, { at: "2026-11-19T11:00:00Z", items, errors: [] });
  const W = "alice@example.com";
  await U.touchUser({ uid: U.uidFor(W), email: W, admin: false });

  // ---- a Vietnamese reader on World: English titles come back in Vietnamese, with the original
  await put("world", [item("w1", "Fed holds rates steady"), item("w2", "Oil falls on supply news")]);
  let r = await get("/api/news?section=world&lang=vi", W);
  let j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.items[0].title, "[Vietnamese] Fed holds rates steady");
  assert.equal(j.items[0].titleOrig, "Fed holds rates steady");
  assert.equal(sent.length, 1, "one batch for the whole list");
  assert.deepEqual(sent[0], ["Fed holds rates steady", "Oil falls on supply news"]);
  assert.ok(await getJSON("tr:hl:w1:vi"), "kept at tr:hl:<id>:<lang>");

  // ---- no lang: untouched
  j = await (await get("/api/news?section=world", W)).json();
  assert.equal(j.items[0].title, "Fed holds rates steady");
  assert.equal(j.items[0].titleOrig, undefined);
  assert.equal(sent.length, 1);

  // ---- second request: nothing sent (cache)
  j = await (await get("/api/news?section=world&lang=vi", W)).json();
  assert.equal(sent.length, 1, "cached: no new call");
  assert.equal(j.items[1].title, "[Vietnamese] Oil falls on supply news");

  // ---- the list changes: only the new headline is sent
  await put("world", [item("w3", "Gold hits a record"), item("w1", "Fed holds rates steady"), item("w2", "Oil falls on supply news")]);
  j = await (await get("/api/news?section=world&lang=vi", W)).json();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], ["Gold hits a record"], "only the new title");
  assert.equal(j.items.every((i: { titleOrig?: string }) => i.titleOrig), true);

  // ---- an English reader on Vietnam: Vietnamese titles translated, English ones left alone
  sent = [];
  await put("vn", [item("v1", "VN-Index tăng điểm nhờ cổ phiếu ngân hàng"), item("v2", "Reuters: Vietnam exports rise")]);
  j = await (await get("/api/news?section=vn&lang=en", W)).json();
  assert.deepEqual(flat(), ["VN-Index tăng điểm nhờ cổ phiếu ngân hàng"]);
  assert.equal(j.items[0].title, "[English] VN-Index tăng điểm nhờ cổ phiếu ngân hàng");
  assert.equal(j.items[0].titleOrig, "VN-Index tăng điểm nhờ cổ phiếu ngân hàng");
  assert.equal(j.items[1].title, "Reuters: Vietnam exports rise");

  // ---- a Vietnamese headline on Vietnam for a vi reader is not sent
  sent = [];
  await put("vn", [item("v3", "Giá vàng trong nước giảm mạnh")]);
  j = await (await get("/api/news?section=vn&lang=vi", W)).json();
  assert.equal(sent.length, 0, "already Vietnamese: nothing sent");
  assert.equal(j.items[0].title, "Giá vàng trong nước giảm mạnh");
  assert.equal(j.items[0].titleOrig, undefined);

  // ---- other target languages translate everything (English and Vietnamese alike)
  sent = [];
  j = await (await get("/api/news?section=vn&lang=ja", W)).json();
  assert.equal(flat().length, 1);
  assert.equal(j.items[0].title, "[Japanese] Giá vàng trong nước giảm mạnh");

  // ---- the cap: 40 new titles a request, the rest on a later poll
  sent = [];
  await put("us", Array.from({ length: 55 }, (_, i) => item(`u${i}`, `Story number ${i} moves markets`)));
  j = await (await get("/api/news?section=us&lang=vi", W)).json();
  assert.equal(flat().length, 40, "40 sent");
  assert.equal(j.items.filter((i: { titleOrig?: string }) => i.titleOrig).length, 40);
  assert.equal(j.items.length, 55, "the rest still come, as published");
  sent = [];
  vt += 5 * 60_000; // the next poll (5 minutes on)
  j = await (await get("/api/news?section=us&lang=vi", W)).json();
  assert.equal(flat().length, 15, "the next poll translates the remaining 15 only");
  assert.equal(j.items.every((i: { titleOrig?: string }) => i.titleOrig), true);

  // ---- translator failure: untranslated list, status 200, nothing cached
  sent = [];
  vt += 5 * 60_000;
  fail = true;
  await put("us", [item("f1", "Breaking: chip stocks jump")]);
  r = await get("/api/news?section=us&lang=vi", W);
  j = await r.json();
  assert.equal(r.status, 200, "news never errors");
  assert.equal(j.items[0].title, "Breaking: chip stocks jump");
  assert.equal(j.items[0].titleOrig, undefined);
  assert.equal(await getJSON("tr:hl:f1:vi"), null, "failures are not cached");
  fail = false;

  // ---- signed out: per-address daily limit on batches (3), cached titles stay free
  sent = [];
  vt += 5 * 60_000;
  const batches = async (n: number, ip: string) => {
    for (let i = 0; i < n; i++) {
      vt += 61_000;
      await put("us", [item(`s${ip}${i}`, `Fresh headline ${i} for ${ip}`)]);
      await get("/api/news?section=us&lang=vi", undefined, ip);
    }
  };
  await batches(5, "1.2.3.4");
  assert.equal(sent.length, 3, "5 batches asked, 3 allowed for one address");
  await put("us", [item("s1.2.3.40", "Fresh headline 0 for 1.2.3.4"), item("zz", "Brand new one")]);
  j = await (await get("/api/news?section=us&lang=vi", undefined, "1.2.3.4")).json();
  assert.equal(j.items[0].titleOrig !== undefined, true, "an already translated title is served from the cache past the limit");
  assert.equal(j.items[1].titleOrig, undefined, "a new one is not translated past the limit");
  sent = [];
  await put("us", [item("o1", "Another address headline")]);
  j = await (await get("/api/news?section=us&lang=vi", undefined, "5.6.7.8")).json();
  assert.equal(sent.length, 1, "another address is unaffected");
  assert.equal(j.items[0].title, "[Vietnamese] Another address headline");

  // ---- signed-in readers are not limited per address
  sent = [];
  for (let i = 0; i < 5; i++) {
    vt += 61_000;
    await put("us", [item(`g${i}`, `Signed in headline ${i}`)]);
    await get("/api/news?section=us&lang=vi", W, "1.2.3.4");
  }
  assert.equal(sent.length, 5);

  console.log("ROW24 OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
