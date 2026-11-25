/** v19b D8: the big-story trigger: bigStoryDue (pure), the tick's marker and daily cap, the scheduler's big-story unit on the briefing lane. */
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import { pinClock } from "../clock";
import { isStoryCall, storyReply } from "../story-reply";

pinClock("2026-11-25T13:00:00Z");
process.env.VERCEL = "1";
process.env.GEMINI_API_KEY = "g";
delete process.env.GROQ_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LLM_PROVIDER;
delete process.env.GROQ_TPM;
delete process.env.BIG_STORY_DAILY_LIMIT;
delete process.env.APP_URL;
delete process.env.VERCEL_URL;
delete process.env.VERCEL_PROJECT_PRODUCTION_URL;

type NewsItem = import("../../src/lib/types").NewsItem;
type Story = import("../../src/lib/stories/types").Story;
type StoryCard = import("../../src/lib/stories/types").StoryCard;

let feed: { title: string; source: string; at: string }[] = [];
const ai: { system: string; user: string }[] = [];
const rss = (items: typeof feed) =>
  `<?xml version="1.0"?><rss><channel>${items.map((i) => `<item><title>${i.title}</title><link>https://n/${encodeURIComponent(i.title + i.source)}</link><source>${i.source}</source><pubDate>${new Date(i.at).toUTCString()}</pubDate></item>`).join("")}</channel></rss>`;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("generativelanguage") || url.includes("api.groq.com")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const system: string = body.messages?.[0]?.content ?? "";
    const user: string = body.messages?.[1]?.content ?? "";
    ai.push({ system, user });
    const content = isStoryCall(system) ? storyReply(user) : system.startsWith("You translate") ? JSON.stringify((JSON.parse(user) as string[]).map((s) => `vi:${s}`)) : "{}";
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 100 } }), { status: 200 });
  }
  if (url.includes("/v8/finance/spark")) {
    const syms = decodeURIComponent(url.split("symbols=")[1].split("&")[0]).split(",");
    const day = Date.UTC(2026, 10, 24, 21) / 1000;
    const ts = Array.from({ length: 30 }, (_, i) => day - (29 - i) * 86400);
    return new Response(JSON.stringify(Object.fromEntries(syms.map((s) => [s, { timestamp: ts, close: ts.map(() => 100), chartPreviousClose: 100 }]))), { status: 200 });
  }
  if (url.includes("bbci.co.uk") || url.includes("vnexpress.net")) return new Response(rss(feed), { status: 200 });
  if (/rss|news\.google|feeds|\.xml|\/rss/.test(url)) return new Response(rss([]), { status: 200 });
  return new Response("{}", { status: 404 });
}) as typeof fetch;

const T = (iso: string) => new Date(iso);
const MIN = 60_000;
const item = (id: string, source: string, at: string): NewsItem => ({ id, title: `Story headline ${id}`, source, link: `https://x/${id}`, publishedAt: new Date(at).toISOString() });
/** A story whose outlets published at the given minutes after `first`. */
const story = (id: string, minutes: number[], kind: "important" | "interesting" = "important", first = "2026-11-25T13:00:00Z"): Story => {
  const t0 = new Date(first).getTime();
  const members = minutes.map((m, j) => item(`${id}m${j}`, `Outlet${j}`, new Date(t0 + m * MIN).toISOString()));
  return { id, members, outlets: members.map((m) => m.source), firstSeen: members[0].publishedAt, lastSeen: members.at(-1)!.publishedAt, lang: "en", kind };
};
const card = (id: string): StoryCard => ({ id, scope: "world", kind: "important", lang: "en", explainedAt: "2026-11-25T12:00:00Z", outletsAtExplain: 4, title: id, outlets: [], what: "w", why: "y", markets: [], world: "", past: null, concepts: [], memberIds: [] });

(async () => {
  await fs.rm(process.env.STORE_DIR || "/tmp/invest-helper", { recursive: true, force: true });
  const P = await import("../../src/lib/stories/pick");
  const now = T("2026-11-25T13:20:00Z");

  // ---- 1. bigStoryDue
  assert.equal(P.bigStoryDue([story("a", [0, 5, 10, 15])], {}, now)?.id, "a", "4 outlets within 30 min: due");
  assert.equal(P.bigStoryDue([story("a", [0, 10, 20])], {}, now), null, "3 outlets: no");
  assert.equal(P.bigStoryDue([story("a", [0, 10, 20, 40])], {}, now), null, "the 4th outlet 40 min after the first headline: no");
  assert.equal(P.bigStoryDue([story("a", [0, 10, 20, 29, 45])], {}, now)?.id, "a", "4 within 30 min, a 5th later: still due");
  assert.equal(P.bigStoryDue([story("a", [0, 5, 10, 15])], { a: card("a") }, now), null, "it has a card: no");
  assert.equal(P.bigStoryDue([story("a", [0, 5, 10, 15], "interesting")], {}, now), null, "an interesting story: no");
  assert.equal(P.bigStoryDue([story("a", [0, 5, 10, 15])], {}, T("2026-11-25T13:45:00Z")), null, "first headline 45 min ago: too old");
  assert.equal(P.bigStoryDue([story("a", [0, 5, 10, 15]), story("b", [2, 4, 6, 8, 10])], {}, now)?.id, "b", "the one with most outlets");
  assert.equal(P.bigStoryDue([], {}, now), null);

  // ---- 2. the tick writes a marker (no AI) and respects the daily cap
  const H = await import("../../src/lib/headlines");
  const B = await import("../../src/lib/stories/big");
  const { getJSON, setJSON, delJSON } = await import("../../src/lib/store");
  const TT = await import("../../src/lib/timetable");
  const S = await import("../../src/lib/scheduler");
  const Pl = { ...(await import("../../src/lib/pipeline")), ...(await import("../../src/lib/briefings")) };

  // Two old stories get cards from a normal run at 12:00.
  feed = [
    { title: "Oil jumps after OPEC+ agrees surprise output cut", source: "Reuters", at: "2026-11-25T09:00:00Z" },
    { title: "Oil jumps after OPEC+ agrees surprise output cut today", source: "AP", at: "2026-11-25T09:10:00Z" },
    { title: "Brazil central bank holds rates steady", source: "Reuters", at: "2026-11-25T09:30:00Z" },
  ];
  const d0 = await Pl.refreshShared("world", "en", T("2026-11-25T12:00:00Z"));
  assert.equal(d0.stories!.length, 2);
  const BIG = "Volcano erupts near a major city, thousands evacuated";
  feed = [
    ...feed,
    { title: BIG, source: "BBC", at: "2026-11-25T13:00:00Z" },
    { title: `${BIG} officials say`, source: "CNN", at: "2026-11-25T13:05:00Z" },
    { title: `${BIG} authorities say`, source: "Sky", at: "2026-11-25T13:08:00Z" },
    { title: `${BIG} agency reports`, source: "DW", at: "2026-11-25T13:12:00Z" },
  ];
  ai.length = 0;
  const tickAt = T("2026-11-25T13:15:00Z");
  await H.refreshHeadlines(tickAt);
  assert.equal(ai.length, 0, "the tick makes no AI call");
  const marker = await getJSON<{ id: string; at: string }>("stories:big:world");
  assert.ok(marker, "the tick wrote stories:big:world");
  assert.equal(marker!.at, tickAt.toISOString());
  const idx = await getJSON<{ stories: { id: string; memberIds: string[]; outlets: string[] }[] }>("stories:world");
  const bigStory = idx!.stories.find((s) => s.id === marker!.id)!;
  assert.equal(bigStory.outlets.length, 4, "the marked story is the 4-outlet one");
  assert.equal(await getJSON("stories:big:us"), null);
  assert.equal(await getJSON("stories:big:vn"), null);

  // the cap: BIG_STORY_DAILY_LIMIT (default 6) per section per UTC day
  await delJSON("stories:big:world");
  const cap = B.bigCountKey("world", tickAt);
  assert.equal(cap, "stories:bigcount:world:2026-11-25");
  await setJSON(cap, 6);
  await delJSON("news:world"); // make the list due again
  await H.refreshHeadlines(T("2026-11-25T13:29:00Z"));
  assert.equal(await getJSON("stories:big:world"), null, "6 today: no marker");
  await setJSON(cap, 5);
  await delJSON("news:world"); // make the list due again
  await H.refreshHeadlines(T("2026-11-25T13:29:00Z"));
  assert.ok(await getJSON("stories:big:world"), "5 today: one more allowed");
  await delJSON("stories:big:world");
  process.env.BIG_STORY_DAILY_LIMIT = "5";
  assert.equal(await B.markBigStory("world", [story("zz", [0, 1, 2, 3], "important", "2026-11-25T13:20:00Z")], T("2026-11-25T13:29:00Z")), false, "BIG_STORY_DAILY_LIMIT lowers the cap");
  delete process.env.BIG_STORY_DAILY_LIMIT;
  await setJSON(cap, 0);
  await delJSON("stories:big:world");
  await delJSON("news:world"); // make the list due again
  await H.refreshHeadlines(T("2026-11-25T13:29:00Z"));
  const marker2 = await getJSON<{ id: string; at: string }>("stories:big:world");
  assert.ok(marker2 && marker2.id === marker!.id, "marker back");
  // a second story is not marked while one is pending
  assert.equal(await B.markBigStory("world", [story("zz", [0, 1, 2, 3, 4], "important", "2026-11-25T13:25:00Z")], T("2026-11-25T13:29:00Z")), false, "one pending marker at a time");

  // ---- 3. never for interests
  assert.equal(await B.markBigStory("ib:abc123", [story("yy", [0, 1, 2, 3, 4], "important", "2026-11-25T13:25:00Z")], T("2026-11-25T13:29:00Z")), false);
  assert.equal(await getJSON("stories:big:ib:abc123"), null, "no marker for an interest set");
  await setJSON("stories:big:ib:abc123", { id: "yy", at: "2026-11-25T13:25:00.000Z" });

  // ---- 4. the scheduler: a big-story unit on the briefing lane, after the 65 s gap, explaining only that story
  // Everything scheduled is done; the marker is from 13:30.
  const doneBefore = async (ms: number) => {
    for (const o of TT.occurrences(ms - 3 * 86400_000, ms - 1)) if (!(await getJSON(TT.runKey(o)))) await setJSON(TT.runKey(o), { items: {}, sets: {}, done: "seed" });
  };
  await doneBefore(T("2026-11-26T00:00:00Z").getTime());
  let t = T("2026-11-25T13:31:00Z").getTime();
  const sleeps: number[] = [];
  const opts = { now: () => new Date(t), sleep: async (ms: number) => { sleeps.push(ms); t += ms; } };
  await setJSON("sched:lastUnit:brief", { at: t - 10_000, used120: false });
  await delJSON("news:world"); // headlines not due-check noise: the tick refreshes them (and keeps the marker)
  ai.length = 0;
  const r = await S.runTick(opts);
  assert.deepEqual(r.unit && { slot: r.unit.slot, ok: r.unit.ok }, { slot: "big:world", ok: true }, `a big-story unit ran: ${JSON.stringify(r.unit)}`);
  assert.deepEqual(sleeps, [55_000], "the briefing lane's 65 s gap: 10 s since the last unit, so it waited 55 s");
  const storyCalls = ai.filter((c) => isStoryCall(c.system));
  assert.equal(storyCalls.length, 1, "one story AI call");
  const sent = storyCalls[0].user.match(/^\[[^\]]+\] [^:]*: .*$/gm) ?? [];
  assert.ok(sent.length >= 4 && sent.every((l) => l.includes("Volcano")), `only the big story's headlines are sent: ${sent.join(" / ")}`);
  assert.ok(!/OPEC|Brazil/.test(sent.join("\n")), "the old stories are not explained again");
  assert.equal(await getJSON("stories:big:world"), null, "the marker is cleared");
  assert.equal(await getJSON(cap), 1, "the day's counter went up");
  const shown = await Pl.loadDigest("world", undefined, "en");
  assert.ok(shown!.stories!.some((c) => c.id === marker!.id), "the stored digest shows the new card");
  assert.equal(shown!.stories!.length, 3, "kept cards plus the big story's");
  assert.ok(new Date(shown!.generatedAt).getTime() >= T("2026-11-25T13:31:55Z").getTime(), "stored by this unit");
  const last = await getJSON<{ at: string }>("digest:world:en:last");
  assert.equal(last!.at, d0.generatedAt, "a big-story run does not touch :last (the next slot is not skipped as fresh)");
  assert.equal(await getJSON("stories:big:ib:abc123") !== null, true, "an interest marker is never picked up (still there, untouched)");
  assert.ok(!sleeps.slice(1).length);

  // the chain ends: nothing pending, nothing runs
  const r2 = await S.runTick(opts);
  assert.equal(r2.unit, undefined, "no marker, no unit");

  // ---- 5. a scheduled briefing keeps priority over a pending big story
  await setJSON("stories:big:us", { id: "us1", at: new Date(t).toISOString() });
  await delJSON("stories:big:ib:abc123");
  const o = TT.occurrences(T("2026-11-25T12:25:00Z").getTime(), T("2026-11-25T12:35:00Z").getTime()).find((x) => x.slot.id === "b-1230")!;
  assert.ok(o, "the 12:30 briefing slot exists");
  await delJSON(TT.runKey(o));
  t += 5 * MIN;
  sleeps.length = 0;
  await setJSON("sched:lastUnit:brief", { at: t - 120_000, used120: false });
  const r3 = await S.runTick(opts);
  assert.ok(r3.unit && r3.unit.slot === "b-1230", `the scheduled slot goes first: ${JSON.stringify(r3.unit)}`);
  assert.ok(await getJSON("stories:big:us"), "the big-story marker waits");

  // ---- 6. a stale marker (older than 2 h) is dropped
  await setJSON("stories:big:vn", { id: "old", at: new Date(t - 2 * 3600_000 - MIN).toISOString() });
  assert.equal(await B.pendingBig("vn", new Date(t)), null);
  assert.equal(await getJSON("stories:big:vn"), null, "the stale marker is removed");
  assert.equal((await S.nextBigStory(t))?.scope === "vn", false);

  // ---- 7. a failed unit records its attempt: one retry after 20 min, then it gives up
  await setJSON("stories:big:vn", { id: "gone", at: new Date(t).toISOString() });
  await doneBefore(T("2026-11-26T00:00:00Z").getTime());
  const nb = await S.nextBigStory(t);
  assert.equal(nb?.scope, "us", "the us marker is still pending too (checked in scope order: world, us, vn)");
  await delJSON("stories:big:us");
  assert.equal((await S.nextBigStory(t))?.scope, "vn");
  await setJSON("stories:big:vn", { id: "gone", at: new Date(t).toISOString(), tries: 1, lastTry: new Date(t - 5 * MIN).toISOString() });
  assert.equal(await S.nextBigStory(t), null, "tried 5 min ago: waits for the retry");
  assert.equal((await S.nextBigStory(t + 16 * MIN))?.scope, "vn", "retry after 20 min");
  await setJSON("stories:big:vn", { id: "gone", at: new Date(t).toISOString(), tries: 2, lastTry: new Date(t - 30 * MIN).toISOString(), gaveUp: true });
  assert.equal(await S.nextBigStory(t + 40 * MIN), null, "gave up: never again");

  console.log("D8 BIG STORY OK");
})();
