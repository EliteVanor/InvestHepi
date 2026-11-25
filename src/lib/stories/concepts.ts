/**
 * Concept cards (v19b D7, owner Q15 decision 10): plain-language explainers of the terms a story flags
 * (`StoryCard.concepts`). Written by a second small AI call right after the story call in the same run, so
 * readers never wait; at most CONCEPTS_DAILY_LIMIT new ones a day app-wide; stored forever
 * (`concept:<slug>`); translated once per language (`concept:<slug>:<lang>`) with the briefing translator.
 * Concepts are optional: nothing here throws.
 *
 *   concept:<slug>           the concept in the language it was written in
 *   concept:<slug>:<lang>    its translation, forever
 *   concepts:new:<UTC date>  how many new concepts were written that day
 */
import { z } from "zod";
import { generateJSON, type Route } from "../llm";
import { getJSON, releaseLock, setJSON, takeLock } from "../store";
import { waitUntil } from "../lock-wait";
import { translateSlots } from "../translate";
import { conceptSlug } from "./view";

export { conceptSlug };

export interface Concept {
  slug: string;
  term: string;
  /** 2-3 sentences, no jargon, for a reader with no finance background. */
  plain: string;
  /** One concrete example. */
  example?: string;
  lang: string;
  writtenAt: string;
}

export const conceptKey = (slug: string) => `concept:${slug}`;
export const conceptTrKey = (slug: string, lang: string) => `concept:${slug}:${lang}`;
export const conceptCountKey = (now: Date) => `concepts:new:${now.toISOString().slice(0, 10)}`;
export const conceptsDailyLimit = () => {
  const raw = process.env.CONCEPTS_DAILY_LIMIT;
  const n = Number(raw);
  return raw && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 10;
};

// Kept free of min/max constraints so it works as a Claude structured-output schema too.
export const ConceptsSchema = z.object({
  concepts: z.array(z.object({ term: z.string(), plain: z.string(), example: z.string().optional() })),
});
export const CONCEPTS_HINT = `Return ONLY JSON: {"concepts":[{"term":"<the term as given>","plain":"<2-3 plain sentences>","example":"<one concrete example>"}]}, one entry per term, in the same order.`;
const CONCEPTS_MAX_TOKENS_EACH = 220;

const systemFor = (lang: "en" | "vi") =>
  `You write short concept cards for a news site. Each card explains one term from the news to a curious reader with no finance background. Write in ${lang === "vi" ? "Vietnamese" : "English"}. For each term: "plain" is 2-3 sentences in everyday words, no jargon, no hype, no market predictions; "example" is one concrete everyday example. Do not state figures, dates or facts about today's events, only how the idea works.`;

/**
 * Write the new concepts among `terms` (one AI call) within today's app-wide budget. Returns the slugs now
 * available (already stored and newly written, for the terms given). Never throws.
 */
export async function writeConcepts(terms: string[], lang: "en" | "vi", route: Route, now: Date): Promise<string[]> {
  try {
    const bySlug = new Map<string, string>();
    for (const t of terms) {
      const slug = conceptSlug(String(t ?? ""));
      if (slug && !bySlug.has(slug)) bySlug.set(slug, String(t).trim());
    }
    const order = [...bySlug.keys()];
    const have = new Set<string>();
    const missing: [string, string][] = [];
    await Promise.all(
      [...bySlug].map(async ([slug, term]) => {
        const stored = await getJSON<Concept>(conceptKey(slug)).catch(() => null);
        if (stored) have.add(slug);
        else missing.push([slug, term]);
      }),
    );
    missing.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
    const used = (await getJSON<{ n: number }>(conceptCountKey(now)).catch(() => null))?.n ?? 0;
    const todo = missing.slice(0, Math.max(0, conceptsDailyLimit() - used));
    if (!todo.length) return order.filter((s) => have.has(s));

    const list = todo.map(([, t], i) => `${i + 1}. ${t}`).join("\n");
    const { value } = await generateJSON(route, {
      build: () => ({ system: systemFor(lang), user: `Terms:\n${list}` }),
      hint: CONCEPTS_HINT,
      parse: (raw) => ConceptsSchema.parse(raw),
      maxTokens: CONCEPTS_MAX_TOKENS_EACH * todo.length + 200,
    });
    const writtenAt = now.toISOString();
    let saved = 0;
    for (let i = 0; i < todo.length; i++) {
      const [slug, term] = todo[i];
      const r = value.concepts.find((c) => conceptSlug(c.term) === slug) ?? value.concepts[i];
      if (!r?.plain?.trim()) continue;
      const concept: Concept = { slug, term, plain: r.plain.trim(), ...(r.example?.trim() ? { example: r.example.trim() } : {}), lang, writtenAt };
      await setJSON(conceptKey(slug), concept);
      have.add(slug);
      saved++;
    }
    if (saved) await setJSON(conceptCountKey(now), { n: used + saved }, 3 * 86400);
    return order.filter((s) => have.has(s));
  } catch {
    return [];
  }
}

/** A concept's translatable text in a fixed order (term, plain, example). */
const conceptSlots = (c: Concept) => {
  const out = [
    { text: c.term, set: (v: string) => void (c.term = v) },
    { text: c.plain, set: (v: string) => void (c.plain = v) },
  ];
  if (c.example) out.push({ text: c.example, set: (v: string) => void (c.example = v) });
  return out;
};

/**
 * The stored concepts for `slugs` in `lang`, in order. A concept written in another language is translated
 * once (all that need it in one request) and cached at `concept:<slug>:<lang>` for good; unknown slugs and
 * concepts whose translation fails are skipped. Never throws.
 */
export async function loadConcepts(slugs: string[], lang: string): Promise<Concept[]> {
  const unique = [...new Set(slugs)];
  const out = new Map<string, Concept>();
  const todo: Concept[] = [];
  await Promise.all(
    unique.map(async (slug) => {
      const base = await getJSON<Concept>(conceptKey(slug)).catch(() => null);
      if (!base) return;
      if (base.lang === lang) return void out.set(slug, base);
      const cached = await getJSON<Concept>(conceptTrKey(slug, lang)).catch(() => null);
      if (cached) return void out.set(slug, cached);
      todo.push(JSON.parse(JSON.stringify(base)));
    }),
  );
  if (todo.length) {
    // One translation per slug and language across instances: take a lock per concept; the ones another
    // instance holds are read from its cached result after ours is done.
    const locks = await Promise.all(todo.map(async (c) => ({ c, key: `${conceptTrKey(c.slug, lang)}:lock`, token: await takeLock(`${conceptTrKey(c.slug, lang)}:lock`, 90) })));
    const mine: typeof locks = [];
    for (const l of locks.filter((l) => l.token)) {
      const done = await getJSON<Concept>(conceptTrKey(l.c.slug, lang)).catch(() => null); // finished just before our lock
      if (done) out.set(l.c.slug, done);
      mine.push(l);
    }
    const toTranslate = mine.filter((l) => !out.has(l.c.slug));
    const theirs = locks.filter((l) => !l.token).map((l) => l.c.slug);
    try {
      if (toTranslate.length) {
        const cards = toTranslate.map((l) => l.c);
        const ok = await translateSlots(cards.flatMap(conceptSlots), lang, "short plain-language explanations of terms from the news").then(() => true, () => false);
        if (ok) {
          await Promise.all(
            cards.map(async (c) => {
              c.lang = lang;
              out.set(c.slug, c);
              await setJSON(conceptTrKey(c.slug, lang), c).catch(() => {});
            }),
          );
        }
      }
    } finally {
      await Promise.all(mine.map((l) => releaseLock(l.key, l.token!).catch(() => {})));
    }
    if (theirs.length) {
      const cachedAll = async () => (await Promise.all(theirs.map((s) => getJSON(conceptTrKey(s, lang))))).every(Boolean);
      await waitUntil(cachedAll);
      await Promise.all(
        theirs.map(async (slug) => {
          const cached = await getJSON<Concept>(conceptTrKey(slug, lang)).catch(() => null);
          if (cached) out.set(slug, cached);
        }),
      );
    }
  }
  return unique.flatMap((s) => (out.has(s) ? [out.get(s)!] : []));
}
