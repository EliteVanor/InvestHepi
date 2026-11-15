"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { Direction } from "@/lib/types";
import { IconX } from "./Icons";

/** Bottom sheet on phones, centered panel on desktop. Esc and scrim click close it. */
export function Sheet({ title, onClose, children, actions, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
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
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Minimal SVG sparkline. Color follows direction of the series. */
export function Sparkline({ values, width = 108, height = 26, strokeWidth = 1.6, fill = true }: { values: number[]; width?: number; height?: number; strokeWidth?: number; fill?: boolean }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - 2 - ((v - min) / span) * (height - 4)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const color = values[values.length - 1] >= values[0] ? "var(--green)" : "var(--red)";
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

export function fmtPct(n: number, digits = 2) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

/** Friendly ticker label: "^VNINDEX.VN" → "VN-Index", "FPT.VN" → "FPT". */
const SYM_LABEL: Record<string, string> = { "^VNINDEX.VN": "VN-Index", "^VN30.VN": "VN30", "^HNX.VN": "HNX", "VND=X": "USD/VND", "E1VFVN30.VN": "VN30 ETF" };
export function symLabel(s: string) {
  return SYM_LABEL[s] ?? s.replace(/\.VN$/, "");
}

export function fmtPrice(n: number) {
  return n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : n.toFixed(2);
}
