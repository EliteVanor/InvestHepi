"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { Direction } from "@/lib/types";
import { IconX } from "./Icons";
import { usePrefs } from "./prefs";

/*
 * Overlays on phones. iOS sizes `vh` with the browser bars hidden, so a sheet capped at 92vh is taller
 * than the visible screen when Safari's or Brave's bars are showing, and its top (title, close button)
 * slides above the screen. While any overlay is open we publish the real visible height as
 * --app-h (visualViewport, which also shrinks for the on-screen keyboard; CSS falls back to dvh/vh),
 * and lock the page behind it the way iOS respects (body fixed at the current scroll position;
 * `overflow: hidden` alone doesn't stop iOS from scrolling the page).
 */
let overlays = 0;
let savedY = 0;
let stopVV: (() => void) | null = null;

function trackViewport() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const set = () => {
    root.style.setProperty("--app-h", `${Math.round(vv ? vv.height : window.innerHeight)}px`);
    root.style.setProperty("--app-top", `${Math.round(vv ? vv.offsetTop : 0)}px`);
  };
  set();
  vv?.addEventListener("resize", set);
  vv?.addEventListener("scroll", set);
  window.addEventListener("resize", set);
  return () => {
    vv?.removeEventListener("resize", set);
    vv?.removeEventListener("scroll", set);
    window.removeEventListener("resize", set);
    root.style.removeProperty("--app-h");
    root.style.removeProperty("--app-top");
  };
}

/** Call while an overlay is open: real visible height + page scroll lock. Nested overlays share one lock. Exported for tests. */
export function openOverlay(): () => void {
  if (overlays++ === 0) {
    savedY = window.scrollY;
    const b = document.body.style;
    b.position = "fixed";
    b.top = `-${savedY}px`;
    b.left = "0";
    b.right = "0";
    b.overflow = "hidden";
    stopVV = trackViewport();
  }
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    if (--overlays > 0) return;
    const b = document.body.style;
    b.position = b.top = b.left = b.right = b.overflow = "";
    window.scrollTo(0, savedY);
    stopVV?.();
    stopVV = null;
  };
}

/**
 * Bottom sheet on phones, centered panel on desktop. Esc and scrim click close it. The header (title,
 * actions, close) sits outside the scrolling body, so it's always on screen.
 */
export function Sheet({ title, onClose, children, actions, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = usePrefs();
  useEffect(() => openOverlay(), []);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      // Keep keyboard focus inside the sheet.
      if (e.key === "Tab" && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || !ref.current.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !ref.current.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet split" role="dialog" aria-modal="true" tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()} style={wide ? { maxWidth: 820 } : undefined}>
        <div className="grabber" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <span className="spacer" />
          {actions}
          <button className="icon-btn" onClick={onClose} aria-label={t("set.close")}>
            <IconX />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/** Minimal SVG sparkline. Color follows direction of the series. */
/**
 * Mini line chart. By default colored by its own first-to-last move. Pass `up` to color it by the
 * figure shown next to it (the day's change), and `baseline` (previous close) to draw it dotted and
 * keep it in range, the way a session chart is read: above the line = up on the day.
 */
export function Sparkline({ values, width = 108, height = 26, strokeWidth = 1.6, fill = true, up, baseline, neutral }: { values: number[]; width?: number; height?: number; strokeWidth?: number; fill?: boolean; up?: boolean; baseline?: number; neutral?: boolean }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const range = baseline != null && Number.isFinite(baseline) ? [...values, baseline] : values;
  const min = Math.min(...range);
  const max = Math.max(...range);
  const span = max - min || 1;
  const yOf = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, yOf(v)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const color = neutral ? "var(--label-3, #8e8e93)" : (up ?? values[values.length - 1] >= values[0]) ? "var(--green)" : "var(--red)";
  const id = `g${Math.round(values[0] * 1000) % 100000}${values.length}${width}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${d} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />
        </>
      )}
      {baseline != null && Number.isFinite(baseline) && (
        <line x1="0" x2={width} y1={yOf(baseline)} y2={yOf(baseline)} stroke="var(--label-3, currentColor)" strokeOpacity="0.45" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      )}
      <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Apple Watch-style ring showing confidence. */
export function Ring({ value, direction, size = 52 }: { value: number; direction: Direction; size?: number }) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = direction === "up" ? "var(--green)" : direction === "down" ? "var(--red)" : "var(--orange)";
  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${value}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fill)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${(c * Math.max(0, Math.min(100, value))) / 100} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.27}>
        {value}
      </text>
    </svg>
  );
}

export const arrow = (d: Direction) => (d === "up" ? "↑" : d === "down" ? "↓" : "→");

/** Formatters never throw: prices come from several free sources and one bad value must not crash the page. */
export function fmtPct(n: number, digits = 2) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "–";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export { symLabel } from "@/lib/symbols";

/**
 * Price text. Index levels keep 2 decimals (VN-Index 1,734.93, not 1,735); whole-number prices such as
 * Vietnamese shares stay whole (53,800). `digits` overrides (currency pairs: 4).
 */
export function fmtPrice(n: number, digits?: number) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "–";
  if (digits != null) return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toFixed(2);
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span />
    </label>
  );
}

/* ------------------------------------------------------------ alerts tab */
