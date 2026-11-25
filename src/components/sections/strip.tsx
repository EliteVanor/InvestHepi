"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { fmtDuration, marketClock, vnMarketClock } from "@/lib/marketTime";
import type { Quote } from "@/lib/types";
import type { MsgKey } from "@/lib/i18n";
import { usePrefs } from "../prefs";
import { Sparkline, fmtPct, fmtPrice } from "../primitives";
import { isPercentQuote } from "@/lib/symbols";
import { levelLabel, staleDayTag } from "@/lib/quote-view";
import { symName } from "../labels";


/* ---------------------------------------------------------------- Market */

export function StatusPill({ market = "us" }: { market?: "us" | "vn" }) {
  const { t } = usePrefs();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!now) return <span className="status-pill">&nbsp;</span>;
  const { phase, secs } = market === "vn" ? vnMarketClock(now) : marketClock(now);
  const label = phase === "break" ? t("mkt.break") : phase === "open" ? t("mkt.open") : phase === "pre" ? t("mkt.pre") : phase === "after" ? t("mkt.after") : t("mkt.closed");
  const sub = phase === "open" && market === "vn" && secs > 0 && new Date(now.getTime() + 7 * 3600_000).getUTCHours() < 12 ? t("mkt.breakIn", { t: fmtDuration(secs) }) : phase === "open" ? t("mkt.closesIn", { t: fmtDuration(secs) }) : t("mkt.opensIn", { t: fmtDuration(secs) });
  return (
    <span className="status-pill" role="status">
      <span className={`dot ${phase === "open" ? "live" : phase === "pre" ? "pre" : ""}`} />
      <b>{market === "vn" ? `HOSE · ${label}` : label}</b>
      <span>{sub}</span>
    </span>
  );
}

export interface StripRow {
  /** Group label key (strip.indexes, strip.banks, ...); none for My Interests. */
  key?: string;
  quotes: Quote[];
}

/**
 * Horizontally scrolling price strip, Apple Stocks style. Touch and trackpads scroll natively;
 * mice get arrow buttons and click-and-drag; keyboard users get arrow keys. Edge fades only show
 * where there is more to see.
 */
export function MarketStrip({ groups, macro, onOpen }: { groups: StripRow[]; macro: Quote[]; onOpen: (symbol: string) => void }) {
  const { t } = usePrefs();
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const drag = useRef<{ x: number; left: number; moved: boolean; id: number } | null>(null);
  const suppressClick = useRef(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);
  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, groups, macro]);

  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 240), behavior: "smooth" });
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || !ref.current) return;
    drag.current = { x: e.clientX, left: ref.current.scrollLeft, moved: false, id: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 5) {
      d.moved = true;
      el.setPointerCapture(d.id);
      el.classList.add("dragging");
    }
    if (d.moved) el.scrollLeft = d.left - dx;
  };
  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    const el = ref.current;
    if (!d || !el) return;
    if (d.moved) {
      suppressClick.current = true;
      el.classList.remove("dragging");
      try {
        el.releasePointerCapture(d.id);
      } catch {}
      setTimeout(() => (suppressClick.current = false), 0);
    }
  };
  const open = (sym: string) => {
    if (!suppressClick.current) onOpen(sym);
  };

  const total = groups.reduce((a, g) => a + g.quotes.length, 0) + macro.length;
  if (!total) return null;
  return (
    <div className={`strip-wrap${edges.left ? " can-left" : ""}${edges.right ? " can-right" : ""}`}>
      <button className="strip-nav prev" aria-label={t("strip.prev")} tabIndex={-1} onClick={() => page(-1)} hidden={!edges.left}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6 8.5 12l6 6" /></svg>
      </button>
      <div
        className="strip"
        role="list"
        aria-label={t("mkt.markets")}
        ref={ref}
        tabIndex={0}
        onScroll={measure}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") (e.preventDefault(), page(1));
          if (e.key === "ArrowLeft") (e.preventDefault(), page(-1));
        }}
      >
        {groups.map((g, gi) => (
          <Fragment key={g.key ?? gi}>
            {g.key && g.quotes.length > 0 && <span className="strip-label">{t(`strip.${g.key}` as MsgKey)}</span>}
            {g.quotes.map((q) => (
              <button key={q.symbol} className={`qcard${q.stale ? " stale" : ""}`} role="listitem" onClick={() => open(q.symbol)} title={q.stale ? t("strip.stale") : undefined}>
                <div className="sym">
                  <span>{symName(t, q.symbol)}</span>
                  <span className={`chg num ${q.changePct >= 0 ? "up" : "down"}`}>{fmtPct(q.changePct)}</span>
                </div>
                <div className="px num">
                  {/* A stand-in shows no level; its tag says "via <ETF>". */}
                  {levelLabel(q, { fmt: fmtPrice, via: () => "" })}
                  <QuoteTag q={q} />
                </div>
                <ExtendedLine q={q} />
                {/* The latest session's path against the previous close, colored like the % beside it.
                    Without live intraday data, the month of daily closes is shown in gray: context,
                    not today's direction. */}
                {q.spark && q.spark.length > 1 ? (
                  <Sparkline values={q.spark} baseline={q.prevClose} up={q.changePct >= 0} />
                ) : (
                  <Sparkline values={q.history.map((h) => h[1])} neutral />
                )}
              </button>
            ))}
          </Fragment>
        ))}
        {macro.length > 0 && <span className="strip-label">{t("mkt.macro")}</span>}
        {macro.map((q) => (
          <button key={q.symbol} className={`qcard macro${q.stale ? " stale" : ""}`} role="listitem" onClick={() => open(q.symbol)} title={q.stale ? t("strip.stale") : undefined}>
            <div className="sym">
              <span>{symName(t, q.symbol)}</span>
            </div>
            <div className="px num">
              {isPercentQuote(q.symbol) ? `${q.price.toFixed(2)}%` : levelLabel(q, { fmt: fmtPrice, via: () => "" })}
              <QuoteTag q={q} />
            </div>
            <div className={`chg num ${q.changePct >= 0 ? "up" : "down"}`} style={{ fontSize: 12, fontWeight: 600 }}>
              {/* Yields: change in basis points (5.10% → 5.15% is +5 bp). */}
              {isPercentQuote(q.symbol) ? `${q.price >= q.prevClose ? "+" : ""}${Math.round((q.price - q.prevClose) * 100)} bp` : fmtPct(q.changePct)}
            </div>
          </button>
        ))}
      </div>
      <button className="strip-nav next" aria-label={t("strip.next")} tabIndex={-1} onClick={() => page(1)} hidden={!edges.right}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6" /></svg>
      </button>
    </div>
  );
}



/** A pre-market or after-hours print, small and apart from the regular-session price. */
function ExtendedLine({ q }: { q: Quote }) {
  const { t } = usePrefs();
  if (!q.extended) return null;
  return (
    <div className="px-ext num">
      {t(q.extended.kind === "after" ? "quote.after" : "quote.pre")} <span className={q.extended.changePct >= 0 ? "up" : "down"}>{fmtPct(q.extended.changePct)}</span>
    </div>
  );
}

/** What a strip price is when it isn't a live quote: an ETF's price, an estimate, or a dated close. */
function QuoteTag({ q }: { q: Quote }) {
  const { t, lang } = usePrefs();
  // An ETF stand-in's price is never shown as a level: "via FEZ" and its % only.
  if (q.proxy) return <span className="via" title={t("strip.via", { etf: q.proxy })}>{t("strip.viaShort", { etf: q.proxy })}</span>;
  if (q.estimatedVia) return <span className="via" title={t("strip.est", { etf: q.estimatedVia })}>≈{q.estimatedVia}</span>;
  const date = staleDayTag(q, Date.now());
  if (date) {
    const d = new Intl.DateTimeFormat(lang, { day: "numeric", month: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
    return <span className="via" title={t("strip.closeOf", { date: d })}>{d}</span>;
  }
  return null;
}
