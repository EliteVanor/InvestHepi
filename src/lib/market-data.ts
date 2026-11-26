/**
 * What a briefing or prediction run prices, and the shared price snapshot for it: quotes, macro,
 * US sectors and technicals, cached 10 minutes per coverage (1 minute when a price is stale).
 * Its own module so the briefing pipeline and the prediction job both read it without importing
 * each other.
 */
import { createHash } from "node:crypto";
import { SECTORS } from "./chart";
import { BENCHMARKS, MOOD_BENCH, SECTION_MACRO, SECTION_STRIPS, type StripGroup } from "./config";
import { freshenQuotes, getQuotes } from "./market";
import { getJSON, setJSON } from "./store";
import { getTechnicals, type Technicals } from "./technicals";
import type { Interest, Quote, SectionId } from "./types";

export interface MarketData {
  key: string;
  at: number;
  quotes: Quote[];
  macro: Quote[];
  sectors: Quote[];
  technicals: Record<string, Technicals>;
}

const MARKET_TTL_MS = 10 * 60_000;

/** What one digest prices: strip/AI symbols, macro, whether US sectors matter, and the mood inputs. */
export interface Coverage {
  symbols: string[];
  macro: string[];
  sectors: boolean;
  /** Technicals: mood benchmark first, then each group's benchmark (the free-tier prompt keeps those). */
  tech: string[];
  bench: string;
  /** Quotes used for the mood gauge's breadth (US sectors when `sectors`). */
  breadth: string[];
  strip?: StripGroup[];
}

export function coverage(section: SectionId, interests: Interest[], extra: string[] = []): Coverage {
  const bench = MOOD_BENCH[section];
  const firsts = interests.map((i) => i.tickers[0]).filter(Boolean);
  if (section === "interests") {
    const symbols = [...BENCHMARKS, ...interests.flatMap((i) => i.tickers), ...extra];
    return { symbols, macro: SECTION_MACRO.interests, sectors: true, tech: [bench, ...firsts, ...symbols], bench, breadth: [] };
  }
  const strip = SECTION_STRIPS[section];
  const stripSyms = strip.flatMap((g) => g.symbols);
  // Shared sections: the strip, each group's tickers, and the (hidden) mood benchmark. No personal stocks.
  const symbols = [...stripSyms, ...interests.flatMap((i) => i.tickers), bench];
  const breadth = section === "world" ? strip[0].symbols : section === "vn" ? strip.slice(1).flatMap((g) => g.symbols) : [];
  return { symbols, macro: SECTION_MACRO[section], sectors: section === "us", tech: [bench, ...firsts, ...stripSyms], bench, breadth, strip };
}

/**
 * Prices, macro, sectors and technicals, shared across sections and users for 10 minutes; for one
 * minute when any price is a stale fallback, so a briefing doesn't keep an old price after the source
 * recovers.
 */
const STALE_MARKET_TTL_MS = 60_000;
/** How long a market snapshot is reused (exported for tests). */
export const marketTtl = (d: Pick<MarketData, "quotes" | "macro" | "sectors">) => ([...d.quotes, ...d.macro, ...d.sectors].some((q) => q.stale) ? STALE_MARKET_TTL_MS : MARKET_TTL_MS);

export async function marketData(cov: Coverage): Promise<MarketData> {
  const key = [[...new Set(cov.symbols.map((s) => s.toUpperCase()))].sort().join(","), cov.macro.join(","), cov.sectors ? "s" : "", cov.tech.slice(0, 16).join(",")].join("|");
  const slot = `market:${createHash("sha1").update(key).digest("hex").slice(0, 12)}`;
  const cached = await getJSON<MarketData>(slot).catch(() => null);
  if (cached && cached.key === key && Date.now() - cached.at < marketTtl(cached) && cached.quotes.length) return cached;
  // Freshened: a close the daily source hasn't posted yet is taken from an intraday series.
  const [quotes, macro, sectors, technicals] = await Promise.all([
    getQuotes(cov.symbols).then((q) => freshenQuotes(q)),
    getQuotes(cov.macro).then((q) => freshenQuotes(q)),
    cov.sectors ? getQuotes(SECTORS.map((x) => x.symbol)).then((q) => freshenQuotes(q)) : Promise.resolve([] as Quote[]),
    getTechnicals(cov.tech).catch(() => ({}) as Record<string, Technicals>),
  ]);
  const data: MarketData = { key, at: Date.now(), quotes, macro, sectors, technicals };
  if (quotes.length) await setJSON(slot, data).catch(() => {});
  return data;
}
