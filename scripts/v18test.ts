/**
 * v18: predictions apart from briefings. The timetable (briefings every day, US 5 a day), each
 * market's clock, daily calls graded at that day's close (before market: from the previous close;
 * mid-day: from the price then), weekly calls at the 5th weekday (holiday: the previous full session),
 * "market closed, not graded", record labels and graded times, stats by independent day, old records,
 * the prediction prompt, headline refresh (15 min shared, 30 min interest sets, host back-off), time
 * zones, and the new routes. Fake clock, no network. `npx tsx scripts/v18test.ts`
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";

process.env.VERCEL = "1";
delete process.env.KV_REST_API_URL;
delete process.env.ANTHROPIC_API_KEY;
for (const k of ["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "VIEWER_PASSWORD"]) delete process.env[k];
process.env.APP_PASSWORD = "pw";
const R = (url: string, init: RequestInit = {}) => new Request(url, { ...init, headers: { "x-app-password": "pw", ...(init.headers ?? {}) } });

/** Daily closes per symbol (date → close), served as a Yahoo spark batch. */
const closes: Record<string, [string, number][]> = {};
const feedHits: string[] = [];
let googleDown = false;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("/spark?")) {
    const syms = decodeURIComponent(url.match(/symbols=([^&]+)/)![1]).split(",");
    const out: Record<string, unknown> = {};
    for (const s of syms) {
      const h = closes[s];
      if (h) out[s] = { timestamp: h.map(([d]) => Date.parse(`${d}T15:00:00Z`) / 1000), close: h.map(([, c]) => c), chartPreviousClose: h[0][1] };
    }
    return new Response(JSON.stringify(out), { status: 200 });
  }
  if (/rss|news\.google|feeds|\.xml/.test(url)) {
    feedHits.push(url);
    if (googleDown && url.includes("news.google.com")) return new Response("slow down", { status: 429 });
    const items = Array.from({ length: 4 }, (_, i) => `<item><title>Markets story ${i} ${url.length}</title><link>https://n/${i}</link><pubDate>${new Date().toUTCString()}</pubDate></item>`).join("");
    return new Response(`<?xml version="1.0"?><rss><channel>${items}</channel></rss>`, { status: 200 });
  }
  return new Response("", { status: 404 });
}) as typeof fetch;

const at = (iso: string) => new Date(iso);
const T = (iso: string) => Date.parse(iso);

(async () => {
  await fs.rm("/tmp/invest-helper", { recursive: true, force: true });
  const TT = await import("../src/lib/timetable");
  const MK = await import("../src/lib/markets");
  const TR = await import("../src/lib/track");
  const { getJSON, setJSON } = await import("../src/lib/store");
  type Call = import("../src/lib/types").Call;

  /* ---------------- briefings: every day, US 5 a day */
  const sat = TT.briefingsPerDay(at("2026-11-21T12:00:00Z"));
  assert.deepEqual(sat, TT.briefingsPerDay(at("2026-11-17T12:00:00Z")), "Saturday and Sunday at the weekday rate");
  assert.deepEqual(sat, { vn: 5, world: 4, us: 5, interests: 6 }, "World 4, US 5, Vietnam 5, the admin's set 6");
  const usTimes = TT.TIMETABLE.filter((s) => s.items.includes("us")).map((s) => s.at).sort();
  assert.deepEqual(usTimes, ["02:15", "12:30", "15:30", "17:00", "21:20"], "US briefings at the planned UTC times");
  assert.equal(TT.TIMETABLE.filter((s) => s.items.includes("interests:all")).length, 4, "everyone else's set 4 a day");

  /* ---------------- each market's clock */
  assert.deepEqual(MK.dailyTarget(at("2026-11-17T01:16:00Z"), "^VNINDEX.VN"), { date: "2026-11-17", opened: false, tz: "Asia/Ho_Chi_Minh" }, "08:16 Hanoi: today's session, not open yet");
  assert.equal(MK.dailyTarget(at("2026-11-17T04:36:00Z"), "VCB.VN").opened, true, "11:36 Hanoi (lunch): the session has opened");
  assert.deepEqual(MK.dailyTarget(at("2026-11-17T08:00:00Z"), "VCB.VN").date, "2026-11-18", "after the HOSE close: tomorrow");
  assert.deepEqual(MK.dailyTarget(at("2026-11-15T23:31:00Z"), "^N225"), { date: "2026-11-16", opened: false, tz: "Asia/Tokyo" }, "Sunday 23:31 UTC = Monday 08:31 Tokyo");
  assert.equal(MK.dailyTarget(at("2026-11-20T21:30:00Z"), "SPY").date, "2026-11-23", "Friday after the close: Monday");
  assert.equal(MK.nthWeekday("2026-11-18", 5), "2026-11-24", "weekly: Wed → next Tue close (5th trading day counting Wednesday)");
  assert.equal(MK.nthWeekday("2026-11-16", 5), "2026-11-20", "Mon → Fri");
  assert.equal(MK.preDeadline("eu", T("2026-07-15T06:30:00Z")).toISOString(), "2026-07-15T07:00:00.000Z", "Europe's summer open: 07:00 UTC");
  assert.equal(MK.zonedToUtc("2026-03-08", 570, "America/New_York").toISOString(), "2026-03-08T13:30:00.000Z", "the day New York changes clocks");
  const nxt = TT.nextPredictionRuns("vn", T("2026-11-21T10:00:00Z"), 2);
  assert.deepEqual(nxt.map((n) => [new Date(n.at).toISOString(), n.phase]), [["2026-11-23T01:15:00.000Z", "pre"], ["2026-11-23T04:35:00.000Z", "mid"]], "from Saturday: Monday's runs");
  assert.deepEqual(MK.interestPart([{ id: "a", name: "A", query: "", tickers: ["FPT.VN"] }, { id: "b", name: "B", query: "", tickers: ["NVDA", "AMD"] }], "vn").map((i) => i.id), ["a"], "an interest set splits by its interests' first tickers");

  /* ---------------- recording: phases, ids, weekly end, the price at the time */
  const I = [{ id: "x", name: "X", query: "x", tickers: ["AAA", "7203.T"] }];
  const o = (ticker: string, horizon: "today" | "this week", direction: "up" | "down" | "flat" = "up") => ({ interest: "X", ticker, direction, confidence: 62, horizon, action: "HOLD" as const, actionTrigger: "", rationale: "", risks: "" });
  // Wed Nov 18: before the US open (07:30 New York), then mid-day with a live price (+0.3%), then mid-day without one.
  await TR.recordCalls([o("AAA", "today"), o("AAA", "this week")], I, "groq", at("2026-11-18T12:30:00Z"), "calls:t", { phase: "pre" });
  await TR.recordCalls([o("AAA", "today")], I, "groq", at("2026-11-18T17:00:00Z"), "calls:t", { phase: "mid", live: new Map([["AAA", 0.3]]) });
  await TR.recordCalls([o("7203.T", "today")], I, "groq", at("2026-11-18T04:35:00Z"), "calls:t", { phase: "mid", live: new Map() });
  let calls = (await getJSON<Call[]>("calls:t"))!;
  const byId = (id: string) => calls.find((c) => c.id === id)!;
  assert.deepEqual(calls.map((c) => c.id).sort(), ["2026-11-18:7203.T:m", "2026-11-18:AAA:d", "2026-11-18:AAA:m", "2026-11-18:AAA:w"]);
  assert.deepEqual([byId("2026-11-18:AAA:d").phase, byId("2026-11-18:AAA:d").baseChg, byId("2026-11-18:AAA:d").noLiveBase], ["pre", undefined, undefined], "before the open: from the previous close");
  assert.equal(byId("2026-11-18:AAA:w").endDate, "2026-11-24", "weekly graded at the 5th weekday's close");
  assert.equal(byId("2026-11-18:AAA:m").baseChg, 0.3, "mid-day: measured from the price then");
  assert.equal(byId("2026-11-18:7203.T:m").noLiveBase, true, "mid-day without a live price: graded but not counted");
  assert.equal(TR.gradesAfter(byId("2026-11-18:AAA:d")), "2026-11-18T21:15:00.000Z", "graded at New York's close");
  assert.equal(TR.gradesAfter(byId("2026-11-18:AAA:w")), "2026-11-24T21:15:00.000Z");
  assert.equal(TR.gradesAfter(byId("2026-11-18:7203.T:m")), "2026-11-18T06:45:00.000Z", "at Tokyo's close (15:30 + settling)");

  /* ---------------- grading at each close */
  closes.AAA = [["2026-11-16", 100], ["2026-11-17", 100], ["2026-11-18", 101]];
  closes["7203.T"] = [["2026-11-17", 50], ["2026-11-18", 50.6]];
  assert.equal(await TR.gradeCalls(at("2026-11-18T21:00:00Z"), "calls:t"), 1, "before New York's close only the Tokyo call is due");
  assert.equal(await TR.gradeCalls(at("2026-11-18T21:20:00Z"), "calls:t"), 2, "then both AAA daily calls; the weekly waits");
  calls = (await getJSON<Call[]>("calls:t"))!;
  assert.equal(byId("2026-11-18:AAA:d").correct, true, "pre: +1.0% from the previous close");
  const m = byId("2026-11-18:AAA:m");
  assert.ok(Math.abs(m.returnPct! - ((1.01 / 1.003 - 1) * 100)) < 1e-9, `mid-day: +0.7% from the price then (${m.returnPct})`);
  assert.ok(m.band! < byId("2026-11-18:AAA:d").band!, "half a session left: a narrower flat band");
  assert.equal(byId("2026-11-18:7203.T:m").correct, true, "the uncounted call is still graded");

  // Weekly over a holiday: no bar for Tue Nov 24 (a later bar exists) → the previous full session.
  closes.AAA.push(["2026-11-19", 102], ["2026-11-20", 103], ["2026-11-23", 104], ["2026-11-25", 99]);
  assert.equal(await TR.gradeCalls(at("2026-11-25T21:20:00Z"), "calls:t"), 1);
  calls = (await getJSON<Call[]>("calls:t"))!;
  const w = byId("2026-11-18:AAA:w");
  assert.deepEqual([w.gradedOn, w.outcomeClose, w.correct], ["2026-11-23", 104, true], "5th day was a holiday: graded on Monday's close");

  // Daily on a holiday: market closed, not graded; a late-posted bar is waited for.
  await TR.recordCalls([o("CCC", "today")], [{ id: "c", name: "C", query: "", tickers: ["CCC"] }], "groq", at("2026-11-26T12:30:00Z"), "calls:h", { phase: "pre" });
  closes.CCC = [["2026-11-24", 10], ["2026-11-25", 10.1]];
  assert.equal(await TR.gradeCalls(at("2026-11-26T22:00:00Z"), "calls:h"), 0, "no bar yet, could still be posted: wait");
  closes.CCC.push(["2026-11-27", 10.3]);
  assert.equal(await TR.gradeCalls(at("2026-11-27T22:00:00Z"), "calls:h"), 1);
  const hol = (await getJSON<Call[]>("calls:h"))![0];
  assert.deepEqual([hol.closed, hol.correct, hol.returnPct], [true, undefined, undefined], "Thanksgiving: market closed, not graded");
  await TR.recordCalls([o("DDD", "today")], [{ id: "d", name: "D", query: "", tickers: ["DDD"] }], "groq", at("2026-11-26T12:30:00Z"), "calls:h2", { phase: "pre" });
  closes.DDD = [["2026-11-24", 10], ["2026-11-25", 10.1]];
  assert.equal(await TR.gradeCalls(at("2026-11-28T23:00:00Z"), "calls:h2"), 1, "no later bar, but two days passed: closed");
  assert.equal((await getJSON<Call[]>("calls:h2"))![0].closed, true);

  /* ---------------- stats: independent days, uncounted, closed, by phase */
  const s = TR.computeStats([...calls, hol]);
  assert.equal(s.direction.calls, 3, "pre + mid on AAA, plus the weekly");
  assert.equal(s.direction.n, 2, "the two AAA daily calls share one outcome (one ticker-day)");
  assert.equal(s.uncounted, 1, "7203.T mid-day without a live price");
  assert.equal(s.closed, 1);
  assert.deepEqual([s.byPhase.pre.n, s.byPhase.mid.n], [1, 1], "the uncounted one is left out");
  const split = TR.rateByDay([
    { id: "a:d", ticker: "Z", date: "2026-11-18", correct: true, returnPct: 1 },
    { id: "a:m", ticker: "Z", date: "2026-11-18", correct: false, returnPct: -0.2 },
    { id: "b:d", ticker: "Z", date: "2026-11-19", correct: true, returnPct: 0.5 },
  ] as Call[]);
  assert.deepEqual([split.n, split.hits, split.base], [2, 1.5, 0.75], "a split day counts half; the baseline too");
  assert.match(TR.trackRecordText(TR.computeStats(Array.from({ length: 6 }, (_, i) => ({ ...byId("2026-11-18:AAA:d"), id: `2026-11-1${i}:AAA:d`, date: `2026-11-1${i}` })))), /independent ticker-days/);

  /* ---------------- calls from before v18: labeled before market, grades unchanged */
  const legacy: Call = { id: "2026-11-16:FPT.VN:d", date: "2026-11-16", madeAt: "2026-11-16T01:16:00Z", interest: "Tech", ticker: "FPT.VN", direction: "up", confidence: 65, action: "BUY", provider: "groq", baseClose: 100, outcomeClose: 101, returnPct: 1, correct: true, band: 0.4, gradedAt: "2026-11-16T09:00:00Z" };
  await setJSON("calls:legacy", [legacy]);
  await TR.gradeCalls(at("2026-11-20T09:00:00Z"), "calls:legacy");
  const after = (await getJSON<Call[]>("calls:legacy"))![0];
  assert.deepEqual(after, legacy, "an old graded call isn't touched");
  assert.equal(TR.phaseOf(after), "pre", "and reads as before market");
  assert.equal(TR.horizonOf({ id: "x:w" }), "w");

  /* ---------------- the prediction prompt */
  const LP = await import("../src/lib/llm/predict");
  const quote = (symbol: string) => ({ symbol, price: 101, prevClose: 100, changePct: 1, history: [["2026-11-17", 100], ["2026-11-18", 101]] as [string, number][], source: "yahoo" as const });
  const snap = LP.predictionSnapshot({ quotes: [quote("^GSPC"), quote("^DJI"), quote("^NDX")], live: new Map([["^GSPC", { price: 6810.5, chg: 0.42, at: T("2026-11-18T17:00:00Z") }]]), opened: new Set(["^GSPC", "^DJI"]), tz: "America/New_York" });
  assert.match(snap, /\^GSPC.*NOW 6810\.50 \(\+0\.4% today, at 12:00\); today's call starts from this price/);
  assert.match(snap, /\^DJI.*session open but no live price/);
  assert.match(snap, /\^NDX.*starts from the previous close/);
  const lagged = LP.predictionSnapshot({ quotes: [quote("^GSPC")], live: new Map(), opened: new Set(), tz: "America/New_York", now: at("2026-11-20T12:30:00Z") });
  assert.match(lagged, /the 2026-11-19 session's close isn't in the data yet/, "a close posted late isn't passed off as the latest (Nasdaq's daily history lags by hours)");
  assert.equal(LP.lastFinishedSession("^N225", at("2026-11-16T02:00:00Z")), "2026-11-13", "Monday morning in Tokyo: Friday");
  assert.equal(LP.lastFinishedSession("VCB.VN", at("2026-11-17T08:00:00Z")), "2026-11-17", "after HOSE settles: today");
  const input = { interests: [{ id: "u", name: "S&P 500", query: "", tickers: ["^GSPC"] }], phase: "mid" as const, tz: "America/New_York", vn: false, quotes: [quote("^GSPC")], live: new Map(), opened: new Set<string>(), macro: [], macroWanted: [], technicals: {}, calendar: [], news: [], trackRecord: "n/a", today: "2026-11-18", weekEnd: "2026-11-24", now: at("2026-11-18T17:00:00Z") };
  const mid = LP.buildPredictUser(input);
  assert.match(mid, /MID-DAY RUN/);
  assert.match(mid, /Now: Wed, Nov 18 12:00 New York time/);
  assert.ok(!/this week" \(graded/.test(mid), "no weekly calls at mid-day");
  assert.match(LP.buildPredictUser({ ...input, phase: "pre", now: at("2026-11-18T12:30:00Z") }), /"this week" \(graded at the close on Tue, Nov 24/);
  assert.match(LP.buildPredictSystem({ vn: false }), /graded at TODAY'S CLOSE/);
  const P = await import("../src/lib/llm/prompt");
  const brief = P.buildSystemPrompt({ section: "us", news: [], language: "en" } as never, { compact: true });
  assert.ok(!/action_trigger|Be decisive/.test(brief) && /do NOT make buy\/hold\/sell calls/.test(brief), "briefings make no calls");
  const parsed = LP.parsePrediction({ outlook: [{ ticker: "spy", direction: "Bearish", horizon: "This Week", confidence: "55", action: "sell" }] });
  assert.deepEqual([parsed.calls[0].ticker, parsed.calls[0].direction, parsed.calls[0].horizon, parsed.calls[0].confidence, parsed.calls[0].action], ["SPY", "down", "this week", 55, "SELL"], "free-model slips repaired");

  /* ---------------- a "before market" run made after the open is graded like a mid-day call */
  await TR.recordCalls([o("AAA", "today")], I, "groq", at("2026-11-19T15:00:00Z"), "calls:late", { phase: "pre" });
  const lateCall = (await getJSON<Call[]>("calls:late"))![0];
  assert.deepEqual([lateCall.date, lateCall.noLiveBase], ["2026-11-19", true], "10:00 New York: opened, no live price → not counted");

  /* ---------------- headlines: shared every 15 min, interest sets every 30, back off on 429 */
  const H = await import("../src/lib/headlines");
  const t0 = at("2026-11-18T10:00:00Z");
  const n1 = await H.refreshHeadlines(t0);
  assert.equal(n1, 4, "World, US, Vietnam and the owner's interest set");
  assert.ok((await H.loadHeadlines("world"))!.items.length > 0);
  const hits = feedHits.length;
  assert.equal(await H.refreshHeadlines(new Date(t0.getTime() + 10 * 60_000)), 0, "10 minutes later: nothing due");
  assert.equal(feedHits.length, hits, "and no feed requests");
  assert.equal(await H.refreshHeadlines(new Date(t0.getTime() + 14 * 60_000)), 3, "~15 minutes: the shared sections (ticks come with jitter)");
  assert.equal(await H.refreshHeadlines(new Date(t0.getTime() + 29 * 60_000)), 4, "~30 minutes: the shared sections again, and now the interest set");
  googleDown = true;
  await H.refreshHeadlines(new Date(t0.getTime() + 45 * 60_000));
  const cool = await getJSON<Record<string, number>>("news:cool");
  assert.ok((cool?.["news.google.com"] ?? 0) > Date.now() + 25 * 60_000, "Google News is rested for 30 minutes after a 429");
  const before = feedHits.filter((u) => u.includes("news.google.com")).length;
  await H.refreshHeadlines(new Date(t0.getTime() + 60 * 60_000));
  assert.equal(feedHits.filter((u) => u.includes("news.google.com")).length, before, "and not asked again while it rests");
  assert.ok((await H.loadHeadlines("world"))!.errors.some((e) => /rate-limiting/.test(e)), "the reason is kept");
  googleDown = false;

  /* ---------------- time zones */
  const Z = await import("../src/lib/zones");
  assert.equal(Z.isZone("Asia/Ho_Chi_Minh"), true);
  assert.equal(Z.isZone("auto"), true);
  assert.equal(Z.isZone("Mars/Base"), false);
  assert.equal(Z.resolveZone("America/New_York"), "America/New_York");
  assert.equal(Z.resolveZone("auto"), Z.deviceZone(), "auto follows the device");
  assert.equal(Z.zoneCity("Asia/Ho_Chi_Minh"), "Hanoi");
  assert.equal(Z.zoneCity("America/Argentina/Buenos_Aires"), "Buenos Aires");
  assert.equal(Z.clockIn("2026-11-18T01:15:00Z", "Asia/Ho_Chi_Minh"), "08:15");
  assert.equal(Z.zoneOffset("Asia/Ho_Chi_Minh", T("2026-11-18T00:00:00Z")), "UTC+7");
  assert.equal(Z.sameClock("Asia/Ho_Chi_Minh", "Asia/Bangkok", T("2026-11-18T00:00:00Z")), true, "same wall clock: one label is enough");
  assert.equal(Z.sameClock("Asia/Ho_Chi_Minh", "UTC"), false);
  const settings = await import("../src/app/api/settings/route");
  const put = (b: unknown) => settings.PUT(R("http://x/api/settings", { method: "PUT", body: JSON.stringify(b) }));
  assert.equal((await put({ timeZone: "Mars/Base" })).status, 400);
  assert.equal((await (await put({ timeZone: "America/New_York" })).json()).timeZone, "America/New_York", "saved per account");
  assert.equal((await (await settings.GET(R("http://x/api/settings"))).json()).briefingLanguage, "en", "the language stays as it was");

  /* ---------------- routes */
  await setJSON("pred:vn", { scope: "vn", section: "vn", market: "vn", tz: "Asia/Ho_Chi_Minh", daily: { phase: "pre", at: "2026-11-18T01:16:00Z", provider: "groq", date: "2026-11-18", items: [o("^VNINDEX.VN", "today")] } });
  const pr = await import("../src/app/api/predictions/route");
  const pj = await (await pr.GET(R("http://x/api/predictions?section=vn"))).json();
  assert.equal(pj.sets[0].daily.items[0].ticker, "^VNINDEX.VN");
  assert.equal((await pr.GET(R("http://x/api/predictions?section=moon"))).status, 400);
  const nr = await import("../src/app/api/news/route");
  assert.ok((await (await nr.GET(R("http://x/api/news?section=us"))).json()).items.length > 0, "the live list is served");
  const PV = await import("../src/lib/predictions");
  assert.match(PV.predictionsAsText(pj.sets), /made before market 2026-11-18 01:16 UTC: HOLD, up, 62%/, "Ask AI sees when each call was made");

  console.log("V18 OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
