/**
 * Free-tier providers that speak the OpenAI chat-completions format (Groq, Gemini).
 * Plain fetch keeps the dependency list short.
 */
import { AnalysisSchema, SCHEMA_HINT, extractJSON, normalizeRaw, type RawAnalysis } from "./schema";

export interface CompatProvider {
  id: string;
  baseUrl: string;
  model: string;
  key: string;
}

export function groqProvider(): CompatProvider | null {
  const key = process.env.GROQ_API_KEY;
  return key ? { id: "groq", baseUrl: "https://api.groq.com/openai/v1", model: process.env.GROQ_MODEL || "openai/gpt-oss-120b", key } : null;
}

export function geminiProvider(): CompatProvider | null {
  const key = process.env.GEMINI_API_KEY;
  return key
    ? { id: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: process.env.GEMINI_MODEL || "gemini-flash-latest", key }
    : null;
}

export async function analyzeWithCompat(p: CompatProvider, system: string, user: string): Promise<RawAnalysis> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
      body: JSON.stringify({
        model: p.model,
        messages: [
          { role: "system", content: `${system}\n\n${SCHEMA_HINT}` },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        // Free tiers count max_tokens against tokens-per-minute, so keep it tight.
        max_tokens: Number(process.env.LLM_MAX_TOKENS) || (p.id === "groq" ? 4096 : 8192),
        ...(p.id === "groq" && p.model.includes("gpt-oss") ? { reasoning_effort: process.env.GROQ_REASONING || "low" } : {}),
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      const hint = res.status === 429 || res.status === 413 ? " (free-tier rate or size limit; the next provider will be tried)" : "";
      throw new Error(`${p.id} HTTP ${res.status}${hint}: ${body}`);
    }
    const j = await res.json();
    const content: string = j?.choices?.[0]?.message?.content ?? "";
    const parsed = AnalysisSchema.safeParse(normalizeRaw(extractJSON(content)));
    if (!parsed.success) throw new Error(`${p.id} returned JSON that doesn't match the schema: ${parsed.error.issues[0]?.message}`);
    return parsed.data;
  } finally {
    clearTimeout(t);
  }
}
