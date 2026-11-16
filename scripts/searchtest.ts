/**
 * Stock search and following: Vietnamese listing (accent-insensitive), index names, Yahoo merge and
 * fallback, ranking for Vietnamese readers, news queries for followed stocks, news language.
 * `npx tsx scripts/searchtest.ts`
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";

process.env.VERCEL = "1";
delete process.env.KV_REST_API_URL;

let yahooDown = false;
let listDown = false;
const hits: string[] = [];
const LISTING = {
  data: [
    { code: "VNM", companyName: "Công ty Cổ phần Sữa Việt Nam", shortName: "VINAMILK", companyNameEng: "Viet Nam Dairy Products JSC", floor: "HOSE", type: "STOCK" },
    { code: "HPG", companyName: "Công ty Cổ phần Tập đoàn Hòa Phát", shortName: "Hòa Phát", floor: "HOSE", type: "STOCK" },
    { code: "HPA", companyName: "CTCP Phát triển Nông nghiệp Hòa Phát", shortName: "Hoa Phat Agriculture", floor: "HOSE", type: "STOCK" },
    { code: "FPT", companyName: "Công ty Cổ phần FPT", shortName: "CTCP FPT", companyNameEng: "FPT Corporation", floor: "HOSE", type: "STOCK" },
    { code: "FTS", companyName: "CTCP Chứng khoán FPT", shortName: "Chứng khoán FPT", floor: "HOSE", type: "STOCK" },
    { code: "VCB", companyName: "Ngân hàng TMCP Ngoại thương Việt Nam", shortName: "Vietcombank", floor: "HOSE", type: "STOCK" },
    { code: "E1VFVN30", companyName: "Quỹ ETF DCVFMVN30", shortName: "Quỹ ETF DCVFMVN30", floor: "HOSE", type: "ETF" },
    ...Array.from({ length: 120 }, (_, i) => ({ code: `X${String(i).padStart(2, "0")}A`, companyName: `Công ty ${i}`, shortName: `Company ${i}`, floor: "UPCOM", type: "STOCK" })),
  ],
};

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  hits.push(url);
  if (url.includes("vndirect.com.vn/v4/stocks")) return listDown ? new Response("", { status: 503 }) : new Response(JSON.stringify(LISTING), { status: 200 });
  if (url.includes("/v1/finance/search")) {
    if (yahooDown) return new Response("Too Many Requests", { status: 429 });
    const q = decodeURIComponent(url.split("q=")[1].split("&")[0]).toLowerCase();
    const quotes =
      q === "apple"
        ? [{ symbol: "AAPL", shortname: "Apple Inc.", quoteType: "EQUITY", exchDisp: "NASDAQ" }, { symbol: "SAAPL=F", shortname: "Apple futures", quoteType: "FUTURE" }, { symbol: "APLE", shortname: "Apple Hospitality", quoteType: "EQUITY", exchDisp: "NYSE" }]
        : q === "hoa phat"
          ? [{ symbol: "HPG.VN", shortname: "HOA PHAT GROUP JSC", quoteType: "EQUITY", exchDisp: "Ho Chi Minh" }]
          : q === "fpt"
            ? [{ symbol: "FPT", shortname: "Fortress Paper", quoteType: "EQUITY", exchDisp: "TSX" }]
            : [];
    return new Response(JSON.stringify({ quotes }), { status: 200 });
  }
  return new Response(`<?xml version="1.0"?><rss><channel></channel></rss>`, { status: 200 });
}) as typeof fetch;

(async () => {
  await fs.rm("/tmp/invest-helper", { recursive: true, force: true });
  const L = await import("../src/lib/vnlist");
  const S = await import("../src/lib/search");
  const Y = await import("../src/lib/yahoo");
  const { queryFor } = await import("../src/lib/follow");

  // ---- accent folding and scoring
  assert.equal(L.fold("Hòa Phát"), "hoa phat");
  assert.equal(L.fold("Đất Xanh"), "dat xanh", "đ → d");
  assert.equal(L.fold("  S&P 500 "), "s p 500");
  const list = L.parseVnList(LISTING);
  assert.equal(list.find((x) => x.code === "FPT")!.short, "FPT", "'CTCP ' prefix stripped from short names");
  assert.equal(list.find((x) => x.code === "E1VFVN30")!.type, "ETF");
  const hpg = list.find((x) => x.code === "HPG")!;
  assert.equal(L.scoreVn(hpg, "HPG"), 100, "exact code");
  assert.ok(L.scoreVn(hpg, "hoa phat") >= 65 && L.scoreVn(hpg, "Hòa Phát") >= 65, "name with or without accents");
  assert.equal(L.scoreVn(hpg, "zzz"), 0);

  // ---- merged search
  const r1 = await S.searchTickers("vinamilk");
  assert.equal(r1[0].symbol, "VNM.VN", "brand name finds the Vietnamese listing");
  assert.equal(r1[0].region, "vn");
  assert.equal(r1[0].exchange, "HOSE");
  const r2 = await S.searchTickers("hoa phat");
  assert.deepEqual(r2.slice(0, 2).map((h) => h.symbol), ["HPG.VN", "HPA.VN"]);
  assert.equal(r2.filter((h) => h.symbol === "HPG.VN").length, 1, "Yahoo's duplicate of a VN listing is merged");
  assert.equal(r2[0].name, "Hòa Phát", "Vietnamese name kept (not Yahoo's uppercase English one)");
  const r3 = await S.searchTickers("apple");
  assert.equal(r3[0].symbol, "AAPL");
  assert.ok(!r3.some((h) => h.symbol === "SAAPL=F"), "odd single-stock futures filtered out");
  assert.equal((await S.searchTickers("s&p"))[0].symbol, "^GSPC", "index names searchable");
  assert.equal((await S.searchTickers("vn30"))[0].symbol, "^VN30.VN");
  const en = await S.searchTickers("fpt", { lang: "en" });
  const vi = await S.searchTickers("fpt", { lang: "vi" });
  // Same code on two exchanges: both near the top; ties go to the Vietnamese listing (this app's
  // home market), and Vietnamese readers get a further boost.
  assert.deepEqual(en.slice(0, 2).map((h) => h.symbol).sort(), ["FPT", "FPT.VN"], "both exact matches first");
  assert.equal(vi[0].symbol, "FPT.VN", "Vietnamese readers get the Vietnamese FPT first");
  assert.ok(vi.findIndex((h) => h.symbol === "FPT") > vi.findIndex((h) => h.symbol === "FTS.VN") || vi.findIndex((h) => h.symbol === "FPT") > 0);
  assert.deepEqual(await S.searchTickers("   "), []);

  // ---- resilience: Yahoo rate-limited → Vietnamese + built-in results still work
  yahooDown = true;
  Y.resetYahoo();
  const r4 = await S.searchTickers("nvid");
  assert.equal(r4[0]?.symbol, "NVDA", "built-in list when Yahoo is unavailable");
  assert.equal((await S.searchTickers("vietcombank"))[0].symbol, "VCB.VN");
  yahooDown = false;
  Y.resetYahoo();

  // listing down on a cold start → the built-in list of big Vietnamese names
  listDown = true;
  await fs.rm("/tmp/invest-helper", { recursive: true, force: true });
  L.resetVnList();
  const cold = await L.searchVn("masan");
  assert.equal(cold[0]?.code, "MSN", "built-in Vietnamese list as a backup");
  listDown = false;

  // ---- following: news query per stock
  const qVn = queryFor({ symbol: "FPT.VN", name: "FPT", region: "vn", type: "EQUITY" });
  assert.ok(qVn.includes("cổ phiếu FPT") && /[^\x00-\x7F]/.test(qVn), `Vietnamese query → Vietnamese news (${qVn})`);
  assert.equal(queryFor({ symbol: "AAPL", name: "Apple Inc.", region: "intl", type: "EQUITY" }), '"Apple" OR AAPL stock');
  assert.equal(queryFor({ symbol: "^GSPC", name: "S&P 500", region: "intl", type: "INDEX" }), '"S&P 500"');
  assert.equal(queryFor({ symbol: "VIC.VN", name: "Vingroup", region: "vn" }), '"Vingroup" OR "cổ phiếu VIC"', "'group' inside a word is kept");

  // ---- news for a Vietnamese single-stock interest: Vietnamese Google News, no Yahoo RSS
  const N = await import("../src/lib/news");
  hits.length = 0;
  await N.fetchInterestNews([{ id: "s-hpg-vn", name: "Hòa Phát", query: "Hoa Phat", tickers: ["HPG.VN"] }], []);
  assert.ok(hits.some((u) => u.includes("news.google.com") && u.includes("hl=vi")), "Vietnamese news for VN tickers even with an ASCII query");
  assert.ok(!hits.some((u) => u.includes("feeds.finance.yahoo.com")), "no Yahoo per-ticker feed for Vietnamese listings");

  console.log("SEARCH OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
