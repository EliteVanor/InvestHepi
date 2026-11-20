"use client";

/** Side cards beside a briefing: the benchmark chart, the US sector heatmap, scenarios and the mood gauge. */
import { useEffect, useState } from "react";
import { type MsgKey } from "@/lib/i18n";
import { type Quote, type Scenario } from "@/lib/types";
import { IconBolt, IconCalendar, IconChart, IconEye } from "./Icons";
import { LiveChart } from "./LiveChart";
import { usePrefs } from "./prefs";
import { fmtPct } from "./primitives";
import { type MoodGauge } from "@/lib/mood";
import { moodDetail } from "./labels";
import { useLiveQuotes } from "./live";

export function ChartCard({ symbols, quotes, onOpen }: { symbols: string[]; quotes: Quote[]; onOpen: (s: string) => void }) {
  const { t } = usePrefs();
  const [sym, setSym] = useState(symbols[0]);
  useEffect(() => {
    if (!symbols.includes(sym)) setSym(symbols[0]);
  }, [symbols, sym]);
  if (!sym) return null;
  return (
    <section className="card" aria-labelledby="chart-h">
      <h2 className="card-title" id="chart-h">
        <IconChart /> {t("chart.title")}
        <span className="spacer" />
        <button className="pill-btn" style={{ textTransform: "none", letterSpacing: 0 }} onClick={() => onOpen(sym)}>
          {sym} ↗
        </button>
      </h2>
      <div className="sym-chips" role="toolbar">
        {symbols.map((s) => {
          const q = quotes.find((x) => x.symbol === s);
          return (
            <button key={s} className="sym-chip" aria-pressed={s === sym} onClick={() => setSym(s)}>
              {s}
              {q && <small className={q.changePct >= 0 ? "up" : "down"}>{fmtPct(q.changePct, 1)}</small>}
            </button>
          );
        })}
      </div>
      <LiveChart key={sym} symbol={sym} height={260} />
    </section>
  );
}

const SECTOR_LIST: [string, MsgKey][] = [
  ["XLK", "sector.tech"], ["SMH", "sector.semis"], ["XLC", "sector.comms"], ["XLY", "sector.discretionary"],
  ["XLF", "sector.financials"], ["XLI", "sector.industrials"], ["XLV", "sector.health"], ["XLE", "sector.energy"],
  ["XLB", "sector.materials"], ["XLP", "sector.staples"], ["XLU", "sector.utilities"], ["XLRE", "sector.realestate"],
];

function heatColor(pct: number): { background: string; color: string } {
  const a = Math.min(1, Math.abs(pct) / 2.5); // ±2.5% = full intensity
  const base = pct >= 0 ? "52, 199, 89" : "255, 59, 48";
  return { background: `rgba(${base}, ${0.1 + a * 0.55})`, color: a > 0.6 ? "#fff" : "var(--label)" };
}

export function SectorHeatmap({ sectors, onOpen }: { sectors?: Quote[]; onOpen: (s: string) => void }) {
  const { t } = usePrefs();
  const live = useLiveQuotes(SECTOR_LIST.map(([s]) => s));
  const tiles = SECTOR_LIST.map(([sym, key]) => {
    const l = live.get(sym);
    const d = sectors?.find((x) => x.symbol === sym);
    return { sym, key, pct: l?.changePct ?? d?.changePct };
  }).filter((x) => x.pct != null) as { sym: string; key: MsgKey; pct: number }[];
  if (!tiles.length) return null;
  tiles.sort((a, b) => b.pct - a.pct);
  return (
    <section className="card" aria-labelledby="heat-h">
      <h2 className="card-title" id="heat-h">
        <IconBolt /> {t("heat.title")}
      </h2>
      <div className="heat">
        {tiles.map((x) => (
          <button key={x.sym} className="heat-tile" style={heatColor(x.pct)} onClick={() => onOpen(x.sym)} title={x.sym}>
            <b>{t(x.key)}</b>
            <span>{fmtPct(x.pct, 1)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function ScenarioCases({ cases }: { cases: Scenario["cases"] }) {
  const { t } = usePrefs();
  return (
    <div className="scen-cases">
      {cases.map((c, i) => (
        <div className="scen-case" key={i}>
          <div className="scen-head">
            <b>{c.label}</b>
            <span className="num">{c.probability}%</span>
          </div>
          <div className="scen-bar">
            <i style={{ width: `${c.probability}%` }} />
          </div>
          <p>{c.reaction}</p>
          <p className="scen-do">
            <b>{t("scen.do")}:</b> {c.action}
          </p>
        </div>
      ))}
    </div>
  );
}

export function ScenariosCard({ scenarios }: { scenarios?: Scenario[] }) {
  const { t } = usePrefs();
  const sc = scenarios?.[0];
  if (!sc) return null;
  return (
    <section className="card" aria-labelledby="scen-h">
      <h2 className="card-title" id="scen-h">
        <IconCalendar /> {t("scen.title")}
        <span className="spacer" />
        <span className="scen-when">{sc.when}</span>
      </h2>
      <h3 className="scen-title">{sc.catalyst}</h3>
      <ScenarioCases cases={sc.cases} />
      <p className="note">{t("scen.estimate")}</p>
    </section>
  );
}

export function MoodGaugeCard({ gauge }: { gauge?: MoodGauge }) {
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  if (!gauge) return null;
  const angle = Math.PI - (gauge.score / 100) * Math.PI;
  const nx = 100 + 58 * Math.cos(angle);
  const ny = 100 - 58 * Math.sin(angle);
  const tone = gauge.score < 45 ? "down" : gauge.score > 55 ? "up" : "flat";
  return (
    <section className="card mood-card" aria-labelledby="mood-h">
      <h2 className="card-title" id="mood-h">
        <IconEye /> {t("mood.title")}
      </h2>
      <button className="gauge" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`${t("mood.title")}: ${gauge.score}, ${t(`mood.${gauge.label}` as MsgKey)}`}>
        <svg viewBox="0 0 200 116" aria-hidden="true">
          <defs>
            <linearGradient id="gauge-g" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#ff453a" />
              <stop offset="0.35" stopColor="#ff9f0a" />
              <stop offset="0.5" stopColor="#8e8e93" />
              <stop offset="0.65" stopColor="#a4d65e" />
              <stop offset="1" stopColor="#30d158" />
            </linearGradient>
          </defs>
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="var(--fill)" strokeWidth="14" strokeLinecap="round" />
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="url(#gauge-g)" strokeWidth="14" strokeLinecap="round" opacity="0.9" />
          <line x1="100" y1="100" x2={nx} y2={ny} stroke="var(--label)" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="100" cy="100" r="6" fill="var(--label)" />
        </svg>
        <div className="gauge-read">
          <span className="gauge-score num">{gauge.score}</span>
          <span className={`gauge-label ${tone}`}>{t(`mood.${gauge.label}` as MsgKey)}</span>
        </div>
      </button>
      {open && (
        <div className="gauge-parts">
          {gauge.parts.map((p) => (
            <div key={p.key} className="gauge-part">
              <span>{t(`mood.part.${p.key}` as MsgKey)}</span>
              <span className="muted num">{moodDetail(t, p.detail)}</span>
              <div className="scen-bar">
                <i style={{ width: `${p.score}%`, background: p.score < 45 ? "var(--red)" : p.score > 55 ? "var(--green)" : "var(--orange)" }} />
              </div>
            </div>
          ))}
          <p className="note">{t("mood.hint")}</p>
        </div>
      )}
    </section>
  );
}
