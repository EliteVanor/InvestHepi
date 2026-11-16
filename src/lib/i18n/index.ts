/**
 * UI strings. English (en.ts) is the source of truth; other languages fall back to English per key
 * (i18ntest makes sure none are missing). Dates and relative times use Intl, so they localize
 * automatically. One file per language.
 */
import { langInfo, type LangCode } from "../languages";
import { de } from "./de";
import { en, type Dict, type MsgKey } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { ja } from "./ja";
import { ko } from "./ko";
import { vi } from "./vi";
import { zh } from "./zh";

export type { MsgKey };

const DICTS: Record<LangCode, Dict> = { en, vi, zh, ja, ko, es, fr, de };

export type T = (key: MsgKey, vars?: Record<string, string | number>) => string;

export function makeT(lang: LangCode): T {
  const d = DICTS[lang] ?? en;
  return (key, vars) => {
    let s = d[key] ?? en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

export function relTime(iso: string, lang: LangCode): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(langInfo(lang).locale, { numeric: "auto", style: "short" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

/** For tests: every language must translate every key. */
export function missingKeys(): Record<string, string[]> {
  const keys = Object.keys(en) as MsgKey[];
  return Object.fromEntries(Object.entries(DICTS).map(([c, d]) => [c, keys.filter((k) => !(k in d))]));
}
