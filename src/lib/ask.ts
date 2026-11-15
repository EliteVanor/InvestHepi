/**
 * Ask AI: answers follow-up questions using only what the app already knows today
 * (briefings, headlines, prices, sectors, calendar, track record). Cites headlines as [n].
 */
import { calendarAsText } from "./calendar";
import { sectorsAsText } from "./chart";
import { langInfo } from "./languages";
import { complete, type ChatMessage } from "./llm";
import { macroAsText, quotesAsText } from "./market";
import type { CalendarEvent, Digest, NewsItem } from "./types";

export interface AskSource {
  n: number;
  title: string;
  link: string;
  source: string;
}

export function buildAskContext(digests: Digest[], calendar: CalendarEvent[], trackRecord: string) {
  const seen = new Set<string>();
  const headlines: NewsItem[] = [];
  for (const d of digests) for (const n of d.news.slice(0, 25)) if (!seen.has(n.id) && (seen.add(n.id), true)) headlines.push(n);
  const list = headlines.slice(0, 60);
  const main = digests.find((d) => d.section === "interests") ?? digests[0];
  const briefs = digests
    .map((d) => {
      const a = d.analysis;
      const calls = a.outlook.map((o) => `  - ${o.interest} (${o.ticker}): ${o.action}, ${o.direction}, ${o.confidence}% · trigger: ${o.actionTrigger} · risks: ${o.risks}`).join("\n");
      return `## ${d.section.toUpperCase()} briefing (${d.generatedAt.slice(0, 16).replace("T", " ")} UTC)\n${a.headline}\n${a.summary.map((s) => `- ${s}`).join("\n")}${calls ? `\nCalls:\n${calls}` : ""}${a.movers?.length ? `\nMovers: ${a.movers.map((m) => `${m.ticker} ${m.changePct.toFixed(1)}% (${m.why})`).join("; ")}` : ""}`;
    })
    .join("\n\n");
  const text = `${briefs}

## Prices
${main ? quotesAsText(main.quotes) : "(n/a)"}

## Macro
${main?.macro ? macroAsText(main.macro) : "(n/a)"}

## Sectors
${main?.sectors ? sectorsAsText(main.sectors) : "(n/a)"}

## Upcoming
${calendarAsText(calendar)}

## Track record
${trackRecord}

## Headlines (cite as [n])
${list.map((n, i) => `[${i + 1}] ${n.title} (${n.source})`).join("\n")}`;
  const sources: AskSource[] = list.map((n, i) => ({ n: i + 1, title: n.title, link: n.link, source: n.source }));
  return { text, sources };
}

export function askSystemPrompt(lang: string): string {
  return `You are the analyst inside "Invest Helper", answering one investor's follow-up questions about today's market news.
Rules:
- Use ONLY the context below plus well-known general market knowledge. If the context doesn't cover it, say so plainly.
- Lead with a direct answer and a stance (e.g. "Lean: wait until after Thursday's CPI"), then 2-4 short supporting points citing headlines as [n].
- Give a confidence % and one specific thing that would change your view.
- Be concise: under 170 words. Plain text, short paragraphs or "- " bullets. No tables, no headers.
- Reply in ${langInfo(lang).english}.`;
}

export async function ask(question: string, history: ChatMessage[], digests: Digest[], calendar: CalendarEvent[], trackRecord: string, lang: string) {
  const ctx = buildAskContext(digests, calendar, trackRecord);
  const system = `${askSystemPrompt(lang)}\n\n# CONTEXT\n${ctx.text}`;
  const messages: ChatMessage[] = [...history.slice(-6), { role: "user", content: question }];
  const { text, provider } = await complete(system, messages);
  const cited = new Set([...text.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])));
  return { answer: text, provider, sources: ctx.sources.filter((s) => cited.has(s.n)) };
}
