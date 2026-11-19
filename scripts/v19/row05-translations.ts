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

const calls: { lang: string; n: number; at: number; gemini: boolean }[] = [];
let clockNow: () => number = () => Date.now();
let inFlight = 0;
let maxInFlight = 0;
let failMarker: string | null = null;
let delayMs = 0;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const gemini = url.includes("generativelanguage.googleapis.com");
  if (!url.includes("api.groq.com") && !gemini) return new Response("{}", { status: 404 });
  const msgs = JSON.parse(String(init?.body)).messages;
  const arr: string[] = JSON.parse(msgs[1].content);
  calls.push({ lang: String(msgs[0].content.match(/into (\w+)\./)?.[1]), n: arr.length, at: clockNow(), gemini });
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
  const { withUser, OWNER } = await import("../../src/lib/context");
  const I = await import("../../src/lib/interests");
  const B = await import("../../src/lib/briefings");
  const TT = await import("../../src/lib/timetable");
  const TR = await import("../../src/lib/translate");
  // A fake clock for the pacing (a minute of waiting costs nothing); a few checks below switch back to the real one.
  let vt = Date.now();
  const realClock = { ...TR.translateClock };
  const fakeClock = () => {
    TR.translateClock.now = () => vt;
    TR.translateClock.sleep = async (ms: number) => {
      vt += ms;
    };
    clockNow = () => vt;
  };
  const useRealClock = () => {
    Object.assign(TR.translateClock, realClock);
    clockNow = () => Date.now();
  };
  fakeClock();

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
  vt += 2 * 60_000; // a fresh pacing window
  failMarker = "Sentence 3 ";
  delayMs = 20;
  await assert.rejects(() => B.translateSet(h2, "vi", { waitMs: 0 }), /translat|providers/i);
  const first = calls.length;
  assert.equal(maxInFlight, 2, "two chunks in flight at most");
  const fail = await getJSON<{ at: number; v: string; backoff: number }>(`tr:ib:${h2}:vi:failed`);
  assert.ok(fail && fail.backoff <= 2 * 60_000, "partial failure backs off briefly (not 10 minutes)");
  failMarker = null;
  // Retry after the back-off. Pacing lets two chunks start a minute (3k reserved tokens each against ~7.5k),
  // and a route call stops starting chunks after 50 s, so a long briefing finishes over a few tries,
  // each redoing only what is missing.
  let t = null;
  for (let i = 0; i < 6 && !t; i++) {
    vt += 3 * 60_000;
    const f = await getJSON<{ at: number; v: string; backoff: number }>(`tr:ib:${h2}:vi:failed`);
    if (f) await setJSON(`tr:ib:${h2}:vi:failed`, { ...f, at: 0 }); // back-off over
    t = await B.translateSet(h2, "vi", { waitMs: 0 }).catch(() => null);
  }
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

  // ---- the lock outlives a translation: its lifetime comes from chunks x providers x timeout, capped by the route budget
  assert.equal(TR.translateWorstCaseMs(1), 60_000);
  assert.equal(TR.translateWorstCaseMs(4), 110_000, "4 chunks, 2 wide: 120 s worst case, capped at budget (50 s) + a chunk in flight (60 s)");
  assert.equal(TR.translateWorstCaseMs(8, 20_000), 80_000, "a shorter budget gives a shorter lock");
  const h5 = "ttl00001";
  await setJSON(`ib:${h5}`, digest("2026-11-19T11:54:00Z", 8, 905));
  calls.length = 0;
  vt += 2 * 60_000;
  delayMs = 100;
  const slow = B.translateSet(h5, "vi", { waitMs: 0 }).catch(() => null);
  await new Promise((r) => setTimeout(r, 40));
  const held = await getJSON<{ until: number }>(`tr:ib:${h5}:vi:lock`);
  assert.ok(held && held.until - Date.now() > 100_000, `lock for a long briefing lasts past 100 s (${held && Math.round((held.until - Date.now()) / 1000)} s)`);
  await slow;
  delayMs = 0;

  // ---- a loser ignores an OLD failure marker (from before it started waiting) and takes a new one
  const { takeLock } = await import("../../src/lib/store");
  const h6 = "oldfail1";
  await setJSON(`ib:${h6}`, digest("2026-11-19T11:55:00Z", 2, 20));
  await setJSON(`tr:ib:${h6}:vi:failed`, { at: Date.now() - 20 * 60_000, v: "2026-11-19T11:55:00Z", backoff: 10 * 60_000 }); // expired back-off
  const tok = await takeLock(`tr:ib:${h6}:vi:lock`, 60); // another instance is working
  assert.ok(tok);
  await assert.rejects(() => B.translateSet(h6, "vi", { waitMs: 300, pollMs: 20 }), /in progress elsewhere/, "waited the whole time: the old marker didn't end it");
  const fresh = B.translateSet(h6, "vi", { waitMs: 3000, pollMs: 20 });
  await new Promise((r) => setTimeout(r, 100));
  await setJSON(`tr:ib:${h6}:vi:failed`, { at: Date.now(), v: "2026-11-19T11:55:00Z", backoff: 10 * 60_000 }); // the winner fails now
  await assert.rejects(() => fresh, /unavailable/, "a failure recorded while waiting ends the wait");

  // ---- pacing by reserved tokens per minute (fake clock): two chunks start together, the next two a minute later
  const hp = "paced001";
  await setJSON(`ib:${hp}`, digest("2026-11-19T11:56:00Z", 12, 1000)); // ~6 chunks
  calls.length = 0;
  vt += 2 * 60_000;
  const start = vt;
  await B.translateSet(hp, "vi", { waitMs: 0, budgetMs: 10 * 60_000, onFull: "wait" }); // the scheduler path
  const offs = calls.map((c) => c.at - start);
  assert.ok(calls.length >= 5, `several chunks (${calls.length})`);
  assert.deepEqual(offs.slice(0, 2), [0, 0], "two chunks start together");
  assert.ok(offs[2] >= 60_000 && offs[3] >= 60_000, `the third chunk waits for the minute to pass (${offs.join(", ")})`);
  assert.ok(offs.every((o, i) => i < 2 || o >= 60_000 * Math.floor(i / 2)), "never more than two chunks' reservation per minute");

  // ---- (3) a slow provider stops after the deadline; the rest is left for first read
  useRealClock();
  process.env.GROQ_TPM = "1000000"; // no pacing waits in this check
  const hs = "slow0001";
  await setJSON(`ib:${hs}`, digest("2026-11-19T11:57:00Z", 12, 1000));
  const hu = U.uidFor("slow@example.com");
  await U.touchUser({ uid: hu, email: "slow@example.com", admin: false }, new Date());
  await withUser(hu, () => setJSON(`u:${hu}:settings`, { briefingLanguage: "vi" }));
  const hu2 = U.uidFor("slow2@example.com");
  await U.touchUser({ uid: hu2, email: "slow2@example.com", admin: false }, new Date());
  await withUser(hu2, () => setJSON(`u:${hu2}:settings`, { briefingLanguage: "ja" }));
  delayMs = 120;
  calls.length = 0;
  const t0 = Date.now();
  const got = await B.pretranslateSet(hs, [hu, hu2], { budgetMs: 200 });
  const took = Date.now() - t0;
  delayMs = 0;
  assert.deepEqual(got, [], "nothing finished inside the budget");
  assert.ok(took < 1500, `stopped near the deadline (${took} ms)`);
  assert.ok(calls.length >= 1 && calls.length <= 6, `few chunks were started (${calls.length}), the second language not at all or barely`);
  assert.equal(await getJSON(`tr:ib:${hs}:vi`), null, "left for the reader");
  delete process.env.GROQ_TPM;
  fakeClock();

  // ---- (4) a daily token cap for pre-translation: the first sets use it, later ones wait for first read
  process.env.PRETRANSLATE_DAILY_TOKENS = "1500"; // about one briefing
  await setJSON(`pretr:tokens:${new Date().toISOString().slice(0, 10)}`, 0); // a fresh day
  const sets = ["cap00001", "cap00002", "cap00003"];
  for (const h of sets) await setJSON(`ib:${h}`, digest("2026-11-19T11:58:00Z", 3, 400));
  calls.length = 0;
  vt += 2 * 60_000;
  const r1 = await B.pretranslateSet(sets[0], [vi]);
  const r2 = await B.pretranslateSet(sets[1], [vi]);
  const r3 = await B.pretranslateSet(sets[2], [vi]);
  assert.deepEqual(r1, ["vi"], "the first set (the scheduler runs the admin's, then the biggest sets, first) is translated");
  assert.ok(r2.length + r3.length < 2, `the cap stops later sets (${r2}/${r3})`);
  assert.ok(!(await getJSON(`tr:ib:${sets[2]}:vi`)), "the last set is left for its reader");
  const spent = await getJSON<number>(`pretr:tokens:${new Date().toISOString().slice(0, 10)}`);
  assert.ok(spent && spent > 0, `counted from real usage (${spent} tokens)`);
  delete process.env.PRETRANSLATE_DAILY_TOKENS;

  // ---- (4) the order the scheduler gives sets: the admin's, then the most followers, then the stalest
  const S = await import("../../src/lib/scheduler");
  const mkSet = async (email: string, ticker: string) => {
    const uid = await mk(email, "vi", new Date());
    await withUser(uid, () => setJSON(`u:${uid}:interests`, [{ id: ticker, name: ticker, query: ticker, tickers: [ticker] }]));
    return uid;
  };
  await mkSet("big1@example.com", "AAA");
  await mkSet("big2@example.com", "AAA");
  await mkSet("big3@example.com", "AAA");
  await mkSet("solo@example.com", "BBB");
  const groups = await I.interestGroups();
  const bySize = [...groups.values()].map((g) => g.uids.length);
  assert.ok(Math.max(...bySize) >= 3, "a set with several followers exists");
  const slotNow = new Date("2026-11-19T04:40:00Z").getTime();
  for (const it of ["us", "vn", "world"]) await setJSON(`digest:${it}:en:last`, { at: new Date(slotNow).toISOString(), ok: true, provider: "groq" });
  const order: string[] = [];
  for (let i = 0; i < 6; i++) {
    const u = (await S.nextUnits(slotNow)).brief;
    if (!u?.set || u.item !== "interests:all") break;
    order.push(u.set.hash);
    await setJSON(`ib:${u.set.hash}:last`, { at: new Date(slotNow).toISOString(), ok: true, provider: "groq" });
  }
  const sizes = order.map((h) => groups.get(h)!.uids.length);
  assert.ok(groups.get(order[0])!.uids.includes(OWNER), "the admin's set comes first");
  assert.ok(order.length >= 3, `all sets came up (${order.length})`);
  const rest = sizes.slice(1);
  assert.deepEqual(rest, [...rest].sort((a, b) => b - a), `after the admin's set, bigger sets first (${sizes})`);
  // ---- a reader is waiting: chunks over the minute's tokens go to Flash-Lite at once, no waiting
  process.env.GEMINI_API_KEY = "g";
  const M = await import("../../src/lib/llm/models");
  const hr = "reader01";
  await setJSON(`ib:${hr}`, digest("2026-11-19T12:01:00Z", 8, 910));
  const nChunks = TR.chunkSlots(TR.textSlots(digest("x", 8, 910).analysis as never)).length;
  assert.ok(nChunks >= 4, `fixture makes several chunks (${nChunks})`);
  vt += 2 * 60_000;
  const rStart = vt;
  const gemBefore = (await M.loadUsage(M.modelDef("gem35")!)).requests;
  calls.length = 0;
  const rd = await B.translateSet(hr, "vi", { waitMs: 0 }); // default: a reader
  assert.equal(rd?.language, "vi", "one call finishes it");
  assert.equal(vt - rStart, 0, "no waiting");
  assert.equal(calls.length, nChunks);
  assert.equal(calls.filter((c) => !c.gemini).length, 2, "two chunks on qwen (the minute's tokens)");
  assert.equal(calls.filter((c) => c.gemini).length, nChunks - 2, "the rest on Flash-Lite");
  assert.equal((await M.loadUsage(M.modelDef("gem35")!)).requests - gemBefore, nChunks - 2, "counted in Flash-Lite's usage");
  delete process.env.GEMINI_API_KEY;

  // ---- same instance: the in-flight promise is registered before the first await (concurrent callers share one job)
  const h7 = "samei001";
  await setJSON(`ib:${h7}`, digest("2026-11-19T11:59:00Z", 2, 31));
  calls.length = 0;
  vt += 2 * 60_000;
  const [c1, c2, c3] = await Promise.all([B.translateSet(h7, "vi"), B.translateSet(h7, "vi"), B.translateSet(h7, "vi")]);
  assert.ok(c1?.language === "vi" && c2?.language === "vi" && c3?.language === "vi");
  assert.equal(calls.length, 1, "three simultaneous readers, one call");

  // ---- chunks are stored only when a run fails
  const trc = async () => (await fs.readdir("/tmp/invest-helper")).filter((n) => n.startsWith("trc_")).length;
  const before = await trc();
  const h8 = "okrun001";
  await setJSON(`ib:${h8}`, digest("2026-11-19T12:00:00Z", 2, 33));
  vt += 2 * 60_000;
  await B.translateSet(h8, "vi");
  assert.equal(await trc(), before, "a successful run leaves no chunk copies");

  // ---- releasing a lock only deletes your own
  const { releaseLock } = await import("../../src/lib/store");
  const lk = "test:lock:1";
  const mine = await takeLock(lk, 1);
  assert.ok(mine && !(await takeLock(lk, 1)), "held");
  await releaseLock(lk, "someone-else");
  assert.ok(!(await takeLock(lk, 1)), "a wrong token leaves the lock alone");
  await releaseLock(lk, mine!);
  const again = await takeLock(lk, 1);
  assert.ok(again, "the owner's release frees it");
  await new Promise((r) => setTimeout(r, 1100)); // expires
  await releaseLock(lk, mine!); // a stale holder can't delete the next lock
  const next = await takeLock(lk, 30);
  assert.ok(next, "expired lock taken over");
  await releaseLock(lk, again!);
  assert.ok(!(await takeLock(lk, 30)), "the previous holder's release didn't free the new lock");
  console.log("ROW05 TRANSLATIONS OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
