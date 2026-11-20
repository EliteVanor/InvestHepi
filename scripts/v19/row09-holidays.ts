// Row 9 (PX-13): exchange holidays and early closes live in one table (src/lib/holidays.ts) and drive
// the timetable, the exchange clocks, grading and the "latest finished session" rule.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { pinClock } from "../clock";

pinClock("2026-11-20T12:00:00Z");
process.env.VERCEL = "1";
delete process.env.KV_REST_API_URL;

const NY = "America/New_York";
const HANOI = "Asia/Ho_Chi_Minh";
const HK = "Asia/Hong_Kong";
const at = (iso: string) => new Date(iso);

/** Daily closes per symbol (date -> close), served as a Yahoo spark batch; AAA also has Friday Nov 27's minute bars. */
const closes: Record<string, [string, number][]> = {};
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
  if (url.includes("/v8/finance/chart/AAA")) {
    // Friday Nov 27 2026, 09:30 ET to 20:00 ET (after hours included, as Nasdaq does): 102 until the 13:00 ET early close, 99 after.
    const ts = Array.from({ length: 63 }, (_, i) => Date.parse("2026-11-27T14:30:00Z") / 1000 + i * 600);
    const c = ts.map((t) => (t <= Date.parse("2026-11-27T18:00:00Z") / 1000 ? 102 : 99));
    return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: c.at(-1), chartPreviousClose: 100, regularMarketTime: ts.at(-1) }, timestamp: ts, indicators: { quote: [{ close: c }] } }] } }), { status: 200 });
  }
  return new Response("", { status: 404 });
}) as typeof fetch;

(async () => {
  await fs.rm("/tmp/invest-helper", { recursive: true, force: true });
  const H = await import("../../src/lib/holidays");
  const MK = await import("../../src/lib/markets");
  const TT = await import("../../src/lib/timetable");
  const TR = await import("../../src/lib/track");
  const CM = await import("../../src/lib/marketTime");
  const CAL = await import("../../src/lib/calendar");
  const MKT = await import("../../src/lib/market");
  const { getJSON, setJSON } = await import("../../src/lib/store");
  type Call = import("../../src/lib/types").Call;

  /* ---------------- the table: every exchange has 2026 and 2027, dates are weekdays, early closes are inside the session */
  const counts: string[] = [];
  for (const [cal, years] of Object.entries(H.HOLIDAYS)) {
    for (const y of [2026, 2027]) {
      const t = years[y];
      assert.ok(t, `${cal} ${y}`);
      assert.ok(t.src.length > 0, `${cal} ${y} has sources`);
      for (const d of [...t.closed, ...Object.keys(t.early)]) {
        assert.ok(d.startsWith(String(y)), `${cal} ${d} is in ${y}`);
        assert.ok(!MK.isWeekend(d), `${cal} ${d} is a weekday (weekends are never listed)`);
      }
      assert.equal(new Set(t.closed).size, t.closed.length, `${cal} ${y}: no duplicate dates`);
      assert.ok(Object.keys(t.early).every((d) => !t.closed.includes(d)), `${cal} ${y}: a day is closed or early, not both`);
      assert.deepEqual([...t.closed, ...Object.keys(t.early)].filter((d) => t.provisional?.includes(d)), t.provisional ?? [], `${cal} ${y}: provisional dates are in the table`);
      counts.push(`${cal} ${y}: ${t.closed.length} closed, ${Object.keys(t.early).length} early`);
    }
  }
  console.log(counts.join("\n"));

  /* ---------------- US Thanksgiving 2026: Thu Nov 26 closed, Fri Nov 27 ends at 13:00 ET */
  assert.equal(H.isHoliday(NY, "2026-11-26"), true);
  assert.equal(H.isHoliday(NY, "2026-11-27"), false);
  assert.equal(H.earlyCloseMins(NY, "2026-11-27"), 13 * 60);
  assert.equal(H.earlyCloseMins(NY, "2026-11-25"), undefined);
  assert.equal(MK.closeUtc("2026-11-27", NY).toISOString(), "2026-11-27T18:00:00.000Z", "13:00 EST");
  assert.equal(MK.closeUtc("2026-11-25", NY).toISOString(), "2026-11-25T21:00:00.000Z");
  assert.equal(MK.sessionClosed("2026-11-27", NY, at("2026-11-27T18:14:00Z")), false, "still settling");
  assert.equal(MK.sessionClosed("2026-11-27", NY, at("2026-11-27T18:15:00Z")), true, "the session ends at the early close + settling");
  assert.equal(MK.sessionClosed("2026-11-26", NY, at("2026-11-26T06:00:00Z")), true, "a holiday has nothing to wait for");
  assert.equal(MK.sessionClosed("2026-11-26", NY, at("2026-11-25T20:00:00Z")), false, "...once the day has begun");

  // No prediction slot on the holiday (New York's), but Tokyo's still run that day, and Friday's US slots exist.
  const slotsOn = (date: string, tz: string) =>
    TT.occurrences(Date.parse(`${date}T00:00:00Z`) - 14 * 3600_000, Date.parse(`${date}T00:00:00Z`) + 38 * 3600_000).filter((o) => o.slot.tz === tz && MK.localNow(o.start, tz).date === date).map((o) => o.slot.id);
  assert.deepEqual(slotsOn("2026-11-26", NY), [], "Thanksgiving: no US prediction runs (no 'unavailable' notes)");
  assert.deepEqual(slotsOn("2026-11-25", NY), ["p-us-pre", "p-us-mid"]);
  assert.deepEqual(slotsOn("2026-11-27", NY), ["p-us-pre", "p-us-mid"]);
  assert.deepEqual(slotsOn("2026-11-26", "Asia/Tokyo"), ["p-jp-pre", "p-jp-mid"], "Tokyo trades on Nov 26");
  assert.deepEqual(TT.nextPredictionRuns("us", Date.parse("2026-11-25T20:00:00Z"), 1).map((r) => new Date(r.at).toISOString()), ["2026-11-27T12:30:00.000Z"], "next US run skips Thanksgiving");
  // Briefings still run on a holiday (they are not market-bound).
  assert.ok(TT.occurrences(Date.parse("2026-11-26T00:00:00Z"), Date.parse("2026-11-26T23:59:00Z")).some((o) => o.slot.id === "b-1230"));

  // Daily targets: Wednesday after the close points to Friday; Friday after the early close points to Monday.
  assert.deepEqual(MK.dailyTarget(at("2026-11-25T22:00:00Z"), "SPY"), { date: "2026-11-27", opened: false, tz: NY });
  assert.deepEqual(MK.dailyTarget(at("2026-11-26T15:00:00Z"), "SPY"), { date: "2026-11-27", opened: false, tz: NY }, "on the holiday itself");
  assert.deepEqual(MK.dailyTarget(at("2026-11-27T17:45:00Z"), "SPY"), { date: "2026-11-27", opened: true, tz: NY }, "12:45 ET: still open");
  assert.equal(MK.dailyTarget(at("2026-11-27T18:05:00Z"), "SPY").date, "2026-11-30", "13:05 ET: the early close has passed");
  assert.equal(MK.preDeadline("us", at("2026-11-25T22:00:00Z")).toISOString(), "2026-11-27T14:30:00.000Z", "a before-market run waits for Friday's open, not Thursday's");
  assert.equal(MK.lastFinishedSession("SPY", at("2026-11-26T17:00:00Z")), "2026-11-25", "Thanksgiving: still Wednesday");
  assert.equal(MK.lastFinishedSession("SPY", at("2026-11-27T18:14:00Z")), "2026-11-25");
  assert.equal(MK.lastFinishedSession("SPY", at("2026-11-27T18:15:00Z")), "2026-11-27", "an early close ends the session at 13:00 ET");
  assert.equal(MK.lastFinishedSession("SPY", at("2026-11-30T14:00:00Z")), "2026-11-27");

  // An after-hours print can't pass as the close on the early-close day.
  const q0 = { symbol: "AAA", price: 100, prevClose: 100, changePct: 0, history: [["2026-11-24", 99], ["2026-11-25", 100]] as [string, number][], source: "nasdaq" as const };
  const fr = (await MKT.freshenQuotes([q0], at("2026-11-27T23:00:00Z")))[0];
  assert.deepEqual([fr.history.at(-1), fr.prevClose, fr.changePct.toFixed(1)], [["2026-11-27", 102], 100, "2.0"], "13:00 ET close (102), not the 99 printed after it; Wednesday is the previous session");

  // The open/closed clock (the pill) and the prompt's phase.
  assert.deepEqual(CM.marketClock(at("2026-11-26T15:00:00Z")).phase, "closed", "Thanksgiving");
  assert.equal(CM.marketClock(at("2026-11-26T15:00:00Z")).secs, 23.5 * 3600, "10:00 ET Thursday: the next open is Friday 09:30, 23.5 h away");
  assert.equal(CM.marketClock(at("2026-11-27T17:30:00Z")).phase, "open", "12:30 ET Friday");
  assert.deepEqual(CM.marketClock(at("2026-11-27T17:30:00Z")), { phase: "open", secs: 1800 }, "30 minutes to the early close");
  assert.equal(CM.marketClock(at("2026-11-27T18:30:00Z")).phase, "after", "13:30 ET Friday");

  /* ---------------- Vietnam: Tet 2027 closed range (provisional), Hanoi clock and timetable */
  for (const d of ["2027-02-04", "2027-02-05", "2027-02-08", "2027-02-09", "2027-02-10"]) {
    assert.ok(H.isHoliday(HANOI, d), `Tet ${d}`);
    assert.ok(H.isProvisional(HANOI, d), `Tet ${d} is flagged provisional until HOSE's notice`);
  }
  assert.ok(!H.isHoliday(HANOI, "2027-02-03") && !H.isHoliday(HANOI, "2027-02-11"));
  assert.equal(MK.nextTradingDay("2027-02-03", HANOI), "2027-02-11", "Wed Feb 3 -> Thu Feb 11");
  assert.equal(MK.nextTradingDay("2027-02-03"), "2027-02-04", "without a calendar only weekends are skipped");
  assert.deepEqual(MK.dailyTarget(at("2027-02-03T09:00:00Z"), "FPT.VN").date, "2027-02-11", "a call after Wednesday's close targets the first session after Tet");
  assert.deepEqual(slotsOn("2027-02-08", HANOI), [], "no Vietnam runs during Tet");
  assert.deepEqual(slotsOn("2027-02-03", HANOI), ["p-vn-pre", "p-vn-mid"]);
  assert.equal(CM.vnMarketClock(at("2027-02-08T03:00:00Z")).phase, "closed");
  assert.equal(CM.vnMarketClock(at("2027-02-08T03:00:00Z")).secs, (3 * 86400 + 9 * 3600) - 10 * 3600, "10:00 ICT Monday: open again Thursday 09:00");
  assert.equal(H.isHoliday(HANOI, "2026-09-01"), true, "National Day 2026");

  /* ---------------- Hong Kong half days close at 12:00 */
  assert.equal(H.earlyCloseMins(HK, "2027-02-05"), 12 * 60, "Lunar New Year's Eve 2027");
  assert.equal(H.earlyCloseMins(HK, "2027-12-24"), 12 * 60);
  assert.equal(H.isProvisional(HK, "2027-02-05"), false, "named in HKEX's own circular");
  assert.equal(MK.closeUtc("2027-02-05", HK).toISOString(), "2027-02-05T04:00:00.000Z");
  assert.equal(MK.sessionClosed("2027-02-05", HK, at("2027-02-05T04:14:00Z")), false);
  assert.equal(MK.sessionClosed("2027-02-05", HK, at("2027-02-05T04:15:00Z")), true);
  assert.ok(H.isHoliday(HK, "2027-02-08") && H.isHoliday(HK, "2027-02-09"));
  assert.equal(TR.gradesAfter({ date: "2027-02-05", ticker: "^HSI", id: "2027-02-05:^HSI:d" }), "2027-02-05T04:15:00.000Z", "a Hang Seng call on a half day grades at 12:15 HK");
  // Japan and London.
  assert.ok(H.isHoliday("Asia/Tokyo", "2026-11-23") && H.isHoliday("Asia/Tokyo", "2027-12-31"));
  assert.equal(H.earlyCloseMins("Europe/London", "2026-12-24"), 12 * 60 + 30);
  assert.ok(H.isHoliday("Europe/London", "2026-12-28") && H.isHoliday("Europe/Berlin", "2026-12-24"));

  /* ---------------- grading: a holiday daily call is closed at once; weekly end skips holidays */
  closes.AAA = ["02", "03", "04", "05", "06", "09", "10", "11", "12", "13", "16", "17", "18", "19", "20", "23", "24", "25"].map((d, i) => [`2026-11-${d}`, 100 + i] as [string, number]);
  const base: Partial<Call> = { madeAt: "2026-11-24T12:00:00Z", interest: "x", ticker: "AAA", direction: "up", confidence: 70, action: "BUY", provider: "groq", phase: "pre" };
  await setJSON("calls:hol", [
    { ...base, id: "2026-11-26:AAA:d", date: "2026-11-26" },
    { ...base, id: "2026-11-19:AAA:w", date: "2026-11-19", endDate: "2026-11-26" }, // recorded before the table: 5th "weekday" is the holiday
  ] satisfies Partial<Call>[]);
  assert.equal(await TR.gradeCalls(at("2026-11-26T15:00:00Z"), "calls:hol"), 2, "graded at 10:00 ET on the holiday itself: no 48-hour wait, no later bar needed");
  const hol = (await getJSON<Call[]>("calls:hol"))!;
  assert.deepEqual([hol[0].closed, hol[0].correct, hol[0].returnPct], [true, undefined, undefined], "Thanksgiving daily call: market closed, not graded");
  assert.deepEqual([hol[1].gradedOn, hol[1].outcomeClose, hol[1].correct], ["2026-11-25", 117, true], "weekly ending on the holiday: the previous full session");

  // Weekly end: the 5th trading day, holidays skipped.
  assert.equal(MK.nthWeekday("2026-11-23", 5), "2026-11-27", "weekends only");
  assert.equal(MK.nthWeekday("2026-11-23", 5, NY), "2026-11-30", "Mon Nov 23, 24, 25, 27, 30: Thanksgiving skipped");
  assert.equal(MK.nthWeekday("2027-02-03", 5, HANOI), "2027-02-16", "Wed Feb 3, then Thu Feb 11, 12, 15, 16 after Tet");
  assert.equal(TR.gradeDateOf({ id: "2026-11-23:AAA:w", date: "2026-11-23", ticker: "AAA" }), "2026-11-30", "a weekly call without a stored end date");
  assert.equal(TR.gradeDateOf({ id: "2026-11-23:AAA:w", date: "2026-11-23", ticker: "AAA", endDate: "2026-11-27" }), "2026-11-27", "a stored end date is kept");
  await TR.recordCalls(
    [{ interest: "x", ticker: "AAA", direction: "up", confidence: 60, horizon: "this week", action: "Buy", actionTrigger: "", rationale: "", risks: "" } as never],
    [{ id: "i", name: "x", query: "", tickers: ["AAA"] }],
    "groq",
    at("2026-11-23T13:00:00Z"),
    "calls:wk",
    { phase: "pre" },
  );
  const wk = (await getJSON<Call[]>("calls:wk"))![0];
  assert.deepEqual([wk.id, wk.endDate], ["2026-11-23:AAA:w", "2026-11-30"], "recorded weekly calls get the holiday-aware end");
  // Recording on the holiday targets the next session, never the closed day.
  await TR.recordCalls(
    [{ interest: "x", ticker: "AAA", direction: "up", confidence: 60, horizon: "today", action: "Buy", actionTrigger: "", rationale: "", risks: "" } as never],
    [{ id: "i", name: "x", query: "", tickers: ["AAA"] }],
    "groq",
    at("2026-11-26T15:00:00Z"),
    "calls:hd",
    { phase: "pre" },
  );
  assert.equal((await getJSON<Call[]>("calls:hd"))![0].date, "2026-11-27");

  /* ---------------- FOMC 2027 */
  const f27 = CAL.fomcEvents("2027-01-01", "2027-12-31");
  assert.equal(f27.covered, true);
  assert.deepEqual(f27.events.map((e) => e.date), ["2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09", "2027-07-28", "2027-09-15", "2027-11-17"], "decision days of the Fed's revised 2027 schedule (Oct 26-27 is strategy only)");
  assert.equal(CAL.fomcEvents("2028-01-01", "2028-01-31").covered, false, "2028 isn't in the app yet");

  /* ---------------- guard: from Dec 1 of year Y, year Y+1 must be in the table for every exchange */
  assert.deepEqual(H.holidayGaps(at("2026-11-30T23:59:00Z")), [], "Nov 30 2026: 2026 needed, present");
  assert.deepEqual(H.holidayGaps(at("2026-12-01T00:00:00Z")), [], "Dec 1 2026: 2027 needed, present");
  assert.deepEqual(H.holidayGaps(Date.now()), [], "today (the real run): nothing missing");
  assert.deepEqual(H.holidayGaps(at("2027-11-30T12:00:00Z")), [], "Nov 30 2027: still fine");
  const gaps2028 = H.holidayGaps(at("2027-12-01T00:00:00Z"));
  assert.deepEqual(gaps2028, Object.keys(H.HOLIDAYS).map((c) => `${c} 2028`), "Dec 1 2027 with no 2028 table fails for every exchange (the real table must get 2028 before then)");
  // A table that has 2028 for all but one exchange fails naming that one.
  const sim = Object.fromEntries(Object.entries(H.HOLIDAYS).map(([c, y]) => [c, c === "JPX" ? y : { ...y, 2028: y[2027] }]));
  assert.deepEqual(H.holidayGaps(at("2027-12-01T00:00:00Z"), sim), ["JPX 2028"]);
  assert.deepEqual(H.holidayGaps(at("2027-12-01T00:00:00Z"), Object.fromEntries(Object.entries(sim).map(([c, y]) => [c, { ...y, 2028: y[2027] }]))), []);
  // Every exchange the app has a clock for has a table (Seoul, Shanghai, Mumbai are weekends-only on purpose).
  assert.deepEqual(Object.keys(H.CALENDAR_OF_TZ).sort(), ["America/New_York", "Asia/Ho_Chi_Minh", "Asia/Hong_Kong", "Asia/Tokyo", "Europe/Berlin", "Europe/London", "Europe/Paris"]);

  console.log("ROW09 HOLIDAYS OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
