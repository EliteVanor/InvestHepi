"use client";

import type { Digest, Quote } from "@/lib/types";
import { usePrefs } from "../prefs";
import { fmtPct } from "../primitives";
import { moverChange } from "@/lib/quote-view";
import { symName } from "../labels";


/* ---------------------------------------------------------------- Movers */

export function Movers({ movers, quotes, onTicker }: { movers: Digest["analysis"]["movers"]; quotes: Quote[]; onTicker: (s: string) => void }) {
  const { t } = usePrefs();
  if (!movers?.length) return null;
  return (
    <section className="card" aria-labelledby="movers-h">
      <h2 className="card-title" id="movers-h">
        <IconChartSmall /> {t("movers.title")}
      </h2>
      {movers.map((m) => {
        const chg = moverChange(m, quotes);
        return (
          <div className="mover" key={m.ticker}>
            <button className="mover-tk" onClick={() => onTicker(m.ticker)}>
              {symName(t, m.ticker)}
            </button>
            <span className={`mover-chg num ${chg >= 0 ? "up" : "down"}`}>{fmtPct(chg)}</span>
            <div className="mover-why">{m.why}</div>
          </div>
        );
      })}
    </section>
  );
}

function IconChartSmall() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 17 6-6 4 4 8-8" />
      <path d="M14 7h7v7" />
    </svg>
  );
}
