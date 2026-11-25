"use client";

/** "Since your last visit" and the full-screen catch-up mode. */
import { isVisitSnapshot } from "@/lib/ls-shape";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type MsgKey, relTime } from "@/lib/i18n";
import { type Action, type CalendarEvent, type Digest, type Direction, type Outlook, type Quote } from "@/lib/types";
import { moverChange } from "@/lib/quote-view";
import { IconAlert, IconHistory, IconSparkles, IconX } from "./Icons";
import { lsGet, lsSet, usePrefs } from "./prefs";
import { arrow, fmtPct, openOverlay, Ring } from "./primitives";
import { langInfo } from "@/lib/languages";
import { calTitle, calWhen, groupName } from "./labels";
import { ScenarioCases } from "./cards";

interface Snapshot {
  at: string;
  digestAt: string;
  calls: Record<string, { action: Action; direction: Direction; confidence: number }>;
  prices: Record<string, number>;
  /** The ETF behind each price when it was a stand-in ("" for a real level): moves compare like with like. */
  bases?: Record<string, string>;
  events: string[];
}

const LAST_KEY = "ih-last";

const MIN_GAP_MS = 30 * 60_000;

function snapshot(d: Digest, quotes: Quote[], outlook: Outlook[]): Snapshot {
  return {
    at: new Date().toISOString(),
    digestAt: d.generatedAt,
    calls: Object.fromEntries(outlook.filter((o) => o.horizon === "today").map((o) => [o.ticker, { action: o.action, direction: o.direction, confidence: o.confidence }])),
    prices: Object.fromEntries(quotes.map((q) => [q.symbol, q.price])),
    bases: Object.fromEntries(quotes.map((q) => [q.symbol, q.proxy ?? ""])),
    events: d.analysis.events.map((e) => e.title),
  };
}

/** What changed on this device since the previous visit: flipped calls, price moves, new key events. */
export function SinceLastVisit({ digest, calls: outlook = [], quotes, newCount, onTicker }: { digest: Digest; calls?: Outlook[]; quotes: Quote[]; newCount: number; onTicker: (s: string) => void }) {
  const { t, lang } = usePrefs();
  const [prev, setPrev] = useState<Snapshot | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const latest = useRef({ digest, quotes, outlook });
  latest.current = { digest, quotes, outlook };
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const p = lsGet<Snapshot | null>(LAST_KEY, null, isVisitSnapshot as (v: unknown) => v is Snapshot | null);
    if (p && Date.now() - new Date(p.at).getTime() > MIN_GAP_MS) setPrev(p);
    // Record this visit once the page has been on screen for a moment.
    const id = setTimeout(() => lsSet(LAST_KEY, snapshot(latest.current.digest, latest.current.quotes, latest.current.outlook)), 6000);
    return () => clearTimeout(id);
  }, []);

  const diff = useMemo(() => {
    if (!prev) return null;
    const calls = outlook
      .filter((o) => o.horizon === "today")
      .map((o) => ({ o, p: prev.calls[o.ticker] }))
      .filter(({ o, p }) => p && (p.action !== o.action || p.direction !== o.direction));
    // An index level and its ETF's price are different series: no move across a basis change.
    const moves = quotes
      .filter((q) => (prev.bases?.[q.symbol] ?? "") === (q.proxy ?? ""))
      .map((q) => ({ symbol: q.symbol, pct: prev.prices[q.symbol] ? ((q.price - prev.prices[q.symbol]) / prev.prices[q.symbol]) * 100 : 0 }))
      .filter((m) => Math.abs(m.pct) >= 1)
      .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
      .slice(0, 4);
    const events = digest.generatedAt !== prev.digestAt ? digest.analysis.events.filter((e) => !prev.events.includes(e.title)).slice(0, 3) : [];
    return { calls, moves, events };
  }, [prev, digest, quotes, outlook]);

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

/** Full-screen, one-idea-per-card walk through the briefing. Tap, swipe or use the arrow keys. */
export function CatchUp({ digest, calls: outlook = [], calendar, quotes = [], onClose, onAsk }: { digest: Digest; calls?: Outlook[]; calendar: CalendarEvent[]; quotes?: Quote[]; onClose: () => void; onAsk: () => void }) {
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
    outlook.forEach((o, i) =>
      list.push({
        key: `call-${i}`,
        kicker: `${t("pred.title")} · ${o.horizon === "today" ? t(o.phase === "mid" ? "pred.mid" : "pred.pre") : t("pred.weekly")}`,
        body: (
          <>
            <div className="cu-call">
              <Ring value={o.confidence} direction={o.direction} size={72} />
              <div>
                <div className="cu-name">{groupName(t, o.interest)}</div>
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
                  {/* Today's move from the current quote, not the number stored with the briefing. */}
                  <span className={`num ${moverChange(m, quotes) >= 0 ? "up" : "down"}`}>{fmtPct(moverChange(m, quotes))}</span>
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
                  {arrow(im.direction)} {groupName(t, im.interest)} · {im.confidence}%
                </span>
              ))}
            </div>
            {e.analog && (
              <div className="analog">
                <div className="analog-label">
                  <IconHistory /> {t("events.past")} · {e.analog.date}
                </div>
                {!/^[a-z]+(_[a-z]+)+$/.test(e.analog.event) && <b style={{ fontWeight: 600 }}>{e.analog.event}. </b>}{e.analog.whatHappenedNext}
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
                  <b>{calTitle(t, e)}</b>
                  <span className="muted">{fmtDay.format(new Date(e.date + "T12:00:00Z"))}{e.time ? ` · ${calWhen(t, e.time)}` : ""}</span>
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
  }, [a, outlook, calendar, t, fmtDay, onAsk, onClose]);

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
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, onClose]);
  // Real visible height + page lock (shared with sheets; see openOverlay).
  useEffect(() => openOverlay(), []);

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
