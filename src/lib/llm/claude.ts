import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AnalysisSchema, type RawAnalysis } from "./schema";

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

export async function analyzeWithClaude(system: string, user: string): Promise<RawAnalysis> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  const msg = await client.beta.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: {
      effort: (process.env.CLAUDE_EFFORT as "low" | "medium" | "high") || "medium",
      format: zodOutputFormat(AnalysisSchema),
    },
    // If a request is declined by a safety classifier, retry on a fallback model chosen by the API.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  if (msg.stop_reason === "refusal") throw new Error("Claude declined the request");
  if (msg.stop_reason === "max_tokens") throw new Error("Claude reply was cut off (max_tokens)");
  if (!msg.parsed_output) throw new Error("Claude returned no parseable output");
  return msg.parsed_output;
}
