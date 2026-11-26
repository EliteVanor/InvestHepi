/**
 * v19 audit 2 (Nov 26 01:15 runs, the first with Q16): a story's market link to one company's shares needs a report
 * that names the company. Real cases: Apple's iPhone Duo story tied to FPT "though not directly related"; Taiwan's
 * tariff deal tied to TSMC; a weight-loss drug study tied to Novo Nordisk "despite" the study. Whole markets stay.
 */
import assert from "node:assert/strict";
import { pinClock } from "../clock";
pinClock("2026-11-26T01:30:00Z");

(async () => {
  const E = await import("../../src/lib/stories/explain");
  const { isMarketWide } = await import("../../src/lib/symbols");
  type Story = import("../../src/lib/stories/types").Story;
  const story = (titles: string[]): Story => ({ id: "s", members: titles.map((title, i) => ({ id: `m${i}`, title, link: "https://e.com", source: `o${i}`, publishedAt: "2026-11-26T01:00:00Z" })), outlets: titles.map((_, i) => `o${i}`), firstSeen: "2026-11-26T01:00:00Z", lastSeen: "2026-11-26T01:00:00Z", lang: "en", kind: "important" });
  const q = (symbol: string, changePct: number) => ({ symbol, price: 100, prevClose: 100, changePct, history: [] as [string, number][], source: "yahoo" as const });
  const quotes = [q("FPT.VN", -1.71), q("TSM", -2.35), q("NVO", 1.64), q("VIC.VN", -0.12), q("CL=F", 1.99), q("^GSPC", -0.25), q("^VNINDEX.VN", -0.57), q("XLE", 1.1)];
  const link = (ticker: string) => ({ ticker, direction: "down" as const, text: "t" });
  const kept = (titles: string[], tickers: string[]) => E.alignMarkets(tickers.map(link), quotes, story(titles)).map((m) => m.symbol);

  assert.deepEqual(kept(["Apple tối ưu hóa hệ sinh thái cho iPhone Duo"], ["FPT.VN"]), [], "a company the reports never name is dropped");
  assert.deepEqual(kept(["Taiwan confident it can keep tariff deal with US"], ["TSM", "^GSPC"]), ["^GSPC"], "TSMC goes, the index stays (the prompt rules on it)");
  assert.deepEqual(kept(["Wegovy, Ozempic users may need extra cancer screening"], ["NVO"]), [], "a drug's name alone doesn't name the maker");
  assert.deepEqual(kept(["Khối ngoại bán ròng đột biến 4.700 tỷ đồng VIC qua thỏa thuận"], ["VIC.VN", "^VNINDEX.VN"]), ["VIC.VN", "^VNINDEX.VN"], "named in a report: kept");
  assert.deepEqual(kept(["Oil transit through Hormuz Strait falls 40% after tanker attacks"], ["CL=F", "XLE"]), ["CL=F", "XLE"], "oil and an energy fund are whole markets");
  assert.deepEqual(E.alignMarkets([link("TSM")], quotes).map((m) => m.symbol), ["TSM"], "without a story (other callers) nothing changes");

  for (const s of ["^GSPC", "000001.SS", "CL=F", "VND=X", "BTC-USD", "DX-Y.NYB", "SPY", "FEZ", "XLK", "E1VFVN30.VN"]) assert.ok(isMarketWide(s), s);
  for (const s of ["FPT.VN", "TSM", "NVO", "AAPL", "0700.HK", "7203.T"]) assert.ok(!isMarketWide(s), s);
  console.log("AUDIT2 MARKETS OK");
})();
