"use client";

/** Live prices on the page: polling /api/quotes while a market is open, and the rule for laying a live quote over a briefing's snapshot (canOverlay). */
import { useEffect, useState } from "react";
import { type LiveQuote } from "@/lib/chart";
import { marketClock, vnMarketClock } from "@/lib/marketTime";
import { type Quote } from "@/lib/types";
import { usePrefs } from "./prefs";

/**
 * Live prices for the given symbols. Polls every minute while the relevant market is in session and
 * the page is visible, every 5 minutes otherwise (FX, futures and crypto move around the clock).
 */
export function useLiveQuotes(symbols: string[], market: "us" | "vn" | "world" = "us", everyMs = 60_000): Map<string, LiveQuote> {
  const { api } = usePrefs();
  const [map, setMap] = useState<Map<string, LiveQuote>>(new Map());
  const key = symbols.join(",");
  useEffect(() => {
    if (!key) return;
    let stop = false;
    let last = 0;
    const open = () => {
      if (market === "world") return new Date().getUTCDay() % 6 !== 0;
      return (market === "vn" ? vnMarketClock() : marketClock()).phase === "open";
    };
    const tick = async (force = false) => {
      if (!force && document.visibilityState !== "visible") return;
      if (!force && !open() && Date.now() - last < 5 * 60_000) return;
      last = Date.now();
      try {
        const j = await api<{ quotes: LiveQuote[] }>(`/api/quotes?symbols=${encodeURIComponent(key)}`);
        if (!stop) setMap(new Map(j.quotes.map((q) => [q.symbol, q])));
      } catch {}
    };
    tick(true);
    const id = setInterval(tick, everyMs);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [api, key, everyMs, market]);
  return map;
}

/**
 * Whether a live quote may replace a briefing's quote: same basis (both real, or the same ETF), or a
 * real level replacing an ETF stand-in. Never an ETF price over a real level. Exported for tests.
 */
export const canOverlay = (digestProxy?: string, liveProxy?: string) => (digestProxy ?? "") === (liveProxy ?? "") || (!!digestProxy && !liveProxy);

/** Overlay live prices on digest quotes (keeps the 1-month history for sparklines). */
export function mergeLive(quotes: Quote[], live: Map<string, LiveQuote>): Quote[] {
  return quotes.map((q) => {
    const l = live.get(q.symbol);
    // Never mix an index level with its tracking ETF's price; a real level may replace an ETF stand-in.
    return l && canOverlay(q.proxy, l.proxy) ? { ...q, proxy: l.proxy, price: l.price, prevClose: l.prevClose, changePct: l.changePct, spark: l.intraday ? l.spark : undefined } : q;
  });
}
