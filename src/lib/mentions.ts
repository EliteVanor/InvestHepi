/**
 * Whether a headline names a ticker. Browser-safe (no store, no network): the server adds the Vietnamese
 * listing's short name (`headlineMentions` in pipeline.ts); the page matches on the code, our label and
 * the aliases (`relatedStories` in stories/view.ts).
 */
import { symLabel } from "./symbols";
import { ALIASES } from "./tickers";

/** Lowercase, strip Vietnamese accents (đ → d), collapse spaces. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Words a headline would use for a ticker: its code, our label, the aliases and any `extra` names. */
export function mentionNames(symbol: string, extra: string[] = []): string[] {
  const code = symbol.replace(/\.VN$/i, "").replace(/^\^/, "");
  const names = [code, symLabel(symbol), ...extra, ...(ALIASES[symbol] ?? [])];
  return [...new Set(names.map((n) => fold(n)).filter((n) => n.length >= 2))];
}

/** Code and short names as whole words, longer names as substrings; accents ignored. */
export function mentionsIn(title: string, symbol: string, extra: string[] = []): boolean {
  const t = fold(title);
  return mentionNames(symbol, extra).some((n) => (n.length <= 4 ? new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(t) : t.includes(n)));
}
