/**
 * Provider chain. Order: Claude (if ANTHROPIC_API_KEY) → Groq → Gemini → rule-based.
 * LLM_PROVIDER=claude|groq|gemini|rules forces one provider to the front.
 * If a provider fails (rate limit, outage, bad JSON) the next one is tried.
 */
import type { Analysis } from "../types";
import { CLAUDE_MODEL, analyzeWithClaude } from "./claude";
import { analyzeWithCompat, geminiProvider, groqProvider } from "./openai-compat";
import { buildUserPrompt, SYSTEM_PROMPT, type PromptInput } from "./prompt";
import { analyzeWithRules } from "./rules";
import { toAnalysis } from "./schema";

interface Step {
  id: string;
  run: (system: string, user: string) => Promise<Analysis>;
}

export function providerChain(): Step[] {
  const steps: Step[] = [];
  if (process.env.ANTHROPIC_API_KEY) {
    steps.push({ id: `claude:${CLAUDE_MODEL}`, run: async (s, u) => toAnalysis(await analyzeWithClaude(s, u)) });
  }
  for (const p of [groqProvider(), geminiProvider()]) {
    if (p) steps.push({ id: `${p.id}:${p.model}`, run: async (s, u) => toAnalysis(await analyzeWithCompat(p, s, u)) });
  }
  const forced = process.env.LLM_PROVIDER?.toLowerCase();
  if (forced) {
    if (forced === "rules") return [];
    steps.sort((a, b) => Number(b.id.startsWith(forced)) - Number(a.id.startsWith(forced)));
  }
  return steps;
}

export async function analyze(input: PromptInput): Promise<{ analysis: Analysis; provider: string; note?: string }> {
  const user = buildUserPrompt(input);
  const failures: string[] = [];
  for (const step of providerChain()) {
    try {
      const analysis = await step.run(SYSTEM_PROMPT, user);
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
