"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { Direction } from "@/lib/types";
import { IconX } from "./Icons";
import { usePrefs } from "./prefs";

/** Bottom sheet on phones, centered panel on desktop. Esc and scrim click close it. */
export function Sheet({ title, onClose, children, actions, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = usePrefs();
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
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()} style={wide ? { maxWidth: 820 } : undefined}>
        <div className="grabber" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <span className="spacer" />
          {actions}
          <button className="icon-btn" onClick={onClose} aria-label={t("set.close")}>
            <IconX />
          </button>
        </div>
        {children}
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
