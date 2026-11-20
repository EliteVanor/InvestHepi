import { EVENT_KEYWORDS, PLAYBOOK, type EventType, type PlaybookEntry } from "../analogs";
import { calendarAsText } from "../calendar";
import { earlyCloseMins, isHoliday } from "../holidays";
import { SECTION_MACRO } from "../config";
import { sectorsAsText } from "../chart";
import { langInfo } from "../languages";
import { macroAsText, quotesAsText } from "../market";
import { moodAsText, type MoodGauge } from "../mood";
import { technicalsAsText, type Technicals } from "../technicals";
import type { CalendarEvent, Interest, NewsItem, Quote, SectionId } from "../types";

export interface PromptInput {
  section: SectionId;
  interests: Interest[];
  news: NewsItem[];
  quotes: Quote[];
  macro: Quote[];
  sectors?: Quote[];
  technicals?: Record<string, Technicals>;
  gauge?: MoodGauge;
  /** Position weights, e.g. "NVDA 34% of portfolio (+12% vs cost)". Never dollar amounts. */
  positions?: string;
  calendar: CalendarEvent[];
  language: string;
  now: Date;
}

/**
 * compact = free tiers with tight tokens-per-minute limits: fewer headlines, no summaries,
 * and only the playbook entries relevant to today's headlines.
 */
export interface PromptOptions {
  compact: boolean;
  /** Override the headline count (used to shrink a prompt that's over a provider's size limit). */
  maxHeadlines?: number;
}

const SECTION_FOCUS: Record<SectionId, string> = {
  interests: "news directly about the user's followed markets and stocks",
  world: "global news (geopolitics, foreign economies, central banks, commodities, trade)",
  us: "US news (Fed, economic data, fiscal policy, politics, regulation)",
  vn: "the Vietnamese stock market (VN-Index, HOSE/HNX listings, State Bank of Vietnam policy and credit growth, the dong exchange rate, FDI, exports, foreign investor net buying/selling, margin lending, index reclassification). Headlines may be in Vietnamese",
};

const RULES = `You are the analyst inside "InvestHepi", a personal tool that helps one investor catch up on news fast.
Your job: turn today's headlines into a clear briefing: what happened, why it matters for the markets below, the trend, what moved and what to watch. You do NOT make buy/hold/sell calls or price forecasts here (a separate, graded prediction job does that).

How to think:
- Start from what moves prices: changes in expected rates and yields, earnings and guidance, AI and data center spending, export controls and tariffs, liquidity and risk appetite. Ask what is NEW versus already priced in. Use the market, macro and sector snapshots to judge what has already moved and where money is rotating.
- Separate signal from noise. Most headlines don't matter. Rank by expected price impact, not drama. A story covered by many outlets ("+N outlets") is usually bigger.
- Impacts: for each event, say which way it pushes each affected market and how strongly; confidence there is how sure you are of the direction of that push (50 = unclear, 80+ = rare).
- Use TECHNICALS to describe the trend concretely: name the level (20/50/200-day average, 20-day range, 52-week high). They are context: news and positioning come first.
- Price levels: only quote a level that appears in the snapshots. Where a market says "level unknown" (it is tracked by an ETF whose price is not the index, oil, gold or dollar level), or has no TECHNICALS line, write triggers as % moves ("a further 2% drop", "a close above its 20-day average") and never write a number as its level. Data marked "unavailable" is unknown: don't fill it in from memory.
- Timing: every price shows the session it belongs to ("as of" / "close of" a date). If that date is before the current session, describe it as that day's close ("Nikkei closed Friday at 61,142"), never as today's move. Levels marked ≈ are estimates: say "about".
- MOOD is a 0-100 composite (0 fear, 100 greed). Extremes cut both ways: extreme greed raises the bar for new buys, extreme fear often marks short-term lows.
- If POSITIONS are given, say what the news means for them and flag concentration if one position is over ~30%.
- SCENARIOS: if a major scheduled catalyst (FOMC, CPI, jobs report, or earnings of a followed ticker) falls within the next 7 days, return ONE scenario set for the nearest one with 2-3 cases (e.g. hot / in line / cool), probabilities that sum to 100, the expected reaction of the user's interests, and what to do in each case. Probabilities are your estimates; keep them sober. Otherwise return an empty array.
- Use the UPCOMING catalysts: put dated catalysts in watch_next. Only give a date that appears in UPCOMING CATALYSTS or a headline; otherwise name the item without a date. Never invent release dates.
- Historical analogs: use a PLAYBOOK entry only when it is the same kind of event (a China growth scare is not a US inflation print). Otherwise set analog to null: a loose analog misleads more than none. analog.event is a short plain description of the past event ("Hot August 2022 US CPI"), never the bracketed tag. If you use one from memory, keep numbers approximate and only cite events you are sure happened.
- movers: put the numbers of the headlines that explain each move in source_ids. A headline only counts if it is about that company or its sector news names it. If none does, source_ids is [] and why is "No clear news in today's headlines": never guess a cause (earnings, flows, sentiment) that no headline states.
- Copy company and person names exactly as the headlines spell them (Hòa Phát, not a near-miss).
- what_could_go_wrong must be specific (a data release, a level, a counter-narrative), not a generic disclaimer.
- Only use facts from the headlines and snapshots. If headlines are thin, say so and lower confidence.
- Write plainly and concisely. No hype.`;

/** Pick playbook entries whose event types appear in today's headlines (plus a couple of defaults). */
export function relevantPlaybook(news: NewsItem[], max = 6, section?: SectionId) {
  const counts = new Map<EventType, number>();
  for (const n of news) {
    const hay = `${n.title} ${n.summary ?? ""}`;
    for (const [type, re] of Object.entries(EVENT_KEYWORDS) as [EventType, RegExp][]) {
      if (re.test(hay)) counts.set(type, (counts.get(type) ?? 0) + 1);
    }
  }
  const types = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  // Only entries whose event type is in today's headlines. Padding with unrelated US entries made the
  // model attach "hot CPI 2022" to a China slowdown; no analog beats a wrong one.
  const region = section === "vn" ? "vn" : undefined;
  const pick = (t: EventType) => {
    const all = PLAYBOOK.filter((p) => p.type === t);
    return (region && all.find((p) => p.region === region)) || all.find((p) => !p.region) || all[0];
  };
  return types.map(pick).filter((p): p is PlaybookEntry => !!p).slice(0, max);
}

export function buildSystemPrompt(input: PromptInput, opts: PromptOptions): string {
  const entries = opts.compact ? relevantPlaybook(input.news, 6, input.section) : PLAYBOOK;
  const playbook = entries.length
    ? entries.map((p) => `- (${p.type.replace(/_/g, " ")}) ${p.date}: ${p.event} → ${p.whatHappenedNext} Lesson: ${p.lesson}`).join("\n")
    : "(no entry matches today's headlines: set analog to null unless you are sure of a close match)";
  const lang = langInfo(input.language);
  const langRule =
    lang.code === "en"
      ? ""
      : `\n\nLANGUAGE: Write every human-readable text value (headline, summary, titles, explanations, watch_next, movers.why, scenarios) in ${lang.english}. Keep JSON keys, enum values (up/down/flat, risk-on, ...) and tickers exactly as specified in English.`;
  return `${RULES}${input.section === "vn" ? VN_RULES : ""}${langRule}\n\nPLAYBOOK (verified historical reactions):\n${playbook}`;
}

function etParts(d: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** Ho Chi Minh City exchange (HOSE): 9:00-11:30 and 13:00-14:45 ICT (UTC+7), ATC auction 14:30-14:45. */
export function vnMarketPhase(d: Date): string {
  const ict = new Date(d.getTime() + 7 * 3600_000);
  const wd = ict.getUTCDay();
  const mins = ict.getUTCHours() * 60 + ict.getUTCMinutes();
  if (wd === 0 || wd === 6) return "weekend, HOSE closed (next session Monday)";
  if (isHoliday("Asia/Ho_Chi_Minh", ict.toISOString().slice(0, 10))) return "market holiday, HOSE closed";
  if (mins < 540) return "before the HOSE open (9:00 ICT)";
  if (mins < 690) return "HOSE morning session in progress";
  if (mins < 780) return "HOSE lunch break (reopens 13:00 ICT)";
  if (mins < 885) return "HOSE afternoon session in progress";
  return "after the HOSE close (next session tomorrow)";
}

export const VN_RULES = `
VIETNAM SECTION:
- Prices are in VND; indexes in points. VN-Index moves are driven mostly by banks, real estate (Vingroup family) and foreign/retail flows, so weigh those first.
- Key drivers: State Bank of Vietnam rates, credit growth and liquidity (OMO), USD/VND pressure, foreign net buying/selling, margin debt, earnings seasons, public investment, FDI and export data, and index reclassification news. US rates and the dollar matter through the exchange rate and foreign flows.
- The central bank and the dong: SBV SELLING dollars (spot or forwards) supports the dong; SBV BUYING dollars adds dong liquidity and is done when the dong is strong or to rebuild reserves (it does not "keep the dong strong"). A rising USD/VND means a weaker dong, which raises import costs and tends to push foreign investors to sell.
- HOSE has a 7% daily price limit and T+2 settlement; retail investors dominate turnover, so momentum and sentiment swings are sharp.
- "today" means the next HOSE session; "week" means the next 5 HOSE sessions.`;

export function marketPhase(d: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "numeric", minute: "numeric", hour12: false })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const mins = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return "weekend, market closed (next session Monday)";
  if (isHoliday("America/New_York", `${parts.year}-${parts.month}-${parts.day}`)) return "market holiday, US exchanges closed";
  const early = earlyCloseMins("America/New_York", `${parts.year}-${parts.month}-${parts.day}`);
  if (mins < 570) return "pre-market (regular session opens 9:30 ET)";
  if (mins < (early ?? 960)) return early ? `regular session in progress (early close at ${Math.floor(early / 60)}:${String(early % 60).padStart(2, "0")} ET)` : "regular session in progress";
  return "after the close (next session tomorrow)";
}

/** Free tiers only get technicals for each interest's benchmark ticker (plus SPY) to save tokens. */
function techFor(p: PromptInput, opts: PromptOptions): Record<string, Technicals> {
  const all = p.technicals ?? {};
  if (!opts.compact) return all;
  const keep = new Set(["SPY", ...p.interests.map((i) => i.tickers[0])]);
  return Object.fromEntries(Object.entries(all).filter(([s]) => keep.has(s)));
}

export function buildUserPrompt(p: PromptInput, opts: PromptOptions): string {
  const maxHeadlines = opts.maxHeadlines ?? (opts.compact ? 30 : 45);
  const interests = p.interests
    .map((i) => `- ${i.name} (benchmark ${i.tickers[0]}${i.tickers.length > 1 ? `; also ${i.tickers.slice(1).join(", ")}` : ""})`)
    .join("\n");
  const headlines = p.news
    .slice(0, maxHeadlines)
    .map((n, i) => {
      const breadth = n.alsoIn?.length ? ` [+${n.alsoIn.length} outlets]` : "";
      const summary = !opts.compact && n.summary ? ` | ${n.summary.slice(0, 200)}` : "";
      return `[${i}] ${n.title} (${n.source}, ${n.publishedAt.slice(5, 16).replace("T", " ")} UTC)${breadth}${summary}`;
    })
    .join("\n");
  const moversRule =
    p.section === "interests"
      ? `In "movers", explain the 1-4 tickers from the user's list with the biggest last-session moves (use the snapshot's numbers).`
      : `In "movers", explain the 1-4 symbols from the market snapshot with the biggest last-session moves, if a headline explains them (use the snapshot's numbers).`;

  const clock =
    p.section === "vn"
      ? `Now: ${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", weekday: "long", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(p.now)} ICT (${vnMarketPhase(p.now)}). US: ${marketPhase(p.now)}.`
      : `Now: ${etParts(p.now)} ET (${marketPhase(p.now)}).`;
  return `${clock}
Section: ${p.section.toUpperCase()}, covering ${SECTION_FOCUS[p.section]}.

${p.section === "interests" ? "USER'S INTERESTS" : "MARKETS COVERED"}:
${interests}

MARKET SNAPSHOT:
${quotesAsText(p.quotes)}

MACRO:
${macroAsText(p.macro, SECTION_MACRO[p.section])}

${p.sectors?.length ? `SECTORS (last session, best to worst):\n${sectorsAsText(p.sectors)}\n` : ""}
TECHNICALS:
${technicalsAsText(techFor(p, opts))}

MOOD GAUGE: ${moodAsText(p.gauge)}
${p.positions ? `\nPOSITIONS (weights only):\n${p.positions}\n` : ""}
UPCOMING CATALYSTS (next 3 weeks):
${calendarAsText(p.calendar)}

HEADLINES (cite by number in source_ids):
${headlines || "(no headlines fetched)"}

Analyze these headlines${p.section === "interests" ? "" : p.section === "vn" ? " for their impact on the Vietnamese market groups above" : " for their impact on the markets above"}. In "impacts", use the exact ${p.section === "interests" ? "interest" : "market"} names above. ${moversRule}`;
}
