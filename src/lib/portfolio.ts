/** Optional holdings. Stored in the user's own database; only weights and gain % ever go to the AI. */
import { ukey } from "./context";
import { getJSON, setJSON } from "./store";
import type { Holding, Quote } from "./types";

export async function loadHoldings(): Promise<Holding[]> {
  return (await getJSON<Holding[]>(ukey("portfolio"))) ?? [];
}

export async function saveHoldings(h: Holding[]): Promise<void> {
  await setJSON(ukey("portfolio"), h);
}

export { summarize, type PortfolioSummary, type Position } from "./portfolioMath";
import { summarize } from "./portfolioMath";

/** What the AI sees: weights and gain %, never share counts or dollar amounts. */
export function positionsAsText(holdings: Holding[], quotes: Quote[]): string | undefined {
  const s = summarize(holdings, quotes);
  if (!s.positions.length) return undefined;
  return s.positions.map((p) => `${p.symbol}: ${p.weight.toFixed(0)}% of portfolio, ${p.totalPct >= 0 ? "+" : ""}${p.totalPct.toFixed(0)}% vs cost`).join("\n");
}
