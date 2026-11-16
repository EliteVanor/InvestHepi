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

/** Index proxies always shown in the market strip. */
export const BENCHMARKS = ["SPY", "QQQ", "SOXX"];

/**
 * Vietnam section coverage: the index plus the sector groups that move it. ".VN" = HOSE listing
 * (prices via Yahoo, then TCBS / VNDirect, see vnmarket.ts). "^VNINDEX.VN" is the VN-Index itself.
 * Each group gets its own prediction in the Vietnam briefing.
 */
export const VN_GROUPS: Interest[] = [
  { id: "vn-index", name: "VN-Index", query: '"VN-Index" OR "VN30" OR "thị trường chứng khoán"', tickers: ["^VNINDEX.VN", "^VN30.VN", "E1VFVN30.VN"] },
  { id: "vn-banks", name: "Banks", query: '"cổ phiếu ngân hàng" OR Vietcombank OR Techcombank OR "MB Bank"', tickers: ["VCB.VN", "TCB.VN", "MBB.VN", "ACB.VN", "BID.VN"] },
  { id: "vn-realestate", name: "Real estate", query: '"cổ phiếu bất động sản" OR Vingroup OR Vinhomes OR "Novaland"', tickers: ["VHM.VN", "VIC.VN", "NVL.VN", "KDH.VN"] },
  { id: "vn-brokers", name: "Securities firms", query: '"cổ phiếu chứng khoán" OR SSI OR VNDirect OR "khối ngoại"', tickers: ["SSI.VN", "VND.VN", "VCI.VN", "HCM.VN"] },
  { id: "vn-tech-retail", name: "Tech & retail", query: "FPT OR \"Thế Giới Di Động\" OR MWG OR \"bán lẻ\"", tickers: ["FPT.VN", "MWG.VN", "PNJ.VN"] },
  { id: "vn-industrial", name: "Steel & industrials", query: '"Hòa Phát" OR "thép" OR "đầu tư công" OR "khu công nghiệp"', tickers: ["HPG.VN", "GVR.VN", "HSG.VN"] },
];

/** Prices shown in the Vietnam tab's strip, first to last. VNM = US-listed VanEck Vietnam ETF. */
export const VN_SYMBOLS = ["^VNINDEX.VN", "^VN30.VN", "VCB.VN", "FPT.VN", "HPG.VN", "VHM.VN", "SSI.VN", "MWG.VN", "VNM"];

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

export interface Feed {
  name: string;
  url: string;
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
  ],
  us: [
    { name: "Google News US", url: gnewsTopic("NATION") },
    { name: "NPR News", url: "https://feeds.npr.org/1001/rss.xml" },
    { name: "CNBC Economy", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258" },
    {
      name: "US policy",
      url: gnewsSearch('"Federal Reserve" OR inflation OR "jobs report" OR Congress OR "White House" economy OR Treasury yields'),
    },
  ],
  vn: [
    { name: "VnExpress Kinh doanh", url: "https://vnexpress.net/rss/kinh-doanh.rss" },
    { name: "CafeF Chứng khoán", url: "https://cafef.vn/thi-truong-chung-khoan.rss" },
    { name: "Vietstock", url: "https://vietstock.vn/830/chung-khoan/co-phieu.rss" },
    { name: "Tuổi Trẻ Kinh doanh", url: "https://tuoitre.vn/rss/kinh-doanh.rss" },
    { name: "Google News VN", url: gnewsSearchVi('"VN-Index" OR "chứng khoán" OR "Ngân hàng Nhà nước" OR "tỷ giá" OR "FDI"') },
    { name: "Vietnam markets (EN)", url: gnewsSearch('"Vietnam stock" OR "VN-Index" OR "Vietnam economy" OR "State Bank of Vietnam"') },
  ],
};

export const MAX_ITEMS_PER_SECTION = 60;
export const MAX_ITEMS_TO_LLM = 45;
