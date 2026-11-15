import { playbookAsText } from "../analogs";
import { quotesAsText } from "../market";
import type { Interest, NewsItem, Quote, SectionId } from "../types";

export interface PromptInput {
  section: SectionId;
  interests: Interest[];
  news: NewsItem[];
  quotes: Quote[];
  trackRecord: string;
  now: Date;
}

const SECTION_FOCUS: Record<SectionId, string> = {
  interests: "news directly about the user's followed markets and stocks",
  world: "global news (geopolitics, foreign economies, central banks, commodities, trade)",
  us: "US news (Fed, economic data, fiscal policy, politics, regulation)",
};

export const SYSTEM_PROMPT = `You are the analyst inside "Invest Helper", a personal tool that helps one investor catch up on news fast and act on it.
Your job: turn today's headlines into a clear read on how the user's followed stocks will likely trade over the next session and the coming week.

How to think:
- Start from what moves prices: changes in expected rates and yields, earnings and guidance, AI and data center spending, export controls and tariffs, liquidity and risk appetite. Ask what is NEW versus already priced in. Use the market snapshot to judge what has already moved.
- Separate signal from noise. Most headlines don't matter. Rank by expected price impact, not by how dramatic they sound.
- Be decisive. Give a direction and an action for every interest. "It depends" is not an answer; put the conditions in action_trigger instead.
- Confidence is a calibrated probability that your direction call is right (50 = coin flip, 65 = solid edge, 80+ = rare, needs overwhelming evidence). Use your track record to recalibrate: if you've been overconfident, lower your numbers.
- Historical analogs: prefer entries from the PLAYBOOK below. If you use one from memory, keep numbers approximate and only cite events you are sure happened. Never invent precise figures.
- what_could_go_wrong must be specific (a data release, a level, a counter-narrative), not generic disclaimers.
- Actions: BUY/ADD = favorable entry now; HOLD = keep positions; WAIT = setup unclear or a catalyst is pending; TRIM/SELL = reduce; AVOID = stay out. Tie each to a concrete trigger.
- Only use facts from the headlines and snapshot. If headlines are thin, say so in the headline and lower confidence.
- Write plainly and concisely. No hype.

PLAYBOOK (verified historical reactions):
${playbookAsText()}`;

function etParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return f.format(d);
}

export function marketPhase(d: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hour12: false })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return "weekend, market closed (next session Monday)";
  if (mins < 570) return "pre-market (regular session opens 9:30 ET)";
  if (mins < 960) return "regular session in progress";
  return "after the close (next session tomorrow)";
}

export function buildUserPrompt(p: PromptInput): string {
  const interests = p.interests
    .map((i) => `- ${i.name} (benchmark ${i.tickers[0]}${i.tickers.length > 1 ? `; also ${i.tickers.slice(1).join(", ")}` : ""})`)
    .join("\n");
  const headlines = p.news
    .map((n, i) => `[${i}] ${n.title} (${n.source}, ${n.publishedAt.slice(5, 16).replace("T", " ")} UTC)${n.summary ? ` | ${n.summary.slice(0, 200)}` : ""}`)
    .join("\n");

  return `Now: ${etParts(p.now)} ET (${marketPhase(p.now)}).
Section: ${p.section.toUpperCase()}, covering ${SECTION_FOCUS[p.section]}.

USER'S INTERESTS (give one outlook entry per interest using its benchmark ticker; add entries for individual tickers only if a headline is directly about them):
${interests}

MARKET SNAPSHOT:
${quotesAsText(p.quotes)}

YOUR RECENT TRACK RECORD:
${p.trackRecord}

HEADLINES (cite by number in source_ids):
${headlines || "(no headlines fetched)"}

Analyze these headlines${p.section === "interests" ? "" : " for their impact on the user's interests"}. In "impacts", use the exact interest names above.`;
}
