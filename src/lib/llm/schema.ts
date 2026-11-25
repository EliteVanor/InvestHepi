/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { PLAYBOOK } from "../analogs";
import type { Analysis } from "../types";

/** The model sometimes copies a playbook tag ("inflation_hot") as the event name: swap in the plain description. */
export function analogEventName(event: string, date?: string): string {
  if (!/^[a-z]+(_[a-z]+)+$/.test(event.trim())) return event;
  const all = PLAYBOOK.filter((p) => p.type === event.trim());
  return (all.find((p) => p.date === date) ?? all[0])?.event ?? event.replace(/_/g, " ");
}

// Kept free of min/max constraints so it works as a Claude structured-output schema too.
const Direction = z.enum(["up", "down", "flat"]);

export const AnalysisSchema = z.object({
  headline: z.string().describe("One sentence: the single most important takeaway for the user's stocks today."),
  mood: z.enum(["risk-on", "risk-off", "mixed"]),
  summary: z.array(z.string()).describe("3-6 bullets summarizing the main events, most important first."),
  events: z
    .array(
      z.object({
        title: z.string(),
        what_happened: z.string(),
        why_it_matters: z.string(),
        importance: z.number().describe("1-5, 5 = market-moving"),
        source_ids: z.array(z.number()).describe("Headline numbers [n] this event is based on"),
        impacts: z.array(
          z.object({
            interest: z.string().describe("Exact interest name"),
            direction: Direction,
            magnitude: z.enum(["small", "moderate", "large"]),
            confidence: z.number().describe("0-100"),
            reasoning: z.string(),
          }),
        ),
        analog: z
          .object({
            event: z.string(),
            date: z.string(),
            what_happened_next: z.string(),
          })
          .nullable(),
        what_could_go_wrong: z.string(),
      }),
    )
    .describe("3-6 key events, most important first"),
  watch_next: z.array(z.string()).describe("Upcoming catalysts with dates if known"),
  movers: z
    .array(
      z.object({
        ticker: z.string(),
        change_pct: z.number().describe("Last-session % change from the snapshot"),
        why: z.string().describe("Most likely reason from the headlines, or 'No clear news catalyst'"),
        source_ids: z.array(z.number()).optional().describe("Numbers of the headlines that explain this move; [] if none"),
      }),
    )
    .describe("1-4 of the user's tickers that moved most last session. Empty outside the interests section."),
  scenarios: z
    .array(
      z.object({
        catalyst: z.string().describe("The scheduled event, e.g. 'October CPI'"),
        when: z.string().describe("Date and time, e.g. 'Thu Nov 26, 8:30 ET'"),
        cases: z.array(
          z.object({
            label: z.string().describe("e.g. 'Hot', 'In line', 'Cool'"),
            probability: z.number().describe("0-100; the cases sum to about 100"),
            reaction: z.string().describe("Expected reaction of the user's interests"),
            action: z.string().describe("What to do if this case happens"),
          }),
        ),
      }),
    )
    .describe("At most ONE scenario set, only if a major catalyst is within ~7 days. Otherwise empty."),
});

export type RawAnalysis = z.infer<typeof AnalysisSchema>;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));

const PLACEHOLDER = /^(n\/?a|none|null|nil|undefined|tbd|unknown|no data|not available|not applicable|[-\u2013\u2014.\u2026?_*\s]*)$/i;
/** Text that says something: not blank and not a placeholder like "N/A". */
export const hasText = (v: unknown): boolean => typeof v === "string" && !PLACEHOLDER.test(v.trim());

/** True when a reply carries a headline, a summary bullet or an event with real text. */
export function hasUsableContent(r: RawAnalysis): boolean {
  return hasText(r.headline) || (r.summary ?? []).some(hasText) || (r.events ?? []).some((e) => hasText(e.title) || hasText(e.what_happened));
}

/** One cited id as a number (a blank string is not 0); NaN when it isn't one. */
const idNumber = (x: unknown): number => (typeof x === "string" && x.trim() === "" ? NaN : Number(x));

/** Valid, de-duplicated headline indexes: integers in [0, count), at most `max`. */
export function clampSourceIds(ids: unknown, count: number, max = 8): number[] {
  const out: number[] = [];
  for (const x of Array.isArray(ids) ? ids : []) {
    const n = idNumber(x);
    if (Number.isInteger(n) && n >= 0 && n < count && !out.includes(n)) out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Turn a validated reply into an Analysis. `headlines` is how many headlines the model was shown:
 * cited ids outside that range are dropped. A reply with no usable content throws, so the caller
 * tries the next model (and finally the rule-based path) instead of storing an empty briefing.
 */
export function toAnalysis(r: RawAnalysis, headlines = Infinity): Analysis {
  if (!hasUsableContent(r)) throw new Error("model reply had no usable content (no headline, summary or events)");
  const ids = (v: unknown) => clampSourceIds(v, headlines);
  return {
    headline: r.headline,
    mood: r.mood,
    summary: r.summary ?? [],
    events: (r.events ?? []).map((e) => ({
      title: e.title,
      whatHappened: e.what_happened,
      whyItMatters: e.why_it_matters,
      importance: clamp(e.importance, 1, 5),
      sourceIds: ids(e.source_ids),
      impacts: (e.impacts ?? []).map((i) => ({ ...i, confidence: clamp(i.confidence, 0, 100) })),
      analog: e.analog ? { event: analogEventName(e.analog.event, e.analog.date), date: e.analog.date, whatHappenedNext: e.analog.what_happened_next } : null,
      whatCouldGoWrong: e.what_could_go_wrong,
    })),
    watchNext: r.watch_next ?? [],
    movers: (r.movers ?? []).map((m) => ({ ticker: m.ticker.toUpperCase(), changePct: Number(m.change_pct) || 0, why: m.why, sourceIds: ids(m.source_ids) })),
    scenarios: (r.scenarios ?? [])
      .filter((s) => s.catalyst && s.cases?.length >= 2)
      .slice(0, 1)
      .map((s) => {
        const cases = s.cases.slice(0, 4).map((c) => ({ label: c.label, probability: clamp(c.probability, 0, 100), reaction: c.reaction, action: c.action }));
        // Rescale so the estimates sum to 100.
        const sum = cases.reduce((a, c) => a + c.probability, 0) || 1;
        return { catalyst: s.catalyst, when: s.when, cases: cases.map((c) => ({ ...c, probability: Math.round((c.probability / sum) * 100) })) };
      }),
  };
}

/** Pull the first JSON object out of a model reply (handles ```json fences and stray prose). */
export function extractJSON(s: string): unknown {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("no JSON object in model reply");
  return JSON.parse(body.slice(start, end + 1));
}

/** Plain-text schema for providers without native structured output. */
export const SCHEMA_HINT = `Return ONLY a JSON object with exactly this shape:
{
  "headline": string,
  "mood": "risk-on" | "risk-off" | "mixed",
  "summary": string[3-6],
  "events": [{
    "title": string, "what_happened": string, "why_it_matters": string,
    "importance": 1-5, "source_ids": number[],
    "impacts": [{ "interest": string, "direction": "up"|"down"|"flat", "magnitude": "small"|"moderate"|"large", "confidence": 0-100, "reasoning": string }],
    "analog": { "event": string, "date": string, "what_happened_next": string } | null,
    "what_could_go_wrong": string
  }],
  "watch_next": string[],
  "movers": [{ "ticker": string, "change_pct": number, "why": string, "source_ids": number[] }],
  "scenarios": [{ "catalyst": string, "when": string, "cases": [{ "label": string, "probability": 0-100, "reaction": string, "action": string }] }]
}`;

/** Repair common free-model JSON slips (string numbers, wrong case, missing arrays) before validation. */
export function normalizeRaw(input: unknown): unknown {
  const o = (input ?? {}) as Record<string, any>;
  const arr = (v: unknown) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const num = (v: unknown, d = 50) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const str = (v: unknown) => (v == null ? "" : String(v));
  const dir = (v: unknown) => {
    const s = str(v).toLowerCase();
    return s.startsWith("up") || s === "bullish" ? "up" : s.startsWith("down") || s === "bearish" ? "down" : "flat";
  };
  const mood = str(o.mood).toLowerCase().replace(/\s+/g, "-");
  return {
    headline: str(o.headline),
    mood: ["risk-on", "risk-off", "mixed"].includes(mood) ? mood : "mixed",
    summary: arr(o.summary).map(str),
    events: arr(o.events).map((e: any) => ({
      title: str(e?.title),
      what_happened: str(e?.what_happened),
      why_it_matters: str(e?.why_it_matters),
      importance: num(e?.importance, 3),
      source_ids: arr(e?.source_ids).map(idNumber).filter((x) => Number.isInteger(x)),
      impacts: arr(e?.impacts).map((i: any) => ({
        interest: str(i?.interest),
        direction: dir(i?.direction),
        magnitude: ["small", "moderate", "large"].includes(str(i?.magnitude).toLowerCase()) ? str(i?.magnitude).toLowerCase() : "moderate",
        confidence: num(i?.confidence),
        reasoning: str(i?.reasoning),
      })),
      analog: e?.analog && typeof e.analog === "object"
        ? { event: str(e.analog.event), date: str(e.analog.date), what_happened_next: str(e.analog.what_happened_next) }
        : null,
      what_could_go_wrong: str(e?.what_could_go_wrong),
    })),
    watch_next: arr(o.watch_next).map(str),
    movers: arr(o.movers).map((m: any) => ({ ticker: str(m?.ticker), change_pct: num(m?.change_pct, 0), why: str(m?.why), source_ids: arr(m?.source_ids).map(idNumber).filter((x: number) => Number.isInteger(x) && x >= 0) })),
    scenarios: arr(o.scenarios).map((s: any) => ({
      catalyst: str(s?.catalyst),
      when: str(s?.when),
      cases: arr(s?.cases).map((c: any) => ({ label: str(c?.label), probability: num(String(c?.probability ?? "").replace("%", ""), 0), reaction: str(c?.reaction), action: str(c?.action) })),
    })),
  };
}
