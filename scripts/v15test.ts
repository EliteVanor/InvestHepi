/**
 * v15: the page's logic pulled out of page.tsx, pinned. The price strip (which symbols, live vs
 * snapshot, the ETF rule), the chart's symbol list, and who sees Refresh and what it says.
 * The UI itself was checked pixel for pixel against the old page (see HANDOFF, v15).
 * `npx tsx scripts/v15test.ts`
 */
import assert from "node:assert/strict";

(async () => {
  const S = await import("../src/components/shell/strip");
  const H = await import("../src/components/shell/hooks");
  const { makeT } = await import("../src/lib/i18n");
  const { SECTION_STRIPS, SECTION_MACRO } = await import("../src/lib/config");
  type Digest = import("../src/lib/types").Digest;
  type LiveQuote = import("../src/lib/chart").LiveQuote;

  const q = (symbol: string, price: number, extra: object = {}) => ({ symbol, price, prevClose: price, changePct: 0, history: [], source: "yahoo" as const, ...extra });
  const digest = (o: Partial<Digest>) => ({ quotes: [], macro: [], news: [], ...o }) as unknown as Digest;
  const live = (symbol: string, price: number, extra: Partial<LiveQuote> = {}) => [symbol, { symbol, price, prevClose: price - 1, changePct: 1.5, spark: [1, 2, 3], intraday: true, ...extra } as LiveQuote] as const;

  /* ---------------- which symbols the strip shows */
  assert.deepEqual(S.stripPlan(null, "us"), { groups: [], macro: [] }, "no briefing: empty strip");
  const mine = digest({ quotes: [q("NVDA", 100), q("FPT.VN", 120000)] as never, macro: [q("^VIX", 15)] as never });
  assert.deepEqual(S.stripPlan(mine, "interests"), { groups: [{ symbols: ["NVDA", "FPT.VN"] }], macro: ["^VIX"] }, "My Interests: the user's tickers and the briefing's macro");
  assert.deepEqual(S.stripPlan(digest({}), "vn"), { groups: SECTION_STRIPS.vn, macro: SECTION_MACRO.vn }, "older shared briefings fall back to config");
  const own = [{ key: "indexes", symbols: ["^GSPC"] }];
  assert.deepEqual(S.stripPlan(digest({ strip: own } as never), "us").groups, own, "a briefing's own strip wins");
  assert.deepEqual(S.planSymbols({ groups: [{ symbols: ["A", "B"] }, { symbols: ["C"] }], macro: ["D"] }), ["A", "B", "C", "D"]);

  /* ---------------- live vs snapshot */
  const shown = digest({ quotes: [q("SPY", 500), q("^GSPC", 5000), q("BAD", NaN)] as never, macro: [] });
  const plan = { groups: [{ symbols: ["SPY", "^GSPC", "BAD", "ONLYLIVE", "MISSING"] }], macro: [] };
  const rows = S.stripRows(shown, plan, new Map([live("SPY", 510), live("^GSPC", 520, { proxy: "SPY" }), live("ONLYLIVE", 42, { intraday: false })]));
  const [spy, gspc, onlyLive] = rows.groups[0].quotes;
  assert.deepEqual([spy.symbol, spy.price, spy.changePct, spy.stale, spy.spark], ["SPY", 510, 1.5, false, [1, 2, 3]], "live wins, with its intraday path");
  assert.equal(gspc.price, 5000, "an ETF's live price never replaces a real index level (canOverlay)");
  assert.deepEqual([onlyLive.symbol, onlyLive.price, onlyLive.spark, onlyLive.history.length], ["ONLYLIVE", 42, undefined, 3], "live-only symbol: daily history, no intraday sparkline");
  assert.equal(rows.groups[0].quotes.length, 3, "unpriceable (NaN) and unknown symbols are dropped");

  /* ---------------- the chart card's symbols */
  assert.deepEqual(S.chartSymbols([]), ["SPY", "QQQ", "SOXX"], "default");
  assert.deepEqual(S.chartSymbols([{ tickers: ["SPY", "AAPL"] }, { tickers: ["QQQ", "AAPL", "MSFT"] }]), ["SPY", "QQQ", "AAPL", "MSFT"], "benchmarks first, no duplicates");
  assert.equal(S.chartSymbols([{ tickers: Array.from({ length: 20 }, (_, i) => `T${i}`) }]).length, 14, "at most 14");

  /* ---------------- Refresh: who sees it and what it says */
  const t = makeT("en");
  const now = new Date("2026-11-17T03:00:00Z");
  const admin = H.refreshState({ mode: "multi", user: { email: "a" }, admin: true, refresh: { left: 7, limit: 10, nextAt: null } }, "world", t, "en", now);
  assert.deepEqual([admin.can, admin.blocked, admin.title], [true, false, "Refresh (R)"], "the admin: any section");
  const user = (refresh: { left: number; limit: number; nextAt: string | null }) => ({ mode: "multi" as const, user: { email: "u" }, admin: false, refresh });
  assert.equal(H.refreshState(user({ left: 5, limit: 5, nextAt: null }), "world", t, "en", now).can, false, "users can't refresh shared sections");
  const ok = H.refreshState(user({ left: 3, limit: 5, nextAt: null }), "interests", t, "en", now);
  assert.deepEqual([ok.can, ok.blocked], [true, false]);
  assert.ok(ok.title.includes("3") && ok.title.includes("5"), `presses left in the title: ${ok.title}`);
  const out = H.refreshState(user({ left: 0, limit: 5, nextAt: null }), "interests", t, "en", now);
  assert.deepEqual([out.blocked, out.title], [true, out.limitText], "none left: blocked, says the limit");
  const wait = H.refreshState(user({ left: 2, limit: 5, nextAt: "2026-11-17T04:00:00Z" }), "interests", t, "en", now);
  assert.equal(wait.blocked, true, "inside the 90-minute gap: blocked");
  assert.ok(wait.waitText && wait.title === wait.waitText, "and says until when");
  assert.equal(H.refreshState(user({ left: 2, limit: 5, nextAt: "2026-11-17T02:00:00Z" }), "interests", t, "en", now).blocked, false, "a past wait doesn't block");
  assert.equal(H.refreshState({ mode: "multi", user: null, admin: false }, "interests", t, "en", now).can, false, "signed-out visitors: no button");

  /* ---------------- translation attempts are keyed per version and variant */
  assert.notEqual(H.translateKey("us", "vi", "2026-11-17T01:00:00Z", false), H.translateKey("us", "vi", "2026-11-17T01:00:00Z", true));

  console.log("V15 OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
