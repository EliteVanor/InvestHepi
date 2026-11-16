/** Pure helpers for following a single stock from search (shared by the UI and tests). */
import type { SearchHit } from "./search";

/** Google News query for a followed stock. Vietnamese stocks get a Vietnamese query (and news). */
export function queryFor(hit: Pick<SearchHit, "symbol" | "name" | "region" | "type">): string {
  const name = hit.name
    .replace(/\b(inc|corp|corporation|co|ltd|plc|sa|ag|nv|holdings?|group|company|the)\b\.?/gi, "")
    .replace(/[,.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  if (hit.region === "vn" || hit.symbol.endsWith(".VN")) {
    const code = hit.symbol.replace(/^\^/, "").replace(/\.VN$/, "");
    return hit.type === "INDEX" ? `"${name}" chứng khoán` : `"${name}" OR "cổ phiếu ${code}"`;
  }
  if (hit.type === "INDEX" || hit.symbol.startsWith("^") || /=/.test(hit.symbol)) return `"${name}"`;
  return name && name.toUpperCase() !== hit.symbol ? `"${name}" OR ${hit.symbol} stock` : `${hit.symbol} stock`;
}
