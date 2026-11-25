/**
 * Translate a finished briefing instead of regenerating it. Only the human-readable text is sent
 * (headline, summary, event write-ups, call rationales, scenarios), about a quarter of the tokens
 * of a full analysis, and every number, ticker and call stays identical across languages.
 * Translations are cached per briefing version and language, so each one is paid for once.
 */
import { createHash } from "node:crypto";
import { langInfo } from "./languages";
import { complete } from "./llm";
import { modelDef } from "./llm/models";
import { getJSON, setJSON } from "./store";
import type { Analysis, Digest, NewsItem, Outlook } from "./types";

type Setter = (v: string) => void;

/** Every translatable string in an analysis, with a setter to write the translation back. */
export function textSlots(a: Analysis): { text: string; set: Setter }[] {
  const out: { text: string; set: Setter }[] = [];
  const add = (text: string | undefined, set: Setter) => {
    if (typeof text === "string" && text.trim()) out.push({ text, set });
  };
  add(a.headline, (v) => (a.headline = v));
  a.summary.forEach((_, i) => add(a.summary[i], (v) => (a.summary[i] = v)));
  for (const e of a.events) {
    add(e.title, (v) => (e.title = v));
    add(e.whatHappened, (v) => (e.whatHappened = v));
    add(e.whyItMatters, (v) => (e.whyItMatters = v));
    add(e.whatCouldGoWrong, (v) => (e.whatCouldGoWrong = v));
    for (const im of e.impacts) add(im.reasoning, (v) => (im.reasoning = v));
    if (e.analog) {
      const an = e.analog;
      add(an.event, (v) => (an.event = v));
      add(an.whatHappenedNext, (v) => (an.whatHappenedNext = v));
    }
  }
  for (const o of a.outlook ?? []) {
    add(o.actionTrigger, (v) => (o.actionTrigger = v));
    add(o.rationale, (v) => (o.rationale = v));
    add(o.risks, (v) => (o.risks = v));
  }
  a.watchNext.forEach((_, i) => add(a.watchNext[i], (v) => (a.watchNext[i] = v)));
  for (const m of a.movers ?? []) add(m.why, (v) => (m.why = v));
  for (const s of a.scenarios ?? []) {
    add(s.catalyst, (v) => (s.catalyst = v));
    add(s.when, (v) => (s.when = v));
    for (const c of s.cases) {
      add(c.label, (v) => (c.label = v));
      add(c.reaction, (v) => (c.reaction = v));
      add(c.action, (v) => (c.action = v));
    }
  }
  return out;
}

/** Pull the JSON array of strings out of a model reply (tolerates code fences / chatter). Exported for tests. */
export function parseTranslations(text: string, n: number): string[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(arr) || arr.length !== n || !arr.every((x) => typeof x === "string")) return null;
    return arr;
  } catch {
    return null;
  }
}

/**
 * Split strings into chunks of about `maxChars`. One big request for a long briefing (the Vietnam tab
 * has 60+ strings) needed more output tokens than the reply was allowed, so it came back cut off.
 * Exported for tests.
 */
export function chunkSlots<T extends { text: string }>(slots: T[], maxChars = 2200): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let size = 0;
  for (const s of slots) {
    if (cur.length && size + s.text.length > maxChars) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(s);
    size += s.text.length + 4;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Output budget for translating `chars` characters of English: Vietnamese, Chinese, Japanese and
 * Korean take up to ~2-3x the tokens of the English, plus room for a reasoning model's thinking.
 */
export const translateBudget = (chars: number) => Math.ceil(chars * 0.8) + 800;

/** Headlines translated per briefing: the ones its events cite, plus the top of the list. */
export const TOP_HEADLINES = 20;

const VI_MARKS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;

/** Rough language of a headline: Vietnamese (diacritics), English (plain Latin), or other. Exported for tests. */
export function headlineLang(title: string): "vi" | "en" | "other" {
  if (VI_MARKS.test(title)) return "vi";
  const letters = title.replace(/[^\p{L}]/gu, "");
  const latin = letters.replace(/[^A-Za-z]/g, "");
  return letters.length && latin.length / letters.length > 0.95 ? "en" : "other";
}

/**
 * Headlines worth translating for a reader of `lang`: cited by an event or in the top 20, and not
 * already in that language (Vietnamese headlines on the Vietnam tab cost nothing for Vietnamese
 * readers). Exported for tests.
 */
export function headlineSlots(news: NewsItem[], a: Analysis, lang: string): { text: string; set: Setter }[] {
  const cited = new Set(a.events.flatMap((e) => e.sourceIds));
  return news
    .map((n, i) => ({ n, i }))
    .filter(({ n, i }) => (i < TOP_HEADLINES || cited.has(i)) && n.title?.trim() && headlineLang(n.title) !== lang)
    .map(({ n }) => ({
      text: n.title,
      set: (v: string) => {
        n.titleOrig = n.title;
        n.title = v;
      },
    }));
}

/** Chunks translated at once. Pacing (below) keeps their reserved tokens inside Groq's per-minute limit. */
export const TRANSLATE_CONCURRENCY = 2;
/** One chunk's time limit per provider, and how many providers the translate route can try (qwen, Flash-Lite 3.5, 3.1). */
export const TRANSLATE_TIMEOUT_MS = 20_000;
export const TRANSLATE_PROVIDERS = 3;
/** The translate route stops starting chunks this long after it starts (maxDuration is 60 s). */
export const TRANSLATE_ROUTE_BUDGET_MS = 50_000;
/** Finished chunks of a failed run are kept this long, so a retry only redoes the failed ones. */
const CHUNK_TTL_SEC = 24 * 3600;

/**
 * Longest a translation of `chunks` chunks can run: waves of chunks, each wave as long as every provider
 * timing out, capped by the budget after which no chunk is started (plus the chunks already running).
 * The cross-instance lock lives this long (+10 s), so a killed winner frees it soon after.
 */
export function translateWorstCaseMs(chunks: number, budgetMs = TRANSLATE_ROUTE_BUDGET_MS): number {
  const perChunk = TRANSLATE_PROVIDERS * TRANSLATE_TIMEOUT_MS;
  return Math.min(Math.ceil(chunks / TRANSLATE_CONCURRENCY) * perChunk, budgetMs + perChunk);
}

/** Clock and sleep of the pacing and the budgets; tests replace them with a fake clock. */
export const translateClock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
};

/** Reserved tokens (input plus the output budget) of chunks started in the current minute. */
const pace = { start: 0, reserved: 0 };
/** Groq counts the output budget against tokens per minute, so stay under ~94% of it. */
const paceLimit = () => Math.floor((Number(process.env.GROQ_TPM) || 8000) * 0.94);

/**
 * Wait until a chunk reserving `tokens` fits in the current minute (the window opens with its first
 * chunk and closes 60 s later). A chunk that does not fit either waits (`spill` false: the scheduler, which has
 * time and no reader) or is reported as "over" so the caller sends it to a provider with no per-minute limit
 * (`spill`: a reader is waiting). "late" = the wait would pass `deadline`.
 */
async function pacedStart(tokens: number, deadline: number, spill: boolean): Promise<"ok" | "over" | "late"> {
  for (;;) {
    const now = translateClock.now();
    if (now - pace.start >= 60_000) {
      pace.start = now;
      pace.reserved = 0;
    }
    if (pace.reserved === 0 || pace.reserved + tokens <= paceLimit()) {
      pace.reserved += tokens;
      return "ok";
    }
    if (spill) return "over";
    const until = pace.start + 60_000;
    if (until > deadline) return "late";
    await translateClock.sleep(Math.max(1, until - now));
  }
}

/** A translation that failed after `done` of `total` chunks were finished and kept. */
export class TranslateError extends Error {
  constructor(message: string, readonly done: number, readonly total: number) {
    super(message);
  }
}

/**
 * Translate text slots in place, in chunks, two at a time and paced to the minute's token limit (with a
 * reader waiting, `onFull` "spill": the overflow goes to Flash-Lite at once; the scheduler uses "wait"),
 * through the translate route. Returns the provider id. No new chunk starts after `budgetMs`. When the
 * run fails (a chunk fails, or the budget ran out) nothing is written to the slots, the finished chunks
 * are stored (`trc:<hash of language, instructions and text>`, 24 h), and a TranslateError says how
 * many were done, so a retry only pays for the rest. Throws if no AI provider can do it.
 */
export async function translateSlots(slots: { text: string; set: Setter }[], lang: string, what = "a stock-market briefing and news headlines", budgetMs = TRANSLATE_ROUTE_BUDGET_MS, onFull: "spill" | "wait" = "spill"): Promise<string> {
  if (!slots.length) return "";
  const target = langInfo(lang).english;
  const system = `You translate ${what} into ${target}. You get a JSON array of strings. Return ONLY a JSON array with the same number of strings, in the same order, each translated into natural, concise ${target} as a financial journalist would write it. Keep tickers, numbers, percentages, dates, index and company names, and units exactly as they are. Do not add, merge, drop or explain anything.`;
  const deadline = translateClock.now() + budgetMs;
  const chunks = chunkSlots(slots);
  const results: ({ out: string[]; provider: string } | undefined)[] = chunks.map(() => undefined);
  const keys: string[] = [];
  let next = 0;
  let stop: Error | null = null;
  const worker = async () => {
    while (!stop && next < chunks.length) {
      const i = next++;
      const texts = chunks[i].map((s) => s.text);
      const json = JSON.stringify(texts);
      const ck = (keys[i] = `trc:${createHash("sha1").update(`${lang}\n${what}\n${json}`).digest("hex")}`);
      const kept = await getJSON<{ out: string[]; provider: string }>(ck).catch(() => null);
      if (kept && kept.out?.length === texts.length) {
        results[i] = kept;
        continue;
      }
      const reserve = Math.ceil((system.length + json.length) / 3) + translateBudget(json.length);
      // With a reader waiting, a chunk that would pass the minute's tokens goes to Flash-Lite (no per-minute
      // limit; counted in its usage) instead of waiting.
      const canSpill = onFull === "spill" && (modelDef("gem35") != null || modelDef("gem31") != null);
      const slot = translateClock.now() >= deadline ? "late" : await pacedStart(reserve, deadline, canSpill);
      if (slot === "late") {
        stop ??= new Error("out of time");
        return;
      }
      try {
        const { text, provider } = await complete(system, [{ role: "user", content: json }], {
          route: "translate",
          maxTokens: translateBudget(json.length),
          timeoutMs: TRANSLATE_TIMEOUT_MS,
          skip: slot === "over" ? ["qwen"] : undefined,
          accept: (t) => parseTranslations(t, texts.length) != null,
        });
        results[i] = { out: parseTranslations(text, texts.length)!, provider };
      } catch (e) {
        stop ??= e as Error; // stop starting chunks; the ones in flight finish and are kept
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(TRANSLATE_CONCURRENCY, chunks.length) }, worker));
  if (stop || results.some((r) => !r)) {
    const done = results.filter(Boolean).length;
    await Promise.all(results.map((r, i) => r && setJSON(keys[i], r, CHUNK_TTL_SEC).catch(() => {})));
    throw new TranslateError(`translation incomplete (${done}/${chunks.length} chunks): ${(stop as Error | null)?.message ?? "unknown"}`, done, chunks.length);
  }
  chunks.forEach((chunk, i) => results[i]!.out.forEach((v, j) => chunk[j].set(v)));
  return results.find((r) => r!.provider)!.provider;
}

/** The translatable text of prediction calls (trigger, rationale, risks). */
export function outlookSlots(list: Outlook[]): { text: string; set: Setter }[] {
  const out: { text: string; set: Setter }[] = [];
  for (const o of list) {
    if (o.actionTrigger?.trim()) out.push({ text: o.actionTrigger, set: (v) => (o.actionTrigger = v) });
    if (o.rationale?.trim()) out.push({ text: o.rationale, set: (v) => (o.rationale = v) });
    if (o.risks?.trim()) out.push({ text: o.risks, set: (v) => (o.risks = v) });
  }
  return out;
}

/** A copy of `d` with its text (and its main headlines) in `lang`. Throws if no AI provider can do it. */
export async function translateDigest(d: Digest, lang: string, budgetMs = TRANSLATE_ROUTE_BUDGET_MS, onFull: "spill" | "wait" = "spill"): Promise<Digest> {
  const copy: Digest = JSON.parse(JSON.stringify(d));
  const slots = [...textSlots(copy.analysis), ...headlineSlots(copy.news ?? [], copy.analysis, lang)];
  if (!slots.length) return { ...copy, language: lang };
  const provider = await translateSlots(slots, lang, undefined, budgetMs, onFull);
  return { ...copy, language: lang, translatedFrom: d.language, translatedBy: provider.split(":")[0] };
}
