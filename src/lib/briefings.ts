/**
 * Stored briefings: where they live, how readers get them (translated, rule-based copy, history),
 * and how a new one is saved.
 *
 *   digest:<section>:<lang>   shared sections (World, US, Vietnam), the same for everyone
 *   ib:<hash>                 an interest set's briefing (hash from interests.ts)
 *   <prefix>:last             { at, provider, ok } of the latest run
 *   <prefix>:history, :<ts>   the last 10 versions
 *   <prefix>:rules, :aifail   rule-based copy and the failed AI run (an AI briefing is never replaced by rules)
 *   tr:<prefix>:<lang>        translation of the current version
 */
import { OWNER, currentUid } from "./context";
import { isLang } from "./languages";
import { translateDigest } from "./translate";
import { delJSON, getJSON, setJSON } from "./store";
import type { Digest, DigestMeta, SectionId } from "./types";
import { currentInterestSet } from "./interests";

const HISTORY_SIZE = 10;

/** Storage prefix for a briefing: ib:<hash> for interests, digest:<section>:<lang> for shared ones. */
export function prefixFor(section: SectionId, lang: string, hash?: string): string {
  return section === "interests" ? `ib:${hash}` : `digest:${section}:${lang}`;
}

/** When the set's briefing was written, if it's missing or older than `maxAgeMs` (null = fresh). */
export async function interestBriefingStale(hash: string, maxAgeMs = Infinity, now = Date.now()): Promise<{ at: string | null } | null> {
  const last = await getJSON<{ at: string }>(`ib:${hash}:last`);
  if (!last) return (await getJSON(`ib:${hash}`)) ? null : { at: null }; // briefings from before :last existed count as fresh
  return now - new Date(last.at).getTime() > maxAgeMs ? { at: last.at } : null;
}

/** Translation cache key for a stored briefing (prefix = ib:<hash> or digest:<section>:<lang>). */
const trKey = (prefix: string, lang: string) => `tr:${prefix}:${lang}`;

/**
 * The briefing a reader sees. `langOverride` is the reader's interface language: if the briefing was
 * written in another language and a translation of this exact version is cached, that's returned;
 * otherwise the original (the client then asks /api/translate once).
 */
export async function loadDigest(section: SectionId, at?: string, langOverride?: string): Promise<Digest | null> {
  const want = langOverride && isLang(langOverride) ? langOverride : undefined;
  const translated = async (prefix: string, d: Digest | null, target: string | undefined = want) => {
    if (!d || !target || d.language === target || at) return d;
    const tr = await getJSON<Digest>(trKey(prefix, target));
    return tr && tr.generatedAt === d.generatedAt ? tr : d;
  };
  const set = await currentInterestSet();
  if (section === "interests") {
    const { hash } = set;
    if (at) return getJSON<Digest>(`ib:${hash}:${at}`);
    const d = await getJSON<Digest>(`ib:${hash}`);
    // The owner's pre-multi-user briefing is shown until the first new one is generated.
    if (!d && currentUid() === OWNER) return translated("digest:interests", await getJSON<Digest>("digest:interests"), want ?? set.display);
    return translated(`ib:${hash}`, d, want ?? set.display);
  }
  const lang = want ?? set.display;
  if (at) return (await getJSON<Digest>(`digest:${section}:${lang}:${at}`)) ?? getJSON<Digest>(`digest:${section}:${at}`);
  // Shared sections are written once in English and translated; a native copy (older runs, or a
  // language someone generated directly) wins only if it's at least as new.
  const [native, en] = await Promise.all([getJSON<Digest>(`digest:${section}:${lang}`), lang !== "en" ? getJSON<Digest>(`digest:${section}:en`) : null]);
  if (native && (!en || native.generatedAt >= en.generatedAt)) return native;
  if (en) return translated(`digest:${section}:en`, en, lang);
  return getJSON<Digest>(`digest:${section}`);
}

const translating = new Map<string, Promise<Digest>>();

/**
 * Translate the latest briefing of a section into `lang`, once per briefing version (cached for
 * every reader; concurrent requests share one call). Returns the original if no translation is
 * needed or possible. `onSpend` runs only when a new translation is actually paid for.
 */
export async function translateLatest(section: SectionId, lang: string, onSpend?: () => Promise<boolean>, variant?: "rules"): Promise<Digest | null> {
  const d = variant === "rules" ? await loadRules(section, lang) : await loadDigest(section, undefined, lang);
  if (!d || !isLang(lang) || d.language === lang || d.translatedFrom) return d;
  const base = section === "interests" ? `ib:${(await currentInterestSet()).hash}` : `digest:${section}:${d.language ?? "en"}`;
  const prefix = variant === "rules" ? `${base}:rules` : base;
  const key = trKey(prefix, lang);
  const pending = translating.get(key);
  if (pending) return pending;
  // A briefing that just failed to translate isn't retried for 10 minutes: otherwise every reader
  // triggers another AI call and the daily translation cap is gone in an hour.
  const failKey = `${key}:failed`;
  const failed = await getJSON<{ at: number; v: string }>(failKey).catch(() => null);
  if (failed && failed.v === d.generatedAt && Date.now() - failed.at < 10 * 60_000) throw new Error("translation unavailable, retrying later");
  if (onSpend && !(await onSpend())) return d;
  const job = translateDigest(d, lang)
    .then(async (t) => {
      await setJSON(key, t);
      return t;
    })
    .catch(async (e) => {
      await setJSON(failKey, { at: Date.now(), v: d.generatedAt }).catch(() => {});
      throw e;
    })
    .finally(() => translating.delete(key));
  translating.set(key, job);
  return job;
}

/** Where the caller's current briefing for a section lives (English original). */
export async function basePrefix(section: SectionId): Promise<string> {
  return section === "interests" ? `ib:${(await currentInterestSet()).hash}` : `digest:${section}:en`;
}

/**
 * When the latest scheduled or manual run couldn't use any AI model, readers keep the last AI
 * briefing; this returns when that run happened (only if it's newer than the briefing shown).
 */
export async function aiFailedSince(section: SectionId, shown: Digest | null): Promise<string | null> {
  if (!shown || shown.provider === "rules") return null;
  const f = await getJSON<{ at: string }>(`${await basePrefix(section)}:aifail`);
  return f && f.at > shown.generatedAt ? f.at : null;
}

/** Rule-based copies are cached this long; anyone asking within the window shares one. */
export const RULES_TTL_MS = 15 * 60_000;

/** The cached rule-based copy of a section (translated if a translation of this version exists). */
export async function loadRules(section: SectionId, lang?: string): Promise<Digest | null> {
  const prefix = `${await basePrefix(section)}:rules`;
  const d = await getJSON<Digest>(prefix);
  if (!d || !lang || d.language === lang) return d;
  const tr = await getJSON<Digest>(trKey(prefix, lang));
  return tr && tr.generatedAt === d.generatedAt ? tr : d;
}

/**
 * Save a new briefing. A rule-based one never replaces an AI briefing: it's kept beside it
 * (prefix:rules, so readers can switch to it) and the failed attempt is noted (prefix:aifail).
 * Returns what readers now see and whether the AI briefing was kept.
 */
export async function storeBriefing(prefix: string, d: Digest): Promise<{ shown: Digest; keptAi: boolean }> {
  if (d.provider === "rules") {
    const prev = await getJSON<Digest>(prefix);
    if (prev && prev.provider !== "rules") {
      await setJSON(`${prefix}:rules`, d);
      await setJSON(`${prefix}:aifail`, { at: d.generatedAt, note: d.providerNote });
      return { shown: prev, keptAi: true };
    }
  }
  await setJSON(prefix, d);
  await archive(prefix, d).catch(() => {});
  return { shown: d, keptAi: false };
}

export interface HistoryEntry extends DigestMeta {
  key: string;
}

/** Past versions of the caller's briefing for a section (English originals). */
export async function loadHistory(section: SectionId): Promise<HistoryEntry[]> {
  const { lang, hash } = await currentInterestSet();
  return (await getJSON<HistoryEntry[]>(`${prefixFor(section, lang, hash)}:history`)) ?? [];
}

async function archive(prefix: string, d: Digest): Promise<void> {
  const ts = d.generatedAt.replace(/[^0-9]/g, "").slice(0, 14);
  await setJSON(`${prefix}:${ts}`, d);
  const hk = `${prefix}:history`;
  const entry: HistoryEntry = { key: ts, generatedAt: d.generatedAt, provider: d.provider, headline: d.analysis.headline, mood: d.analysis.mood };
  const list = [entry, ...((await getJSON<HistoryEntry[]>(hk)) ?? []).filter((h) => h.key !== ts)];
  for (const old of list.slice(HISTORY_SIZE)) await delJSON(`${prefix}:${old.key}`).catch(() => {});
  await setJSON(hk, list.slice(0, HISTORY_SIZE));
}
