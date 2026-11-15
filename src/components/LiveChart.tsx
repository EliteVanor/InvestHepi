"use client";

/**
 * Live price chart (TradingView Lightweight Charts, Apache-2.0).
 * - Ranges 1D · 5D · 1M · 6M · 1Y; area turns green/red vs the reference price
 * - Dashed previous-close line, volume histogram, crosshair readout
 * - Polls every 20s while the market session is active and the tab is visible
 * - Re-themes itself when light/dark changes
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, IPriceLine, UTCTimestamp } from "lightweight-charts";
import type { ChartData, ChartRange } from "@/lib/chart";
import { langInfo } from "@/lib/languages";
import { marketClock } from "@/lib/marketTime";
import { usePrefs } from "./prefs";
import { fmtPct, fmtPrice } from "./primitives";

const RANGES: ChartRange[] = ["1d", "5d", "1mo", "6mo", "1y"];
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

function useLiveFlash(value: number | undefined) {
  const prev = useRef<number | undefined>(undefined);
  const [flash, setFlash] = useState<"" | "flash-up" | "flash-down">("");
  useEffect(() => {
    if (value == null) return;
    if (prev.current != null && value !== prev.current) {
      setFlash(value > prev.current ? "flash-up" : "flash-down");
      const id = setTimeout(() => setFlash(""), 900);
      prev.current = value;
      return () => clearTimeout(id);
    }
    prev.current = value;
  }, [value]);
  return flash;
}

export function LiveChart({ symbol, height = 280, initialRange = "1d", showHeader = true, onData }: { symbol: string; height?: number; initialRange?: ChartRange; showHeader?: boolean; onData?: (d: ChartData) => void }) {
  const { t, lang, api } = usePrefs();
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const areaRef = useRef<ISeriesApi<"Area"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const prevLineRef = useRef<IPriceLine | null>(null);
  const [range, setRange] = useState<ChartRange>(initialRange);
  const [data, setData] = useState<ChartData | null>(null);
  const [err, setErr] = useState("");
  const [hover, setHover] = useState<{ price: number; time: number } | null>(null);
  const [live, setLive] = useState(false);
  const [readyTick, setReadyTick] = useState(0);
  const flash = useLiveFlash(data?.price);
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  const locale = langInfo(lang).locale;
  const fmtTime = useCallback(
    (sec: number, withDate: boolean) =>
      new Intl.DateTimeFormat(locale, {
        timeZone: "America/New_York",
        ...(withDate ? { month: "short", day: "numeric" } : {}),
        ...(range === "6mo" || range === "1y" ? { year: "2-digit" } : { hour: "numeric", minute: "2-digit" }),
      }).format(new Date(sec * 1000)),
    [locale, range],
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
      const vol = chart.addSeries(lc.HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
      chart.subscribeCrosshairMove((p) => {
        const v = p.seriesData.get(area) as { value?: number } | undefined;
        if (!p.time || v?.value == null) setHover(null);
        else setHover({ price: v.value, time: p.time as number });
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
      const volColor = alpha(cssVar("--label-3"), 0.3);
      vol.setData(d.bars.map((b) => ({ time: b.t as UTCTimestamp, value: b.v, color: volColor })));
      if (prevLineRef.current) area.removePriceLine(prevLineRef.current);
      prevLineRef.current = d.range === "1d" ? area.createPriceLine({ price: d.prevClose, color: cssVar("--label-3"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" }) : null;
      chart.applyOptions({
        localization: { locale, timeFormatter: (time: number) => fmtTime(time, d.range !== "1d"), priceFormatter: (p: number) => fmtPrice(p) },
        timeScale: {
          timeVisible: d.range !== "6mo" && d.range !== "1y",
          // Axis labels in New York time, matching the crosshair readout.
          tickMarkFormatter: (time: number, type: number) => {
            const date = new Date(time * 1000);
            const opts: Intl.DateTimeFormatOptions =
              type === 0 ? { year: "numeric" } : type === 1 ? { month: "short" } : type === 2 ? { month: "short", day: "numeric" } : { hour: "numeric", minute: "2-digit" };
            return new Intl.DateTimeFormat(locale, { timeZone: "America/New_York", ...opts }).format(date);
          },
        },
      });
      chart.timeScale().fitContent();
    },
    [fmtTime, locale],
  );

  const load = useCallback(async () => {
    try {
      const d = await api<ChartData>(`/api/chart?symbol=${encodeURIComponent(symbol)}&range=${range}`);
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
      const { phase } = marketClock();
      const active = phase !== "closed" && document.visibilityState === "visible";
      setLive(phase === "open");
      if (active) load();
    };
    const id = setInterval(tick, POLL_MS);
    setLive(marketClock().phase === "open");
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

  const ref = data ? (data.range === "1d" ? data.prevClose : data.bars[0]?.c ?? data.prevClose) : 0;
  const shown = hover?.price ?? data?.price;
  const chg = data && shown != null ? shown - ref : 0;
  const chgPct = data && ref ? (chg / ref) * 100 : 0;
  const rangeLabel: Record<ChartRange, string> = { "1d": "1D", "5d": "5D", "1mo": "1M", "6mo": "6M", "1y": "1Y" };
  const stale = data ? Date.now() / 1000 - data.asOf > 20 * 60 && marketClock().phase === "open" : false;

  return (
    <div className="chart">
      {showHeader && (
        <div className="chart-head">
          <div>
            <div className="chart-price num">
              <span className={flash}>{shown != null ? fmtPrice(shown) : "—"}</span>
            </div>
            <div className={`chart-chg num ${chg >= 0 ? "up" : "down"}`}>
              {data ? `${chg >= 0 ? "+" : ""}${fmtPrice(Math.abs(chg) < 1000 ? chg : Math.round(chg))} (${fmtPct(chgPct)})` : " "}
              <span className="chart-when">
                {hover ? fmtTime(hover.time, range !== "1d") : data ? (range === "1d" ? t("chart.today") : t(`chart.range.${range}`)) : ""}
              </span>
            </div>
          </div>
          <span className="spacer" />
          {data && (
            <span className="chart-live">
              <span className={`dot ${live && !stale ? "live" : ""}`} />
              {live && !stale ? t("chart.live") : stale ? t("chart.delayed") : t("chart.asOf", { t: fmtTime(data.asOf, true) })}
            </span>
          )}
        </div>
      )}
      <div className="chart-canvas" ref={box} style={{ height }} aria-label={`${symbol} chart`} role="img">
        {!data && !err && <div className="skeleton chart-skel" />}
        {err && <div className="chart-err">{t("chart.error")}</div>}
      </div>
      <div className="segmented chart-ranges" role="tablist">
        {RANGES.map((r) => (
          <button key={r} role="tab" aria-selected={range === r} onClick={() => setRange(r)}>
            {rangeLabel[r]}
          </button>
        ))}
      </div>
    </div>
  );
}
