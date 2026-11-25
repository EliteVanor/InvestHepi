/**
 * Story clustering (v19 row 21): groups headlines that report the same event. Pure, no I/O.
 * Replaces the old `dedupe` tokens (a-z only: Vietnamese titles shrank to 1-2 words). Unicode-aware tokens,
 * word bigrams for Vietnamese, character trigrams, one language per story, and no chaining: an item joins a
 * cluster only if it is close to the cluster's FIRST member.
 */
import type { NewsItem } from "../types";

export interface Story {
  id: string;
  members: NewsItem[];
  outlets: string[];
  firstSeen: string;
  lastSeen: string;
  lang: "vi" | "en";
  kind: "important" | "interesting";
}
export interface StoryIndex {
  at: string;
  stories: { id: string; memberIds: string[]; outlets: string[]; firstSeen: string }[];
}

export const MAX_AGE_HOURS = 36;
const MAX_OUTLETS = 12;
/** Word Jaccard floor (today's English dedupe behaviour). */
export const JACCARD_MIN = 0.55;
/** Vietnamese word sets hold syllables and bigrams, and outlets word the same event differently. */
export const JACCARD_MIN_VI = 0.4;
/** Character-trigram Dice threshold. */
export const DICE_MIN = 0.6;
/** Vietnamese: a weaker word overlap still counts when both titles carry the same figure (a number of 2+ digits, or a %). */
export const JACCARD_MIN_VI_FIGURE = 0.2;

const VI_ONLY = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/;
export function detectLang(title: string): "vi" | "en" {
  return VI_ONLY.test(title.normalize("NFC").toLowerCase()) ? "vi" : "en";
}

const STOP_EN = new Set("a an the of to in on for and or with at by from as is are was be after over amid says said new its it this that".split(" "));
const STOP_VI = new Set("của và các những là có được cho với trong này khi đã sẽ từ về theo tại một người".split(" "));

const split = (title: string) =>
  title
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}$%]+/u)
    .filter(Boolean);

/** "25/11", "25-11", "25/11/2026", and in Vietnamese titles "25.11": a day/month, not a figure. */
const DATE = /(?<![\d.,])(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?(?![\d%])/g;
const DATE_VI = /(?<![\d.,])(\d{1,2})\.(\d{1,2})(?![\d%.,])/g;
function datesOf(title: string, lang: "vi" | "en"): { dates: Set<string>; rest: string } {
  const dates = new Set<string>();
  const take = (re: RegExp, t: string) =>
    t.replace(re, (m, d, mo) => {
      if (+d < 1 || +d > 31 || +mo < 1 || +mo > 12) return m;
      dates.add(`${+d}/${+mo}`);
      return " ";
    });
  let rest = take(DATE, title);
  if (lang === "vi") rest = take(DATE_VI, rest);
  return { dates, rest };
}

function words(title: string, lang: "vi" | "en"): Set<string> {
  const w = split(title);
  if (lang === "en") return new Set(w.filter((x) => x.length > 2 && !STOP_EN.has(x)).map((x) => x.replace(/(ing|ed|es|s)$/, "")));
  const syl = w.filter((x) => !STOP_VI.has(x));
  const out = new Set(syl);
  for (let i = 0; i + 1 < syl.length; i++) out.add(`${syl[i]} ${syl[i + 1]}`);
  return out;
}

function trigrams(title: string): Set<string> {
  const f = ` ${split(title).join(" ").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d")} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= f.length; i++) out.add(f.slice(i, i + 3));
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}
const jaccard = (a: Set<string>, b: Set<string>) => overlap(a, b) / (a.size + b.size - overlap(a, b) || 1);
const dice = (a: Set<string>, b: Set<string>) => (2 * overlap(a, b)) / (a.size + b.size || 1);

const sharesFigure = (a: Set<string>, b: Set<string>) => [...a].some((w) => b.has(w) && !w.includes(" ") && /^(\d{2,}|\d+%|\$\d+)$/.test(w));

const UP = new Set("rise rises rose rising jump jumps jumped gain gains gained climb climbs climbed rally rallies rallied surge surges surged soar soars soared up higher tăng".split(" "));
const DOWN = new Set("fall falls fell falling drop drops dropped slide slides slid slump slumps slumped sink sinks sank plunge plunges plunged tumble tumbles tumbled down lower lose loses lost giảm mất sụt rơi".split(" "));
/** +1 up, -1 down, 0 neither or both: two headlines moving opposite ways report different events. */
function direction(title: string): number {
  const w = split(title);
  const up = w.some((x) => UP.has(x)), down = w.some((x) => DOWN.has(x));
  return up === down ? 0 : up ? 1 : -1;
}

interface Sig {
  item: NewsItem;
  lang: "vi" | "en";
  w: Set<string>;
  t: Set<string>;
  dir: number;
  dates: Set<string>;
}
const ms = (i: NewsItem) => new Date(i.publishedAt).getTime();

/** Words too common in market news to tie two stories together (second pass only). */
const GENERIC_EN = new Set("stock market share price index investor percent point today week year report update live new rate".split(" "));
const GENERIC_VI = new Set(["chứng khoán", "cổ phiếu", "thị trường", "nhà đầu", "đầu tư", "hôm nay", "giá vàng", "tỷ giá", "ngân hàng", "doanh nghiệp"]);
/** Second pass: the story's distinctive words (English single words, Vietnamese syllable pairs), first member only. */
function core(sig: Sig): Set<string> {
  return new Set([...sig.w].filter((w) => (sig.lang === "en" ? !w.includes(" ") && !GENERIC_EN.has(w) : w.includes(" ") && !GENERIC_VI.has(w)) && !/^[\d$%.,]+$/.test(w)));
}
/** Shared distinctive words for two stories to count as related (and overlap >= RELATED_OVERLAP of the smaller). */
export const RELATED_SHARED = 3;
export const RELATED_OVERLAP = 0.3;
const sigOf = (item: NewsItem): Sig => {
  const lang = detectLang(item.title);
  const { dates, rest } = datesOf(item.title, lang);
  return { item, lang, w: words(rest, lang), t: trigrams(rest), dir: direction(rest), dates };
};
/**
 * Two stories about the same event or topic (one event worded differently by outlets can land in two clusters;
 * so can two events of one war): their first headlines share RELATED_SHARED distinctive words, same language,
 * no opposite moves, no different dates. Used by the picker to avoid two cards on one subject; clustering itself
 * never merges on it (word counts can't tell "same event" from "same topic", so cards and sources stay exact).
 */
export function relatedStories(a: Story, b: Story): boolean {
  const x = sigOf(a.members[0]), y = sigOf(b.members[0]);
  if (x.lang !== y.lang || x.dir * y.dir < 0) return false;
  if (x.dates.size && y.dates.size && ![...y.dates].some((d) => x.dates.has(d))) return false;
  const cx = core(x), cy = core(y);
  const shared = overlap(cx, cy);
  return shared >= RELATED_SHARED && shared / Math.max(1, Math.min(cx.size, cy.size)) >= RELATED_OVERLAP;
}

export function clusterStories(items: NewsItem[], prev: StoryIndex | null, now: Date): Story[] {
  const cutoff = now.getTime() - MAX_AGE_HOURS * 3600_000;
  const sorted = items.filter((i) => ms(i) >= cutoff).sort((a, b) => ms(b) - ms(a));
  const clusters: Sig[][] = [];
  for (const item of sorted) {
    const lang = detectLang(item.title);
    // Dates are taken out before comparing (daily columns share "25/11"); two different dates are two events.
    const { dates, rest } = datesOf(item.title, lang);
    const sig: Sig = { item, lang, w: words(rest, lang), t: trigrams(rest), dir: direction(rest), dates };
    const home = clusters.find((c) => {
      const f = c[0];
      if (f.item.id === item.id) return true;
      if (f.lang !== lang || f.dir * sig.dir < 0) return false;
      if (f.dates.size && sig.dates.size && ![...sig.dates].some((d) => f.dates.has(d))) return false;
      const j = jaccard(f.w, sig.w);
      if (j >= (lang === "vi" ? JACCARD_MIN_VI : JACCARD_MIN) || dice(f.t, sig.t) >= DICE_MIN) return true;
      return lang === "vi" && j >= JACCARD_MIN_VI_FIGURE && sharesFigure(f.w, sig.w);
    });
    if (home) home.push(sig);
    else clusters.push([sig]);
  }

  const prevStories = prev?.stories ?? [];
  const taken = new Set<string>(); // a previous story split in two: only the first part keeps its id
  return clusters.map((c) => {
    const members = c.map((s) => s.item);
    const times = members.map(ms);
    const earliest = members.reduce((a, b) => (ms(b) < ms(a) ? b : a));
    const carried = prevStories
      .filter((p) => !taken.has(p.id) && members.some((m) => p.memberIds.includes(m.id)))
      .sort((a, b) => +new Date(a.firstSeen) - +new Date(b.firstSeen))[0];
    const id = carried?.id ?? (taken.has(earliest.id) ? `${earliest.id}~${members.length}` : earliest.id);
    taken.add(id);
    return {
      id,
      members,
      outlets: [...new Set(members.map((m) => m.source).filter(Boolean))].slice(0, MAX_OUTLETS),
      firstSeen: new Date(Math.min(...times)).toISOString(),
      lastSeen: new Date(Math.max(...times)).toISOString(),
      lang: c[0].lang,
      kind: members.some((m) => m.feedKind === "interesting") ? "interesting" : "important",
    };
  });
}

/** One headline per story: its first (newest) member, as dedupe kept; other outlets in `alsoIn`, tags merged. */
export function toHeadlines(stories: Story[]): NewsItem[] {
  return stories.map((s) => {
    const first = { ...s.members[0] };
    const tags = new Set(first.tags ?? []);
    for (const m of s.members.slice(1)) for (const g of m.tags ?? []) tags.add(g);
    if (tags.size) first.tags = [...tags];
    const also = [...new Set(s.members.map((m) => m.source))].filter((o) => o && o !== first.source);
    const merged = [...new Set([...(first.alsoIn ?? []), ...also])].slice(0, MAX_OUTLETS);
    if (merged.length) first.alsoIn = merged;
    return first;
  });
}

export function toIndex(stories: Story[], now: Date): StoryIndex {
  return {
    at: now.toISOString(),
    stories: stories.map((s) => ({ id: s.id, memberIds: s.members.map((m) => m.id), outlets: s.outlets, firstSeen: s.firstSeen })),
  };
}
