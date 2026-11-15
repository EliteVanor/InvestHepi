"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { relTime } from "@/lib/i18n";
import { langInfo } from "@/lib/languages";
import { fmtDuration, marketClock } from "@/lib/marketTime";
import type { CalendarEvent, Digest, Interest, KeyEvent, NewsItem, Outlook, Quote } from "@/lib/types";
import {
  IconAlert, IconArrow, IconBookmark, IconCalendar, IconCopy, IconEye, IconHistory, IconSearch, IconShare, IconSparkles, IconSpeaker, IconStop, IconTarget,
} from "./Icons";
import { usePrefs } from "./prefs";
import { Ring, Sparkline, arrow, fmtPct, fmtPrice } from "./primitives";

const MACRO_LABEL: Record<string, string> = { "^VIX": "VIX", "^TNX": "US 10Y", "CL=F": "Oil", "GC=F": "Gold", "DX-Y.NYB": "Dollar", "BTC-USD": "Bitcoin" };

/* ---------------------------------------------------------------- Market */

export function StatusPill() {
  const { t } = usePrefs();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!now) return <span className="status-pill">&nbsp;</span>;
  const { phase, secs } = marketClock(now);
  const label = phase === "open" ? t("mkt.open") : phase === "pre" ? t("mkt.pre") : phase === "after" ? t("mkt.after") : t("mkt.closed");
  const sub = phase === "open" ? t("mkt.closesIn", { t: fmtDuration(secs) }) : t("mkt.opensIn", { t: fmtDuration(secs) });
  return (
    <span className="status-pill" role="status">
      <span className={`dot ${phase === "open" ? "live" : phase === "pre" ? "pre" : ""}`} />
      <b>{label}</b>
      <span>{sub}</span>
    </span>
  );
}

export function MarketStrip({ quotes, macro, onOpen }: { quotes: Quote[]; macro: Quote[]; onOpen: (symbol: string) => void }) {
  const { t } = usePrefs();
  if (!quotes.length && !macro.length) return null;
  return (
    <div className="strip-wrap">
      <div className="strip" role="list" aria-label={t("mkt.markets")}>
        {quotes.map((q) => (
          <button key={q.symbol} className="qcard" role="listitem" onClick={() => onOpen(q.symbol)}>
            <div className="sym">
              <span>{q.symbol}</span>
              <span className={`chg num ${q.changePct >= 0 ? "up" : "down"}`}>{fmtPct(q.changePct)}</span>
            </div>
            <div className="px num">{fmtPrice(q.price)}</div>
            <Sparkline values={q.history.map((h) => h[1])} />
          </button>
        ))}
        {macro.length > 0 && <span className="strip-label">{t("mkt.macro")}</span>}
        {macro.map((q) => (
          <button key={q.symbol} className="qcard macro" role="listitem" onClick={() => onOpen(q.symbol)}>
            <div className="sym">
              <span>{MACRO_LABEL[q.symbol] ?? q.symbol}</span>
            </div>
            <div className="px num">
              {q.symbol === "^TNX" ? `${q.price.toFixed(2)}%` : fmtPrice(q.price)}
            </div>
            <div className={`chg num ${q.changePct >= 0 ? "up" : "down"}`} style={{ fontSize: 12, fontWeight: 600 }}>
              {fmtPct(q.changePct)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Briefing */

export function briefingText(d: Digest, t: ReturnType<typeof usePrefs>["t"]): string {
  const a = d.analysis;
  const lines = [a.headline, "", ...a.summary.map((s) => `• ${s}`)];
  if (a.outlook.length) {
    lines.push("", t("calls.title"));
    for (const o of a.outlook) lines.push(`• ${o.interest} (${o.ticker}): ${t(`act.${o.action}`)} · ${t(`dir.${o.direction}`)} · ${o.confidence}%. ${o.actionTrigger}`);
  }
  if (a.watchNext.length) lines.push("", t("watch.title"), ...a.watchNext.map((w) => `• ${w}`));
  return lines.join("\n");
}

export function Briefing({
  digest, viewingOld, onBackToLatest, onHistory, onCatchUp,
}: { digest: Digest; viewingOld: boolean; onBackToLatest: () => void; onHistory: () => void; onCatchUp: () => void }) {
  const { t, lang } = usePrefs();
  const a = digest.analysis;
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => () => { if (canSpeak) window.speechSynthesis.cancel(); }, [canSpeak, digest]);

  const speak = () => {
    if (!canSpeak) return;
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    // Speak in the language the briefing was written in, not the UI language.
    const info = langInfo(digest.language ?? "en");
    const text = briefingText(digest, t).replace(/•/g, "").replace(/\n+/g, ". ");
    const u = new SpeechSynthesisUtterance(text);
    u.lang = info.speech;
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(info.code));
    if (voice) u.voice = voice;
    u.rate = 1.02;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    synth.cancel();
    synth.speak(u);
    setSpeaking(true);
  };

  const share = async () => {
    const text = briefingText(digest, t);
    try {
      if (navigator.share && window.matchMedia("(max-width: 719px)").matches) {
        await navigator.share({ title: "Invest Helper", text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };

  // Keyboard shortcut "L" dispatches this event.
  const speakRef = useRef(speak);
  speakRef.current = speak;
  useEffect(() => {
    const on = () => speakRef.current();
    window.addEventListener("ih-listen", on);
    return () => window.removeEventListener("ih-listen", on);
  }, []);

  const langMismatch = digest.provider !== "rules" && digest.language && digest.language !== lang;

  return (
    <section className="card hero" aria-labelledby="brief-h">
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="chip accent">
          <IconSparkles width={13} height={13} /> {t("brief.title")}
        </span>
        <span className={`chip mood ${a.mood}`}>{t(`mood.${a.mood}`)}</span>
      </div>
      <h2 id="brief-h" className="hero-headline">{a.headline}</h2>
      <ul className="hero-summary">
        {a.summary.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      {viewingOld && (
        <div className="banner info">
          <IconHistory />
          <span>{t("brief.viewingOld")}</span>
          <button onClick={onBackToLatest}>{t("brief.backToLatest")}</button>
        </div>
      )}
      {langMismatch && !viewingOld && (
        <div className="banner info">
          <IconInfo16 />
          <span>{t("brief.langMismatch", { lang: langInfo(digest.language!).native })}</span>
        </div>
      )}
      <div className="hero-meta">
        <span>{t("brief.updated", { t: relTime(digest.generatedAt, lang) })}</span>
        <span>{digest.provider === "rules" ? t("brief.rules") : providerName(digest.provider)}</span>
        <span>{t("brief.stories", { n: digest.news.length })}</span>
        <div className="hero-actions">
          <button className="pill-btn catch-btn" onClick={onCatchUp} title="C">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
            {t("catch.button")}
          </button>
          {canSpeak && (
            <button className={`pill-btn ${speaking ? "active" : ""}`} onClick={speak} aria-pressed={speaking}>
              {speaking ? <IconStop /> : <IconSpeaker />} {speaking ? t("nav.stop") : t("nav.listen")}
            </button>
          )}
          <button className="pill-btn" onClick={share}>
            {copied ? <IconCopy /> : <IconShare />} {copied ? t("nav.copied") : t("nav.share")}
          </button>
          <button className="pill-btn" onClick={onHistory}>
            <IconHistory /> <span className="desktop-only">{t("brief.history")}</span>
          </button>
        </div>
      </div>
    </section>
  );
}

function IconInfo16() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

/* ----------------------------------------------------------------- Calls */

export function Calls({ outlook, onTicker }: { outlook: Outlook[]; onTicker: (s: string) => void }) {
  const { t } = usePrefs();
  if (!outlook.length) return null;
  return (
    <section className="card" aria-labelledby="calls-h">
      <h2 className="card-title" id="calls-h">
        <IconTarget /> {t("calls.title")}
      </h2>
      <div className="calls">
        {outlook.map((o, i) => (
          <article className="call" key={i}>
            <div className="call-head">
              <Ring value={o.confidence} direction={o.direction} />
              <div>
                <div className="call-name">{o.interest}</div>
                <div className="call-sub">
                  <button onClick={() => onTicker(o.ticker)} style={{ color: "var(--accent)", fontWeight: 600 }}>
                    {o.ticker}
                  </button>{" "}
                  · <span className={o.direction}>{arrow(o.direction)} {t(`dir.${o.direction}`)}</span> ·{" "}
                  {o.horizon === "today" ? t("calls.today") : t("calls.thisWeek")}
                </div>
              </div>
              <span className={`action ${o.action}`}>{t(`act.${o.action}`)}</span>
            </div>
            <div className="trigger">{o.actionTrigger}</div>
            <div className="muted">{o.rationale}</div>
            <div className="muted">
              <b>{t("calls.risks")}:</b> {o.risks}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

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
        const q = quotes.find((x) => x.symbol === m.ticker);
        const chg = q?.changePct ?? m.changePct;
        return (
          <div className="mover" key={m.ticker}>
            <button className="mover-tk" onClick={() => onTicker(m.ticker)}>
              {m.ticker}
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

/* ---------------------------------------------------------------- Events */

export function Events({ events, news }: { events: KeyEvent[]; news: NewsItem[] }) {
  const { t } = usePrefs();
  return (
    <section className="card" aria-labelledby="events-h">
      <h2 className="card-title" id="events-h">
        <IconSparkles /> {t("events.title")}
      </h2>
      {events.length === 0 && <p className="muted">{t("events.none")}</p>}
      {events.map((e, i) => (
        <article className="event" key={i}>
          <h3>
            <span className="imp" aria-label={`${e.importance}/5`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <i key={n} className={n <= e.importance ? "on" : ""} />
              ))}
            </span>
            <span>{e.title}</span>
          </h3>
          <p className="kv">
            <b>{t("events.what")}:</b> {e.whatHappened}
          </p>
          <p className="kv">
            <b>{t("events.why")}:</b> {e.whyItMatters}
          </p>
          <div className="impacts">
            {e.impacts.map((im, j) => (
              <span key={j} className={`chip ${im.direction}`} title={im.reasoning}>
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
          {e.sourceIds.length > 0 && (
            <div className="sources">
              <span>{t("events.sources")}:</span>
              {e.sourceIds
                .map((id) => news[id])
                .filter(Boolean)
                .slice(0, 4)
                .map((n) => (
                  <a key={n.id} href={n.link} target="_blank" rel="noreferrer">
                    {n.source}
                  </a>
                ))}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

/* --------------------------------------------------------------- Up next */

function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function UpNext({ events, notes }: { events: CalendarEvent[]; notes: string[] }) {
  const { t, lang } = usePrefs();
  const today = etToday();
  const tomorrow = new Date(new Date(today + "T12:00:00Z").getTime() + 86400_000).toISOString().slice(0, 10);
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events.slice(0, 24)) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return [...m.entries()];
  }, [events]);
  const fmt = new Intl.DateTimeFormat(langInfo(lang).locale, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const when = (s?: string) => (s === "before open" ? t("cal.beforeOpen") : s === "after close" ? t("cal.afterClose") : s ?? "");
  return (
    <section className="card" aria-labelledby="cal-h">
      <h2 className="card-title" id="cal-h">
        <IconCalendar /> {t("cal.title")}
      </h2>
      {byDay.length === 0 && <p className="muted">{t("cal.empty")}</p>}
      {byDay.map(([date, evs]) => (
        <div className="cal-day" key={date}>
          <div className={`cal-date ${date === today ? "today" : ""}`}>
            {date === today ? t("cal.today") : date === tomorrow ? t("cal.tomorrow") : fmt.format(new Date(date + "T12:00:00Z"))}
          </div>
          {evs.map((e, i) => (
            <div className="cal-ev" key={i}>
              <span className={`bar i${e.importance}`} />
              <span>{e.title}</span>
              <span className="when">{when(e.time)}</span>
            </div>
          ))}
        </div>
      ))}
      {notes.length > 0 && <div className="note">{notes.join(" ")}</div>}
    </section>
  );
}

export function WatchNext({ items }: { items: string[] }) {
  const { t } = usePrefs();
  if (!items.length) return null;
  return (
    <section className="card" aria-labelledby="watch-h">
      <h2 className="card-title" id="watch-h">
        <IconEye /> {t("watch.title")}
      </h2>
      <ul className="watch">
        {items.map((w, i) => (
          <li key={i}>
            <IconArrow />
            <span>{w}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------- Headlines */

export function Headlines({
  digest, interests, newIds, onMarkRead, searchRef, onExplain,
}: {
  onExplain?: (title: string) => void;
  digest: Digest;
  interests: Interest[];
  newIds: Set<string>;
  onMarkRead: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { t, lang, saved, toggleSaved, isSaved } = usePrefs();
  const [filter, setFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  useEffect(() => {
    const on = (e: Event) => {
      setFilter("all");
      setQ(String((e as CustomEvent).detail ?? ""));
      setTimeout(() => searchRef.current?.focus(), 300);
    };
    window.addEventListener("ih-search", on);
    return () => window.removeEventListener("ih-search", on);
  }, [searchRef]);
  const keyIds = useMemo(() => new Set(digest.analysis.events.flatMap((e) => e.sourceIds.map((i) => digest.news[i]?.id)).filter(Boolean)), [digest]);
  const tags = useMemo(() => [...new Set(digest.news.flatMap((n) => n.tags ?? []))], [digest.news]);
  const tagName = (id: string) => interests.find((i) => i.id === id)?.name ?? id;

  const base = filter === "saved" ? saved : filter === "new" ? digest.news.filter((n) => newIds.has(n.id)) : filter === "all" ? digest.news : digest.news.filter((n) => n.tags?.includes(filter));
  const needle = q.trim().toLowerCase();
  const list = needle ? base.filter((n) => `${n.title} ${n.source} ${n.summary ?? ""}`.toLowerCase().includes(needle)) : base;

  return (
    <section className="card" aria-labelledby="news-h" id="headlines">
      <h2 className="card-title" id="news-h">
        {t("news.title")}
        <span className="spacer" />
        {newIds.size > 0 && (
          <button className="pill-btn" onClick={onMarkRead} style={{ textTransform: "none", letterSpacing: 0 }}>
            {t("news.markRead")}
          </button>
        )}
      </h2>
      <div className="search">
        <IconSearch />
        <input ref={searchRef} type="search" placeholder={t("nav.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("nav.search")} />
      </div>
      <div className="filters" role="toolbar">
        <button className="filter" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
          {t("news.all")}
        </button>
        {newIds.size > 0 && (
          <button className="filter" aria-pressed={filter === "new"} onClick={() => setFilter("new")}>
            {t("news.newCount", { n: newIds.size })}
          </button>
        )}
        {tags.length > 1 &&
          tags.map((tg) => (
            <button key={tg} className="filter" aria-pressed={filter === tg} onClick={() => setFilter(tg)}>
              {tagName(tg)}
            </button>
          ))}
        <button className="filter" aria-pressed={filter === "saved"} onClick={() => setFilter("saved")}>
          <IconBookmark width={12} height={12} style={{ verticalAlign: -1, marginRight: 4 }} />
          {t("news.saved")} {saved.length ? `(${saved.length})` : ""}
        </button>
      </div>
      {list.length === 0 && <p className="muted" style={{ padding: "12px 0" }}>{filter === "saved" && !needle ? t("news.savedEmpty") : t("news.none")}</p>}
      {list.map((n) => (
        <div className={`news ${newIds.has(n.id) ? "is-new" : ""}`} key={n.id}>
          <a href={n.link} target="_blank" rel="noreferrer">
            {n.title}
          </a>
          <div className="news-actions">
            {onExplain && (
              <button className="save-btn" onClick={() => onExplain(n.title)} aria-label={t("news.explain")} title={t("news.explain")}>
                <IconSparkles />
              </button>
            )}
            <button className="save-btn" aria-pressed={isSaved(n.id)} onClick={() => toggleSaved(n)} aria-label={isSaved(n.id) ? t("news.unsave") : t("news.save")}>
              <IconBookmark filled={isSaved(n.id)} />
            </button>
          </div>
          <div className="news-meta">
            <span>{n.source}</span>
            <span>·</span>
            <span>{relTime(n.publishedAt, lang)}</span>
            {keyIds.has(n.id) && <span className="tag key">{t("news.key")}</span>}
            {n.alsoIn?.length ? <span className="tag" title={n.alsoIn.join(", ")}>{t("news.sources", { n: n.alsoIn.length })}</span> : null}
            {n.tags?.slice(0, 3).map((tg) => (
              <span className="tag" key={tg}>
                {tagName(tg)}
              </span>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

export function providerName(id: string): string {
  const p = id.split(":")[0];
  return { claude: "Claude", groq: "Groq", gemini: "Gemini" }[p] ?? p;
}
