/**
 * v19 audit row 5 (NEWS-2, NEWS-3, NEWS-7) and fix-plan items 4 and 5: My Interests briefings are
 * pre-translated for the languages of the set's recently seen followers; translation runs two chunks
 * at a time, keeps finished chunks, and backs off briefly after a partial failure; two instances
 * share one translation through a store lock; the 04:35 UTC slot reaches every user's set.
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import { pinClock } from "../clock";

pinClock("2026-11-19T12:00:00Z");
process.env.AUTH_SECRET = "test-secret";
process.env.AUTH_GOOGLE_ID = "gid";
process.env.AUTH_GOOGLE_SECRET = "gsecret";
process.env.OWNER_EMAIL = "owner@example.com";
process.env.GROQ_API_KEY = "x";
process.env.VERCEL = "1";
delete process.env.APP_PASSWORD;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.LLM_PROVIDER;

const calls: { lang: string; n: number }[] = [];
let inFlight = 0;
let maxInFlight = 0;
let failMarker: string | null = null;
let delayMs = 0;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.includes("api.groq.com")) return new Response("{}", { status: 404 });
  const msgs = JSON.parse(String(init?.body)).messages;
  const arr: string[] = JSON.parse(msgs[1].content);
  calls.push({ lang: String(msgs[0].content.match(/into (\w+)\./)?.[1]), n: arr.length });
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  inFlight--;
  if (failMarker && arr.some((s) => s.includes(failMarker!))) return new Response(JSON.stringify({ choices: [{ message: { content: "sorry, no" } }] }), { status: 200 });
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(arr.map((s) => `tr:${s}`)) } }] }), { status: 200 });
}) as typeof fetch;

const digest = (generatedAt: string, strings = 3, len = 40) => ({
  section: "interests",
  generatedAt,
  provider: "groq:x",
  language: "en",
  feedErrors: [],
  quotes: [],
  news: [],
  analysis: { headline: "Headline", mood: "mixed", summary: Array.from({ length: strings }, (_, i) => `Sentence ${i} ${"w".repeat(len)}`), events: [], watchNext: [], movers: [], scenarios: [] },
});

(async () => {
  await fs.rm("/tmp/invest-helper", { recursive: true, force: true });
  const U = await import("../../src/lib/users");
  const { setJSON, getJSON } = await import("../../src/lib/store");
  const { withUser } = await import("../../src/lib/context");
  const I = await import("../../src/lib/interests");
  const B = await import("../../src/lib/briefings");
  const TT = await import("../../src/lib/timetable");

  // ---- (c) the new slot
  const slot = TT.TIMETABLE.find((s) => s.at === "04:35" && !s.tz);
  assert.ok(slot?.items.includes("interests:all"), "04:35 UTC (11:35 Hanoi) refreshes every user's set");
  assert.equal(TT.TIMETABLE.filter((s) => s.items.includes("interests:all")).length, 5, "users' sets 5 a day (owner decision, fix-plan item 4)");

  // ---- (a) followers' languages
  const mk = async (email: string, lang: string, lastSeen: Date) => {
    const uid = U.uidFor(email);
    await U.touchUser({ uid, email, admin: false }, lastSeen);
    await withUser(uid, () => setJSON(`u:${uid}:settings`, { briefingLanguage: lang }));
    return uid;
  };
  const day = 86_400_000;
  const vi = await mk("vi@example.com", "vi", new Date());
  const ja = await mk("ja@example.com", "ja", new Date());
  const en = await mk("en@example.com", "en", new Date());
  const old = await mk("de@example.com", "de", new Date(Date.now() - 3 * day));
  const langs = await I.followerLanguages([vi, ja, en, old]);
  assert.deepEqual(langs.sort(), ["ja", "vi"], "vi + ja followers: both; English and the follower unseen for 3 days: none");

  const hash = "abc123";
  await setJSON(`ib:${hash}`, digest("2026-11-19T11:50:00Z"));
  const done = await B.pretranslateSet(hash, [vi, ja, en, old]);
  assert.deepEqual(done.sort(), ["ja", "vi"]);
  assert.deepEqual([...new Set(calls.map((c) => c.lang))].sort(), ["Japanese", "Vietnamese"], "only the followers' languages were paid for");
  assert.ok((await getJSON(`tr:ib:${hash}:vi`)) && (await getJSON(`tr:ib:${hash}:ja`)), "both cached for readers");
  assert.equal(await getJSON(`tr:ib:${hash}:de`), null);
  calls.length = 0;
  assert.deepEqual((await B.pretranslateSet(hash, [vi, ja])).sort(), ["ja", "vi"]);
  assert.equal(calls.length, 0, "already cached: no new call");
  assert.deepEqual(await B.pretranslateSet(hash, [en]), []);
  assert.equal(calls.length, 0, "English-only followers cost nothing");

  // ---- (b) partial failure keeps finished chunks; retry redoes only the failed one
  const h2 = "partial1";
  await setJSON(`ib:${h2}`, digest("2026-11-19T11:51:00Z", 8, 900)); // 8 long strings: several chunks
  const { chunkSlots, textSlots } = await import("../../src/lib/translate");
  const total = chunkSlots(textSlots(digest("x", 8, 900).analysis as never)).length;
  assert.ok(total >= 4, `fixture makes several chunks (${total})`);
  calls.length = 0;
  maxInFlight = 0;
  failMarker = "Sentence 3 ";
  delayMs = 20;
  await assert.rejects(() => B.translateSet(h2, "vi", { waitMs: 0 }), /translat|providers/i);
  const first = calls.length;
  assert.equal(maxInFlight, 2, "two chunks in flight at most");
  const fail = await getJSON<{ at: number; v: string; backoff: number }>(`tr:ib:${h2}:vi:failed`);
  assert.ok(fail && fail.backoff <= 2 * 60_000, "partial failure backs off briefly (not 10 minutes)");
  failMarker = null;
  await setJSON(`tr:ib:${h2}:vi:failed`, { ...fail, at: Date.now() - 3 * 60_000 }); // back-off over
  const t = await B.translateSet(h2, "vi", { waitMs: 0 });
  assert.equal(t?.language, "vi");
  assert.equal(calls.length, total + 1, `each chunk paid once, the failed one twice (${first} + ${calls.length - first} calls for ${total} chunks)`);

  // ---- (b) a failure with nothing finished keeps the long back-off
  const h3 = "allfail1";
  await setJSON(`ib:${h3}`, digest("2026-11-19T11:52:00Z", 2, 20));
  failMarker = "Sentence";
  await assert.rejects(() => B.translateSet(h3, "vi", { waitMs: 0 }));
  const f3 = await getJSON<{ backoff: number }>(`tr:ib:${h3}:vi:failed`);
  assert.equal(f3?.backoff, 10 * 60_000, "nothing translated: 10 minutes");
  failMarker = null;

  // ---- (b/NEWS-7) two instances, one provider call
  const h4 = "locked01";
  await setJSON(`ib:${h4}`, digest("2026-11-19T11:53:00Z", 2, 20));
  // A second module instance (its own in-memory dedupe), as another serverless instance would be: drop
  // the module from the require cache and load it again; the store (and its lock) is shared.
  const path = require.resolve("../../src/lib/briefings");
  delete require.cache[path];
  const B2 = require(path) as typeof B;
  assert.notEqual(B2.translateSet, B.translateSet, "a second module instance (own in-memory dedupe)");
  calls.length = 0;
  delayMs = 150;
  const [a, b] = await Promise.all([B.translateSet(h4, "vi", { waitMs: 5000, pollMs: 25 }), B2.translateSet(h4, "vi", { waitMs: 5000, pollMs: 25 })]);
  assert.equal(a?.language, "vi");
  assert.equal(b?.language, "vi");
  assert.equal(calls.length, 1, "one chunk, one call, across both instances");
  assert.equal(await getJSON(`tr:ib:${h4}:vi:lock`), null, "lock released");
  console.log("ROW05 TRANSLATIONS OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
