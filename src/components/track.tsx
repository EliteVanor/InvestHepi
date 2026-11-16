"use client";

/** Track-record extras: the followed-the-AI equity curve and calibration. */
import { lsGet, usePrefs } from "./prefs";
import { fmtPct } from "./primitives";
import { type TrackStats } from "@/lib/track";
import { useToast } from "./toast";

function EquityChart({ equity }: { equity: TrackStats["equity"] }) {
  const { t } = usePrefs();
  const W = 600;
  const H = 170;
  const pad = { l: 6, r: 6, t: 14, b: 8 };
  const vals = equity.flatMap((e) => [e.ai, e.hold]).concat(0);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => pad.l + (equity.length === 1 ? 0.5 : i / (equity.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);
  const path = (key: "ai" | "hold") => equity.map((e, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(e[key]).toFixed(1)}`).join(" ");
  const lastP = equity.at(-1)!;
  return (
    <div>
      <div className="eq-legend">
        <span>
          <i className="eq-dot ai" /> {t("track.ai")} <b className={`num ${lastP.ai >= 0 ? "up" : "down"}`}>{fmtPct(lastP.ai, 1)}</b>
        </span>
        <span>
          <i className="eq-dot hold" /> {t("track.hold")} <b className={`num ${lastP.hold >= 0 ? "up" : "down"}`}>{fmtPct(lastP.hold, 1)}</b>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="eq-chart" preserveAspectRatio="none" role="img" aria-label={`${t("track.ai")} ${fmtPct(lastP.ai, 1)}, ${t("track.hold")} ${fmtPct(lastP.hold, 1)}`}>
        <defs>
          <linearGradient id="eq-g" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#5e5ce6" stopOpacity="0.25" />
            <stop offset="1" stopColor="#5e5ce6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--sep)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        <path d={`${path("ai")} L${x(equity.length - 1)},${y(min)} L${x(0)},${y(min)} Z`} fill="url(#eq-g)" />
        <path d={path("hold")} fill="none" stroke="var(--label-3)" strokeWidth="1.6" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
        <path d={path("ai")} fill="none" stroke="#5e5ce6" strokeWidth="2.4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export function TrackExtras({ stats, section = "interests" }: { stats: TrackStats; section?: string }) {
  const { t } = usePrefs();
  const toast = useToast();
  const exportCsv = async () => {
    try {
      // Fetch with the password header, then hand the browser a file.
      const pw = lsGet<string>("ih-password", "");
      const res = await fetch(`/api/track?format=csv${section === "interests" ? "" : `&section=${section}`}`, { headers: { "x-app-password": encodeURIComponent(pw) } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `investhepi-calls${section === "interests" ? "" : `-${section}`}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <>
      {stats.equity?.length >= 2 && (
        <div className="sheet-section">
          <h3>{t("track.followed")}</h3>
          <EquityChart equity={stats.equity} />
          <p className="hint">{t("track.followedHint")}</p>
        </div>
      )}
      {stats.byTicker?.length > 0 && (
        <div className="sheet-section">
          <h3>{t("track.byTicker")}</h3>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t("track.ticker")}</th>
                  <th>{t("track.calls")}</th>
                  <th>{t("track.actual")}</th>
                  <th>{t("track.avg")}</th>
                </tr>
              </thead>
              <tbody>
                {stats.byTicker.map((b) => (
                  <tr key={b.ticker}>
                    <td style={{ fontWeight: 600 }}>{b.ticker}</td>
                    <td className="num">{b.n}</td>
                    <td className="num">{Math.round((b.hits / b.n) * 100)}%</td>
                    <td className={`num ${b.avgReturn >= 0 ? "up" : "down"}`}>{fmtPct(b.avgReturn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {stats.total > 0 && (
        <div className="sheet-actions" style={{ justifyContent: "flex-start" }}>
          <button className="btn-plain" onClick={exportCsv}>{t("track.export")}</button>
        </div>
      )}
    </>
  );
}
