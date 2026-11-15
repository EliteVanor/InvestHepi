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

const gnewsSearch = (q: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:1d")}&hl=en-US&gl=US&ceid=US:en`;
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
};

export const MAX_ITEMS_PER_SECTION = 60;
export const MAX_ITEMS_TO_LLM = 45;
