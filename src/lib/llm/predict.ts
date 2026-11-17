/**
 * The prediction job's prompt and schema (predictions.ts runs it). Separate from briefings: a
 * prediction is only the calls (direction, confidence, action, trigger, rationale, risks), made from
 * prices, technicals, headlines and the track record, and graded at a known close.
 */
import { z } from "zod";
import { calendarAsText } from "../calendar";
import { levelText, macroAsText } from "../market";
import { MARKET_CITY, lastFinishedSession, localNow, type Phase } from "../markets";
import { symLabel } from "../symbols";
import { technicalsAsText, type Technicals } from "../technicals";
import type { CalendarEvent, Interest, NewsItem, Quote } from "../types";
import { VN_RULES } from "./prompt";

const Direction = z.enum(["up", "down", "flat"]);

export const PredictionSchema = z.object({
  calls: z.array(
    z.object({
      interest: z.string(),
      ticker: z.string(),
      horizon: z.enum(["today", "this week"]),
      direction: Direction,
      confidence: z.number(),
      action: z.enum(["BUY", "ADD", "HOLD", "WAIT", "TRIM", "SELL", "AVOID"]),
      action_trigger: z.string(),
      rationale: z.string(),
      risks: z.string(),
    }),
  ),
});
export type RawPrediction = z.infer<typeof PredictionSchema>;

export const PREDICT_HINT = `Return ONLY a JSON object with exactly this shape:
{ "calls": [{ "interest": string, "ticker": string, "horizon": "today"|"this week", "direction": "up"|"down"|"flat", "confidence": 0-100, "action": "BUY"|"ADD"|"HOLD"|"WAIT"|"TRIM"|"SELL"|"AVOID", "action_trigger": string, "rationale": string, "risks": string }] }`;

/** Repair common free-model slips (string numbers, wrong case, a bare array) before validation. */
export function normalizePrediction(input: unknown): unknown {
  const o = (Array.isArray(input) ? { calls: input } : (input ?? {})) as Record<string, unknown>;
  const list = Array.isArray(o.calls) ? o.calls : Array.isArray(o.outlook) ? o.outlook : [];
  const str = (v: unknown) => (v == null ? "" : String(v));
  const actions = ["BUY", "ADD", "HOLD", "WAIT", "TRIM", "SELL", "AVOID"];
  return {
    calls: list.map((x: Record<string, unknown>) => {
      const d = str(x?.direction).toLowerCase();
      return {
        interest: str(x?.interest),
        ticker: str(x?.ticker).toUpperCase(),
        horizon: str(x?.horizon).toLowerCase().includes("week") ? "this week" : "today",
        direction: d.startsWith("up") || d === "bullish" ? "up" : d.startsWith("down") || d === "bearish" ? "down" : "flat",
        confidence: Number.isFinite(Number(x?.confidence)) ? Number(x?.confidence) : 50,
        action: actions.includes(str(x?.action).toUpperCase()) ? str(x?.action).toUpperCase() : "WAIT",
        action_trigger: str(x?.action_trigger),
        rationale: str(x?.rationale),
        risks: str(x?.risks),
      };
    }),
  };
}

export function parsePrediction(raw: unknown): RawPrediction {
  const p = PredictionSchema.safeParse(normalizePrediction(raw));
  if (!p.success) throw new Error(`prediction JSON doesn't match the schema: ${p.error.issues[0]?.message}`);
  return p.data;
}

export const PREDICT_RULES = `You are the forecaster inside "InvestHepi". You make short calls on where each market will close, and every call is graded.

How you are graded:
- A "today" call is graded at TODAY'S CLOSE on the ticker's own exchange, measured from the starting price stated in the snapshot (the previous close before the open; during the session, the price "now").
- A "this week" call is graded at the close of the 5th trading day counting today, measured from the previous close.
- "up" / "down" is right when that close is above / below the starting price. A move smaller than the ticker's usual range counts as no result. "flat" is right only when the move stays inside that range.
- Your track record (below) shows how this has gone. Use it: lower confidence where your record at that level or on that ticker is weak.

How to think:
- Start from what moves prices: expected rates and yields, earnings and guidance, AI spending, tariffs and export controls, liquidity, flows. Ask what is NEW versus already priced in; the snapshot shows what has already moved.
- Most headlines don't matter. Weigh them by expected price impact; a story covered by many outlets is usually bigger.
- Confidence is a calibrated probability that the direction is right (50 = coin flip, 60-65 = a real edge, 75+ = rare). Same-day index moves are close to random: keep most "today" calls between 50 and 65 unless something specific and new drives them.
- Use TECHNICALS to make triggers concrete (20/50/200-day average, 20-day range). RSI above 70 or below 30 argues against chasing.
- Price levels: only quote a level that appears in the snapshot. Where a market says "level unknown" or has no TECHNICALS line, write triggers as % moves. Data marked "unavailable" is unknown: don't fill it from memory.
- A pending catalyst before the close (CPI, FOMC, earnings) argues for WAIT or lower confidence. Only give dates that appear in UPCOMING CATALYSTS or a headline.
- Actions: BUY/ADD = favorable entry now; HOLD = keep positions; WAIT = setup unclear or a catalyst is pending; TRIM/SELL = reduce; AVOID = stay out.
- The action must agree with the direction: "up" goes with BUY, ADD, HOLD or WAIT; "down" with SELL, TRIM, AVOID or WAIT (HOLD only for a position the investor holds); "flat" with HOLD or WAIT.
- If POSITIONS are given, word actions for this investor (held: HOLD/ADD/TRIM/SELL; not held: BUY/WAIT/AVOID).
- Only use facts from the headlines and snapshots. If headlines are thin, say so in the rationale and lower confidence.
- action_trigger: one concrete condition with a level or % move. rationale: 1-2 sentences naming what drives the call. risks: one specific thing that would make it wrong. Plain words, no hype.`;

export interface PredictInput {
  /** Market groups to call (each group's first ticker is its benchmark). */
  interests: Interest[];
  phase: Phase;
  /** The market's clock, for the "now" line and graded times. */
  tz: string;
  /** Vietnam rules apply. */
  vn: boolean;
  quotes: Quote[];
  /** Per ticker: the live price and its move since the previous close, when the session is open. */
  live: Map<string, { price: number; chg: number; at: number }>;
  /** Tickers whose graded session has already opened (their daily call starts from "now"). */
  opened: Set<string>;
  macro: Quote[];
  macroWanted: string[];
  technicals: Record<string, Technicals>;
  calendar: CalendarEvent[];
  news: NewsItem[];
  trackRecord: string;
  positions?: string;
  /** Graded sessions: today's session and the weekly end, local dates. */
  today: string;
  weekEnd: string;
  now: Date;
}

const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const dayName = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const f = (n: number) => (Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(1)}%` : "n/a");

export { lastFinishedSession } from "../markets";

/** One snapshot line per ticker, with the starting price its daily call is measured from. */
export function predictionSnapshot(p: Pick<PredictInput, "quotes" | "live" | "opened" | "tz"> & { now?: Date }): string {
  if (!p.quotes.length) return "(price data unavailable)";
  return p.quotes
    .map((q) => {
      const h = q.history;
      const wk = h.length > 5 ? ((q.price - h[h.length - 6][1]) / h[h.length - 6][1]) * 100 : NaN;
      const name = symLabel(q.symbol);
      const label = `${q.symbol}${name !== q.symbol && !q.symbol.endsWith(".VN") ? ` (${name})` : ""}`;
      const live = p.live.get(q.symbol);
      let start: string;
      if (!p.opened.has(q.symbol)) start = `today's call starts from the previous close`;
      else if (live) start = `NOW ${live.price.toFixed(2)} (${f(live.chg)} today, at ${hhmm(localNow(live.at, p.tz).mins)}); today's call starts from this price`;
      else start = `session open but no live price: make no call on it`;
      // Daily closes are posted hours later by some sources: say so instead of passing an older close off as the latest.
      const want = p.now ? lastFinishedSession(q.symbol, p.now, q.proxy) : undefined;
      const last = h.at(-1)?.[0];
      const lag = want && last && last < want ? ` [the ${want} session's close isn't available yet: make no call on it]` : "";
      return `${label}: ${levelText(q)}${q.stale ? " [stale]" : ""}${lag} (last session ${f(q.changePct)}, 5d ${f(wk)}) | ${start}`;
    })
    .join("\n");
}

export function buildPredictSystem(p: Pick<PredictInput, "vn">): string {
  return `${PREDICT_RULES}${p.vn ? VN_RULES.replace(/- "today" means[^\n]*/, "") : ""}`;
}

export function buildPredictUser(p: PredictInput, maxHeadlines = 20): string {
  const local = localNow(p.now, p.tz);
  const city = MARKET_CITY[p.tz] ?? p.tz;
  const markets = p.interests.map((i) => `- ${i.name} (benchmark ${i.tickers[0]}${i.tickers.length > 1 ? `; also ${i.tickers.slice(1).join(", ")}` : ""})`).join("\n");
  const want =
    p.phase === "pre"
      ? `BEFORE-MARKET RUN. For each market give TWO calls on its benchmark: one "today" (graded at the close on ${dayName(p.today)}) and one "this week" (graded at the close on ${dayName(p.weekEnd)}, or the last session before it if that day is a holiday).`
      : `MID-DAY RUN. For each market give ONE "today" call on its benchmark (graded at the close on ${dayName(p.today)}, from the starting price shown). No "this week" calls.`;
  const headlines = p.news
    .slice(0, maxHeadlines)
    .map((n, i) => `[${i}] ${n.title} (${n.source}, ${n.publishedAt.slice(5, 16).replace("T", " ")} UTC)${n.alsoIn?.length ? ` [+${n.alsoIn.length} outlets]` : ""}`)
    .join("\n");
  return `Now: ${dayName(local.date)} ${hhmm(local.mins)} ${city} time.
${want}
Add a call for an individual ticker only if a headline is directly about it. Use the exact market names below as "interest".

MARKETS TO CALL:
${markets}

MARKET SNAPSHOT (each line ends with where today's call is measured from):
${predictionSnapshot(p)}

MACRO:
${macroAsText(p.macro, p.macroWanted)}

TECHNICALS:
${technicalsAsText(p.technicals)}
${p.positions ? `\nPOSITIONS (weights only):\n${p.positions}\n` : ""}
UPCOMING CATALYSTS:
${calendarAsText(p.calendar)}

YOUR TRACK RECORD:
${p.trackRecord}

LATEST HEADLINES (newest first):
${headlines || "(no headlines fetched)"}`;
}

/** Output budget: a call is ~120 tokens; a before-market run makes two per market. */
export const predictOutputTokens = (markets: number, phase: Phase) => Math.min(3000, 400 + markets * (phase === "pre" ? 2 : 1) * 170);

