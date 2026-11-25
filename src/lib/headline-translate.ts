/**
 * Live headlines in the reader's language. Each headline is translated once per language and kept
 * (`tr:hl:<id>:<lang>`, 3 days); a request sends only the titles with no kept translation, in one
 * batch through the chunked translator. A failure returns the list as it was: news never errors.
 */
import { isLang } from "./languages";
import { createHash } from "node:crypto";
import { waitUntil } from "./lock-wait";
import { getJSON, releaseLock, setJSON, takeLock } from "./store";
import { detectLang } from "./stories/cluster";
import { translateSlots } from "./translate";
import type { NewsItem } from "./types";

export const hlKey = (id: string, lang: string) => `tr:hl:${id}:${lang}`;
const TTL_SEC = 3 * 86400;
/**
 * New titles translated per request; the rest wait for the next poll (page asks every 5 min).
 * Cost: a section adds ~60-100 new headlines a day, x ~50 tokens a title (in + out) = 3-5K tokens per
 * section per language per day, once per headline whatever the number of readers.
 */
export const HEADLINE_TRANSLATE_CAP = 40;
/** The route's share of the 60 s function: the translator starts no chunk after this. */
const BUDGET_MS = 40_000;

/** Whether a title is already in `lang` as far as we can tell (only English and Vietnamese are detected; any other target always translates). */
export const alreadyIn = (title: string, lang: string) => (lang === "en" || lang === "vi") && detectLang(title) === lang;

type Kept = { o: string; t: string };

/**
 * `items` with titles in `lang` where a translation exists (`titleOrig` keeps the original). Titles
 * without one are translated if `mayStart()` allows a new batch (it is asked once, only when a
 * batch would be sent). Never throws.
 */
export async function translateHeadlines(items: NewsItem[], lang: string, mayStart: () => Promise<boolean> = async () => true): Promise<NewsItem[]> {
  try {
    if (!isLang(lang) || !items.length) return items;
    const out = items.map((n) => ({ ...n }));
    const need = new Set<NewsItem>();
    await Promise.all(
      out.map(async (n) => {
        if (!n.title?.trim() || n.titleOrig || alreadyIn(n.title, lang)) return;
        const kept = await getJSON<Kept>(hlKey(n.id, lang)).catch(() => null);
        if (kept && kept.o === n.title && typeof kept.t === "string") {
          n.titleOrig = n.title;
          n.title = kept.t;
        } else need.add(n);
      }),
    );
    const batch = out.filter((n) => need.has(n)).slice(0, HEADLINE_TRANSLATE_CAP);
    if (!batch.length) return out;
    // One translation per batch across instances: the loser waits briefly, then returns what is cached.
    const lockKey = `tr:hl:lock:${lang}:${createHash("sha1").update(batch.map((n) => n.id).join("|")).digest("hex").slice(0, 16)}`;
    const token = await takeLock(lockKey, Math.ceil(BUDGET_MS / 1000) + 20);
    if (!token) {
      const cached = async () => Promise.all(batch.map(async (n) => (await getJSON<Kept>(hlKey(n.id, lang)).catch(() => null))?.o === n.title));
      await waitUntil(async () => (await cached()).every(Boolean));
      await Promise.all(
        batch.map(async (n) => {
          const kept = await getJSON<Kept>(hlKey(n.id, lang)).catch(() => null);
          if (kept && kept.o === n.title && typeof kept.t === "string") {
            n.titleOrig = n.title;
            n.title = kept.t;
          }
        }),
      );
      return out;
    }
    try {
      // The previous holder may have finished between our cache read and our lock: use its result.
      const fresh: NewsItem[] = [];
      await Promise.all(
        batch.map(async (n) => {
          const kept = await getJSON<Kept>(hlKey(n.id, lang)).catch(() => null);
          if (kept && kept.o === n.title && typeof kept.t === "string") {
            n.titleOrig = n.title;
            n.title = kept.t;
          } else fresh.push(n);
        }),
      );
      return fresh.length ? await translateBatch(out, batch.filter((n) => fresh.includes(n)), lang, mayStart) : out;
    } finally {
      await releaseLock(lockKey, token).catch(() => {});
    }
  } catch (e) {
    console.error("headline translation failed:", e);
    return items;
  }
}

async function translateBatch(out: NewsItem[], batch: NewsItem[], lang: string, mayStart: () => Promise<boolean>): Promise<NewsItem[]> {
  {
    if (!(await mayStart())) return out;
    const done: { id: string; o: string; t: string }[] = [];
    const slots = batch.map((n) => ({
      text: n.title,
      set: (v: string) => {
        done.push({ id: n.id, o: n.title, t: v });
        n.titleOrig = n.title;
        n.title = v;
      },
    }));
    try {
      await translateSlots(slots, lang, "news headlines", BUDGET_MS);
    } catch (e) {
      console.error("headline translation failed:", e);
      return out; // nothing was written to the slots on failure
    }
    await Promise.all(done.map((d) => setJSON(hlKey(d.id, lang), { o: d.o, t: d.t } satisfies Kept, TTL_SEC).catch(() => {})));
    return out;
  }
}
