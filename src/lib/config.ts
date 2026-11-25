import type { Interest, SectionId } from "./types";

export const DEFAULT_INTERESTS: Interest[] = [
  {
    id: "nasdaq",
    name: "Nasdaq",
    query: '"Nasdaq" stocks OR "Nasdaq 100" OR "tech stocks"',
    tickers: ["QQQ"],
  },
  {
    id: "sp500",
    name: "S&P 500",
    query: '"S&P 500" OR "Wall Street" stocks OR "stock market"',
    tickers: ["SPY"],
  },
  {
    id: "chips",
    name: "Chip stocks",
    query: 'semiconductor stocks OR chipmakers OR Nvidia OR TSMC OR AMD OR Broadcom OR ASML OR Micron',
    tickers: ["SOXX", "NVDA", "AMD", "TSM", "AVGO", "ASML", "MU"],
  },
];

/** Index proxies always shown in the My Interests strip. */
export const BENCHMARKS = ["SPY", "QQQ", "SOXX"];

/* ----------------------------------------------------------------------------------------------
 * Shared sections (World, US, Vietnam) cover the market itself, never anyone's personal stocks.
 *   STRIP:  what the price strip under the title shows, in labeled groups.
 *   GROUPS: what the AI makes one call for (direction, confidence, action), graded later.
 *   MACRO:  rates, currencies and commodities that matter for that market.
 * Symbols are Yahoo-style; ".VN" = a Vietnamese listing (HOSE/HNX/UPCoM), priced via DNSE/Vietcap/VNDirect.
 * -------------------------------------------------------------------------------------------- */

export type StripKey = "indexes" | "megacaps" | "giants" | "banks" | "largecaps";
export interface StripGroup {
  key: StripKey;
  symbols: string[];
}
export type SharedSection = "world" | "us" | "vn";

export const SECTION_STRIPS: Record<SharedSection, StripGroup[]> = {
  us: [
    { key: "indexes", symbols: ["^GSPC", "^DJI", "^NDX", "^RUT"] },
    { key: "megacaps", symbols: ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "AVGO", "TSLA"] },
  ],
  world: [
    { key: "indexes", symbols: ["^GSPC", "^STOXX50E", "^FTSE", "^GDAXI", "^N225", "^HSI", "000001.SS", "^KS11", "^NSEI"] },
    // US-listed shares of the largest non-US companies: priced by Yahoo and by Nasdaq as a backup.
    { key: "giants", symbols: ["TSM", "ASML", "TM", "SONY", "BABA", "NVO", "SAP", "SHEL", "HSBC", "BHP"] },
  ],
  vn: [
    { key: "indexes", symbols: ["^VNINDEX.VN", "^VN30.VN", "^HNX.VN", "^UPCOM.VN"] },
    { key: "banks", symbols: ["VCB.VN", "BID.VN", "CTG.VN", "TCB.VN", "MBB.VN", "VPB.VN", "ACB.VN"] },
    { key: "largecaps", symbols: ["VIC.VN", "VHM.VN", "FPT.VN", "HPG.VN", "GAS.VN", "VNM.VN", "MSN.VN", "MWG.VN", "SSI.VN"] },
  ],
};

export const SECTION_MACRO: Record<SectionId, string[]> = {
  interests: ["^VIX", "^TNX", "CL=F", "GC=F", "DX-Y.NYB", "BTC-USD"],
  us: ["^VIX", "^TNX", "DX-Y.NYB", "CL=F", "GC=F", "BTC-USD"],
  world: ["CL=F", "GC=F", "DX-Y.NYB", "EURUSD=X", "JPY=X", "CNY=X", "^TNX", "^VIX", "BTC-USD"],
  vn: ["VND=X", "DX-Y.NYB", "^TNX", "GC=F", "CL=F", "^VIX"],
};

export const US_GROUPS: Interest[] = [
  { id: "us-sp500", name: "S&P 500", query: '"S&P 500" OR "Wall Street" OR "stock market"', tickers: ["^GSPC", "SPY"] },
  { id: "us-ndx", name: "Nasdaq 100", query: '"Nasdaq" OR "tech stocks" OR "Big Tech"', tickers: ["^NDX", "QQQ"] },
  { id: "us-dow", name: "Dow Jones", query: '"Dow Jones" OR "blue chips"', tickers: ["^DJI", "DIA"] },
  { id: "us-small", name: "Small caps", query: '"Russell 2000" OR "small caps" OR "small-cap stocks"', tickers: ["^RUT", "IWM"] },
];

export const WORLD_GROUPS: Interest[] = [
  { id: "w-us", name: "US stocks", query: '"Wall Street" OR "S&P 500"', tickers: ["^GSPC"] },
  { id: "w-europe", name: "Europe", query: '"European stocks" OR "Stoxx 600" OR DAX OR FTSE', tickers: ["^STOXX50E", "^GDAXI", "^FTSE"] },
  { id: "w-japan", name: "Japan", query: 'Nikkei OR "Japanese stocks" OR "Bank of Japan"', tickers: ["^N225"] },
  { id: "w-china", name: "China & Hong Kong", query: '"Hang Seng" OR "Chinese stocks" OR "Shanghai Composite"', tickers: ["^HSI", "000001.SS"] },
  { id: "w-oil", name: "Oil", query: '"oil prices" OR OPEC OR Brent', tickers: ["CL=F"] },
  { id: "w-gold", name: "Gold", query: '"gold price" OR "gold prices"', tickers: ["GC=F"] },
];

/**
 * Vietnam: the index plus the sector groups that move it. Each group gets its own call.
 */
export const VN_GROUPS: Interest[] = [
  { id: "vn-index", name: "VN-Index", query: '"VN-Index" OR "VN30" OR "thị trường chứng khoán"', tickers: ["^VNINDEX.VN", "^VN30.VN"] },
  { id: "vn-banks", name: "Banks", query: '"cổ phiếu ngân hàng" OR Vietcombank OR Techcombank OR "MB Bank"', tickers: ["VCB.VN", "BID.VN", "CTG.VN", "TCB.VN", "MBB.VN", "VPB.VN", "ACB.VN"] },
  { id: "vn-realestate", name: "Real estate", query: '"cổ phiếu bất động sản" OR Vingroup OR Vinhomes OR "Novaland"', tickers: ["VHM.VN", "VIC.VN", "NVL.VN", "KDH.VN"] },
  { id: "vn-brokers", name: "Securities firms", query: '"cổ phiếu chứng khoán" OR SSI OR VNDirect OR "khối ngoại"', tickers: ["SSI.VN", "VND.VN", "VCI.VN", "HCM.VN"] },
  { id: "vn-tech-retail", name: "Tech & retail", query: 'FPT OR "Thế Giới Di Động" OR MWG OR "bán lẻ"', tickers: ["FPT.VN", "MWG.VN", "PNJ.VN", "MSN.VN"] },
  { id: "vn-industrial", name: "Steel, energy & industrials", query: '"Hòa Phát" OR "thép" OR "PV Gas" OR "đầu tư công"', tickers: ["HPG.VN", "GAS.VN", "GVR.VN", "HSG.VN"] },
];

export const SECTION_GROUPS: Record<SharedSection, Interest[]> = { us: US_GROUPS, world: WORLD_GROUPS, vn: VN_GROUPS };

/** Benchmark for the mood gauge (momentum/strength) and the "breadth" set, per section. */
export const MOOD_BENCH: Record<SectionId, string> = { interests: "SPY", us: "SPY", world: "ACWI", vn: "^VNINDEX.VN" };

/** One-tap preset for Vietnamese users. */
export const VN_PRESET: Interest = {
  id: "vn-stocks",
  name: "Vietnam stocks",
  query: '"VN-Index" OR "chứng khoán" OR HOSE OR "cổ phiếu"',
  tickers: ["^VNINDEX.VN", "FPT.VN", "VCB.VN", "HPG.VN", "VHM.VN"],
};

const gnewsSearch = (q: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:1d")}&hl=en-US&gl=US&ceid=US:en`;
const gnewsSearchVi = (q: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:1d")}&hl=vi&gl=VN&ceid=VN:vi`;
const gnewsTopic = (topic: string) =>
  `https://news.google.com/rss/headlines/section/topic/${topic}?hl=en-US&gl=US&ceid=US:en`;
const gnewsTopicVi = (topic: string) => `https://news.google.com/rss/headlines/section/topic/${topic}?hl=vi&gl=VN&ceid=VN:vi`;
/** Interesting-news feeds (owner Q17): checked from the cloud on Nov 25 2026; BBC, Guardian, NPR, NASA, ScienceDaily,
 * Smithsonian, Tuoi Tre and Thanh Nien science/culture feeds were unreachable from the build sandbox, so not added. */
const INTERESTING_MAX = 8;
const interesting = (name: string, url: string): Feed => ({ name, url, kind: "interesting", max: INTERESTING_MAX });

export interface Feed {
  name: string;
  url: string;
  /** "interesting" for science and culture feeds; unset means important news. */
  kind?: "interesting";
  /** Most items taken from this feed per fetch (science and culture feeds would otherwise crowd out market news). */
  max?: number;
}

/** Static feeds per section. Interest-specific feeds are generated from the interest list. */
export const SECTION_FEEDS: Record<SectionId, Feed[]> = {
  interests: [
    { name: "CNBC Top News", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114" },
    { name: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
    { name: "Google News Business", url: gnewsTopic("BUSINESS") },
  ],
  world: [
    { name: "Google News World", url: gnewsTopic("WORLD") },
    { name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
    { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
    {
      name: "Global macro",
      url: gnewsSearch('"central bank" OR "oil prices" OR "global economy" OR tariffs OR China economy OR Taiwan'),
    },
    interesting("Google News Science", gnewsTopic("SCIENCE")),
    interesting("Google News Health", gnewsTopic("HEALTH")),
  ],
  us: [
    { name: "Google News US", url: gnewsTopic("NATION") },
    { name: "NPR News", url: "https://feeds.npr.org/1001/rss.xml" },
    { name: "CNBC Economy", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258" },
    {
      name: "US policy",
      url: gnewsSearch('"Federal Reserve" OR inflation OR "jobs report" OR Congress OR "White House" economy OR Treasury yields'),
    },
    interesting("Google News Science", gnewsTopic("SCIENCE")),
    interesting("Google News Health", gnewsTopic("HEALTH")),
  ],
  vn: [
    { name: "VnExpress Kinh doanh", url: "https://vnexpress.net/rss/kinh-doanh.rss" },
    { name: "CafeF Chứng khoán", url: "https://cafef.vn/thi-truong-chung-khoan.rss" },
    { name: "Vietstock", url: "https://vietstock.vn/830/chung-khoan/co-phieu.rss" },
    { name: "Tuổi Trẻ Kinh doanh", url: "https://tuoitre.vn/rss/kinh-doanh.rss" },
    { name: "Google News VN", url: gnewsSearchVi('"VN-Index" OR "chứng khoán" OR "Ngân hàng Nhà nước" OR "tỷ giá" OR "FDI"') },
    { name: "Vietnam markets (EN)", url: gnewsSearch('"Vietnam stock" OR "VN-Index" OR "Vietnam economy" OR "State Bank of Vietnam"') },
    interesting("VnExpress Khoa học công nghệ", "https://vnexpress.net/rss/khoa-hoc-cong-nghe.rss"),
    interesting("VnExpress Giải trí", "https://vnexpress.net/rss/giai-tri.rss"),
    interesting("Google News Khoa học", gnewsTopicVi("SCIENCE")),
  ],
};

export const MAX_ITEMS_PER_SECTION = 60;
/** Headlines shown to a model: the full prompt, and the compact one free providers get (their per-minute token limits). */
export const MAX_ITEMS_TO_LLM = 45;
export const MAX_ITEMS_TO_LLM_COMPACT = 30;
