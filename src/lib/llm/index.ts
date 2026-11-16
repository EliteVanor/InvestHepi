/**
 * Provider chains per job ("route", see models.ts). Each model is skipped while it's cooling down
 * after a 429 or near its daily allowance; every call's token count is recorded. If every model in
 * the route fails, briefings fall back to the rule-based analysis (the caller decides whether to
 * show it or keep the last AI briefing).
 * LLM_PROVIDER=claude|groq|gemini|rules forces one provider family to the front.
 */
import type { Analysis } from "../types";
import { CLAUDE_MODEL, analyzeWithClaude, completeWithClaude } from "./claude";
import { analyzeWithCompat, completeWithCompat, estimateTokens, outputTokens, tokenBudget, ProviderError, type CompatProvider } from "./openai-compat";
import { available, chainFor, recordRefusal, recordUsage, type ModelDef, type Route } from "./models";
import { SCHEMA_HINT } from "./schema";
import { buildSystemPrompt, buildUserPrompt, type PromptInput } from "./prompt";
import { analyzeWithRules } from "./rules";
import { toAnalysis } from "./schema";

export type { Route } from "./models";

interface Step {
  id: string;
  compact: boolean;
  provider?: CompatProvider;
  def?: ModelDef;
  run: (system: string, user: string) => Promise<{ analysis: Analysis; tokens: number }>;
}

function forcedOrder<T extends { id: string }>(steps: T[]): T[] {
  const forced = process.env.LLM_PROVIDER?.toLowerCase();
  if (!forced) return steps;
  if (forced === "rules") return [];
  return [...steps].sort((a, b) => Number(b.id.startsWith(forced)) - Number(a.id.startsWith(forced)));
}

export function providerChain(route: Route = "shared"): Step[] {
  const steps: Step[] = [];
  if (process.env.ANTHROPIC_API_KEY) {
    steps.push({ id: `claude:${CLAUDE_MODEL}`, compact: false, run: async (s, u) => ({ analysis: toAnalysis(await analyzeWithClaude(s, u)), tokens: 0 }) });
  }
  for (const def of chainFor(route)) {
    const p = def.provider;
    steps.push({
      id: `${p.id}:${p.model}`,
      compact: true,
      provider: p,
      def,
      run: async (s, u) => {
        const r = await analyzeWithCompat(p, s, u);
        return { analysis: toAnalysis(r.raw), tokens: r.usage.tokens };
      },
    });
  }
  return forcedOrder(steps);
}

/** Run one model step with budget checks and bookkeeping. Throws with a short reason on skip/failure. */
async function guarded<T>(def: ModelDef | undefined, route: Route, run: () => Promise<{ value: T; tokens: number }>): Promise<T> {
  if (def) {
    const av = await available(def, route);
    if (!av.ok) throw new Error(`skipped (${av.why})`);
  }
  try {
    const { value, tokens } = await run();
    if (def) await recordUsage(def, route, tokens, true);
    return value;
  } catch (e) {
    if (def) {
      if (e instanceof ProviderError) await recordRefusal(def, e.status, e.retryAfterSec, e.body);
      // A reply that came back but was unusable still cost tokens.
      const spent = (e as { usage?: { tokens: number } }).usage?.tokens;
      if (spent) await recordUsage(def, route, spent, false);
    }
    throw e;
  }
}

/**
 * Build the prompt, and for providers with a hard request-size limit (Groq free tier) drop
 * headlines until input + reserved output fits, with ~6% headroom for estimate error.
 */
export function fitPrompt(input: PromptInput, step: { compact: boolean; provider?: CompatProvider }) {
  const budget = step.provider ? tokenBudget(step.provider) : undefined;
  const build = (maxHeadlines?: number) => {
    const opts = { compact: step.compact, maxHeadlines };
    return { system: buildSystemPrompt(input, opts), user: buildUserPrompt(input, opts), maxHeadlines };
  };
  if (!budget || !step.provider) return build();
  const limit = budget * 0.94 - outputTokens(step.provider);
  // The schema hint is appended to the system prompt by the compat client, so count it too.
  const size = (p: { system: string; user: string }) => estimateTokens(p.system + SCHEMA_HINT + p.user);
  for (const n of [30, 24, 18, 14, 10, 6]) {
    const p = build(n);
    if (size(p) <= limit) return p;
  }
  return build(4);
}

export async function analyze(input: PromptInput, route: Route = "shared"): Promise<{ analysis: Analysis; provider: string; note?: string }> {
  const failures: string[] = [];
  for (const step of providerChain(route)) {
    try {
      const { system, user } = fitPrompt(input, step);
      const analysis = await guarded(step.def, route, async () => {
        const r = await step.run(system, user);
        return { value: r.analysis, tokens: r.tokens };
      });
      return { analysis, provider: step.id, note: failures.length ? `Fell back after: ${failures.join("; ")}` : undefined };
    } catch (e) {
      failures.push(`${step.id}: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  return {
    analysis: analyzeWithRules(input.news, input.interests, input.quotes),
    provider: "rules",
    note: failures.length
      ? `All AI providers failed: ${failures.join("; ")}`
      : "No AI key configured. Add a free GROQ_API_KEY or GEMINI_API_KEY for real analysis.",
  };
}

export type ChatMessage = { role: "user" | "assistant"; content: string };

export interface CompleteOptions {
  /** Which job this is (picks the model order). Default: Ask AI. */
  route?: Route;
  maxTokens?: number;
  /** Per-provider timeout, so a slow provider still leaves time for the next one (Vercel stops at 60 s). */
  timeoutMs?: number;
  /** Reject a reply (malformed, truncated) and move on to the next provider instead of failing. */
  accept?: (text: string) => boolean;
}

/** Free-form text completion through a route's chain (no rule-based fallback). */
export async function complete(system: string, messages: ChatMessage[], opts: CompleteOptions = {}): Promise<{ text: string; provider: string }> {
  const route = opts.route ?? "ask";
  const failures: string[] = [];
  const chain: { id: string; def?: ModelDef; run: () => Promise<{ value: string; tokens: number }> }[] = [];
  if (process.env.ANTHROPIC_API_KEY) chain.push({ id: `claude:${CLAUDE_MODEL}`, run: async () => ({ value: await completeWithClaude(system, messages, opts.maxTokens), tokens: 0 }) });
  for (const def of chainFor(route)) {
    const p = def.provider;
    chain.push({
      id: `${p.id}:${p.model}`,
      def,
      run: async () => {
        const r = await completeWithCompat(p, system, messages, opts.maxTokens, opts.timeoutMs);
        if (opts.accept && !opts.accept(r.text)) throw Object.assign(new Error("reply rejected (malformed or cut off)"), { usage: r.usage });
        return { value: r.text, tokens: r.usage.tokens };
      },
    });
  }
  for (const step of forcedOrder(chain)) {
    try {
      return { text: await guarded(step.def, route, step.run), provider: step.id };
    } catch (e) {
      failures.push(`${step.id}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  throw new Error(chain.length ? `All AI providers failed: ${failures.join("; ")}` : "NO_PROVIDER");
}
