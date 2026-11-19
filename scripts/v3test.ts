/**
 * Offline tests for v3: alert rules, de-dupe, email delivery (mocked Resend), morning-email timing,
 * chart parsing, and Ask AI grounding. `npx tsx scripts/v3test.ts`
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import { pinClock } from "./clock";

// Fixtures and code under test share one clock, so the result never depends on when this runs.
pinClock("2026-11-17T12:00:00Z");

process.env.RESEND_API_KEY = "re_test";
process.env.APP_URL = "https://invest.example.app";
delete process.env.SMTP_URL;
process.env.GROQ_API_KEY = "test";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.LLM_PROVIDER;

const sent: { to: string[]; subject: string; html: string; text: string }[] = [];
let resendFails = false;
let groqBody: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any

function yahooChart(symbol: string, price: number, prev: number) {
  const now = Math.floor(Date.now() / 1000);
  const ts = Array.from({ length: 30 }, (_, i) => now - (30 - i) * 60);
  const closes = ts.map((_, i) => prev + ((price - prev) * i) / 29);
  return { chart: { result: [{ meta: { regularMarketPrice: price, chartPreviousClose: prev, regularMarketTime: now, regularMarketDayHigh: price + 1, regularMarketDayLow: prev - 1, regularMarketVolume: 123456, longName: `${symbol} Inc.` }, timestamp: ts, indicators: { quote: [{ close: closes, open: closes, high: closes, low: closes, volume: ts.map(() => 1000) }] } }] } };
}
const PRICES: Record<string, [number, number]> = { NVDA: [210, 200], SOXX: [270, 268], QQQ: [560, 561], SPY: [640, 641], AMD: [190, 200], TSM: [290, 290], AVGO: [350, 350], ASML: [950, 950], MU: [200, 200] };

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("api.resend.com")) {
    if (resendFails) return new Response(JSON.stringify({ message: "boom" }), { status: 500 });
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: `em_${sent.length}` }), { status: 200 });
  }
  if (url.includes("query1.finance.yahoo.com")) {
    const sym = decodeURIComponent(url.split("/chart/")[1].split("?")[0]);
    const [p, pc] = PRICES[sym] ?? [100, 100];
    return new Response(JSON.stringify(yahooChart(sym, p, pc)), { status: 200 });
  }
  if (url.includes("api.groq.com")) {
    groqBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "Lean: wait for CPI [1]. Chips are strong [2]. Confidence 62%." } }] }), { status: 200 });
  }
  return new Response("not mocked", { status: 404 });
}) as typeof fetch;

async function main() {
  await fs.rm(".data", { recursive: true, force: true });
  const { makeT } = await import("../src/lib/i18n");
  const t = makeT("en");
  const A = await import("../src/lib/alerts");
  const base = { ...A.DEFAULT_ALERTS, enabled: true, email: "me@example.com" };

  // ---- pure price rules
  const quotes = [
    { symbol: "NVDA", price: 210, prevClose: 200, changePct: 5, asOf: 0, spark: [] },
    { symbol: "AMD", price: 190, prevClose: 200, changePct: -5, asOf: 0, spark: [] },
    { symbol: "QQQ", price: 560, prevClose: 561, changePct: -0.18, asOf: 0, spark: [] },
  ];
  const rules = {
    ...base,
    priceAlerts: [
      { id: "a1", symbol: "NVDA", op: "above" as const, value: 205, repeat: false, active: true, createdAt: "" },
      { id: "a2", symbol: "QQQ", op: "below" as const, value: 500, repeat: true, active: true, createdAt: "" },
      { id: "a3", symbol: "AMD", op: "pct_down" as const, value: 4, repeat: true, active: true, createdAt: "" },
      { id: "a4", symbol: "NVDA", op: "above" as const, value: 1, repeat: false, active: false, createdAt: "" },
    ],
  };
  const r = A.evaluatePriceRules(rules, quotes, ["NVDA", "AMD", "QQQ"], "2026-11-16", t);
  assert.deepEqual(r.fired.sort(), ["a1", "a3"], "fires NVDA above + AMD -4%, skips unmet and inactive");
  const moves = r.events.filter((e) => e.kind === "move").map((e) => e.key);
  assert.deepEqual(moves.sort(), ["move:AMD:2026-11-16:d1", "move:NVDA:2026-11-16:u1"], "big-move level keys");
  const r6 = A.evaluatePriceRules({ ...base, bigMove: { enabled: true, pct: 2.5 } }, quotes, ["NVDA"], "2026-11-16", t);
  assert.ok(r6.events.some((e) => e.key === "move:NVDA:2026-11-16:u2"), "doubling the threshold re-alerts at level 2");

  // ---- pure briefing rules
  const o = (ticker: string, action: string, confidence: number, direction = "up") => ({ interest: ticker, ticker, direction, confidence, horizon: "today", action, actionTrigger: "trigger", rationale: "", risks: "" }) as never;
  const ev = A.evaluateBriefingRules(base, [o("SOXX", "SELL", 70, "down"), o("QQQ", "HOLD", 80), o("SPY", "WAIT", 90, "flat")], [o("SOXX", "HOLD", 60), o("QQQ", "HOLD", 60)], [
    { date: "2026-11-17", kind: "macro", title: "CPI inflation", importance: 3 },
    { date: "2026-11-17", kind: "earnings", title: "NVDA earnings", ticker: "NVDA", importance: 2 },
    { date: "2026-11-17", kind: "earnings", title: "ZZZ earnings", ticker: "ZZZ", importance: 2 },
    { date: "2026-11-20", kind: "macro", title: "Jobs", importance: 3 },
  ], ["NVDA", "SOXX"], "2026-11-16", "2026-11-17", t);
  const keys = ev.map((e) => e.key);
  assert.ok(keys.includes("call:2026-11-16:SOXX:SELL"), "call flip HOLD → SELL alerts");
  assert.ok(!keys.some((k) => k.startsWith("call:2026-11-16:QQQ")), "unchanged action does not alert");
  assert.ok(keys.includes("conf:2026-11-16:QQQ:up"), "high-confidence call alerts");
  assert.ok(!keys.some((k) => k.startsWith("conf:2026-11-16:SPY")), "flat calls never count as high-confidence");
  assert.ok(keys.includes("cat:2026-11-17:CPI inflation") && keys.includes("cat:2026-11-17:NVDA earnings"), "catalysts for tomorrow");
  assert.ok(!keys.some((k) => k.includes("ZZZ") || k.includes("Jobs")), "ignores other companies and later dates");
  assert.ok(ev.find((e) => e.kind === "call")!.title.includes("Hold → Sell"), "localized action names in title");

  // ---- end-to-end price check: email sent, once-only disarmed, de-duped on re-run
  await A.saveAlertSettings({ ...base, priceAlerts: [{ id: "p1", symbol: "NVDA", op: "above", value: 205, repeat: false, active: true, createdAt: new Date().toISOString() }] });
  const interests = [{ id: "chips", name: "Chips", query: "chips", tickers: ["SOXX", "NVDA", "AMD"] }];
  const c1 = await A.checkPriceAlerts(interests);
  assert.equal(sent.length, 1, "one bundled email");
  assert.ok(sent[0].subject.startsWith("3 alerts"), `bundled subject (${sent[0].subject})`);
  assert.equal(sent[0].to[0], "me@example.com");
  assert.ok(sent[0].html.includes("NVDA rose above 205.00") && sent[0].html.includes("https://invest.example.app"), "email body has alert + app link");
  assert.ok(c1.sent === 3);
  const after = await A.loadAlertSettings();
  assert.equal(after.priceAlerts[0].active, false, "once-only alert disarmed after firing");
  await A.checkPriceAlerts(interests);
  assert.equal(sent.length, 1, "same-day re-run sends nothing (de-dupe)");

  // ---- failure path: Resend down → logged, not marked sent, retried later
  await A.saveAlertSettings({ ...base, bigMove: { enabled: true, pct: 0.5 } });
  resendFails = true;
  const failed = await A.checkPriceAlerts([{ id: "x", name: "x", query: "x", tickers: ["SOXX"] }]);
  assert.ok(failed.error?.includes("Resend 500"), "provider error surfaced");
  const log = await A.loadAlertLog();
  assert.equal(log[0].ok, false, "failure logged");
  resendFails = false;
  await A.checkPriceAlerts([{ id: "x", name: "x", query: "x", tickers: ["SOXX"] }]);
  assert.equal(sent.length, 2, "retried and sent once provider recovers");

  // ---- disabled → nothing
  await A.saveAlertSettings({ ...base, enabled: false });
  const off = await A.checkPriceAlerts(interests);
  assert.equal(off.skipped, "alerts disabled");

  // ---- morning email timing: 8:10 ET weekday sends once; 10:30 ET doesn't
  await A.saveAlertSettings({ ...base, callChanges: false, highConfidence: { enabled: false, min: 75 }, catalysts: false });
  const digest = (section: "interests" | "world" | "us") => ({
    section, generatedAt: new Date().toISOString(), provider: "groq:x", news: [], quotes: [], feedErrors: [],
    analysis: { headline: `${section} <headline> & more`, mood: "risk-on", summary: ["one", "two"], events: [], outlook: [o("SOXX", "ADD", 66)], watchNext: [], movers: [] },
  }) as never;
  const ctx = { interests, calls: [o("SOXX", "ADD", 66)], digests: { interests: digest("interests"), world: digest("world"), us: digest("us") }, calendar: [], trackSummary: { graded: 10, hitRate: 0.6, weekGraded: 5, weekHits: 3 } };
  const mon0810 = new Date("2026-11-16T13:10:00Z"); // Monday 8:10 ET
  await A.afterRefresh(ctx, mon0810);
  assert.equal(sent.length, 3, "morning briefing sent");
  assert.ok(sent[2].subject.startsWith("Briefing: interests"), sent[2].subject);
  assert.ok(sent[2].html.includes("&lt;headline&gt; &amp; more"), "HTML is escaped");
  assert.ok(sent[2].html.includes("World") && sent[2].html.includes("world &lt;headline&gt;"), "includes World/US headlines");
  await A.afterRefresh(ctx, new Date("2026-11-16T13:40:00Z"));
  assert.equal(sent.length, 3, "morning briefing only once per day");
  await A.afterRefresh(ctx, new Date("2026-11-17T15:30:00Z")); // Tue 10:30 ET
  assert.equal(sent.length, 3, "no morning email after the open");

  // ---- weekly recap Sunday evening
  await A.afterRefresh(ctx, new Date("2026-11-22T22:40:00Z")); // Sun 17:40 ET
  assert.equal(sent.length, 4, "weekly recap sent");
  assert.ok(sent[3].subject.includes("60%"), `weekly subject has hit rate (${sent[3].subject})`);

  // ---- localization of emails follows briefing language
  const { saveSettings } = await import("../src/lib/interests");
  await saveSettings({ briefingLanguage: "vi" });
  const res = await A.sendTestEmail("me@example.com");
  assert.ok(res.ok);
  assert.equal(sent[4].subject, "Email thử từ InvestHepi", "test email localized to briefing language");
  await saveSettings({ briefingLanguage: "en" });

  // ---- chart parsing + live quotes
  const { getChart, getLiveQuotes, parseYahooChart } = await import("../src/lib/chart");
  const cd = await getChart("NVDA", "1d");
  assert.equal(cd.price, 210);
  assert.equal(cd.prevClose, 200);
  assert.equal(Math.round(cd.changePct), 5);
  assert.equal(cd.name, "NVDA Inc.");
  assert.equal(cd.bars.length, 30);
  const lq = await getLiveQuotes(["NVDA", "AMD", "bad symbol!"]);
  assert.equal(lq.length, 2, "skips symbols that fail");
  assert.throws(() => parseYahooChart({ chart: { result: [] } }, "X", "1d"));

  // ---- Ask AI grounding
  const { buildAskContext, ask } = await import("../src/lib/ask");
  const d = {
    section: "interests", generatedAt: new Date().toISOString(), provider: "groq:x", quotes: [], feedErrors: [],
    news: [
      { id: "1", title: "CPI due Thursday", link: "https://e/1", source: "Reuters", publishedAt: new Date().toISOString() },
      { id: "2", title: "Chip stocks rally", link: "https://e/2", source: "CNBC", publishedAt: new Date().toISOString() },
      { id: "3", title: "Unrelated", link: "https://e/3", source: "AP", publishedAt: new Date().toISOString() },
    ],
    analysis: { headline: "H", mood: "mixed", summary: ["s"], events: [], outlook: [o("SOXX", "WAIT", 60)], watchNext: [], movers: [] },
  } as never;
  const ctxText = buildAskContext([d], [], "n/a", undefined, "  - Chip stocks (SOXX), today 2026-11-17: WAIT, flat, 60%");
  assert.ok(ctxText.text.includes("[1] CPI due Thursday") && ctxText.text.includes("SOXX"), "context has numbered headlines and calls");
  const ans = await ask("Should I buy chips?", [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }], [d], [], "n/a", "vi");
  assert.deepEqual(ans.sources.map((s) => s.n), [1, 2], "only cited headlines returned as sources");
  assert.ok(groqBody.messages[0].content.includes("Reply in Vietnamese"), "answer language follows UI language");
  assert.equal(groqBody.messages.length, 4, "system + history + question");

  console.log("V3 OK");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
