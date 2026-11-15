/**
 * Provider chain. Order: Claude (if ANTHROPIC_API_KEY) → Groq → Gemini → rule-based.
 * LLM_PROVIDER=claude|groq|gemini|rules forces one provider to the front.
 * If a provider fails (rate limit, outage, bad JSON) the next one is tried.
 * Free providers get a compact prompt to stay under their tokens-per-minute limits.
 */
import type { Analysis } from "../types";
import { CLAUDE_MODEL, analyzeWithClaude, completeWithClaude } from "./claude";
import { analyzeWithCompat, completeWithCompat, geminiProvider, groqProvider } from "./openai-compat";
import { buildSystemPrompt, buildUserPrompt, type PromptInput } from "./prompt";
import { analyzeWithRules } from "./rules";
import { toAnalysis } from "./schema";

interface Step {
  id: string;
  compact: boolean;
  run: (system: string, user: string) => Promise<Analysis>;
}

export function providerChain(): Step[] {
  const steps: Step[] = [];
  if (process.env.ANTHROPIC_API_KEY) {
    steps.push({ id: `claude:${CLAUDE_MODEL}`, compact: false, run: async (s, u) => toAnalysis(await analyzeWithClaude(s, u)) });
  }
  for (const p of [groqProvider(), geminiProvider()]) {
    if (p) steps.push({ id: `${p.id}:${p.model}`, compact: true, run: async (s, u) => toAnalysis(await analyzeWithCompat(p, s, u)) });
  }
  const forced = process.env.LLM_PROVIDER?.toLowerCase();
  if (forced) {
    if (forced === "rules") return [];
    steps.sort((a, b) => Number(b.id.startsWith(forced)) - Number(a.id.startsWith(forced)));
  }
  return steps;
}

export async function analyze(input: PromptInput): Promise<{ analysis: Analysis; provider: string; note?: string }> {
  const failures: string[] = [];
  for (const step of providerChain()) {
    try {
      const opts = { compact: step.compact };
      const analysis = await step.run(buildSystemPrompt(input, opts), buildUserPrompt(input, opts));
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
