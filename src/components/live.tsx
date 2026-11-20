"use client";

/** Live prices on the page: polling /api/quotes on each symbol's own exchange hours (quote-view.ts pollPlan). */
import { useEffect, useState } from "react";
import { overlayQuote, pollPlan, type CurrentQuote } from "@/lib/quote-view";
import { type Quote } from "@/lib/types";
import { usePrefs } from "./prefs";

/**
 * Current quotes for the given symbols while the page is visible: each minute only the symbols whose
 * own market trades now (Vietnam on Hanoi hours, FX/futures/crypto near 24 h), the whole set every
 * 5 minutes (pollPlan). `everyMs` slows the minute step (the sector heatmap: 2 minutes); `windows`
 * adds the 5D/1M changes.
 */
export function useLiveQuotes(symbols: string[], opts: { windows?: boolean; everyMs?: number } = {}): Map<string, CurrentQuote> {
  const { api } = usePrefs();
  const [map, setMap] = useState<Map<string, CurrentQuote>>(new Map());
  const key = symbols.join(",");
  const windows = !!opts.windows;
  const everyMs = opts.everyMs ?? 60_000;
  useEffect(() => {
    if (!key) return;
    let stop = false;
    let lastFull = 0;
    let lastAny = 0;
    const syms = key.split(",");
    const tick = async (force = false) => {
      if (!force && document.visibilityState !== "visible") return;
      const want = pollPlan(syms, Date.now(), { lastFull: force ? 0 : lastFull, lastAny: force ? 0 : lastAny, everyMs });
      if (!want.length) return;
      lastAny = Date.now();
      if (want.length === syms.length) lastFull = lastAny;
      try {
        const j = await api<{ quotes: CurrentQuote[] }>(`/api/quotes?symbols=${encodeURIComponent(want.join(","))}${windows ? "&windows=1" : ""}`);
        if (!stop) setMap((m) => new Map([...[...m].filter(([k]) => syms.includes(k)), ...j.quotes.map((q) => [q.symbol, q] as const)]));
      } catch {}
    };
    tick(true);
    const id = setInterval(tick, 60_000);
    const onVis = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [api, key, windows, everyMs]);
  return map;
}

/** A briefing's quotes with the current quotes laid over them (quote-view.ts overlayQuote). */
export const withLive = (quotes: Quote[], live: Map<string, CurrentQuote>): Quote[] => quotes.map((q) => overlayQuote(q, live.get(q.symbol)));
