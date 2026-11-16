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

/**
 * Groq's free tier rejects any request whose input + reserved output exceeds the model's
 * tokens-per-minute limit (8,000 for gpt-oss-120b). Override with GROQ_TPM if your tier differs.
 */
export function tokenBudget(p: CompatProvider): number | undefined {
  if (p.id !== "groq") return undefined;
  return Number(process.env.GROQ_TPM) || 8000;
}

export function outputTokens(p: CompatProvider): number {
  return Number(process.env.LLM_MAX_TOKENS) || (p.id === "groq" ? 3000 : 8192);
}

/** Conservative token estimate (~3 chars per token for English + JSON; real counts are usually lower). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3);

/** The model comes from models.ts, which holds every default. */
export function groqProvider(model: string): CompatProvider | null {
  const key = process.env.GROQ_API_KEY;
  return key ? { id: "groq", baseUrl: "https://api.groq.com/openai/v1", model, key } : null;
}

export function geminiProvider(model: string): CompatProvider | null {
  const key = process.env.GEMINI_API_KEY;
  return key ? { id: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model, key } : null;
}

/** A provider refusal with what the budget tracker needs: status and how long to back off. */
export class ProviderError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterSec?: number, readonly body = "") {
    super(message);
  }
}

/** Tokens a reply cost: the provider's count, or an estimate if it didn't send one. */
export interface Usage {
  tokens: number;
}

function usageOf(j: { usage?: { total_tokens?: number } }, sent: string, got: string): Usage {
  const n = Number(j?.usage?.total_tokens);
  return { tokens: Number.isFinite(n) && n > 0 ? n : estimateTokens(sent + got) };
}

/** Reasoning knobs per model family (gpt-oss: low effort; qwen3: thinking off for plain tasks). */
function reasoning(p: CompatProvider, plain: boolean): Record<string, string> {
  if (p.id !== "groq") return {};
  if (p.model.includes("gpt-oss")) return { reasoning_effort: process.env.GROQ_REASONING || "low" };
  if (p.model.includes("qwen") && plain) return { reasoning_effort: "none" };
  return {};
}

async function post(p: CompatProvider, body: Record<string, unknown>, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const send = (b: Record<string, unknown>) =>
      fetch(`${p.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
        body: JSON.stringify(b),
        signal: ctrl.signal,
      });
    let res = await send(body);
    // A model that doesn't take the reasoning knob says so with a 400: retry once without it.
    if (res.status === 400 && "reasoning_effort" in body) {
      const text = await res.clone().text();
      if (/reasoning/i.test(text)) {
        const { reasoning_effort: _drop, ...rest } = body;
        res = await send(rest);
      }
    }
    if (!res.ok) {
      const text = (await res.text()).slice(0, 400);
      const ra = Number(res.headers.get("retry-after"));
      const hint = res.status === 429 || res.status === 413 ? " (free-tier rate or size limit; the next provider will be tried)" : "";
      throw new ProviderError(`${p.id} HTTP ${res.status}${hint}: ${text.slice(0, 300)}`, res.status, Number.isFinite(ra) && ra > 0 ? ra : undefined, text);
    }
    return res;
  } finally {
    clearTimeout(t);
  }
}

export async function analyzeWithCompat(p: CompatProvider, system: string, user: string): Promise<{ raw: RawAnalysis; usage: Usage }> {
  const sys = `${system}\n\n${SCHEMA_HINT}`;
  const res = await post(
    p,
    {
      model: p.model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      // Free tiers count max_tokens against tokens-per-minute, so keep it tight.
      max_tokens: outputTokens(p),
      ...reasoning(p, false),
    },
    120_000,
  );
  const j = await res.json();
  const content: string = j?.choices?.[0]?.message?.content ?? "";
  const usage = usageOf(j, sys + user, content);
  const parsed = AnalysisSchema.safeParse(normalizeRaw(extractJSON(content)));
  if (!parsed.success) throw Object.assign(new Error(`${p.id} returned JSON that doesn't match the schema: ${parsed.error.issues[0]?.message}`), { usage });
  return { raw: parsed.data, usage };
}

/** Plain-text answer (Ask AI, translations). */
export async function completeWithCompat(p: CompatProvider, system: string, messages: { role: "user" | "assistant"; content: string }[], maxTokens = 1500, timeoutMs = 60_000): Promise<{ text: string; usage: Usage }> {
  const res = await post(p, { model: p.model, messages: [{ role: "system", content: system }, ...messages], max_tokens: maxTokens, ...reasoning(p, true) }, timeoutMs);
  const j = await res.json();
  const text: string = (j?.choices?.[0]?.message?.content ?? "").trim();
  const usage = usageOf(j, system + messages.map((m) => m.content).join(""), text);
  if (!text) throw Object.assign(new Error(`${p.id} returned an empty answer`), { usage });
  return { text, usage };
}
