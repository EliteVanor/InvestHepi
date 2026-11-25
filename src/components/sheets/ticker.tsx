"use client";

import { useMemo, useState } from "react";
import { relTime, type MsgKey } from "@/lib/i18n";
import { langInfo } from "@/lib/languages";
import type { AlertSettings } from "@/lib/alerts";
import { tickerMatcher } from "@/lib/tickers";
import { exchangeTz } from "@/lib/symbols";
import { type Digest, type Outlook, type Quote } from "@/lib/types";
import { usePrefs } from "../prefs";
import { LiveChart, type ChartReply } from "../LiveChart";
import { showsLevel, windowChange, type CurrentQuote } from "@/lib/quote-view";
import { Ring, Sheet, arrow, fmtPct, fmtPrice, symLabel } from "../primitives";
import { safeHttpUrl } from "@/lib/safe-url";

/* ---------------------------------------------------------------- Ticker */

export function TickerSheet({ symbol, quote, digests, calls = [], onClose, onAlert, action }: { symbol: string; quote?: Quote; digests: Digest[]; calls?: Outlook[]; onClose: () => void; onAlert?: (symbol: string) => void; action?: React.ReactNode }) {
  const { t, lang, api, marketTime } = usePrefs();
  const [cd, setCd] = useState<ChartReply | null>(null);
  // The current quote (quote.ts) comes with every chart reply: the same price and 5D/1M on every range.
  const [cq, setCq] = useState<CurrentQuote | null>(null);
  const [alertMsg, setAlertMsg] = useState("");
  // The latest prediction on this ticker (daily first).
  const call = calls.find((o) => o.ticker === symbol);
  const mover = digests.flatMap((d) => d.analysis.movers ?? []).find((m) => m.ticker === symbol);
  const tech = digests.map((d) => d.technicals?.[symbol]).find(Boolean);
  const related = useMemo(() => {
    const re = tickerMatcher(symbol);
    const seen = new Set<string>();
    return digests
      .flatMap((d) => d.news)
      .filter((n) => re.test(n.title) || n.link.includes(`s=${symbol}`))
      .filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)))
      .slice(0, 10);
  }, [digests, symbol]);
  const price = cq?.price ?? quote?.price;
  // 5D and 1M only from the current quote (the same numbers as the watchlist and the chart header).
  // While it loads (or if it fails) the briefing quote's own daily history gives the same windows.
  const chg5 = cq ? cq.changes?.["5d"] ?? null : quote?.history ? windowChange(quote.history, quote.price, "5d") : null;
  const chg1m = cq ? cq.changes?.["1mo"] ?? null : quote?.history ? windowChange(quote.history, quote.price, "1mo") : null;
  // An ETF stand-in's levels are the ETF's: no day range, 52-week range or level alerts for the symbol (Q5).
  const levels = cq ? showsLevel(cq) : quote ? showsLevel(quote) : true;
  const fmtVol = (v?: number) => (v == null ? "–" : new Intl.NumberFormat(langInfo(lang).locale, { notation: "compact", maximumFractionDigits: 1 }).format(v));

  const quickAlert = async (op: "above" | "below") => {
    if (!price) return;
    const value = Number((price * (op === "above" ? 1.05 : 0.95)).toFixed(price >= 100 ? 0 : 2));
    try {
      const j = await api<{ settings: AlertSettings }>("/api/alerts");
      const settings = j.settings;
      settings.priceAlerts = [...settings.priceAlerts, { id: Math.random().toString(36).slice(2, 10), symbol, op, value, repeat: false, active: true, createdAt: new Date().toISOString() }];
      await api("/api/alerts", { method: "PUT", body: JSON.stringify(settings) });
      setAlertMsg(`${t("tk.alertSet")} · ${t(op === "above" ? "tk.alertAbove" : "tk.alertBelow", { p: fmtPrice(value) })}${settings.enabled ? "" : ` · ${t("al.enabled")}: ${t("st.off")}`}`);
    } catch (e) {
      setAlertMsg((e as Error).message);
    }
  };

  return (
    <Sheet title={<span>{symLabel(symbol)}{cd?.name && cd.name !== symLabel(symbol) ? <span className="muted" style={{ fontWeight: 500, fontSize: 15, marginLeft: 8 }}>{cd.name}</span> : null}</span>} onClose={onClose} wide actions={action}>
      <LiveChart
        symbol={symbol}
        height={300}
        onData={(d) => {
          if (d.quote) setCq(d.quote);
          if (d.range === "1d") setCd(d);
        }}
      />
      <div className="stats stats-5" style={{ marginTop: 14 }}>
        <div className="stat"><small>{t("tk.5d")}</small><b className={`num ${(chg5 ?? 0) >= 0 ? "up" : "down"}`}>{chg5 == null ? "–" : fmtPct(chg5, 1)}</b></div>
        <div className="stat"><small>{t("tk.1m")}</small><b className={`num ${(chg1m ?? 0) >= 0 ? "up" : "down"}`}>{chg1m == null ? "–" : fmtPct(chg1m, 1)}</b></div>
        <div className="stat"><small>{t("tk.dayRange")}</small><b className="num range" style={{ fontSize: 15 }}>{levels && cd?.dayLow != null && cd.dayHigh != null ? `${fmtPrice(cd.dayLow)} – ${fmtPrice(cd.dayHigh)}` : "–"}</b></div>
        <div className="stat"><small>{t("tk.52w")}</small><b className="num range" style={{ fontSize: 15 }}>{!levels ? "–" : cd?.fiftyTwoWeekLow != null && cd.fiftyTwoWeekHigh != null ? `${fmtPrice(cd.fiftyTwoWeekLow)} – ${fmtPrice(cd.fiftyTwoWeekHigh)}` : tech?.low52 != null && tech.high52 != null ? `${fmtPrice(tech.low52)} – ${fmtPrice(tech.high52)}` : "–"}</b></div>
        <div className="stat"><small>{t("tk.volume")}</small><b className="num">{fmtVol(cd?.volume)}</b></div>
      </div>
      {tech && levels && (
        <div className="sheet-section">
          <h3>
            {t("tk.levels")} · <span className={tech.trend === "up" ? "up" : tech.trend === "down" ? "down" : "flat"}>{t(`trend.${tech.trend}` as MsgKey)}</span> <span className="muted">({t("trend.span")})</span>
          </h3>
          <div className="levels">
            {(
              [
                ["tk.resistance", tech.resistance20],
                ["tk.sma20", tech.sma20],
                ["tk.sma50", tech.sma50],
                ["tk.sma200", tech.sma200],
                ["tk.support", tech.support20],
              ] as [MsgKey, number | undefined][]
            )
              .filter(([, v]) => v != null)
              .map(([k, v]) => (
                <div className="level" key={k}>
                  <span>{t(k)}</span>
                  <b className="num">{fmtPrice(v!)}</b>
                  <small className={`num ${price != null && price >= v! ? "up" : "down"}`}>{price != null ? fmtPct(((price - v!) / v!) * 100, 1) : ""}</small>
                </div>
              ))}
            {tech.rsi14 != null && (
              <div className="level">
                <span>{t("tk.rsi")}</span>
                <b className={`num ${tech.rsi14 >= 70 ? "down" : tech.rsi14 <= 30 ? "up" : ""}`}>{tech.rsi14.toFixed(0)}</b>
                <small />
              </div>
            )}
            {tech.atrPct != null && (
              <div className="level">
                <span>{t("tk.atr")}</span>
                <b className="num">±{tech.atrPct.toFixed(1)}%</b>
                <small />
              </div>
            )}
          </div>
        </div>
      )}
      {price != null && levels && onAlert && (
        <div className="sheet-actions" style={{ justifyContent: "flex-start" }}>
          <button className="pill-btn" onClick={() => quickAlert("above")}>↑ {t("tk.alertAbove", { p: fmtPrice(Number((price * 1.05).toFixed(price >= 100 ? 0 : 2))) })}</button>
          <button className="pill-btn" onClick={() => quickAlert("below")}>↓ {t("tk.alertBelow", { p: fmtPrice(Number((price * 0.95).toFixed(price >= 100 ? 0 : 2))) })}</button>
          <button className="pill-btn" onClick={() => onAlert(symbol)}>{t("set.alerts")} →</button>
        </div>
      )}
      {alertMsg && <p className="hint ok">{alertMsg}</p>}
      {mover && (
        <div className="sheet-section">
          <h3>{t("movers.title")}</h3>
          <p style={{ margin: 0 }}>{mover.why}</p>
        </div>
      )}
      {call && (
        <div className="sheet-section">
          <h3>{t("tk.call")}</h3>
          <div className="call">
            <div className="call-head">
              <Ring value={call.confidence} direction={call.direction} />
              <div className="call-sub">
                <span className={call.direction}>{arrow(call.direction)} {t(`dir.${call.direction}` as MsgKey)}</span> · {call.horizon === "today" ? t(call.phase === "mid" ? "pred.mid" : "pred.pre") : t("pred.weekly")}
                {call.madeAt && <> · {marketTime(call.madeAt, exchangeTz(symbol), { day: call.horizon !== "today" })}</>}
              </div>
              <span className={`action ${call.action}`}>{t(`act.${call.action}` as MsgKey)}</span>
            </div>
            <div className="trigger">{call.actionTrigger}</div>
            <div className="muted">{call.rationale}</div>
            {call.gradesAt && <div className="call-record">{t(new Date(call.gradesAt).getTime() < Date.now() ? "pred.graded" : "pred.gradesAt", { when: marketTime(call.gradesAt, exchangeTz(symbol), { day: true }) })}</div>}
          </div>
        </div>
      )}
      <div className="sheet-section">
        <h3>{t("tk.related")}</h3>
        {related.length === 0 ? (
          <p className="muted">{t("tk.noRelated")}</p>
        ) : (
          related.map((n) => (
            <div className="news" key={n.id} style={{ gridTemplateColumns: "1fr" }}>
              <a href={safeHttpUrl(n.link) || undefined} target="_blank" rel="noreferrer">{n.title}</a>
              <div className="news-meta">{n.source} · {relTime(n.publishedAt, lang)}</div>
            </div>
          ))
        )}
      </div>
    </Sheet>
  );
}
