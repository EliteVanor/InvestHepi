"use client";

/**
 * Live price chart (TradingView Lightweight Charts, Apache-2.0).
 * - Ranges 1D · 5D · 1M · 6M · 1Y; area turns green/red vs the reference price
 * - Dashed previous-close line, volume histogram, crosshair readout
 * - Polls every 20s while the symbol trades (its own exchange's hours) and the tab is visible
 * - The header is the current quote (quote.ts): the same price and day change on every range, with the
 *   selected range's change beside it
 * - Re-themes itself when light/dark changes
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, ISeriesMarkersPluginApi, IPriceLine, SeriesMarker, Time, UTCTimestamp } from "lightweight-charts";
import type { ChartData, ChartRange } from "@/lib/chart";
import type { MsgKey } from "@/lib/i18n";
import { langInfo } from "@/lib/languages";
import { liveHours, type CurrentQuote } from "@/lib/quote-view";
import { exchangeTz, priceDigits } from "@/lib/symbols";
import type { Call } from "@/lib/types";
import { lsGet, lsSet, usePrefs } from "./prefs";
import { fmtPct, fmtPrice } from "./primitives";
import { dayIn } from "@/lib/dates";

const RANGES: ChartRange[] = ["1d", "5d", "1mo", "6mo", "1y"];
const OPTS_KEY = "ih-chart";
interface ChartOpts {
  candles: boolean;
  ma: boolean;
  calls: boolean;
}
const DEFAULT_OPTS: ChartOpts = { candles: false, ma: false, calls: true };

/** /api/chart's reply: the series plus the current quote and the range's change (quote.ts chartWithQuote). */
export type ChartReply = ChartData & { quote?: CurrentQuote | null; rangeChangePct?: number | null };

function smaSeries(bars: { t: number; c: number }[], n: number) {
  const out: { time: UTCTimestamp; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].c;
    if (i >= n) sum -= bars[i - n].c;
    if (i >= n - 1) out.push({ time: bars[i].t as UTCTimestamp, value: sum / n });
  }
  return out;
}
const POLL_MS = 20_000;

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Canvas can't parse color-mix(); turn "#rrggbb" or "rgb(a)(...)" into rgba with the given alpha. */
function alpha(color: string, a: number): string {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const rgb = color.match(/rgba?\(([^)]+)\)/);
  if (rgb) {
    const [r, g, b] = rgb[1].split(",").map((x) => x.trim());
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return color;
}

/** Flash on live ticks only: switching symbol or range (a new `scope`) resets the baseline. */
function useLiveFlash(value: number | undefined, scope: string) {
  const prev = useRef<number | undefined>(undefined);
  const prevScope = useRef(scope);
  const [flash, setFlash] = useState<"" | "flash-up" | "flash-down">("");
  useEffect(() => {
    if (value == null) return;
    if (prevScope.current !== scope) {
      prevScope.current = scope;
      prev.current = value;
      return;
    }
    if (prev.current != null && value !== prev.current) {
      setFlash(value > prev.current ? "flash-up" : "flash-down");
      const id = setTimeout(() => setFlash(""), 900);
      prev.current = value;
      return () => clearTimeout(id);
    }
    prev.current = value;
  }, [value, scope]);
  return flash;
}

export function LiveChart({ symbol, height = 280, initialRange = "1d", showHeader = true, onData }: { symbol: string; height?: number; initialRange?: ChartRange; showHeader?: boolean; onData?: (d: ChartReply) => void }) {
  const { t, lang, api } = usePrefs();
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const areaRef = useRef<ISeriesApi<"Area"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const ma20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ma50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const areaMarks = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const candleMarks = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const [opts, setOpts] = useState<ChartOpts>(DEFAULT_OPTS);
  const [calls, setCalls] = useState<Call[]>([]);
  useEffect(() => setOpts({ ...DEFAULT_OPTS, ...lsGet<Partial<ChartOpts>>(OPTS_KEY, {}) }), []);
  const toggle = (k: keyof ChartOpts) => setOpts((o) => (lsSet(OPTS_KEY, { ...o, [k]: !o[k] }), { ...o, [k]: !o[k] }));
  // Past AI calls for this ticker, drawn as markers.
  useEffect(() => {
    let stop = false;
    api<{ calls: Call[] }>(`/api/track?ticker=${encodeURIComponent(symbol)}`)
      .then((j) => !stop && setCalls(j.calls.filter((c) => c.id.endsWith(":d"))))
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [api, symbol]);
  const prevLineRef = useRef<IPriceLine | null>(null);
  const [range, setRange] = useState<ChartRange>(initialRange);
  const [data, setData] = useState<ChartReply | null>(null);
  const [err, setErr] = useState("");
  const [hover, setHover] = useState<{ price: number; time: number } | null>(null);
  const [live, setLive] = useState(false);
  const [readyTick, setReadyTick] = useState(0);
  const flash = useLiveFlash(data?.quote?.price ?? data?.price, data ? `${data.symbol}|${data.range}` : "");
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  const locale = langInfo(lang).locale;
  const tz = exchangeTz(symbol);
  const fmtTime = useCallback(
    (sec: number, withDate: boolean) =>
      new Intl.DateTimeFormat(locale, {
        timeZone: tz,
        ...(withDate ? { month: "short", day: "numeric" } : {}),
        ...(range === "6mo" || range === "1y" ? { year: "2-digit" } : { hour: "numeric", minute: "2-digit" }),
      }).format(new Date(sec * 1000)),
    [locale, range, tz],
  );

  // Create the chart once.
  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      const lc = await import("lightweight-charts");
      if (disposed || !box.current) return;
      const chart = lc.createChart(box.current, {
        height,
        autoSize: true,
        layout: { background: { type: lc.ColorType.Solid, color: "transparent" }, textColor: cssVar("--label-2"), fontFamily: cssVar("--font") || "system-ui", fontSize: 11, attributionLogo: false /* attribution is in the page footer */ },
        grid: { vertLines: { visible: false }, horzLines: { color: cssVar("--sep") } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.22 } },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true },
        crosshair: { mode: lc.CrosshairMode.Magnet, vertLine: { color: cssVar("--label-3"), labelVisible: false }, horzLine: { color: cssVar("--label-3"), labelBackgroundColor: cssVar("--label") } },
        handleScroll: false,
        handleScale: false,
      });
      const area = chart.addSeries(lc.AreaSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 4 });
      const candle = chart.addSeries(lc.CandlestickSeries, { visible: false, priceLineVisible: false, borderVisible: false, upColor: cssVar("--green"), downColor: cssVar("--red"), wickUpColor: cssVar("--green"), wickDownColor: cssVar("--red") });
      const lineOpts = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
      ma20Ref.current = chart.addSeries(lc.LineSeries, { ...lineOpts, color: "#ff9f0a" });
      ma50Ref.current = chart.addSeries(lc.LineSeries, { ...lineOpts, color: "#bf5af2" });
      candleRef.current = candle;
      areaMarks.current = lc.createSeriesMarkers(area, []);
      candleMarks.current = lc.createSeriesMarkers(candle, []);
      const vol = chart.addSeries(lc.HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
      chart.subscribeCrosshairMove((p) => {
        const v = (p.seriesData.get(area) ?? p.seriesData.get(candle)) as { value?: number; close?: number } | undefined;
        const price = v?.value ?? v?.close;
        if (!p.time || price == null) setHover(null);
        else setHover({ price, time: p.time as number });
      });
      chartRef.current = chart;
      areaRef.current = area;
      volRef.current = vol;
      ro = new ResizeObserver(() => chart.timeScale().fitContent());
      ro.observe(box.current);
      setReadyTick((x) => x + 1);
    })();
    return () => {
      disposed = true;
      ro?.disconnect();
      chartRef.current?.remove();
      chartRef.current = null;
    };
  }, [height]);

  const paint = useCallback(
    (d: ChartData) => {
      const chart = chartRef.current;
      const area = areaRef.current;
      const vol = volRef.current;
      if (!chart || !area || !vol) return;
      const ref = d.range === "1d" ? d.prevClose : d.bars[0]?.c ?? d.prevClose;
      const up = d.price >= ref;
      const color = cssVar(up ? "--green" : "--red");
      area.applyOptions({ lineColor: color, topColor: alpha(color, 0.26), bottomColor: alpha(color, 0) });
      area.setData(d.bars.map((b) => ({ time: b.t as UTCTimestamp, value: b.c })));
      const candle = candleRef.current;
      candle?.setData(d.bars.map((b) => ({ time: b.t as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c })));
      area.applyOptions({ visible: !opts.candles });
      candle?.applyOptions({ visible: opts.candles });
      // Moving averages only make sense on daily bars.
      const daily = d.range === "6mo" || d.range === "1y";
      ma20Ref.current?.setData(opts.ma && daily ? smaSeries(d.bars, 20) : []);
      ma50Ref.current?.setData(opts.ma && daily ? smaSeries(d.bars, 50) : []);
      // AI call markers: one per session, on the first bar of that day.
      const firstBar = new Map<string, number>();
      for (const b of d.bars) {
        const day = dayIn(tz, b.t * 1000);
        if (!firstBar.has(day)) firstBar.set(day, b.t);
      }
      const marks: SeriesMarker<Time>[] = opts.calls
        ? calls
            .filter((c) => firstBar.has(c.date) && c.direction !== "flat")
            .map((c) => ({
              time: firstBar.get(c.date)! as UTCTimestamp,
              position: c.direction === "up" ? ("belowBar" as const) : ("aboveBar" as const),
              shape: c.direction === "up" ? ("arrowUp" as const) : ("arrowDown" as const),
              color: c.correct === undefined ? cssVar("--label-3") : c.correct ? cssVar("--green") : cssVar("--red"),
              size: 1,
            }))
            .sort((a, b) => (a.time as number) - (b.time as number))
        : [];
      areaMarks.current?.setMarkers(opts.candles ? [] : marks);
      candleMarks.current?.setMarkers(opts.candles ? marks : []);
      const volColor = alpha(cssVar("--label-3"), 0.3);
      vol.setData(d.bars.map((b) => ({ time: b.t as UTCTimestamp, value: b.v, color: volColor })));
      if (prevLineRef.current) area.removePriceLine(prevLineRef.current);
      prevLineRef.current = d.range === "1d" ? area.createPriceLine({ price: d.prevClose, color: cssVar("--label-3"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" }) : null;
      chart.applyOptions({
        localization: { locale, timeFormatter: (time: number) => fmtTime(time, d.range !== "1d"), priceFormatter: (p: number) => fmtPrice(p, priceDigits(d.symbol, p)) },
        timeScale: {
          timeVisible: d.range !== "6mo" && d.range !== "1y",
          // Axis labels in the exchange's time zone, matching the crosshair readout.
          tickMarkFormatter: (time: number, type: number) => {
            const date = new Date(time * 1000);
            const opts: Intl.DateTimeFormatOptions =
              type === 0 ? { year: "numeric" } : type === 1 ? { month: "short" } : type === 2 ? { month: "short", day: "numeric" } : { hour: "numeric", minute: "2-digit" };
            return new Intl.DateTimeFormat(locale, { timeZone: tz, ...opts }).format(date);
          },
        },
      });
      chart.timeScale().fitContent();
    },
    [fmtTime, locale, opts, calls, tz],
  );

  const load = useCallback(async () => {
    try {
      const d = await api<ChartReply>(`/api/chart?symbol=${encodeURIComponent(symbol)}&range=${range}`);
      setData(d);
      setErr("");
      onDataRef.current?.(d);
    } catch (e) {
      if ((e as Error).message !== "401") setErr((e as Error).message);
    }
  }, [api, symbol, range]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  useEffect(() => {
    if (data) paint(data);
  }, [data, paint, readyTick]);

  // Live polling while the session is active and the page is visible.
  useEffect(() => {
    if (range !== "1d" && range !== "5d") {
      setLive(false);
      return;
    }
    const tick = () => {
      const open = liveHours(symbol, Date.now());
      setLive(open);
      if (open && document.visibilityState === "visible") load();
    };
    const id = setInterval(tick, POLL_MS);
    setLive(liveHours(symbol, Date.now()));
    const onVis = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [range, load]);

  // Re-theme on light/dark switch.
  useEffect(() => {
    const re = () => {
      const chart = chartRef.current;
      if (!chart) return;
      chart.applyOptions({ layout: { textColor: cssVar("--label-2") }, grid: { horzLines: { color: cssVar("--sep") } }, crosshair: { horzLine: { labelBackgroundColor: cssVar("--label") } } });
      if (data) paint(data);
    };
    const mo = new MutationObserver(re);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", re);
    return () => {
      mo.disconnect();
      mq.removeEventListener("change", re);
    };
  }, [data, paint]);

  // Hovering reads the chart (change vs the range's start); otherwise the header is the current quote.
  const q = data?.quote ?? null;
  const ref = data ? (data.range === "1d" ? data.prevClose : data.bars[0]?.c ?? data.prevClose) : 0;
  const shown = hover?.price ?? q?.price ?? data?.price;
  const chg = !data || shown == null ? 0 : hover ? shown - ref : q ? q.price - q.prevClose : data.price - data.prevClose;
  const chgPct = !data ? 0 : hover ? (ref ? (chg / ref) * 100 : 0) : q?.changePct ?? data.changePct;
  const proxyVia = q ? (q.basis === "proxy" ? q.via : undefined) : data?.proxy;
  const estimated = q ? q.basis === "estimate" : !!data?.estimatedVia;
  const rangeLabel: Record<ChartRange, string> = { "1d": "1D", "5d": "5D", "1mo": "1M", "6mo": "6M", "1y": "1Y" };
  const stale = q ? q.stale : !!data?.stale;
  const asOf = q?.asOf ?? data?.asOf ?? 0;
  // Daily-only data is never "live"; and the day change says which session it is when it isn't today's.
  const isLive = live && !stale && (q ? q.intraday : !data?.dailyOnly);
  const dayOf = (sec: number) => dayIn(tz, sec * 1000);
  const session = q?.session ?? dayOf(asOf);
  const sessionLabel = data
    ? session === dayOf(Date.now() / 1000)
      ? t("chart.today")
      : new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${session}T12:00:00Z`))
    : "";
  const rangeChg = !hover && range !== "1d" && data?.rangeChangePct != null ? data.rangeChangePct : null;
  const ext = !hover ? q?.extended : undefined;
  const sourceNote = !data
    ? ""
    : proxyVia
      ? t("strip.via", { etf: proxyVia })
      : estimated
        ? t("strip.est", { etf: q?.via ?? data.estimatedVia ?? "" })
        : data.shapeVia
          ? t("chart.shape", { etf: data.shapeVia })
          : (q?.dailyOnly ?? data.dailyOnly)
            ? t("strip.closeOf", { date: new Intl.DateTimeFormat(locale, { timeZone: tz, day: "numeric", month: "short" }).format(new Date(asOf * 1000)) })
            : "";

  return (
    <div className="chart">
      {showHeader && (
        <div className="chart-head">
          <div>
            <div className="chart-price num">
              {/* An ETF stand-in's price is never shown as the symbol's level (only its %, "via <ETF>"). */}
              <span className={flash}>{shown == null ? "—" : proxyVia && !hover ? t("strip.viaShort", { etf: proxyVia }) : `${estimated && !hover ? "≈" : ""}${fmtPrice(shown, priceDigits(symbol, shown))}`}</span>
            </div>
            <div className={`chart-chg num ${chg >= 0 ? "up" : "down"}`}>
              {data ? (proxyVia && !hover ? fmtPct(chgPct) : `${chg >= 0 ? "+" : ""}${fmtPrice(Math.abs(chg) < 1000 ? chg : Math.round(chg))} (${fmtPct(chgPct)})`) : " "}
              <span className="chart-when">{hover ? fmtTime(hover.time, range !== "1d" || !!data?.dailyOnly) : sessionLabel}</span>
              {rangeChg != null && (
                <span className={`chart-range-chg ${rangeChg >= 0 ? "up" : "down"}`}>
                  {t(`chart.range.${range}` as MsgKey)} {fmtPct(rangeChg)}
                </span>
              )}
            </div>
            {ext && (
              <div className="chart-ext num">
                {t(ext.kind === "after" ? "quote.after" : "quote.pre")} {proxyVia ? "" : fmtPrice(ext.price, priceDigits(symbol, ext.price))} <span className={ext.changePct >= 0 ? "up" : "down"}>({fmtPct(ext.changePct)})</span>
              </div>
            )}
          </div>
          <span className="spacer" />
          {data && (
            <span className="chart-live">
              <span className={`dot ${isLive ? "live" : ""}`} />
              {isLive ? t("chart.live") : stale ? t("chart.delayed") : t("chart.asOf", { t: new Intl.DateTimeFormat(locale, { timeZone: tz, month: "short", day: "numeric", ...(data.dailyOnly ? {} : { hour: "numeric", minute: "2-digit" }) }).format(new Date(asOf * 1000)) })}
            </span>
          )}
        </div>
      )}
      {showHeader && sourceNote && <div className="chart-note">{sourceNote}</div>}
      <div className="chart-canvas" ref={box} style={{ height }} aria-label={`${symbol} chart`} role="img">
        {!data && !err && <div className="skeleton chart-skel" />}
        {err && (
          <div className="chart-err">
            <span>{t("chart.error")}</span>
            <small>{err}</small>
          </div>
        )}
      </div>
      <div className="chart-foot">
        <div className="segmented chart-ranges" role="tablist">
          {RANGES.map((r) => (
            <button key={r} role="tab" aria-selected={range === r} onClick={() => setRange(r)}>
              {rangeLabel[r]}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <div className="chart-tools">
          <button className="filter" aria-pressed={opts.candles} onClick={() => toggle("candles")}>{t("chart.candles")}</button>
          <button className="filter" aria-pressed={opts.ma} onClick={() => toggle("ma")} title="20 / 50">
            {t("chart.ma")}
          </button>
          {calls.length > 0 && (
            <button className="filter" aria-pressed={opts.calls} onClick={() => toggle("calls")}>{t("chart.calls")}</button>
          )}
        </div>
      </div>
    </div>
  );
}
