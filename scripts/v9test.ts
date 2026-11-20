/**
 * v9 stress-test fixes: chunked translations with provider fallback, no ETF prices passed off as index
 * levels, dividend-adjusted Vietnamese history, Nasdaq search fallback and share classes, Nasdaq
 * intraday times, per-exchange call dates, relevant analogs only, and labels in the reader's language.
 * `npx tsx scripts/v9test.ts`
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";

process.env.VERCEL = "1";
process.env.GROQ_TPM = "1000000"; // this suite checks chunking, not the per-minute pacing (v19 row05 covers that)
delete process.env.KV_REST_API_URL;
delete process.env.ANTHROPIC_API_KEY;
process.env.GROQ_API_KEY = "test";
process.env.GEMINI_API_KEY = "test";

const calls: { url: string; body?: string }[] = [];
let groqMode: "truncate" | "ok" = "truncate";

/** Fake "translation": prefix each string so the test can see which provider wrote it. */
function fakeTranslate(body: string, tag: string) {
  const req = JSON.parse(body);
  const arr: string[] = JSON.parse(req.messages.at(-1).content);
  return JSON.stringify(arr.map((s) => `${tag}:${s}`));
}

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const body = typeof init?.body === "string" ? init.body : undefined;
  calls.push({ url, body });
  if (url.includes("api.groq.com")) {
    const content = groqMode === "truncate" ? '["cut off' : fakeTranslate(body!, "groq");
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }
  if (url.includes("generativelanguage")) return new Response(JSON.stringify({ choices: [{ message: { content: fakeTranslate(body!, "gemini") } }] }), { status: 200 });
  if (url.includes("/v1/finance/search")) return new Response("Too Many Requests", { status: 429 });
  if (url.includes("api.nasdaq.com/api/autocomplete")) {
    return new Response(
      JSON.stringify({
        data: [
          { symbol: "BFOCX", name: "Berkshire Focus Fund", asset: "MUTUALFUNDS", exchange: "" },
          { symbol: "BRK.B", name: "Berkshire Hathaway Inc", asset: "STOCKS", exchange: "NYSE" },
          { symbol: "BRK/A", name: "Berkshire Hathaway Inc", asset: "STOCKS", exchange: "NYSE" },
          { symbol: "KO", name: "Coca-Cola Company (The) Common Stock", asset: "STOCKS", exchange: "NYSE" },
        ],
      }),
      { status: 200 },
    );
  }
  if (url.includes("vndirect.com.vn/v4/stocks")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
  return new Response("", { status: 404 });
}) as typeof fetch;

(async () => {
  await fs.rm(process.env.STORE_DIR || "/tmp/invest-helper", { recursive: true, force: true });

  /* ---------------- translation: chunked, truncated replies fall through to the next provider */
  {
    const { translateDigest, chunkSlots, textSlots, translateBudget } = await import("../src/lib/translate");
    const long = (i: number) => `Sentence number ${i} about banks, the dong and foreign flows on HOSE today, with enough words to matter.`;
    const analysis = {
      headline: "Headline",
      mood: "mixed",
      summary: Array.from({ length: 5 }, (_, i) => long(i)),
      events: Array.from({ length: 5 }, (_, i) => ({
        title: `Event ${i}`, whatHappened: long(i), whyItMatters: long(i + 10), importance: 3, sourceIds: [],
        impacts: [{ interest: "Banks", direction: "down", magnitude: "small", confidence: 60, reasoning: long(i + 20) }],
        analog: null, whatCouldGoWrong: long(i + 30),
      })),
      outlook: Array.from({ length: 6 }, (_, i) => ({ interest: "Banks", ticker: "VCB.VN", direction: "down", confidence: 60, horizon: "today", action: "WAIT", actionTrigger: long(i + 40), rationale: long(i + 50), risks: long(i + 60) })),
      watchNext: ["A", "B"],
      movers: [],
      scenarios: [],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d: any = { section: "vn", generatedAt: "2026-11-16T04:00:00Z", provider: "groq:x", analysis, news: [], quotes: [], macro: [], language: "en" };
    const slots = textSlots(JSON.parse(JSON.stringify(analysis)));
    const chunks = chunkSlots(slots);
    assert.ok(chunks.length >= 2, "a Vietnam-sized briefing is split into several requests");
    assert.equal(chunks.flat().length, slots.length, "chunking keeps every string");
    assert.ok(translateBudget(2200) >= 2500, "output budget leaves room for languages that need more tokens");

    groqMode = "truncate";
    const before = calls.length;
    const vi = await translateDigest(d, "vi");
    const aiCalls = calls.slice(before).filter((c) => /groq|generativelanguage/.test(c.url));
    assert.ok(aiCalls.some((c) => c.url.includes("generativelanguage")), "a cut-off Groq reply falls through to Gemini instead of failing");
    assert.ok(vi.analysis.headline.startsWith("gemini:"));
    assert.ok(vi.analysis.outlook!.every((o: { rationale: string }) => o.rationale.startsWith("gemini:")), "every chunk is written back (old digests with calls still translate)");
    assert.equal(vi.analysis.outlook![0].ticker, "VCB.VN", "tickers untouched");
    for (const c of aiCalls) {
      const req = JSON.parse(c.body!);
      assert.equal(req.max_tokens, translateBudget(req.messages.at(-1).content.length), "output budget sized to each chunk");
    }
    assert.ok(Math.max(...aiCalls.map((c) => JSON.parse(c.body!).max_tokens)) > 1500, "full chunks get more than the old 1500-token cap");

    groqMode = "ok";
    const ja = await translateDigest(d, "ja");
    assert.ok(ja.analysis.headline.startsWith("groq:"));
  }

  /* ---------------- prompt never presents an ETF price as an index / oil / dollar level */
  {
    const { quotesAsText, macroAsText } = await import("../src/lib/market");
    const { technicalsAsText } = await import("../src/lib/technicals");
    const hist = (p: number): [string, number][] => Array.from({ length: 25 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, "0")}`, p * (1 + i / 1000)]);
    const hsi = { symbol: "^HSI", price: 23.06, prevClose: 23.17, changePct: -0.5, history: hist(23), source: "nasdaq" as const, proxy: "EWH" };
    const oil = { symbol: "CL=F", price: 145.58, prevClose: 146.07, changePct: -0.3, history: hist(145), source: "nasdaq" as const, proxy: "USO" };
    const dxy = { symbol: "DX-Y.NYB", price: 29.5, prevClose: 29.42, changePct: 0.3, history: hist(29), source: "nasdaq" as const, proxy: "UUP" };
    const aapl = { symbol: "AAPL", price: 356.27, prevClose: 354.88, changePct: 0.4, history: hist(350), source: "nasdaq" as const };
    const q = quotesAsText([hsi, aapl]);
    assert.ok(!q.includes("23.06"), "proxied index price is not printed");
    assert.ok(q.includes("level unknown") && q.includes("EWH"));
    assert.ok(q.includes("356.27"), "real prices still printed");
    const m = macroAsText([oil, dxy], ["CL=F", "DX-Y.NYB", "VND=X", "^TNX"]);
    assert.ok(!m.includes("145.58") && !m.includes("29.50"), "oil/dollar ETF prices are not printed as levels");
    assert.ok(/not USD\/VND/.test(m), "the dollar index is spelled out so it isn't read as USD/VND");
    assert.ok(/USD\/VND: unavailable/.test(m) && /10-year Treasury yield \(%\): unavailable/.test(m), "missing macro rows are named as unavailable");
    const tx = technicalsAsText({
      "^HSI": { symbol: "^HSI", price: 23.06, support20: 22.8, resistance20: 24.1, sma20: 23.2, trend: "sideways", proxy: "EWH" },
      "VCB.VN": { symbol: "VCB.VN", price: 53800, support20: 52600, resistance20: 56000, trend: "down" },
    });
    assert.ok(!tx.includes("22.80") && !tx.includes("24.10"), "proxied technicals give no levels");
    assert.ok(/20d range -1\.1% to \+4\.5%/.test(tx), `proxied range is given as distances: ${tx}`);
    assert.ok(tx.includes("52600.00-56000.00"), "real levels kept");

    const { buildSystemPrompt, buildUserPrompt, relevantPlaybook } = await import("../src/lib/llm/prompt");
    const news = (title: string) => ({ id: title, title, link: "", source: "X", publishedAt: "2026-11-16T03:00:00Z" });
    const china = relevantPlaybook([news("China’s economy misses forecasts with across-the-board slowdown")]);
    assert.deepEqual(china.map((p) => p.type), ["china_slowdown"], "a China slowdown gets the China analog and nothing padded in");
    assert.equal(relevantPlaybook([news("Apple unveils a new phone")]).length, 0, "no unrelated US entries when nothing matches");
    const vnTariff = relevantPlaybook([news("Mỹ áp thuế đối ứng với hàng Việt Nam")], 6, "vn");
    assert.equal(vnTariff[0]?.region, "vn", "Vietnamese headlines match, and the Vietnam section prefers the Vietnam entry");
    const input = { section: "world" as const, interests: [], news: [news("Apple unveils a new phone")], quotes: [hsi], macro: [oil], calendar: [], trackRecord: "", language: "en", now: new Date("2026-11-16T04:00:00Z") };
    const sys = buildSystemPrompt(input, { compact: true });
    assert.ok(/set analog to null/.test(sys) && !/\[inflation_hot\]/.test(sys), "no bracketed tags for the model to copy");
    assert.ok(/Never invent release dates/.test(sys));
    const user = buildUserPrompt(input, { compact: true });
    assert.ok(/EUR\/USD: unavailable/.test(user), "section macro list drives the 'unavailable' lines");

    const { analogEventName } = await import("../src/lib/llm/schema");
    assert.equal(analogEventName("inflation_hot", "2022-09-13"), "August 2022 CPI came in hotter than expected");
    assert.equal(analogEventName("Hot August 2022 CPI"), "Hot August 2022 CPI");
  }

  /* ---------------- mood gauge ignores the VIXY price level */
  {
    const { computeMood } = await import("../src/lib/mood");
    const flat: [string, number][] = Array.from({ length: 20 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, "0")}`, 30]);
    const tech = { symbol: "SPY", price: 100, sma125: 100, rsi14: 50, trend: "sideways" as const };
    const g = computeMood({ spy: tech, sectors: [], quotes: [], macro: [{ symbol: "^VIX", price: 30, prevClose: 30, changePct: 0, history: flat, source: "nasdaq", proxy: "VIXY" }] })!;
    const vol = g.parts.find((p) => p.key === "volatility")!;
    assert.equal(vol.score, 50, "VIXY at its own average reads neutral, not 'VIX 30 = fear'");
    assert.ok(vol.detail.startsWith("VIXY"));
  }

  /* ---------------- Vietnamese history uses adjusted prices */
  {
    const { parseVndirect } = await import("../src/lib/vnmarket");
    const rows = { data: [
      { code: "FPT", date: "2026-11-16", open: 49.8, high: 50.2, low: 49.5, close: 49.8, adOpen: 49.8, adHigh: 50.2, adLow: 49.5, adClose: 49.8, nmVolume: 1000 },
      { code: "FPT", date: "2026-01-19", open: 107, high: 108.7, low: 106, close: 108, adOpen: 96, adHigh: 97.475, adLow: 95.3, adClose: 97.1, nmVolume: 1000 },
    ] };
    const bars = parseVndirect(rows, false).get("FPT")!;
    assert.equal(Math.max(...bars.map((b) => b.h)), 97475, "52-week high comes from adjusted prices (stock dividend doesn't fake a crash)");
    assert.equal(bars.at(-1)!.c, 49800);
    const idx = parseVndirect({ data: [{ code: "VNINDEX", date: "2026-11-16", open: 1740, high: 1750, low: 1735, close: 1747.57, accumulatedVol: 5 }] }, true).get("VNINDEX")!;
    assert.equal(idx[0].c, 1747.57, "indexes (no adjusted columns) unchanged");
  }

  /* ---------------- Nasdaq intraday times: New York wall clock → real UTC */
  {
    const { parseNasdaqIntraday, nyWallToUtc } = await import("../src/lib/chart");
    const wall930 = Date.UTC(2026, 10, 13, 9, 30) / 1000; // "9:30 AM ET" as Nasdaq encodes it
    assert.equal(nyWallToUtc(wall930), Date.UTC(2026, 10, 13, 14, 30) / 1000, "EST: +5 h");
    const summer = Date.UTC(2026, 6, 13, 9, 30) / 1000;
    assert.equal(nyWallToUtc(summer), Date.UTC(2026, 6, 13, 13, 30) / 1000, "EDT: +4 h");
    const d = parseNasdaqIntraday({ chart: [{ x: wall930 * 1000, y: 100 }, { x: (wall930 + 60) * 1000, y: 101 }], lastSalePrice: "$101", previousClose: "$99" }, "AAPL");
    assert.equal(d.bars[0].t, Date.UTC(2026, 10, 13, 14, 30) / 1000);
  }

  /* ---------------- search: Nasdaq fallback when Yahoo refuses, share classes, no unpriceable symbols */
  {
    const { searchTickers, parseNasdaqSearch, yahooOnly } = await import("../src/lib/search");
    const parsed = parseNasdaqSearch({ data: [{ symbol: "BRK.B", name: "Berkshire Hathaway Inc", asset: "STOCKS" }, { symbol: "BFOCX", asset: "MUTUALFUNDS" }, { symbol: "BRK/A", asset: "STOCKS" }] });
    assert.deepEqual(parsed.map((h) => h.symbol), ["BRK-B"], "funds and slash forms dropped, share class in Yahoo form");
    const hits = await searchTickers("berkshire");
    assert.ok(hits.some((h) => h.symbol === "BRK-B"), "Berkshire is findable while Yahoo is down");
    const ko = await searchTickers("KO");
    assert.equal(ko[0].symbol, "KO", "an exact ticker comes first");
    assert.equal(ko[0].name, "Coca-Cola Company (The)", "boilerplate trimmed from names");
    assert.ok(yahooOnly("0700.HK") && yahooOnly("005930.KS") && !yahooOnly("^HSI") && !yahooOnly("VCB.VN") && !yahooOnly("AAPL"));
    assert.ok(!yahooOnly("^TNX") && !yahooOnly("VND=X"), "the 10-year yield (Treasury) and USD/VND (VNDirect) have real sources now");
    const tencent = await searchTickers("tencent");
    assert.ok(!tencent.some((h) => h.symbol === "0700.HK"), "a Hong Kong listing isn't offered when nothing can price it");
  }

  /* ---------------- track record: each call targets the next session on its own exchange */
  {
    const { targetSession } = await import("../src/lib/track");
    const monday11ICT = new Date("2026-11-16T04:00:00Z"); // Mon 11:00 Hanoi = Sun 23:00 New York
    assert.equal(targetSession(monday11ICT, "^VNINDEX.VN"), "2026-11-17", "HOSE already open: grade on Tuesday, not the half-finished Monday");
    assert.equal(targetSession(monday11ICT, "^GSPC"), "2026-11-16", "US hasn't opened: Monday");
    assert.equal(targetSession(monday11ICT, "^N225"), "2026-11-17", "Tokyo already trading: Tuesday");
    assert.equal(targetSession(new Date("2026-11-16T01:30:00Z"), "VCB.VN"), "2026-11-16", "8:30 Hanoi: before the open, Monday");
    assert.equal(targetSession(new Date("2026-11-14T03:00:00Z"), "VCB.VN"), "2026-11-16", "weekend → Monday");
  }

  /* ---------------- calendar: VN30 futures expiry */
  {
    const { vnFuturesExpiry } = await import("../src/lib/calendar");
    assert.deepEqual(vnFuturesExpiry("2026-11-16", "2026-12-31").map((e) => e.date), ["2026-11-19", "2026-12-17"], "third Thursdays");
  }

  /* ---------------- labels in the reader's language */
  {
    const { makeT } = await import("../src/lib/i18n");
    const L = await import("../src/components/labels");
    const t = makeT("vi");
    assert.equal(L.groupName(t, "Banks"), "Ngân hàng");
    assert.equal(L.groupName(t, "China & Hong Kong"), "Trung Quốc & Hồng Kông");
    assert.equal(L.groupName(t, "S&P 500"), "S&P 500", "proper names stay");
    assert.equal(L.groupName(t, "^HSI"), "Hang Seng", "an impact naming a ticker shows its name");
    assert.equal(L.symName(t, "CL=F"), "Dầu");
    assert.equal(L.calTitle(t, { date: "2026-12-09", kind: "macro", title: "FOMC rate decision", importance: 3 }), "Fed quyết định lãi suất (FOMC)");
    assert.equal(L.calTitle(t, { date: "2026-11-17", kind: "earnings", title: "NVDA earnings (EPS est. 2.52)", importance: 2 }), "NVDA công bố KQKD (EPS dự kiến 2.52)");
    assert.equal(L.calWhen(t, "after close"), t("cal.afterClose"));
    assert.deepEqual(L.calNotes(t, ["Economic releases unavailable (BLS 403).", "FOMC dates for next year aren't in the app yet (update src/lib/calendar.ts)."]), [t("cal.noteMacro")], "diagnostics become one plain sentence; developer hints are dropped");
    assert.equal(L.moodDetail(t, "-1.3% vs 125d"), "-1.3% so với TB 125 ngày");
    assert.equal(L.moodDetail(t, "4/9 up"), "4/9 tăng");
    assert.equal(L.moodDetail(t, "RSI 47"), "RSI 47");
  }

  console.log("V9 OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
