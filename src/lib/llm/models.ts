/**
 * Which AI model does which job, and how much of each free daily allowance is left.
 *
 * Groq's limits are per model (gpt-oss-120b, gpt-oss-20b and qwen each get 200K tokens a day), and
 * Gemini's Flash-Lite models allow 500 requests a day each. Each job ("route") has its own order.
 * Predictions (the graded calls) get gpt-oss-120b; briefings (summary, events, movers, scenarios)
 * start on Gemini Flash-Lite so 120b's daily tokens go to predictions:
 *   predShared   World/US/Vietnam predictions: 120b → Flash-Lite 3.5 → 3.1 → 20b (last resort)
 *   predAdmin    the admin's interest-set predictions: 120b → 20b → Flash-Lite
 *   predUser     users' predictions: 120b (only beyond the reserve below) → 20b → Flash-Lite
 *   shared       World/US/Vietnam briefings: Flash-Lite 3.5 → 3.1 → 120b → 20b
 *   adminAuto    the admin's interest briefing on the schedule: Flash-Lite 3.5 → 3.1 → 120b → 20b
 *   adminManual  the admin's refresh button: same order
 *   userAuto     users' briefings on the schedule: Flash-Lite 3.5 → 3.1 → 20b → 120b (beyond the reserve)
 *   userManual   users' refresh button: Flash-Lite 3.5 → 3.1 → 20b
 *   translate    qwen → Flash-Lite 3.5 → 3.1 (never the briefing models)
 *   ask          Ask AI: 20b → 120b
 * Claude goes first everywhere when ANTHROPIC_API_KEY is set.
 *
 * Usage is counted from the token totals each reply returns, per model per day (Groq: UTC day;
 * Gemini resets at midnight Pacific). The counters aren't atomic: concurrent calls can undercount a
 * little, which the 3% headroom absorbs. A 429 puts the model on a cooldown (Retry-After, or longer
 * when the provider says the daily quota is gone) so we stop knocking on a closed door.
 */
import { getJSON, setJSON } from "../store";
import { plannedPerDay } from "../timetable";
import { geminiProvider, groqProvider, type CompatProvider } from "./openai-compat";
import { dayIn } from "../dates";

export type ModelKey = "groq120" | "groq20" | "qwen" | "gem35" | "gem31";
export type Route = "predShared" | "predAdmin" | "predUser" | "shared" | "adminAuto" | "adminManual" | "userAuto" | "userManual" | "translate" | "ask";

export const ROUTES: Record<Route, ModelKey[]> = {
  predShared: ["groq120", "gem35", "gem31", "groq20"],
  predAdmin: ["groq120", "groq20", "gem35", "gem31"],
  predUser: ["groq120", "groq20", "gem35", "gem31"],
  shared: ["gem35", "gem31", "groq120", "groq20"],
  adminAuto: ["gem35", "gem31", "groq120", "groq20"],
  adminManual: ["gem35", "gem31", "groq120", "groq20"],
  userAuto: ["gem35", "gem31", "groq20", "groq120"],
  userManual: ["gem35", "gem31", "groq20"],
  translate: ["qwen", "gem35", "gem31"],
  ask: ["groq20", "groq120"],
};

export interface ModelDef {
  key: ModelKey;
  provider: CompatProvider;
  tokensPerDay?: number;
  requestsPerDay?: number;
  /** Time zone of the provider's daily reset. */
  dayTz: string;
}

const num = (v: string | undefined, d: number) => Number(v) || d;

export function modelDef(key: ModelKey): ModelDef | null {
  const groq = (model: string): ModelDef | null => {
    const p = groqProvider(model);
    return p ? { key, provider: p, tokensPerDay: num(process.env.GROQ_TPD, 200_000), requestsPerDay: 1000, dayTz: "UTC" } : null;
  };
  const gemini = (model: string): ModelDef | null => {
    const p = geminiProvider(model);
    return p ? { key, provider: p, requestsPerDay: num(process.env.GEMINI_RPD, 500), dayTz: "America/Los_Angeles" } : null;
  };
  switch (key) {
    case "groq120":
      return groq(process.env.GROQ_MODEL || "openai/gpt-oss-120b");
    case "groq20":
      return groq(process.env.GROQ_SMALL_MODEL || "openai/gpt-oss-20b");
    case "qwen":
      return groq(process.env.GROQ_TRANSLATE_MODEL || "qwen/qwen3.8-27b");
    case "gem35":
      return gemini(process.env.GEMINI_MODEL || "gemini-3.5-flash-lite");
    case "gem31":
      return gemini(process.env.GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite");
  }
}

/* ------------------------------------------------------------- usage */

export interface ModelUsage {
  day: string;
  tokens: number;
  requests: number;
  /** Successful runs per route today (drives the shared/admin prediction reserve on 120b). */
  byRoute: Partial<Record<Route, number>>;
  cooldownUntil?: number;
  lastError?: string;
}

const usageKey = (k: ModelKey) => `llm:usage:${k}`;

export async function loadUsage(def: ModelDef, now = new Date()): Promise<ModelUsage> {
  const day = dayIn(def.dayTz, now);
  const u = await getJSON<ModelUsage>(usageKey(def.key)).catch(() => null);
  if (u && u.day === day) return u;
  // New day: counters reset, but a cooldown set late yesterday still applies until it ends.
  return { day, tokens: 0, requests: 0, byRoute: {}, cooldownUntil: u?.cooldownUntil };
}

/** Read-modify-write of a model's counters one at a time per instance (parallel translation chunks would lose counts). */
const usageQueue = new Map<ModelKey, Promise<unknown>>();
function serialized<T>(key: ModelKey, fn: () => Promise<T>): Promise<T> {
  const run = (usageQueue.get(key) ?? Promise.resolve()).then(fn, fn);
  usageQueue.set(key, run.catch(() => {}));
  return run;
}

export function recordUsage(def: ModelDef, route: Route, tokens: number, ok: boolean, now = new Date()): Promise<void> {
  return serialized(def.key, async () => {
    const u = await loadUsage(def, now);
    u.tokens += Math.max(0, Math.round(tokens));
    u.requests += 1;
    if (ok) u.byRoute[route] = (u.byRoute[route] ?? 0) + 1;
    await setJSON(usageKey(def.key), u).catch(() => {});
  });
}

/** After a refusal: back off for Retry-After, or an hour when the daily quota itself is spent. */
export async function recordRefusal(def: ModelDef, status: number, retryAfterSec: number | undefined, body: string, now = new Date()): Promise<void> {
  const u = await loadUsage(def, now);
  u.lastError = `${status} ${body.slice(0, 160)}`;
  if (status === 429) {
    const daily = /per day|\bTPD\b|\bRPD\b|PerDay|daily/i.test(body);
    const sec = Math.min(Math.max(retryAfterSec ?? (daily ? 3600 : 60), daily ? 900 : 20), 6 * 3600);
    u.cooldownUntil = now.getTime() + sec * 1000;
  }
  await setJSON(usageKey(def.key), u).catch(() => {});
}

/* ------------------------------------------------------------ budget */

/** Shared and admin predictions the timetable runs today (UTC) on 120b first: see timetable.ts. */
export function scheduledPerDay(now = new Date()): { shared: number; admin: number } {
  return plannedPerDay(now);
}

/** A prediction run costs about 5K tokens (a briefing about 7K); used until today's average is known. */
const AVG_RUN_TOKENS = 6000;

/**
 * Tokens on 120b that users' automatic jobs must leave alone: the shared and admin predictions still
 * due today, at today's measured average cost per request.
 */
export function reserveFor120(u: ModelUsage, now = new Date()): number {
  const plan = scheduledPerDay(now);
  const done = (r: Route) => u.byRoute[r] ?? 0;
  const left = Math.max(0, plan.shared - done("predShared")) + Math.max(0, plan.admin - done("predAdmin"));
  const runs = Object.values(u.byRoute).reduce((a, b) => a + (b ?? 0), 0);
  const avg = runs >= 2 && u.tokens > 0 ? Math.max(3000, u.tokens / u.requests) : AVG_RUN_TOKENS;
  return left * avg;
}

/** Whether `route` may call this model now: not cooling down, and under 97% of the daily allowance. */
export async function available(def: ModelDef, route: Route, now = new Date()): Promise<{ ok: boolean; why?: string }> {
  const u = await loadUsage(def, now);
  if (u.cooldownUntil && u.cooldownUntil > now.getTime()) return { ok: false, why: `cooling down until ${new Date(u.cooldownUntil).toISOString().slice(11, 16)} UTC` };
  if (def.tokensPerDay && u.tokens >= def.tokensPerDay * 0.97) return { ok: false, why: "daily tokens used up" };
  if (def.requestsPerDay && u.requests >= def.requestsPerDay * 0.97) return { ok: false, why: "daily requests used up" };
  if (def.key === "groq120" && (route === "userAuto" || route === "predUser") && def.tokensPerDay) {
    const room = def.tokensPerDay * 0.97 - u.tokens - reserveFor120(u, now);
    if (room < AVG_RUN_TOKENS) return { ok: false, why: "kept for shared and admin predictions" };
  }
  return { ok: true };
}

/** The models a route will try, in order, that have a key configured. */
export function chainFor(route: Route): ModelDef[] {
  return ROUTES[route].map(modelDef).filter((d): d is ModelDef => d != null);
}

/** Admin view: per model, today's use against its allowance. */
export async function usageReport(now = new Date()) {
  const keys: ModelKey[] = ["groq120", "groq20", "qwen", "gem35", "gem31"];
  const out = [];
  for (const k of keys) {
    const def = modelDef(k);
    if (!def) continue;
    const u = await loadUsage(def, now);
    out.push({
      key: k,
      model: def.provider.model,
      day: u.day,
      tokens: u.tokens,
      tokensPerDay: def.tokensPerDay,
      requests: u.requests,
      requestsPerDay: def.requestsPerDay,
      byRoute: u.byRoute,
      cooldownUntil: u.cooldownUntil && u.cooldownUntil > now.getTime() ? new Date(u.cooldownUntil).toISOString() : undefined,
      lastError: u.lastError,
    });
  }
  return out;
}
