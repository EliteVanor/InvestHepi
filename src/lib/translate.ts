/**
 * Translate a finished briefing instead of regenerating it. Only the human-readable text is sent
 * (headline, summary, event write-ups, call rationales, scenarios), about a quarter of the tokens
 * of a full analysis, and every number, ticker and call stays identical across languages.
 * Translations are cached per briefing version and language, so each one is paid for once.
 */
import { langInfo } from "./languages";
import { complete } from "./llm";
import type { Analysis, Digest } from "./types";

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
  for (const o of a.outlook) {
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

/** A copy of `d` with its text in `lang`. Throws if no AI provider can do it. */
export async function translateDigest(d: Digest, lang: string): Promise<Digest> {
  const copy: Digest = JSON.parse(JSON.stringify(d));
  const slots = textSlots(copy.analysis);
  if (!slots.length) return { ...copy, language: lang };
  const target = langInfo(lang).english;
  const system = `You translate a stock-market briefing into ${target}. You get a JSON array of strings. Return ONLY a JSON array with the same number of strings, in the same order, each translated into natural, concise ${target} as a financial journalist would write it. Keep tickers, numbers, percentages, dates, index and company names, and units exactly as they are. Do not add, merge, drop or explain anything.`;
  const { text, provider } = await complete(system, [{ role: "user", content: JSON.stringify(slots.map((s) => s.text)) }]);
  const out = parseTranslations(text, slots.length);
  if (!out) throw new Error("translation came back malformed");
  out.forEach((v, i) => slots[i].set(v));
  return { ...copy, language: lang, translatedFrom: d.language, translatedBy: provider.split(":")[0] };
}
