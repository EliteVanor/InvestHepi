/**
 * Labels that reach the page as English data (market group names, calendar titles, mood details,
 * macro names) mapped to the reader's language. Anything unknown is shown as it came: proper names
 * (S&P 500, VN-Index, tickers) and the user's own interest names need no translation.
 */
import type { MsgKey, T } from "@/lib/i18n";
import { symLabel } from "@/lib/symbols";
import type { CalendarEvent } from "@/lib/types";

/** Market groups (config.ts SECTION_GROUPS) and the default interests. */
const GROUPS: Record<string, MsgKey> = {
  "Small caps": "grp.small",
  "US stocks": "grp.us",
  Europe: "grp.europe",
  Japan: "grp.japan",
  "China & Hong Kong": "grp.china",
  Oil: "grp.oil",
  Gold: "grp.gold",
  Banks: "grp.banks",
  "Real estate": "grp.realestate",
  "Securities firms": "grp.brokers",
  "Tech & retail": "grp.techretail",
  "Steel, energy & industrials": "grp.industrial",
  "Chip stocks": "grp.chips",
  "Vietnam stocks": "grp.vnstocks",
};

/** A market group, or a ticker when an impact names one ("^HSI" → "Hang Seng"). */
export const groupName = (t: T, name: string) => (GROUPS[name] ? t(GROUPS[name]) : symName(t, name));

/** Symbol labels that are words, not names ("Oil", "Gold", "Shanghai"). */
const SYMS: Record<string, MsgKey> = {
  "CL=F": "grp.oil",
  "GC=F": "grp.gold",
  "DX-Y.NYB": "sym.dollar",
  "^TNX": "sym.us10y",
  "000001.SS": "sym.shanghai",
};

export const symName = (t: T, symbol: string) => (SYMS[symbol] ? t(SYMS[symbol]) : symLabel(symbol));

const CAL: Record<string, MsgKey> = {
  "FOMC rate decision": "cal.fomc",
  "FOMC rate decision + projections": "cal.fomcSep",
  "CPI inflation": "cal.cpi",
  "Jobs report (nonfarm payrolls)": "cal.jobs",
  "PPI inflation": "cal.ppi",
  "JOLTS job openings": "cal.jolts",
  "VN30 futures expiry": "cal.vn30f",
};

export function calTitle(t: T, e: CalendarEvent): string {
  if (CAL[e.title]) return t(CAL[e.title]);
  const m = e.title.match(/^(\S+) earnings(?: \(EPS est\. ([^)]+)\))?$/);
  if (m) return `${t("cal.earningsOf", { sym: symLabel(m[1]) })}${m[2] ? ` (${t("cal.epsEst", { eps: m[2] })})` : ""}`;
  return e.title;
}

export const calWhen = (t: T, s?: string) => (s === "before open" ? t("cal.beforeOpen") : s === "after close" ? t("cal.afterClose") : (s ?? ""));

/** Server notes are diagnostics in English; readers get a plain sentence, developers' hints are dropped. */
export function calNotes(t: T, notes: string[]): string[] {
  const out = new Set<string>();
  for (const n of notes) {
    if (n.startsWith("Economic releases unavailable")) out.add(t("cal.noteMacro"));
    else if (n.startsWith("Earnings dates unavailable")) out.add(t("cal.noteEarnings"));
  }
  return [...out];
}

/** Mood gauge part details are built server-side as short English ("-1.3% vs 125d", "4/9 up"). */
export function moodDetail(t: T, detail: string): string {
  let m: RegExpMatchArray | null;
  if ((m = detail.match(/^(\S+) vs 125d$/))) return t("mood.d.vs125", { v: m[1] });
  if ((m = detail.match(/^(\d+)\/(\d+) up$/))) return t("mood.d.up", { n: m[1], m: m[2] });
  if ((m = detail.match(/^(\S+) vs gold$/))) return t("mood.d.vsGold", { v: m[1] });
  if ((m = detail.match(/^(\S+) (\S+) vs 1mo$/))) return t("mood.d.vs1mo", { sym: m[1], v: m[2] });
  return detail; // "RSI 47", "VIX 17.9"
}
