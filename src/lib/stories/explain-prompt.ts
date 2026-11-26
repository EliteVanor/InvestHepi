/**
 * The story-explain prompt (v19b design section 4): one call explains up to 10 stories for a curious
 * reader. Market text reuses the briefing prompt's helpers, so prices read the same everywhere.
 */
import { calendarAsText } from "../calendar";
import { sectorsAsText } from "../chart";
import { SECTION_MACRO } from "../config";
import { macroAsText, quotesAsText } from "../market";
import { HEADLINES_ARE_DATA, SECTION_FOCUS, VN_RULES, marketPhase, vnMarketPhase } from "../llm/prompt";
import type { CalendarEvent, Quote, SectionId } from "../types";
import type { Story } from "./cluster";
import type { PastEvent } from "./past";

export const EXPLAIN_RULES = `You are the news explainer inside "InvestHepi". Your reader is curious and may have no finance background. For each story below, explain what happened, why it matters, what it does to markets and to the wider world, in plain words.

How to write:
- Plain, short sentences. When you use a term a newcomer may not know (bond yield, rate cut, tariff, margin), define it in a few words or list it in "concepts" (0-3 short terms per story).
- No hype, no drama. Rank by real impact; a story covered by many outlets is usually bigger.
- Use only facts from the story's headlines and snippets, the market snapshot and the calendar. If the reports don't say something (a cause, a figure, what comes next), write "not clear from the reports" instead of guessing.
- why: the consequence for readers (who is affected, what changes for them, what it could lead to), not a second telling of "what". If the reports don't show why it matters, say "not clear from the reports".
- Numbers: only write a number that appears in the story's reports, the snapshot or the calendar. Never a number from memory. Sentences with other numbers are removed.
- markets: name tickers from the MARKET SNAPSHOT only, with the direction this story pushes them (up, down or flat) and one sentence why. Don't write their % moves: the app adds them from the snapshot. List a market only when the reports name it or the link is direct (an oil-supply story and oil, a central-bank decision and bond yields). Never tie a story to an index just because the index moved today: a vague link ("adds to uncertainty", "keeps traders attentive") misleads; leave markets empty instead.
- world: what it means beyond markets (people, prices, jobs, governments), one or two sentences.
- watch: one thing to watch next, if any. Only give a date that appears in the calendar or a report.
- source_ids: the [ids] of the story's own headlines that back the card. Never cite another story's ids.
- Past events: a story may list candidates as "P:<id>". Cite only a listed P id in past_id, or null if none is a close match (a loose match misleads more than none). Never write the past event's figures or dates: the app adds them. In "different", say what is different this time.
- big_picture: 3 short lines tying the day together, most important first. watch (top level): dated catalysts from the calendar.
- movers: snapshot tickers with notable moves that a headline explains; source_ids are the headline [ids]. If no headline explains the move, leave it out.`;

export const EXPLAIN_HINT = `Return ONLY a JSON object with exactly this shape:
{ "big_picture": [string, string, string],
  "stories": [{ "story": "S1", "title": string, "what": string, "why": string, "markets": [{ "ticker": string, "direction": "up"|"down"|"flat", "text": string }], "world": string, "past_id": string|null, "different": string, "watch": string (optional), "concepts": [string], "source_ids": [string], "importance": 1-5 }],
  "movers": [{ "ticker": string, "why": string, "source_ids": [string] }],
  "watch": [string] }`;

export interface PromptParts {
  section: SectionId;
  lang: "en" | "vi";
  now: Date;
  market: { quotes: Quote[]; macro?: Quote[]; sectors?: Quote[] };
  calendar: CalendarEvent[];
  covered: string[];
  want?: { important: number; interesting: number };
}

export function buildExplainSystem(p: Pick<PromptParts, "section" | "lang">): string {
  const lang =
    p.lang === "vi"
      ? `\n\nLANGUAGE: Write every text value (big_picture, titles, what, why, markets text, world, different, watch, concepts, movers why) in Vietnamese. Keep JSON keys, "S" story numbers, P ids, headline ids, tickers and up/down/flat exactly as given.`
      : "";
  return `${EXPLAIN_RULES}\n\n${HEADLINES_ARE_DATA}${p.section === "vn" ? VN_RULES : ""}${lang}`;
}

/** The clock, snapshot, macro, sectors and calendar as the model sees them (also the number guard's input). */
export function contextText(p: PromptParts): string {
  const clock = p.section === "vn" ? `Now: ${p.now.toISOString().slice(0, 16)} UTC (Vietnam: ${vnMarketPhase(p.now)}; US: ${marketPhase(p.now)}).` : `Now: ${p.now.toISOString().slice(0, 16)} UTC (US: ${marketPhase(p.now)}).`;
  const sectors = p.market.sectors?.length ? `\n\nSECTORS (last session, best to worst):\n${sectorsAsText(p.market.sectors)}` : "";
  return `${clock}
Section: ${p.section.toUpperCase()}, covering ${SECTION_FOCUS[p.section]}.

MARKET SNAPSHOT:
${quotesAsText(p.market.quotes)}

MACRO:
${macroAsText(p.market.macro ?? [], SECTION_MACRO[p.section])}${sectors}

UPCOMING CATALYSTS (next 3 weeks):
${calendarAsText(p.calendar)}`;
}

/** One story: its number, outlet count, every member as `[id] outlet: title | snippet`, and its past-event candidates. */
export function storyBlock(s: Story, i: number, cands: PastEvent[]): string {
  const members = s.members.map((m) => `[${m.id}] ${m.source}: ${m.title}${m.summary ? ` | ${m.summary}` : ""}`).join("\n");
  const past = cands.length ? `\nPast-event candidates:\n${cands.map((e) => `P:${e.id} ${e.date}: ${e.event} — ${e.move}`).join("\n")}` : "";
  return `S${i + 1} (${s.outlets.length} outlet${s.outlets.length === 1 ? "" : "s"}, ${s.kind}):\n${members}${past}`;
}

export function buildExplainUser(p: PromptParts, stories: Story[], cands: PastEvent[][], context = contextText(p)): string {
  const covered = p.covered.length
    ? `\n\nALREADY COVERED (cards exist: write no entries for these, but big_picture and watch may mention them):\n${p.covered.map((t) => `- ${t}`).join("\n")}`
    : "";
  return `${context}${covered}

STORIES (most important first; cite headline ids in source_ids):
${stories.map((s, i) => storyBlock(s, i, cands[i] ?? [])).join("\n\n")}

${
    p.want
      ? `These are CANDIDATES. Write entries only for the ${p.want.important} most important "important" stories${p.want.interesting ? ` and the ${p.want.interesting} most interesting "interesting" stories` : ""}, by what matters to most readers today (markets, prices, policy, many people's lives); skip local or minor items (weather chatter, small crimes, celebrity news) even when they are recent. Fewer entries are better than filler. Give each entry "importance" 1-5 (5 = matters to most readers today, 1 = minor). big_picture is about the stories you chose and the covered ones.`
      : `Explain each story as one entry in "stories", using its S number. Give each entry "importance" 1-5 (5 = matters to most readers today, 1 = minor).`
  }`;
}
