"use client";

/**
 * The track record sheet: how often the AI's calls were right, against what baseline, how sure it
 * was vs how often it was right, what each action returned, and which calls wait for a close.
 */
import { useEffect, useState } from "react";
import { relTime, type MsgKey } from "@/lib/i18n";
import { exchangeTz, symLabel } from "@/lib/symbols";
import { type Rate, type TrackStats } from "@/lib/track";
import { SECTION_IDS, type Call, type SectionId } from "@/lib/types";
import { lsGet, usePrefs } from "./prefs";
import { Sheet, arrow, fmtPct } from "./primitives";
import { useToast } from "./toast";

const pctOf = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);
/** Fewer graded calls than this and the numbers are labeled early data. */
const EARLY = 30;

/** When a call was made: "Before market", "Mid-day" or, for weekly calls, "Week from Wed". Calls before v18 count as before market. */
function madeLabel(t: ReturnType<typeof usePrefs>["t"], lang: string, c: { id: string; phase?: string; date: string }) {
  if (c.id.endsWith(":w")) return t("track.weekFrom", { day: new Intl.DateTimeFormat(lang, { weekday: "short", timeZone: "UTC" }).format(new Date(c.date + "T12:00:00Z")) });
  return t((c.phase ?? (c.id.endsWith(":m") ? "mid" : "pre")) === "mid" ? "pred.mid" : "pred.pre");
}

export function TrackSheet({ onClose, section = "interests" }: { onClose: () => void; section?: SectionId }) {
  const { t, api, lang, marketTime } = usePrefs();
  const [sec, setSec] = useState<SectionId>(section);
  const [s, setS] = useState<TrackStats | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setS(null);
    setErr("");
    api<TrackStats>(`/api/track${sec === "interests" ? "" : `?section=${sec}`}`).then(setS).catch((e) => setErr((e as Error).message));
  }, [api, sec]);
  const fmtDate = (iso: string) => new Intl.DateTimeFormat(lang, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(iso + "T12:00:00Z"));
  const callLabel = (c: Pick<Call, "direction" | "action">) => (
    <span className={c.direction}>
      {arrow(c.direction)} {t(`act.${c.action}` as MsgKey)}
    </span>
  );

  return (
    <Sheet title={t("track.title")} onClose={onClose} wide>
      <p className="hint" style={{ marginTop: 0 }}>{t("track.intro")}</p>
      {/* Each section keeps its own record: your interests, plus the shared World, US and Vietnam calls. */}
      <div className="segmented track-seg" role="tablist" aria-label={t("track.title")}>
        {SECTION_IDS.map((x) => (
          <button key={x} role="tab" aria-selected={sec === x} className={sec === x ? "on" : ""} onClick={() => setSec(x)}>
            {t(`sec.${x}` as MsgKey)}
          </button>
        ))}
      </div>
      {err && <p className="hint bad">{err}</p>}
      {!s ? (
        <div className="skeleton" style={{ height: 220, marginTop: 16 }} />
      ) : (
        <>
          <Summary s={s} />
          <Calibration s={s} />
          <ByAction s={s} />
          <TrackExtras stats={s} section={sec} />
          {s.pending.length > 0 && (
            <div className="sheet-section">
              <h3>
                {t("track.waiting")} <span className="muted num">({s.pending.length})</span>
              </h3>
              <div className="tr-list">
                {s.pending.map((p) => (
                  <div className="tr-item" key={p.id}>
                    <div className="tr-row">
                      <span className="num tr-date">{fmtDate(p.date)}</span>
                      <b className="tr-sym">{symLabel(p.ticker)}</b>
                      {callLabel(p as Pick<Call, "direction" | "action">)}
                      <span className="num muted">{p.confidence}%</span>
                      <span className="tr-when muted">{relTime(p.gradesAfter, lang)}</span>
                    </div>
                    <div className="tr-sub">
                      <span className="tr-made">{madeLabel(t, lang, p)}</span> · {marketTime(p.madeAt, exchangeTz(p.ticker), { day: p.horizon === "w" })} · {t("track.gradedClose", { when: marketTime(p.closesAt ?? p.gradesAfter, exchangeTz(p.ticker), { day: true }) })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="sheet-section">
            <h3>{t("track.recent")}</h3>
            {s.recent.length === 0 ? (
              <p className="hint">{t("track.none")}</p>
            ) : (
              <div className="tr-list">
                {s.recent.map((c) => (
                  <div className="tr-item" key={c.id}>
                    <div className="tr-row">
                      <span className="num tr-date">{fmtDate(c.date)}</span>
                      <b className="tr-sym">{symLabel(c.ticker)}</b>
                      {callLabel(c)}
                      <span className="num muted">{c.confidence}%</span>
                      {c.closed ? (
                        <span className="tr-result muted">{t("track.closed")}</span>
                      ) : (
                        <span className={`num tr-result ${c.noResult || c.noLiveBase ? "muted" : c.correct ? "ok" : "bad"}`} title={c.band != null ? `±${c.band}%` : undefined}>
                          {c.noResult ? "–" : c.correct ? "✓" : "✗"} {fmtPct(c.returnPct ?? 0)}
                        </span>
                      )}
                    </div>
                    <div className="tr-sub">
                      <span className="tr-made">{madeLabel(t, lang, c)}</span> · {marketTime(c.madeAt, exchangeTz(c.ticker), { day: c.id.endsWith(":w") })}
                      {!c.closed && <> · {t("track.gradedClose", { when: new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date((c.gradedOn ?? c.endDate ?? c.date) + "T12:00:00Z")) })}</>}
                      {c.closed && <> · {t("track.closedHint")}</>}
                      {c.noLiveBase && !c.closed && <> · {t("track.uncountedOne")}</>}
                      {c.baseChg != null && <> · {t("track.fromNow", { chg: fmtPct(c.baseChg) })}</>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}

/** The headline: hit rate on up/down calls, its likely range, and the edge over "always up". */
function Summary({ s }: { s: TrackStats }) {
  const { t } = usePrefs();
  const d = s.direction;
  const skillPts = d.skill == null ? null : Math.round(d.skill * 100);
  const rateText = (r: Rate) => (r.n ? `${r.hits}/${r.n}` : "–");
  return (
    <div className="sheet-section">
      <div className="tr-hero">
        <div className="tr-hero-main">
          <span className="big-stat num">{pctOf(d.rate)}</span>
          <span className="muted">{d.n ? t("track.dirRateDays", { n: d.calls ?? d.n, days: d.n }) : t("track.none")}</span>
          {d.noResult > 0 && <span className="muted" style={{ fontSize: 13 }}>{t("track.noResult", { n: d.noResult })}</span>}
          {s.uncounted > 0 && <span className="muted" style={{ fontSize: 13 }}>{t("track.uncounted", { n: s.uncounted })}</span>}
          {s.closed > 0 && <span className="muted" style={{ fontSize: 13 }}>{t("track.closedN", { n: s.closed })}</span>}
        </div>
        <div className="tr-chips">
          {d.low != null && <span className="chip num">{t("track.likely", { lo: Math.round(d.low * 100), hi: Math.round(d.high! * 100) })}</span>}
          {skillPts != null && <span className={`chip num ${skillPts > 0 ? "ok" : skillPts < 0 ? "bad" : ""}`}>{t("track.skill", { pts: `${skillPts > 0 ? "+" : ""}${skillPts}` })}</span>}
          {d.n < EARLY && <span className="chip">{t("track.early")}</span>}
        </div>
      </div>
      <div className="tr-tiles">
        <div className="stat">
          <small>{t("track.flat")}</small>
          <b className="num">{rateText(s.flat)}</b>
        </div>
        <div className="stat">
          <small>{t("track.horizon")}</small>
          <b className="num">
            {pctOf(s.byHorizon.d.rate)} · {pctOf(s.byHorizon.w.rate)}
          </b>
        </div>
        <div className="stat">
          <small>{t("track.byPhase")}</small>
          <b className="num">
            {pctOf(s.byPhase?.pre.rate)} · {pctOf(s.byPhase?.mid.rate)}
          </b>
        </div>
        <div className="stat" title={t("track.brierHint")}>
          <small>{t("track.brier")}</small>
          <b className="num">{s.brier == null ? "–" : s.brier.toFixed(2)}</b>
        </div>
      </div>
      <p className="hint">{t("track.brierHint")}</p>
    </div>
  );
}

/** Claimed vs real, per confidence level. Levels with few graded calls are faded: too few to read. */
function Calibration({ s }: { s: TrackStats }) {
  const { t } = usePrefs();
  const mids = [55, 65, 75, 85];
  return (
    <div className="sheet-section">
      <h3>{t("track.calibration")}</h3>
      <div className="calib">
        {s.buckets.map((b, i) => {
          const actual = b.n ? (b.hits / b.n) * 100 : 0;
          const claimed = b.n ? b.avgConfidence : mids[i];
          return (
            <div className={`calib-col${b.n < 5 ? " thin" : ""}`} key={b.label}>
              <span className="num" style={{ fontSize: 13, fontWeight: 600 }}>{b.n ? `${Math.round(actual)}%` : "–"}</span>
              <div className="calib-track">
                <div className="calib-bar" style={{ height: `${actual}%` }} />
                <div className="calib-line" style={{ bottom: `${claimed}%` }} />
              </div>
              <span className="calib-lbl">
                {b.label}
                <br />
                <span className="num">n={b.n}</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="hint">{t("track.calibrationHint")}</p>
    </div>
  );
}

/** What acting on each kind of call returned on average. */
function ByAction({ s }: { s: TrackStats }) {
  const { t } = usePrefs();
  if (!s.byAction.length) return null;
  return (
    <div className="sheet-section">
      <h3>{t("track.byAction")}</h3>
      <div className="tr-list">
        {s.byAction.map((a) => (
          <div className="tr-row" key={a.action}>
            <span className={`action ${a.action}`}>{t(`act.${a.action}` as MsgKey)}</span>
            <span className={`num ${a.avgReturn >= 0 ? "ok" : "bad"}`}>{fmtPct(a.avgReturn)}</span>
            <span className="num muted">n={a.n}</span>
          </div>
        ))}
      </div>
      <p className="hint">{t("track.actionHint")}</p>
    </div>
  );
}

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
