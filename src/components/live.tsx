"use client";

/** Live prices on the page: polling /api/quotes on each symbol's own exchange hours (quote-view.ts pollInterval). */
import { useEffect, useState } from "react";
import { overlayQuote, pollInterval, type CurrentQuote } from "@/lib/quote-view";
import { type Quote } from "@/lib/types";
import { usePrefs } from "./prefs";

/**
 * Current quotes for the given symbols. Polls every minute while any of them trades (each on its own
 * exchange's clock: Vietnam on Hanoi hours, FX/futures/crypto near 24 h) and the page is visible,
 * every 5 minutes otherwise. `windows` adds the 5D/1M changes.
 */
export function useLiveQuotes(symbols: string[], opts: { windows?: boolean } = {}): Map<string, CurrentQuote> {
  const { api } = usePrefs();
  const [map, setMap] = useState<Map<string, CurrentQuote>>(new Map());
  const key = symbols.join(",");
  const windows = !!opts.windows;
  useEffect(() => {
    if (!key) return;
    let stop = false;
    let last = 0;
    const syms = key.split(",");
    const tick = async (force = false) => {
      if (!force && document.visibilityState !== "visible") return;
      if (!force && Date.now() - last < pollInterval(syms) - 1000) return;
      last = Date.now();
      try {
        const j = await api<{ quotes: CurrentQuote[] }>(`/api/quotes?symbols=${encodeURIComponent(key)}${windows ? "&windows=1" : ""}`);
        if (!stop) setMap(new Map(j.quotes.map((q) => [q.symbol, q])));
      } catch {}
    };
    tick(true);
    const id = setInterval(tick, 60_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [api, key, windows]);
  return map;
}

/** A briefing's quotes with the current quotes laid over them (quote-view.ts overlayQuote). */
export const withLive = (quotes: Quote[], live: Map<string, CurrentQuote>): Quote[] => quotes.map((q) => overlayQuote(q, live.get(q.symbol)));
