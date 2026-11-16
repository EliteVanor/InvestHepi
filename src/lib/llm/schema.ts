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
  outlook: z
    .array(
      z.object({
        interest: z.string(),
        ticker: z.string(),
        direction: Direction,
        confidence: z.number().describe("0-100, calibrated probability the direction call is right"),
        horizon: z.enum(["today", "this week"]),
        action: z.enum(["BUY", "ADD", "HOLD", "WAIT", "TRIM", "SELL", "AVOID"]),
        action_trigger: z.string().describe("Concrete condition, e.g. 'Add if SOXX holds above yesterday's low after CPI'"),
        rationale: z.string(),
        risks: z.string(),
      }),
    )
    .describe("One entry per interest (benchmark ticker), plus entries for individual tickers with direct news"),
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

export function toAnalysis(r: RawAnalysis): Analysis {
  return {
    headline: r.headline,
    mood: r.mood,
    summary: r.summary ?? [],
    events: (r.events ?? []).map((e) => ({
      title: e.title,
      whatHappened: e.what_happened,
      whyItMatters: e.why_it_matters,
      importance: clamp(e.importance, 1, 5),
      sourceIds: e.source_ids ?? [],
      impacts: (e.impacts ?? []).map((i) => ({ ...i, confidence: clamp(i.confidence, 0, 100) })),
      analog: e.analog ? { event: analogEventName(e.analog.event, e.analog.date), date: e.analog.date, whatHappenedNext: e.analog.what_happened_next } : null,
      whatCouldGoWrong: e.what_could_go_wrong,
    })),
    outlook: (r.outlook ?? []).map((o) => ({
      interest: o.interest,
      ticker: o.ticker.toUpperCase(),
      direction: o.direction,
      confidence: clamp(o.confidence, 0, 100),
      horizon: o.horizon,
      action: o.action,
      actionTrigger: o.action_trigger,
      rationale: o.rationale,
      risks: o.risks,
    })),
    watchNext: r.watch_next ?? [],
    movers: (r.movers ?? []).map((m) => ({ ticker: m.ticker.toUpperCase(), changePct: Number(m.change_pct) || 0, why: m.why, sourceIds: m.source_ids ?? [] })),
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
  "outlook": [{ "interest": string, "ticker": string, "direction": "up"|"down"|"flat", "confidence": 0-100, "horizon": "today"|"this week", "action": "BUY"|"ADD"|"HOLD"|"WAIT"|"TRIM"|"SELL"|"AVOID", "action_trigger": string, "rationale": string, "risks": string }],
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
  const actions = ["BUY", "ADD", "HOLD", "WAIT", "TRIM", "SELL", "AVOID"];
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
      source_ids: arr(e?.source_ids).map((x) => num(x, 0)),
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
    outlook: arr(o.outlook).map((x: any) => ({
      interest: str(x?.interest),
      ticker: str(x?.ticker),
      direction: dir(x?.direction),
      confidence: num(x?.confidence),
      horizon: str(x?.horizon).toLowerCase().includes("week") ? "this week" : "today",
      action: actions.includes(str(x?.action).toUpperCase()) ? str(x?.action).toUpperCase() : "WAIT",
      action_trigger: str(x?.action_trigger),
      rationale: str(x?.rationale),
      risks: str(x?.risks),
    })),
    watch_next: arr(o.watch_next).map(str),
    movers: arr(o.movers).map((m: any) => ({ ticker: str(m?.ticker), change_pct: num(m?.change_pct, 0), why: str(m?.why), source_ids: arr(m?.source_ids).map((x: unknown) => Number(x)).filter((x: number) => Number.isInteger(x) && x >= 0) })),
    scenarios: arr(o.scenarios).map((s: any) => ({
      catalyst: str(s?.catalyst),
      when: str(s?.when),
      cases: arr(s?.cases).map((c: any) => ({ label: str(c?.label), probability: num(String(c?.probability ?? "").replace("%", ""), 0), reaction: str(c?.reaction), action: str(c?.action) })),
    })),
  };
}
