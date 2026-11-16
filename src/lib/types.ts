export type SectionId = "interests" | "world" | "us" | "vn";

export const SECTION_IDS: SectionId[] = ["interests", "world", "us", "vn"];
export const SHARED_SECTIONS: SectionId[] = ["world", "us", "vn"];

export const SECTIONS: { id: SectionId; label: string; blurb: string }[] = [
  { id: "interests", label: "My Interests", blurb: "News about the markets and stocks you follow" },
  { id: "world", label: "World", blurb: "Global events that move markets" },
  { id: "us", label: "US", blurb: "US politics, economy and policy" },
  { id: "vn", label: "Vietnam", blurb: "Vietnam's stock market and economy" },
];

/** Something the user follows, e.g. "Semiconductors". */
export interface Interest {
  id: string;
  name: string;
  /** Search phrase for news feeds, e.g. "semiconductor OR chip stocks". */
  query: string;
  /** Tickers used for prices and grading. First one is the "benchmark" used for track record. */
  tickers: string[];
}

export interface NewsItem {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: string; // ISO
  summary?: string;
  /** Interest ids this item matched (only for the interests section). */
  tags?: string[];
  /** Other outlets that ran the same story (merged by dedupe). */
  alsoIn?: string[];
  /** The headline as published, when `title` holds a translation. */
  titleOrig?: string;
}

export interface Quote {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
  /** Daily closes, oldest first: [isoDate, close] */
  history: [string, number][];
  source: "yahoo" | "nasdaq" | "dnse" | "vietcap" | "vndirect" | "vndirect-world" | "stooq";
  /** Filled from the last good copy because every source failed this time. */
  stale?: boolean;
  /** Priced from this US-listed ETF because the symbol's own source refused (see PROXIES). */
  proxy?: string;
  /** Live overlay only: the latest session's intraday closes (sparkline, baseline prevClose). */
  spark?: number[];
  /** Real level carried forward by this same-hours ETF's move since the last official close. */
  estimatedVia?: string;
  /** Only daily closes exist for this market: the price is the last close (see its date). */
  dailyOnly?: boolean;
  /** Exchange-local date of the session the price belongs to (live overlay). */
  session?: string;
}

export type Direction = "up" | "down" | "flat";
export type Action = "BUY" | "ADD" | "HOLD" | "WAIT" | "TRIM" | "SELL" | "AVOID";

export interface Impact {
  interest: string;
  direction: Direction;
  magnitude: "small" | "moderate" | "large";
  confidence: number; // 0-100
  reasoning: string;
}

export interface Analog {
  event: string;
  date: string;
  whatHappenedNext: string;
}

export interface KeyEvent {
  title: string;
  whatHappened: string;
  whyItMatters: string;
  importance: number; // 1-5
  sourceIds: number[];
  impacts: Impact[];
  analog: Analog | null;
  whatCouldGoWrong: string;
}

export interface Outlook {
  interest: string;
  ticker: string;
  direction: Direction;
  confidence: number; // 0-100
  horizon: "today" | "this week";
  action: Action;
  actionTrigger: string;
  rationale: string;
  risks: string;
}

export interface Analysis {
  headline: string;
  mood: "risk-on" | "risk-off" | "mixed";
  summary: string[];
  events: KeyEvent[];
  outlook: Outlook[];
  watchNext: string[];
  /** sourceIds: the headlines (indexes into Digest.news) that explain the move; empty = no clear news. */
  movers: { ticker: string; changePct: number; why: string; sourceIds?: number[] }[];
  /** "If hot / in line / cool" playbook for the next major catalyst (may be empty or missing on old digests). */
  scenarios?: Scenario[];
}

export interface ScenarioCase {
  label: string;
  probability: number; // 0-100, an estimate
  reaction: string;
  action: string;
}

export interface Scenario {
  catalyst: string;
  when: string;
  cases: ScenarioCase[];
}

export interface Holding {
  symbol: string;
  shares: number;
  /** Average cost per share. */
  cost: number;
}

export interface Digest {
  /** Set on translated copies: the language it was written in, and which AI translated it. */
  translatedFrom?: string;
  translatedBy?: string;
  /** Shared sections: labeled groups for the price strip (World/US/Vietnam). */
  strip?: { key: string; symbols: string[] }[];
  section: SectionId;
  generatedAt: string;
  provider: string; // e.g. "groq:openai/gpt-oss-120b" or "rules"
  providerNote?: string;
  analysis: Analysis;
  news: NewsItem[];
  quotes: Quote[];
  /** Macro context: VIX, 10Y yield, oil, gold, dollar, bitcoin. */
  macro?: Quote[];
  /** Sector ETF moves (last session). */
  sectors?: Quote[];
  /** Moving averages, RSI, support/resistance per ticker. */
  technicals?: Record<string, import("./technicals").Technicals>;
  /** Market mood composite, 0 (fear) to 100 (greed). */
  gauge?: import("./mood").MoodGauge;
  feedErrors: string[];
  /** Language the AI prose was written in. */
  language?: string;
}

export interface DigestMeta {
  generatedAt: string;
  provider: string;
  headline: string;
  mood: Analysis["mood"];
}

export interface CalendarEvent {
  date: string; // YYYY-MM-DD (US/Eastern)
  time?: string; // e.g. "14:00 ET", "before open"
  kind: "earnings" | "macro";
  title: string;
  ticker?: string;
  importance: 1 | 2 | 3;
}

export interface Settings {
  /** Language code for AI-written briefings (en, vi, zh, ja, ko, es, fr, de). */
  briefingLanguage: string;
}

/** A logged call, graded later against real prices. */
export interface Call {
  id: string; // `${date}:${ticker}`
  date: string; // US/Eastern trading date the call is for (YYYY-MM-DD)
  madeAt: string; // ISO
  interest: string;
  ticker: string;
  direction: Direction;
  confidence: number;
  action: Action;
  provider: string;
  baseClose?: number; // previous close at time of call
  outcomeClose?: number;
  returnPct?: number;
  correct?: boolean;
  gradedAt?: string;
}
