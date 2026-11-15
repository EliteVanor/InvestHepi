"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { relTime, type MsgKey } from "@/lib/i18n";
import { langInfo } from "@/lib/languages";
import type { MoodGauge } from "@/lib/mood";
import { summarize } from "@/lib/portfolioMath";
import type { SearchHit } from "@/lib/search";
import type { Technicals } from "@/lib/technicals";
import type { TrackStats } from "@/lib/track";
import type { Action, CalendarEvent, Digest, Direction, Holding, Outlook, Quote, Scenario } from "@/lib/types";
import { IconAlert, IconCalendar, IconEye, IconHistory, IconPlus, IconSearch, IconSparkles, IconTarget, IconX } from "./Icons";
import { lsGet, lsSet, usePrefs } from "./prefs";
import { Ring, arrow, fmtPct, fmtPrice } from "./primitives";
import { useLiveQuotes } from "./v3";

/* ---------------------------------------------------------------- toasts */

type ToastKind = "ok" | "error";
const ToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: ToastKind }[]>([]);
  const push = useCallback((msg: string, kind: ToastKind = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === "error" ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`toast ${i.kind}`}>
            <span className="toast-dot" />
            {i.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ------------------------------------------------------ since last visit */

interface Snapshot {
  at: string;
  digestAt: string;
  calls: Record<string, { action: Action; direction: Direction; confidence: number }>;
  prices: Record<string, number>;
  events: string[];
}
const LAST_KEY = "ih-last";
const MIN_GAP_MS = 30 * 60_000;

function snapshot(d: Digest, quotes: Quote[]): Snapshot {
  return {
    at: new Date().toISOString(),
    digestAt: d.generatedAt,
    calls: Object.fromEntries(d.analysis.outlook.map((o) => [o.ticker, { action: o.action, direction: o.direction, confidence: o.confidence }])),
    prices: Object.fromEntries(quotes.map((q) => [q.symbol, q.price])),
    events: d.analysis.events.map((e) => e.title),
  };
}

/** What changed on this device since the previous visit: flipped calls, price moves, new key events. */
export function SinceLastVisit({ digest, quotes, newCount, onTicker }: { digest: Digest; quotes: Quote[]; newCount: number; onTicker: (s: string) => void }) {
  const { t, lang } = usePrefs();
  const [prev, setPrev] = useState<Snapshot | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const latest = useRef({ digest, quotes });
  latest.current = { digest, quotes };
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const p = lsGet<Snapshot | null>(LAST_KEY, null);
    if (p && Date.now() - new Date(p.at).getTime() > MIN_GAP_MS) setPrev(p);
    // Record this visit once the page has been on screen for a moment.
    const id = setTimeout(() => lsSet(LAST_KEY, snapshot(latest.current.digest, latest.current.quotes)), 6000);
    return () => clearTimeout(id);
  }, []);

  const diff = useMemo(() => {
    if (!prev) return null;
    const calls = digest.analysis.outlook
      .map((o) => ({ o, p: prev.calls[o.ticker] }))
      .filter(({ o, p }) => p && (p.action !== o.action || p.direction !== o.direction));
    const moves = quotes
      .map((q) => ({ symbol: q.symbol, pct: prev.prices[q.symbol] ? ((q.price - prev.prices[q.symbol]) / prev.prices[q.symbol]) * 100 : 0 }))
      .filter((m) => Math.abs(m.pct) >= 1)
      .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
      .slice(0, 4);
    const events = digest.generatedAt !== prev.digestAt ? digest.analysis.events.filter((e) => !prev.events.includes(e.title)).slice(0, 3) : [];
    return { calls, moves, events };
  }, [prev, digest, quotes]);

  if (!prev || !diff || dismissed) return null;
  if (!diff.calls.length && !diff.moves.length && !diff.events.length && !newCount) return null;

  return (
    <section className="card since" aria-labelledby="since-h">
      <h2 className="card-title" id="since-h">
        <IconHistory /> {t("since.title")}
        <span className="since-when">· {relTime(prev.at, lang)}</span>
        <span className="spacer" />
        <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setDismissed(true)} aria-label={t("since.dismiss")}>
          <IconX />
        </button>
      </h2>
      <div className="since-grid">
        {diff.calls.length > 0 && (
          <div>
            <div className="since-label">{t("since.calls")}</div>
            {diff.calls.map(({ o, p }) => (
              <button key={o.ticker} className="since-row" onClick={() => onTicker(o.ticker)}>
                <b>{o.ticker}</b>
                <span className={`action ${p!.action}`} style={{ marginLeft: 0, opacity: 0.6 }}>{t(`act.${p!.action}` as MsgKey)}</span>
                <span aria-hidden="true">→</span>
                <span className={`action ${o.action}`} style={{ marginLeft: 0 }}>{t(`act.${o.action}` as MsgKey)}</span>
              </button>
            ))}
          </div>
        )}
        {diff.moves.length > 0 && (
          <div>
            <div className="since-label">{t("since.moves")}</div>
            <div className="since-chips">
              {diff.moves.map((m) => (
                <button key={m.symbol} className={`chip ${m.pct >= 0 ? "up" : "down"}`} onClick={() => onTicker(m.symbol)}>
                  {m.symbol} <span className="num">{fmtPct(m.pct, 1)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {diff.events.length > 0 && (
          <div>
            <div className="since-label">{t("since.events")}</div>
            {diff.events.map((e) => (
              <div key={e.title} className="since-event">{e.title}</div>
            ))}
          </div>
        )}
      </div>
      {newCount > 0 && (
        <a className="since-more" href="#headlines">
          {t("since.headlines", { n: newCount })} ↓
        </a>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- catch-up */

/** Full-screen, one-idea-per-card walk through the briefing. Tap, swipe or use the arrow keys. */
export function CatchUp({ digest, calendar, onClose, onAsk }: { digest: Digest; calendar: CalendarEvent[]; onClose: () => void; onAsk: () => void }) {
  const { t, lang } = usePrefs();
  const a = digest.analysis;
  const fmtDay = useMemo(() => new Intl.DateTimeFormat(langInfo(lang).locale, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }), [lang]);

  const cards = useMemo(() => {
    const list: { key: string; kicker: string; body: ReactNode }[] = [];
    list.push({
      key: "brief",
      kicker: t("brief.title"),
      body: (
        <>
          <span className={`chip mood ${a.mood}`}>{t(`mood.${a.mood}` as MsgKey)}</span>
          <h2 className="cu-title">{a.headline}</h2>
          <ul className="cu-list">
            {a.summary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </>
      ),
    });
    a.outlook.forEach((o, i) =>
      list.push({
        key: `call-${i}`,
        kicker: t("calls.title"),
        body: (
          <>
            <div className="cu-call">
              <Ring value={o.confidence} direction={o.direction} size={72} />
              <div>
                <div className="cu-name">{o.interest}</div>
                <div className="call-sub">
                  {o.ticker} · <span className={o.direction}>{arrow(o.direction)} {t(`dir.${o.direction}` as MsgKey)}</span> · {o.horizon === "today" ? t("calls.today") : t("calls.thisWeek")}
                </div>
              </div>
              <span className={`action ${o.action}`} style={{ fontSize: 16, padding: "7px 16px" }}>{t(`act.${o.action}` as MsgKey)}</span>
            </div>
            <h2 className="cu-title sm">{o.actionTrigger}</h2>
            <p className="cu-text">{o.rationale}</p>
            <p className="cu-text muted">
              <b>{t("calls.risks")}:</b> {o.risks}
            </p>
          </>
        ),
      }),
    );
    if (a.movers?.length)
      list.push({
        key: "movers",
        kicker: t("movers.title"),
        body: (
          <div className="cu-rows">
            {a.movers.map((m) => (
              <div key={m.ticker} className="cu-row">
                <div>
                  <b>{m.ticker}</b>
                  <span className={`num ${m.changePct >= 0 ? "up" : "down"}`}>{fmtPct(m.changePct)}</span>
                </div>
                <p>{m.why}</p>
              </div>
            ))}
          </div>
        ),
      });
    a.events.forEach((e, i) =>
      list.push({
        key: `ev-${i}`,
        kicker: `${t("events.title")} · ${i + 1}/${a.events.length}`,
        body: (
          <>
            <h2 className="cu-title sm">{e.title}</h2>
            <p className="cu-text">{e.whyItMatters}</p>
            <div className="impacts">
              {e.impacts.map((im, j) => (
                <span key={j} className={`chip ${im.direction}`}>
                  {arrow(im.direction)} {im.interest} · {im.confidence}%
                </span>
              ))}
            </div>
            {e.analog && (
              <div className="analog">
                <div className="analog-label">
                  <IconHistory /> {t("events.past")} · {e.analog.date}
                </div>
                <b style={{ fontWeight: 600 }}>{e.analog.event}.</b> {e.analog.whatHappenedNext}
              </div>
            )}
            <div className="wrong">
              <IconAlert />
              <span>
                <b style={{ fontWeight: 600 }}>{t("events.wrong")}:</b> {e.whatCouldGoWrong}
              </span>
            </div>
          </>
        ),
      }),
    );
    const sc = a.scenarios?.[0];
    if (sc)
      list.push({
        key: "scen",
        kicker: t("scen.title"),
        body: (
          <>
            <h2 className="cu-title sm">{sc.catalyst}</h2>
            <p className="cu-text muted">{sc.when}</p>
            <ScenarioCases cases={sc.cases} />
          </>
        ),
      });
    const cal = calendar.slice(0, 5);
    if (cal.length || a.watchNext.length)
      list.push({
        key: "next",
        kicker: t("cal.title"),
        body: (
          <div className="cu-rows">
            {cal.map((e, i) => (
              <div key={i} className="cu-row">
                <div>
                  <b>{e.title}</b>
                  <span className="muted">{fmtDay.format(new Date(e.date + "T12:00:00Z"))}{e.time ? ` · ${e.time}` : ""}</span>
                </div>
              </div>
            ))}
            {!cal.length && a.watchNext.map((w, i) => (
              <div key={i} className="cu-row"><p>{w}</p></div>
            ))}
          </div>
        ),
      });
    list.push({
      key: "done",
      kicker: "",
      body: (
        <div className="cu-done">
          <div className="cu-check">✓</div>
          <h2 className="cu-title">{t("catch.done")}</h2>
          <p className="cu-text muted">{t("catch.doneBody")}</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn-plain" onClick={onAsk}>
              <IconSparkles width={16} height={16} style={{ verticalAlign: -3, marginRight: 6 }} />
              {t("catch.ask")}
            </button>
            <button className="btn-primary" onClick={onClose}>{t("catch.close")}</button>
          </div>
        </div>
      ),
    });
    return list;
  }, [a, calendar, t, fmtDay, onAsk, onClose]);

  const [i, setI] = useState(0);
  const last = cards.length - 1;
  const next = useCallback(() => setI((x) => Math.min(last, x + 1)), [last]);
  const prev = useCallback(() => setI((x) => Math.max(0, x - 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [next, prev, onClose]);

  const touch = useRef<number | null>(null);
  const card = cards[i];

  return (
    <div className="cu" role="dialog" aria-modal="true" aria-label={t("sc.catchup")}>
      <div className="cu-top">
        <div className="cu-progress" aria-hidden="true">
          {cards.map((c, j) => (
            <i key={c.key} className={j < i ? "done" : j === i ? "now" : ""} />
          ))}
        </div>
        <div className="cu-bar">
          <span className="cu-kicker">{card.kicker}</span>
          <span className="spacer" />
          <span className="cu-count num">{i + 1} / {cards.length}</span>
          <button className="icon-btn" onClick={onClose} aria-label={t("set.close")}>
            <IconX />
          </button>
        </div>
      </div>
      <div
        className="cu-stage"
        onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touch.current == null) return;
          const dx = e.changedTouches[0].clientX - touch.current;
          touch.current = null;
          if (dx > 50) prev();
          else if (dx < -50) next();
        }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button, a")) return;
          const r = e.currentTarget.getBoundingClientRect();
          if (e.clientX - r.left < r.width * 0.3) prev();
          else next();
        }}
      >
        <article className="cu-card" key={card.key}>
          {card.body}
        </article>
      </div>
      <div className="cu-hint">{t("catch.hint")}</div>
    </div>
  );
}

/* ------------------------------------------------------------ scenarios */

function ScenarioCases({ cases }: { cases: Scenario["cases"] }) {
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

/* ----------------------------------------------------------- mood gauge */

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
              <span className="muted num">{p.detail}</span>
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

/* ------------------------------------------------------------ watchlist */

type SortKey = "symbol" | "price" | "day" | "d5" | "m1" | "rsi" | "vs50" | "range" | "call";

export function Watchlist({ symbols, quotes, technicals, outlook, onOpen }: { symbols: string[]; quotes: Quote[]; technicals?: Record<string, Technicals>; outlook: Outlook[]; onOpen: (s: string) => void }) {
  const { t } = usePrefs();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "day", dir: -1 });

  const rows = useMemo(() => {
    const list = symbols
      .map((s) => {
        const q = quotes.find((x) => x.symbol === s);
        const tech = technicals?.[s];
        const o = outlook.find((x) => x.ticker === s);
        if (!q && !tech) return null;
        const price = q?.price ?? tech!.price;
        const h = q?.history ?? [];
        const back = (n: number) => (h.length > n ? ((price - h[h.length - 1 - n][1]) / h[h.length - 1 - n][1]) * 100 : undefined);
        const range = tech?.high52 != null && tech.low52 != null && tech.high52 > tech.low52 ? ((price - tech.low52) / (tech.high52 - tech.low52)) * 100 : undefined;
        return {
          symbol: s,
          price,
          day: q?.changePct,
          d5: tech?.chg5d ?? back(5),
          m1: tech?.chg1m ?? back(Math.min(21, h.length - 1)),
          rsi: tech?.rsi14,
          vs50: tech?.sma50 ? ((price - tech.sma50) / tech.sma50) * 100 : undefined,
          range,
          low: tech?.low52,
          high: tech?.high52,
          o,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r != null);
    const val = (r: (typeof list)[number]): number | string => {
      if (sort.key === "symbol") return r.symbol;
      if (sort.key === "call") return r.o?.confidence ?? -1;
      return (r[sort.key] as number | undefined) ?? -Infinity;
    };
    return list.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      return (typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number)) * sort.dir;
    });
  }, [symbols, quotes, technicals, outlook, sort]);

  if (!rows.length) return null;
  const th = (key: SortKey, label: string, cls = "") => (
    <th className={cls} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "symbol" ? 1 : -1 }))}>
        {label}
        <span className="wl-sort">{sort.key === key ? (sort.dir === 1 ? "↑" : "↓") : ""}</span>
      </button>
    </th>
  );
  const pct = (n: number | undefined, d = 1) => (n == null ? <span className="muted">–</span> : <span className={`num ${n >= 0 ? "up" : "down"}`}>{fmtPct(n, d)}</span>);

  return (
    <section className="card" aria-labelledby="wl-h">
      <h2 className="card-title" id="wl-h">
        <IconTarget /> {t("wl.title")}
      </h2>
      <div className="wl-wrap">
        <table className="wl">
          <thead>
            <tr>
              {th("symbol", t("wl.ticker"), "wl-sticky")}
              {th("price", t("wl.price"))}
              {th("day", t("wl.day"))}
              {th("d5", t("wl.5d"), "wl-m-hide")}
              {th("m1", t("wl.1m"))}
              {th("rsi", t("wl.rsi"))}
              {th("vs50", t("wl.vs50"), "wl-m-hide")}
              {th("range", t("wl.range"), "wl-m-hide")}
              {th("call", t("wl.call"))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} onClick={() => onOpen(r.symbol)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen(r.symbol)}>
                <td className="wl-sticky"><b>{r.symbol}</b></td>
                <td className="num">{fmtPrice(r.price)}</td>
                <td>{pct(r.day, 2)}</td>
                <td className="wl-m-hide">{pct(r.d5)}</td>
                <td>{pct(r.m1)}</td>
                <td>
                  {r.rsi == null ? <span className="muted">–</span> : <span className={`num ${r.rsi >= 70 ? "down" : r.rsi <= 30 ? "up" : ""}`}>{r.rsi.toFixed(0)}</span>}
                </td>
                <td className="wl-m-hide">{pct(r.vs50)}</td>
                <td className="wl-m-hide">
                  {r.range == null ? (
                    <span className="muted">–</span>
                  ) : (
                    <span className="wl-range" title={`${fmtPrice(r.low!)} – ${fmtPrice(r.high!)}`}>
                      <i style={{ left: `${Math.max(0, Math.min(100, r.range))}%` }} />
                    </span>
                  )}
                </td>
                <td>
                  {r.o ? (
                    <span className={`action ${r.o.action}`} style={{ marginLeft: 0, fontSize: 12, padding: "3px 9px" }}>
                      {t(`act.${r.o.action}` as MsgKey)} <span className="num" style={{ opacity: 0.8 }}>{r.o.confidence}</span>
                    </span>
                  ) : (
                    <span className="muted">–</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- holdings */

const money = (n: number, locale: string, sign = false) =>
  `${sign && n > 0 ? "+" : ""}${new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 }).format(n)}`;

export function PortfolioCard({ holdings, onEdit, onOpen }: { holdings: Holding[]; onEdit: () => void; onOpen: (s: string) => void }) {
  const { t, lang } = usePrefs();
  const locale = langInfo(lang).locale;
  const [hide, setHide] = useState(false);
  useEffect(() => setHide(lsGet("ih-pf-hide", false)), []);
  const live = useLiveQuotes(useMemo(() => holdings.map((h) => h.symbol), [holdings]));
  const s = useMemo(() => summarize(holdings, [...live.values()]), [holdings, live]);

  if (!holdings.length)
    return (
      <section className="card" aria-labelledby="pf-h">
        <h2 className="card-title" id="pf-h">{t("pf.title")}</h2>
        <p className="muted" style={{ marginTop: 0 }}>{t("pf.empty")}</p>
        <button className="pill-btn" onClick={onEdit}>
          <IconPlus /> {t("pf.add")}
        </button>
      </section>
    );
  const amt = (n: number, sign = false) => (hide ? "•••" : money(n, locale, sign));
  return (
    <section className="card" aria-labelledby="pf-h">
      <h2 className="card-title" id="pf-h">
        {t("pf.title")}
        <span className="spacer" />
        <button
          className="icon-btn"
          style={{ width: 28, height: 28 }}
          onClick={() => {
            setHide((h) => (lsSet("ih-pf-hide", !h), !h));
          }}
          aria-label={hide ? t("pf.show") : t("pf.hide")}
          aria-pressed={hide}
        >
          <IconEye />
        </button>
        <button className="pill-btn" style={{ textTransform: "none", letterSpacing: 0, height: 28 }} onClick={onEdit}>
          {t("pf.edit")}
        </button>
      </h2>
      {s.positions.length === 0 ? (
        <div className="skeleton" style={{ height: 90 }} />
      ) : (
        <>
          <div className="pf-total num">{amt(s.value)}</div>
          <div className="pf-sub">
            <span className={`num ${s.dayPnl >= 0 ? "up" : "down"}`}>
              {amt(s.dayPnl, true)} ({fmtPct(s.dayPct)})
            </span>
            <span className="muted">{t("pf.today")}</span>
            <span className={`num ${s.totalPnl >= 0 ? "up" : "down"}`}>{fmtPct(s.totalPct, 1)}</span>
            <span className="muted">{t("pf.total")}</span>
          </div>
          <div className="pf-rows">
            {s.positions.map((p) => (
              <button key={p.symbol} className="pf-row" onClick={() => onOpen(p.symbol)}>
                <b>{p.symbol}</b>
                <span className="pf-weight" title={`${p.weight.toFixed(0)}%`}>
                  <i style={{ width: `${p.weight}%` }} />
                </span>
                <span className={`num ${p.dayPct >= 0 ? "up" : "down"}`}>{fmtPct(p.dayPct)}</span>
                <span className="num pf-val">{amt(p.value)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** Debounced ticker / company search with a dropdown. */
export function TickerSearch({ onPick, placeholder }: { onPick: (symbol: string) => void; placeholder?: string }) {
  const { t, api } = usePrefs();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setHits([]);
      return;
    }
    const id = setTimeout(() => {
      api<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(query)}`)
        .then((j) => {
          setHits(j.hits);
          setSel(0);
        })
        .catch(() => setHits([]));
    }, 220);
    return () => clearTimeout(id);
  }, [q, api]);
  const pick = (s: string) => {
    onPick(s);
    setQ("");
    setHits([]);
  };
  return (
    <div className="tsearch">
      <div className="search" style={{ marginBottom: 0 }}>
        <IconSearch />
        <input
          type="search"
          value={q}
          placeholder={placeholder ?? t("pf.search")}
          aria-label={placeholder ?? t("pf.search")}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(hits.length - 1, s + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (hits[sel]) pick(hits[sel].symbol);
              else if (/^[A-Za-z0-9.^=\-]{1,12}$/.test(q.trim())) pick(q.trim().toUpperCase());
            }
          }}
        />
      </div>
      {hits.length > 0 && (
        <div className="tsearch-list" role="listbox">
          {hits.map((h, i) => (
            <button key={h.symbol} role="option" aria-selected={i === sel} onMouseMove={() => setSel(i)} onClick={() => pick(h.symbol)}>
              <b>{h.symbol}</b>
              <span>{h.name}</span>
              <small>{h.exchange ?? h.type ?? ""}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function HoldingsEditor({ onSaved }: { onSaved: (h: Holding[]) => void }) {
  const { t, api } = usePrefs();
  const toast = useToast();
  type Row = { symbol: string; shares: string; cost: string };
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ holdings: Holding[] }>("/api/portfolio")
      .then((j) => setRows(j.holdings.map((h) => ({ symbol: h.symbol, shares: String(h.shares), cost: String(h.cost) }))))
      .catch(() => setRows([]));
  }, [api]);
  if (!rows) return <div className="skeleton" style={{ height: 160, marginTop: 18 }} />;
  const up = (i: number, patch: Partial<Row>) => setRows((r) => r!.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async () => {
    setBusy(true);
    try {
      const body = rows.filter((r) => r.symbol && Number(r.shares) > 0).map((r) => ({ symbol: r.symbol.toUpperCase(), shares: Number(r.shares), cost: Number(r.cost) || 0 }));
      const j = await api<{ holdings: Holding[] }>("/api/portfolio", { method: "PUT", body: JSON.stringify(body) });
      setRows(j.holdings.map((h) => ({ symbol: h.symbol, shares: String(h.shares), cost: String(h.cost) })));
      onSaved(j.holdings);
      toast(t("set.saved"));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sheet-section">
      <p className="hint" style={{ marginTop: 0 }}>{t("pf.privacy")}</p>
      <div className="group">
        {rows.length === 0 && (
          <div className="row"><span className="label muted">{t("pf.empty")}</span></div>
        )}
        {rows.map((r, i) => (
          <div className="row hold-row" key={i}>
            <b className="hold-sym">{r.symbol}</b>
            <label>
              <span>{t("pf.shares")}</span>
              <input className="num-input" type="number" min={0} step="any" value={r.shares} onChange={(e) => up(i, { shares: e.target.value })} />
            </label>
            <label>
              <span>{t("pf.cost")}</span>
              <input className="num-input" type="number" min={0} step="any" value={r.cost} onChange={(e) => up(i, { cost: e.target.value })} />
            </label>
            <button className="icon-btn" onClick={() => setRows((x) => x!.filter((_, j) => j !== i))} aria-label={t("int.remove")}>
              <IconX />
            </button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <TickerSearch onPick={(symbol) => setRows((r) => (r!.some((x) => x.symbol === symbol) ? r : [...r!, { symbol, shares: "", cost: "" }]))} />
      </div>
      <div className="sheet-actions">
        <button className="btn-primary" onClick={save} disabled={busy}>
          {busy ? t("set.saving") : t("set.save")}
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------- track record extras */

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

export function TrackExtras({ stats }: { stats: TrackStats }) {
  const { t } = usePrefs();
  const toast = useToast();
  const exportCsv = async () => {
    try {
      // Fetch with the password header, then hand the browser a file.
      const pw = lsGet<string>("ih-password", "");
      const res = await fetch("/api/track?format=csv", { headers: { "x-app-password": encodeURIComponent(pw) } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "invest-helper-calls.csv";
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
