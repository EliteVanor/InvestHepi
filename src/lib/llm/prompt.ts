import { EVENT_KEYWORDS, PLAYBOOK, type EventType } from "../analogs";
import { calendarAsText } from "../calendar";
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
  trackRecord: string;
  language: string;
  now: Date;
}

/**
 * compact = free tiers with tight tokens-per-minute limits: fewer headlines, no summaries,
 * and only the playbook entries relevant to today's headlines.
 */
export interface PromptOptions {
  compact: boolean;
}

const SECTION_FOCUS: Record<SectionId, string> = {
  interests: "news directly about the user's followed markets and stocks",
  world: "global news (geopolitics, foreign economies, central banks, commodities, trade)",
  us: "US news (Fed, economic data, fiscal policy, politics, regulation)",
};

const RULES = `You are the analyst inside "Invest Helper", a personal tool that helps one investor catch up on news fast and act on it.
Your job: turn today's headlines into a clear read on how the user's followed stocks will likely trade over the next session and the coming week.

How to think:
- Start from what moves prices: changes in expected rates and yields, earnings and guidance, AI and data center spending, export controls and tariffs, liquidity and risk appetite. Ask what is NEW versus already priced in. Use the market, macro and sector snapshots to judge what has already moved and where money is rotating.
- Separate signal from noise. Most headlines don't matter. Rank by expected price impact, not drama. A story covered by many outlets ("+N outlets") is usually bigger.
- Be decisive. Give a direction and an action for every interest. "It depends" is not an answer; put the conditions in action_trigger.
- Confidence is a calibrated probability that your direction call is right (50 = coin flip, 65 = solid edge, 80+ = rare). Use your track record to recalibrate: if you've been overconfident, lower your numbers.
- Use TECHNICALS to make triggers concrete: name the level (20/50/200-day average, 20-day range, 52-week high) instead of "on weakness". They are context, not signals: news and positioning come first. RSI above 70 or below 30 and a stretched distance from the 50-day average argue against chasing.
- MOOD is a 0-100 composite (0 fear, 100 greed). Extremes cut both ways: extreme greed raises the bar for new buys, extreme fear often marks short-term lows.
- If POSITIONS are given, word each action for this investor: for something they hold use HOLD/ADD/TRIM/SELL; for something they don't hold use BUY/WAIT/AVOID. Flag concentration if one position is over ~30%.
- SCENARIOS: if a major scheduled catalyst (FOMC, CPI, jobs report, or earnings of a followed ticker) falls within the next 7 days, return ONE scenario set for the nearest one with 2-3 cases (e.g. hot / in line / cool), probabilities that sum to 100, the expected reaction of the user's interests, and what to do in each case. Probabilities are your estimates; keep them sober. Otherwise return an empty array.
- Use the UPCOMING catalysts: a pending CPI print, FOMC decision or earnings report often argues for WAIT or smaller size until it passes. Put dated catalysts in watch_next.
- Historical analogs: prefer entries from the PLAYBOOK. If you use one from memory, keep numbers approximate and only cite events you are sure happened. Never invent precise figures.
- what_could_go_wrong must be specific (a data release, a level, a counter-narrative), not a generic disclaimer.
- Actions: BUY/ADD = favorable entry now; HOLD = keep positions; WAIT = setup unclear or a catalyst is pending; TRIM/SELL = reduce; AVOID = stay out. Tie each to a concrete trigger.
- Only use facts from the headlines and snapshots. If headlines are thin, say so and lower confidence.
- Write plainly and concisely. No hype.`;

/** Pick playbook entries whose event types appear in today's headlines (plus a couple of defaults). */
export function relevantPlaybook(news: NewsItem[], max = 6) {
  const counts = new Map<EventType, number>();
  for (const n of news) {
    const hay = `${n.title} ${n.summary ?? ""}`;
    for (const [type, re] of Object.entries(EVENT_KEYWORDS) as [EventType, RegExp][]) {
      if (re.test(hay)) counts.set(type, (counts.get(type) ?? 0) + 1);
    }
  }
  const types = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const picked = types.flatMap((t) => PLAYBOOK.filter((p) => p.type === t).slice(0, 1));
  for (const fallback of ["inflation_hot", "fed_hawkish", "ai_disruption_scare"] as EventType[]) {
    if (picked.length >= 3) break;
    const p = PLAYBOOK.find((x) => x.type === fallback);
    if (p && !picked.includes(p)) picked.push(p);
  }
  return picked.slice(0, max);
}

export function buildSystemPrompt(input: PromptInput, opts: PromptOptions): string {
  const entries = opts.compact ? relevantPlaybook(input.news) : PLAYBOOK;
  const playbook = entries.map((p) => `- [${p.type}] ${p.date}: ${p.event} → ${p.whatHappenedNext} Lesson: ${p.lesson}`).join("\n");
  const lang = langInfo(input.language);
  const langRule =
    lang.code === "en"
      ? ""
      : `\n\nLANGUAGE: Write every human-readable text value (headline, summary, titles, explanations, triggers, rationale, risks, watch_next, movers.why) in ${lang.english}. Keep JSON keys, enum values (up/down/flat, risk-on, BUY, today, ...) and tickers exactly as specified in English.`;
  return `${RULES}${langRule}\n\nPLAYBOOK (verified historical reactions):\n${playbook}`;
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

export function marketPhase(d: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hour12: false })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const mins = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return "weekend, market closed (next session Monday)";
  if (mins < 570) return "pre-market (regular session opens 9:30 ET)";
  if (mins < 960) return "regular session in progress";
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
  const maxHeadlines = opts.compact ? 30 : 45;
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
      : `Return "movers" as an empty array.`;

  return `Now: ${etParts(p.now)} ET (${marketPhase(p.now)}).
Section: ${p.section.toUpperCase()}, covering ${SECTION_FOCUS[p.section]}.

USER'S INTERESTS (give one outlook entry per interest using its benchmark ticker; add entries for individual tickers only if a headline is directly about them):
${interests}

MARKET SNAPSHOT:
${quotesAsText(p.quotes)}

MACRO:
${macroAsText(p.macro)}

SECTORS (last session, best to worst):
${sectorsAsText(p.sectors ?? [])}

TECHNICALS:
${technicalsAsText(techFor(p, opts))}

MOOD GAUGE: ${moodAsText(p.gauge)}
${p.positions ? `\nPOSITIONS (weights only):\n${p.positions}\n` : ""}
UPCOMING CATALYSTS (next 3 weeks):
${calendarAsText(p.calendar)}

YOUR RECENT TRACK RECORD:
${p.trackRecord}

HEADLINES (cite by number in source_ids):
${headlines || "(no headlines fetched)"}

Analyze these headlines${p.section === "interests" ? "" : " for their impact on the user's interests"}. In "impacts", use the exact interest names above. ${moversRule}`;
}
