/**
 * Provider chain. Order: Claude (if ANTHROPIC_API_KEY) → Groq → Gemini → rule-based.
 * LLM_PROVIDER=claude|groq|gemini|rules forces one provider to the front.
 * If a provider fails (rate limit, outage, bad JSON) the next one is tried.
 * Free providers get a compact prompt to stay under their tokens-per-minute limits.
 */
import type { Analysis } from "../types";
import { CLAUDE_MODEL, analyzeWithClaude, completeWithClaude } from "./claude";
import { analyzeWithCompat, completeWithCompat, estimateTokens, geminiProvider, groqProvider, outputTokens, tokenBudget, type CompatProvider } from "./openai-compat";
import { SCHEMA_HINT } from "./schema";
import { buildSystemPrompt, buildUserPrompt, type PromptInput } from "./prompt";
import { analyzeWithRules } from "./rules";
import { toAnalysis } from "./schema";

interface Step {
  id: string;
  compact: boolean;
  provider?: CompatProvider;
  run: (system: string, user: string) => Promise<Analysis>;
}

export function providerChain(): Step[] {
  const steps: Step[] = [];
  if (process.env.ANTHROPIC_API_KEY) {
    steps.push({ id: `claude:${CLAUDE_MODEL}`, compact: false, run: async (s, u) => toAnalysis(await analyzeWithClaude(s, u)) });
  }
  for (const p of [groqProvider(), geminiProvider()]) {
    if (p) steps.push({ id: `${p.id}:${p.model}`, compact: true, provider: p, run: async (s, u) => toAnalysis(await analyzeWithCompat(p, s, u)) });
  }
  const forced = process.env.LLM_PROVIDER?.toLowerCase();
  if (forced) {
    if (forced === "rules") return [];
    steps.sort((a, b) => Number(b.id.startsWith(forced)) - Number(a.id.startsWith(forced)));
  }
  return steps;
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

export async function analyze(input: PromptInput): Promise<{ analysis: Analysis; provider: string; note?: string }> {
  const failures: string[] = [];
  for (const step of providerChain()) {
    try {
      const { system, user } = fitPrompt(input, step);
      const analysis = await step.run(system, user);
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

/** Free-form text completion through the same provider chain (no rule-based fallback). */
export async function complete(system: string, messages: ChatMessage[]): Promise<{ text: string; provider: string }> {
  const failures: string[] = [];
  const forced = process.env.LLM_PROVIDER?.toLowerCase();
  const chain: { id: string; run: () => Promise<string> }[] = [];
  if (process.env.ANTHROPIC_API_KEY) chain.push({ id: `claude:${CLAUDE_MODEL}`, run: () => completeWithClaude(system, messages) });
  for (const p of [groqProvider(), geminiProvider()]) if (p) chain.push({ id: `${p.id}:${p.model}`, run: () => completeWithCompat(p, system, messages) });
  if (forced && forced !== "rules") chain.sort((a, b) => Number(b.id.startsWith(forced)) - Number(a.id.startsWith(forced)));
  for (const step of chain) {
    try {
      return { text: await step.run(), provider: step.id };
    } catch (e) {
      failures.push(`${step.id}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  throw new Error(chain.length ? `All AI providers failed: ${failures.join("; ")}` : "NO_PROVIDER");
}
