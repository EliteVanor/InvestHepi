/**
 * Who follows what: each caller's interests and settings (per user, through ukey()), the hash that
 * names an interest set (users with identical interests share one briefing and one track record),
 * and the distinct sets the scheduler refreshes.
 */
import { createHash } from "node:crypto";
import { DEFAULT_INTERESTS } from "./config";
import { OWNER, currentUid, ukey, withUser } from "./context";
import { isLang } from "./languages";
import { getJSON, setJSON } from "./store";
import { activeUsers, multiUser } from "./users";
import type { Interest, Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = { briefingLanguage: "en" };

export async function loadInterests(): Promise<Interest[]> {
  return (await getJSON<Interest[]>(ukey("interests"))) ?? DEFAULT_INTERESTS;
}

export async function saveInterests(list: Interest[]): Promise<void> {
  await setJSON(ukey("interests"), list);
}

export async function loadSettings(): Promise<Settings> {
  const s = await getJSON<Partial<Settings>>(ukey("settings"));
  return { ...DEFAULT_SETTINGS, ...s, briefingLanguage: isLang(s?.briefingLanguage) ? s!.briefingLanguage! : "en" };
}

export async function saveSettings(s: Settings): Promise<void> {
  await setJSON(ukey("settings"), s);
}

export function interestHash(interests: Interest[], lang: string): string {
  const norm = interests.map((i) => [i.name.trim(), i.query.trim(), i.tickers.map((t) => t.toUpperCase())]);
  return createHash("sha1").update(JSON.stringify(norm) + "|" + lang).digest("hex").slice(0, 16);
}

/**
 * The caller's interest list and briefing key. Every briefing is written in English (one AI call per
 * interest set, shared by everyone with the same interests); `display` is the caller's chosen
 * language, which readers get as a cached translation (translate.ts).
 */
export async function currentInterestSet() {
  const [interests, settings] = await Promise.all([loadInterests(), loadSettings()]);
  return { interests, lang: "en", display: settings.briefingLanguage, hash: interestHash(interests, "en") };
}

/** Track-record key for the current caller's interest set (owner's legacy record carries over once). */
export async function currentCallsKey(): Promise<string> {
  const { hash } = await currentInterestSet();
  return callsKeyFor(hash);
}

export async function callsKeyFor(hash: string): Promise<string> {
  const key = `calls:${hash}`;
  if (currentUid() === OWNER && !(await getJSON(key))) {
    const legacy = await getJSON<unknown[]>("calls");
    if (legacy?.length) await setJSON(key, legacy);
  }
  return key;
}

interface Group {
  interests: Interest[];
  lang: string;
  uids: string[];
}

/** Distinct interest sets among active users (identical interests + language share one briefing). */
export async function interestGroups(): Promise<Map<string, Group>> {
  const groups = new Map<string, Group>();
  const add = (interests: Interest[], lang: string, uid?: string) => {
    const h = interestHash(interests, lang);
    const g = groups.get(h) ?? { interests, lang, uids: [] };
    if (uid && !g.uids.includes(uid)) g.uids.push(uid);
    groups.set(h, g);
  };
  for (const uid of multiUser() ? await activeUsers() : [OWNER]) {
    await withUser(uid, async () => {
      const { interests, lang } = await currentInterestSet();
      add(interests, lang, uid);
    });
  }
  // Signed-out visitors don't see My Interests (they're asked to sign in), so no guest set is kept fresh.
  return groups;
}

/** Adds held tickers (not already followed) as one extra group so alerts cover them too. */
export function withHoldings(interests: Interest[], held: string[]): Interest[] {
  const have = new Set(interests.flatMap((i) => i.tickers));
  const extra = held.filter((s) => !have.has(s));
  return extra.length ? [...interests, { id: "holdings", name: "Holdings", query: "", tickers: extra }] : interests;
}
