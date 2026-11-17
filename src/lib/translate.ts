/**
 * Translate a finished briefing instead of regenerating it. Only the human-readable text is sent
 * (headline, summary, event write-ups, call rationales, scenarios), about a quarter of the tokens
 * of a full analysis, and every number, ticker and call stays identical across languages.
 * Translations are cached per briefing version and language, so each one is paid for once.
 */
import { langInfo } from "./languages";
import { complete } from "./llm";
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

/**
 * Translate text slots in place, chunk by chunk, through the translate route. Returns the provider id.
 * Throws if no AI provider can do it.
 */
export async function translateSlots(slots: { text: string; set: Setter }[], lang: string, what = "a stock-market briefing and news headlines"): Promise<string> {
  if (!slots.length) return "";
  const target = langInfo(lang).english;
  const system = `You translate ${what} into ${target}. You get a JSON array of strings. Return ONLY a JSON array with the same number of strings, in the same order, each translated into natural, concise ${target} as a financial journalist would write it. Keep tickers, numbers, percentages, dates, index and company names, and units exactly as they are. Do not add, merge, drop or explain anything.`;
  // One chunk at a time: Groq counts tokens per minute, and parallel chunks would trip it.
  const results: { chunk: typeof slots; out: string[]; provider: string }[] = [];
  for (const chunk of chunkSlots(slots)) {
    const texts = chunk.map((s) => s.text);
    const json = JSON.stringify(texts);
    const { text, provider } = await complete(system, [{ role: "user", content: json }], {
      route: "translate",
      maxTokens: translateBudget(json.length),
      timeoutMs: 20_000,
      accept: (t) => parseTranslations(t, texts.length) != null,
    });
    results.push({ chunk, out: parseTranslations(text, texts.length)!, provider });
  }
  for (const { chunk, out } of results) out.forEach((v, i) => chunk[i].set(v));
  return results[0].provider;
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
export async function translateDigest(d: Digest, lang: string): Promise<Digest> {
  const copy: Digest = JSON.parse(JSON.stringify(d));
  const slots = [...textSlots(copy.analysis), ...headlineSlots(copy.news ?? [], copy.analysis, lang)];
  if (!slots.length) return { ...copy, language: lang };
  const provider = await translateSlots(slots, lang);
  return { ...copy, language: lang, translatedFrom: d.language, translatedBy: provider.split(":")[0] };
}
