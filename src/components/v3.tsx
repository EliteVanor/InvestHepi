"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AlertLogEntry, AlertSettings, PriceAlert, PriceOp } from "@/lib/alerts";
import type { LiveQuote } from "@/lib/chart";
import { relTime, type MsgKey } from "@/lib/i18n";
import { marketClock } from "@/lib/marketTime";
import type { Quote, SectionId } from "@/lib/types";
import { IconBolt, IconChart, IconFlag, IconGear, IconGlobe, IconMoon, IconRefresh, IconSearch, IconSparkles, IconStar, IconTarget, IconX } from "./Icons";
import { LiveChart } from "./LiveChart";
import { usePrefs } from "./prefs";
import { Sheet, fmtPct } from "./primitives";

/* ------------------------------------------------------------ live quotes */

/** Polls /api/quotes while the session is active and the page is visible. */
export function useLiveQuotes(symbols: string[], everyMs = 60_000): Map<string, LiveQuote> {
  const { api } = usePrefs();
  const [map, setMap] = useState<Map<string, LiveQuote>>(new Map());
  const key = symbols.join(",");
  useEffect(() => {
    if (!key) return;
    let stop = false;
    const tick = async (force = false) => {
      if (!force && (marketClock().phase === "closed" || document.visibilityState !== "visible")) return;
      try {
        const j = await api<{ quotes: LiveQuote[] }>(`/api/quotes?symbols=${encodeURIComponent(key)}`);
        if (!stop) setMap(new Map(j.quotes.map((q) => [q.symbol, q])));
      } catch {}
    };
    tick(true);
    const id = setInterval(tick, everyMs);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [api, key, everyMs]);
  return map;
}

/** Overlay live prices on digest quotes (keeps the 1-month history for sparklines). */
export function mergeLive(quotes: Quote[], live: Map<string, LiveQuote>): Quote[] {
  return quotes.map((q) => {
    const l = live.get(q.symbol);
    return l ? { ...q, price: l.price, prevClose: l.prevClose, changePct: l.changePct } : q;
  });
}

/* ------------------------------------------------------------- chart card */

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

/* --------------------------------------------------------------- heatmap */

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
  const live = useLiveQuotes(SECTOR_LIST.map(([s]) => s), 120_000);
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

/* ---------------------------------------------------------------- toggle */

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span />
    </label>
  );
}

/* ------------------------------------------------------------ alerts tab */

export function AlertsTab({ prefillSymbol }: { prefillSymbol?: string }) {
  const { t, api, lang } = usePrefs();
  const [s, setS] = useState<AlertSettings | null>(null);
  const [saved, setSaved] = useState<AlertSettings | null>(null);
  const [provider, setProvider] = useState<string>("none");
  const [log, setLog] = useState<AlertLogEntry[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ symbol: string; op: PriceOp; value: string; repeat: boolean }>({ symbol: prefillSymbol ?? "", op: "above", value: "", repeat: false });

  useEffect(() => {
    api<{ settings: AlertSettings; log: AlertLogEntry[]; provider: string }>("/api/alerts")
      .then((j) => {
        setS(j.settings);
        setSaved(j.settings);
        setLog(j.log);
        setProvider(j.provider);
      })
      .catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, [api]);

  const dirty = s && saved && JSON.stringify(s) !== JSON.stringify(saved);
  const save = async (next = s) => {
    if (!next) return;
    setBusy(true);
    setMsg(null);
    try {
      const j = await api<{ settings: AlertSettings }>("/api/alerts", { method: "PUT", body: JSON.stringify(next) });
      setS(j.settings);
      setSaved(j.settings);
      setMsg({ ok: true, text: t("set.saved") });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    if (!s) return;
    if (dirty) await save(); // the server only sends tests to the saved address
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/alerts/test", { method: "POST", body: "{}" });
      setMsg({ ok: true, text: t("al.testSent", { email: s.email }) });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const addPriceAlert = () => {
    if (!s) return;
    const value = Number(form.value);
    if (!form.symbol.trim() || !(value > 0)) return;
    const pa: PriceAlert = { id: Math.random().toString(36).slice(2, 10), symbol: form.symbol.trim().toUpperCase(), op: form.op, value, repeat: form.repeat, active: true, createdAt: new Date().toISOString() };
    const next = { ...s, priceAlerts: [...s.priceAlerts, pa] };
    setS(next);
    setForm({ symbol: "", op: "above", value: "", repeat: false });
    save(next);
  };

  if (!s) return <div className="skeleton" style={{ height: 260, marginTop: 18 }} />;
  const up = (patch: Partial<AlertSettings>) => setS({ ...s, ...patch });
  const opLabel = (op: PriceOp) => t(`al.op.${op}` as MsgKey);
  const ruleRow = (title: string, hint: string, checked: boolean, onChange: (v: boolean) => void, extra?: ReactNode) => (
    <div className="row">
      <span className="label">
        {title}
        <span className="sub">{hint}</span>
      </span>
      {extra}
      <Toggle checked={checked} onChange={onChange} label={title} disabled={!s.enabled} />
    </div>
  );

  return (
    <>
      <p className="hint" style={{ marginTop: 16 }}>{t("al.intro")}</p>
      <div className="sheet-section">
        <div className="group">
          <div className="row">
            <span className="label">{t("al.enabled")}</span>
            <Toggle checked={s.enabled} onChange={(v) => up({ enabled: v })} label={t("al.enabled")} />
          </div>
          <label className="row">
            <span className="label">{t("al.email")}</span>
            <input className="input" type="email" value={s.email} onChange={(e) => up({ email: e.target.value })} placeholder="you@example.com" style={{ maxWidth: 260, height: 34 }} autoComplete="email" />
          </label>
          <div className="row">
            <span className="label">{t("al.provider")}</span>
            <span className={`value ${provider === "none" ? "bad" : "ok"}`}>{provider === "none" ? t("al.providerNone") : provider === "resend" ? "Resend" : "SMTP"}</span>
          </div>
        </div>
        <div className="sheet-actions" style={{ justifyContent: "flex-start" }}>
          <button className="btn-plain" onClick={test} disabled={busy || !s.email || provider === "none"}>
            {t("al.test")}
          </button>
        </div>
      </div>

      <div className="sheet-section">
        <div className="group">
          {ruleRow(t("al.morning"), t("al.morningHint"), s.morningBriefing, (v) => up({ morningBriefing: v }))}
          {ruleRow(t("al.weekly"), t("al.weeklyHint"), s.weeklyRecap, (v) => up({ weeklyRecap: v }))}
          {ruleRow(
            t("al.bigMove"),
            t("al.bigMoveHint", { pct: s.bigMove.pct }),
            s.bigMove.enabled,
            (v) => up({ bigMove: { ...s.bigMove, enabled: v } }),
            <input className="num-input" type="number" min={0.5} max={50} step={0.5} value={s.bigMove.pct} onChange={(e) => up({ bigMove: { ...s.bigMove, pct: Number(e.target.value) } })} aria-label="%" />,
          )}
          {ruleRow(t("al.calls"), t("al.callsHint"), s.callChanges, (v) => up({ callChanges: v }))}
          {ruleRow(
            t("al.conf"),
            t("al.confHint", { min: s.highConfidence.min }),
            s.highConfidence.enabled,
            (v) => up({ highConfidence: { ...s.highConfidence, enabled: v } }),
            <input className="num-input" type="number" min={50} max={99} step={1} value={s.highConfidence.min} onChange={(e) => up({ highConfidence: { ...s.highConfidence, min: Number(e.target.value) } })} aria-label="%" />,
          )}
          {ruleRow(t("al.catalysts"), t("al.catalystsHint"), s.catalysts, (v) => up({ catalysts: v }))}
        </div>
      </div>

      <div className="sheet-section">
        <h3>{t("al.price")}</h3>
        <div className="group">
          {s.priceAlerts.length === 0 && (
            <div className="row">
              <span className="label muted">{t("al.none")}</span>
            </div>
          )}
          {s.priceAlerts.map((a) => (
            <div className="row" key={a.id} style={{ opacity: a.active ? 1 : 0.55 }}>
              <span className="label">
                <b style={{ fontWeight: 600 }}>{a.symbol}</b> · {opLabel(a.op)} <span className="num">{a.op.startsWith("pct") ? `${a.value}%` : a.value}</span>
                <span className="sub">
                  {a.repeat ? t("al.repeat") : t("al.once")}
                  {a.lastFiredAt ? ` · ${t("al.fired", { t: relTime(a.lastFiredAt, lang) })}` : ""}
                  {!a.active ? ` · ${t("al.paused")}` : ""}
                </span>
              </span>
              <button
                className="icon-btn"
                aria-label={t("int.remove")}
                onClick={() => {
                  const next = { ...s, priceAlerts: s.priceAlerts.filter((x) => x.id !== a.id) };
                  setS(next);
                  save(next);
                }}
              >
                <IconX />
              </button>
            </div>
          ))}
        </div>
        <div className="pa-form">
          <input className="input num" placeholder={t("al.symbol")} value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} maxLength={12} aria-label={t("al.symbol")} />
          <select value={form.op} onChange={(e) => setForm({ ...form, op: e.target.value as PriceOp })} aria-label="Condition">
            {(["above", "below", "pct_up", "pct_down"] as PriceOp[]).map((op) => (
              <option key={op} value={op}>
                {opLabel(op)}
              </option>
            ))}
          </select>
          <input className="input num" type="number" min={0} step="any" placeholder={form.op.startsWith("pct") ? "%" : "$"} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} aria-label={t("al.value")} />
          <div className="pa-actions">
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
              <Toggle checked={form.repeat} onChange={(v) => setForm({ ...form, repeat: v })} label={t("al.repeat")} />
              {t("al.repeat")}
            </label>
            <button className="btn-plain" onClick={addPriceAlert} disabled={!form.symbol || !form.value || busy}>
              {t("al.add")}
            </button>
          </div>
        </div>
      </div>

      {log.length > 0 && (
        <div className="sheet-section">
          <h3>{t("al.recent")}</h3>
          <div className="group">
            {log.slice(0, 12).map((l, i) => (
              <div className="log-row" key={i}>
                <span className={l.ok ? "ok" : "bad"}>{l.ok ? "✓" : "✗"}</span>
                <span>{l.title}</span>
                <small>
                  {relTime(l.at, lang)}
                  {l.error ? ` · ${l.error}` : ""}
                </small>
              </div>
            ))}
          </div>
        </div>
      )}

      {msg && <p className={`hint ${msg.ok ? "ok" : "bad"}`}>{msg.text}</p>}
      {dirty && (
        <div className="sheet-actions">
          <button className="btn-plain" onClick={() => setS(saved)}>
            {t("set.cancel")}
          </button>
          <button className="btn-primary" onClick={() => save()} disabled={busy}>
            {busy ? t("set.saving") : t("set.save")}
          </button>
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- Ask AI */

interface AskMsg {
  role: "user" | "assistant";
  content: string;
  sources?: { n: number; title: string; link: string; source: string }[];
  provider?: string;
  error?: boolean;
}

function renderAnswer(text: string) {
  const parts = text.split(/(\[\d{1,2}\])/g);
  return parts.map((p, i) => (/^\[\d{1,2}\]$/.test(p) ? <span className="cite" key={i}>{p.slice(1, -1)}</span> : <span key={i}>{p}</span>));
}

export function AskSheet({ onClose, tickers, initial }: { onClose: () => void; tickers: string[]; initial?: string }) {
  const { t, api, lang } = usePrefs();
  const [msgs, setMsgs] = useState<AskMsg[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem("ih-ask") ?? "[]");
    } catch {
      return [];
    }
  });
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sentInitial = useRef(false);

  useEffect(() => {
    try {
      sessionStorage.setItem("ih-ask", JSON.stringify(msgs.slice(-20)));
    } catch {}
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy]);

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || busy) return;
      const history = msgs.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
      setMsgs((m) => [...m, { role: "user", content: text }]);
      setQ("");
      setBusy(true);
      try {
        const r = await api<{ answer: string; sources: AskMsg["sources"]; provider: string }>("/api/ask", { method: "POST", body: JSON.stringify({ question: text, history, lang }) });
        setMsgs((m) => [...m, { role: "assistant", content: r.answer, sources: r.sources, provider: r.provider }]);
      } catch (e) {
        const em = (e as Error).message;
        setMsgs((m) => [...m, { role: "assistant", content: em === "NO_PROVIDER" ? t("ask.noProvider") : em, error: true }]);
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [api, busy, lang, msgs, t],
  );

  useEffect(() => {
    if (initial && !sentInitial.current) {
      sentInitial.current = true;
      send(initial);
    }
  }, [initial, send]);

  const tk = tickers[0] ?? "SPY";
  const tk2 = tickers.find((x) => x !== tk) ?? tk;
  const suggestions = [t("ask.s1", { ticker: tk }), t("ask.s2"), t("ask.s3", { ticker: tk2 }), t("ask.s4")];

  return (
    <Sheet
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <IconSparkles width={20} height={20} style={{ color: "var(--purple)" }} /> {t("ask.title")}
        </span>
      }
      onClose={onClose}
      actions={
        msgs.length > 0 ? (
          <button className="pill-btn" onClick={() => setMsgs([])}>
            {t("ask.clear")}
          </button>
        ) : undefined
      }
    >
      <div className="chat" aria-live="polite">
        {msgs.length === 0 && (
          <>
            <p className="hint" style={{ margin: 0 }}>{t("ask.intro")}</p>
            <div className="suggest">
              {suggestions.map((s) => (
                <button key={s} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.role === "user" ? "me" : "ai"}`} style={m.error ? { color: "var(--red)" } : undefined}>
            {m.role === "assistant" ? renderAnswer(m.content) : m.content}
            {m.role === "assistant" && (m.sources?.length || m.provider) ? (
              <div className="bubble-meta">
                {m.sources?.map((s) => (
                  <a key={s.n} href={s.link} target="_blank" rel="noreferrer" title={s.title}>
                    [{s.n}] {s.source}
                  </a>
                ))}
                {m.provider && <span>· {m.provider.split(":")[0]}</span>}
              </div>
            ) : null}
          </div>
        ))}
        {busy && (
          <div className="bubble ai typing" aria-label={t("ask.thinking")}>
            <i />
            <i />
            <i />
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(q);
        }}
      >
        <input ref={inputRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ask.placeholder")} maxLength={500} aria-label={t("ask.placeholder")} />
        <button type="submit" disabled={!q.trim() || busy} aria-label={t("ask.send")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
    </Sheet>
  );
}

/* ------------------------------------------------------- command palette */

export interface PaletteActions {
  section: (s: SectionId) => void;
  ticker: (s: string) => void;
  ask: (q?: string) => void;
  catchup: () => void;
  searchNews: (q: string) => void;
  refresh: () => void;
  theme: () => void;
  track: () => void;
  settings: (tab?: "general" | "interests" | "holdings" | "status" | "alerts") => void;
}

interface Item {
  id: string;
  group: string;
  label: string;
  sub?: string;
  icon: ReactNode;
  run: () => void;
  keywords?: string;
}

export function CommandPalette({ onClose, tickers, actions, readOnly }: { onClose: () => void; tickers: string[]; actions: PaletteActions; readOnly?: boolean }) {
  const { t } = usePrefs();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // Company-name search (e.g. "micro" → MSFT, AMD, MU), debounced.
  const { api } = usePrefs();
  const [hits, setHits] = useState<{ symbol: string; name: string }[]>([]);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      return;
    }
    const id = setTimeout(() => {
      api<{ hits: { symbol: string; name: string }[] }>(`/api/search?q=${encodeURIComponent(query)}`).then((j) => setHits(j.hits)).catch(() => setHits([]));
    }, 220);
    return () => clearTimeout(id);
  }, [q, api]);

  const items = useMemo<Item[]>(() => {
    const query = q.trim();
    const g = { sec: t("cmd.sections"), tk: t("cmd.tickers"), act: t("cmd.actions") };
    const base: Item[] = [
      { id: "s-i", group: g.sec, label: t("sec.interests"), sub: "1", icon: <IconStar />, run: () => actions.section("interests") },
      { id: "s-w", group: g.sec, label: t("sec.world"), sub: "2", icon: <IconGlobe />, run: () => actions.section("world") },
      { id: "s-u", group: g.sec, label: t("sec.us"), sub: "3", icon: <IconFlag />, run: () => actions.section("us") },
      ...tickers.map((s) => ({ id: `t-${s}`, group: g.tk, label: t("cmd.chart", { s }), sub: s, icon: <IconChart />, run: () => actions.ticker(s), keywords: s })),
      { id: "a-catch", group: g.act, label: t("sc.catchup"), sub: "C", icon: <IconBolt />, run: actions.catchup },
      { id: "a-ask", group: g.act, label: t("ask.title"), sub: "A", icon: <IconSparkles />, run: () => actions.ask() },
      { id: "a-refresh", group: g.act, label: t("nav.refresh"), sub: "R", icon: <IconRefresh />, run: actions.refresh },
      { id: "a-track", group: g.act, label: t("nav.track"), sub: "T", icon: <IconTarget />, run: actions.track },
      { id: "a-alerts", group: g.act, label: t("set.alerts"), icon: <IconBolt />, run: () => actions.settings("alerts") },
      { id: "a-int", group: g.act, label: t("set.interests"), icon: <IconStar />, run: () => actions.settings("interests") },
      { id: "a-hold", group: g.act, label: t("pf.title"), icon: <IconChart />, run: () => actions.settings("holdings") },
      { id: "a-theme", group: g.act, label: t("cmd.theme"), sub: "D", icon: <IconMoon />, run: actions.theme },
      { id: "a-set", group: g.act, label: t("nav.settings"), icon: <IconGear />, run: () => actions.settings() },
    ];
    if (readOnly) {
      const ownerOnlyIds = new Set(["a-ask", "a-refresh", "a-alerts", "a-int", "a-hold"]);
      for (let k = base.length - 1; k >= 0; k--) if (ownerOnlyIds.has(base[k].id)) base.splice(k, 1);
    }
    if (!query) return base;
    const needle = query.toLowerCase();
    const matches = base.filter((i) => `${i.label} ${i.keywords ?? ""}`.toLowerCase().includes(needle));
    const extra: Item[] = [];
    const shownSyms = new Set(matches.map((m) => m.keywords));
    for (const h of hits) {
      if (shownSyms.has(h.symbol)) continue;
      shownSyms.add(h.symbol);
      extra.push({ id: `h-${h.symbol}`, group: t("cmd.search"), label: h.name, sub: h.symbol, icon: <IconChart />, run: () => actions.ticker(h.symbol) });
    }
    if (/^[A-Za-z.^=\-]{1,10}$/.test(query) && !shownSyms.has(query.toUpperCase())) {
      const s = query.toUpperCase();
      extra.push({ id: `t-any-${s}`, group: g.tk, label: t("cmd.chart", { s }), sub: s, icon: <IconChart />, run: () => actions.ticker(s) });
    }
    if (!readOnly) extra.push({ id: "q-ask", group: g.act, label: t("cmd.ask", { q: query }), icon: <IconSparkles />, run: () => actions.ask(query) });
    extra.push({ id: "q-news", group: g.act, label: t("cmd.searchNews", { q: query }), icon: <IconSearch />, run: () => actions.searchNews(query) });
    // Keep one header per group: sections, tickers, search results, actions.
    const order = [g.sec, g.tk, t("cmd.search"), g.act];
    return [...matches, ...extra].map((it, i) => ({ it, i })).sort((a, b) => order.indexOf(a.it.group) - order.indexOf(b.it.group) || a.i - b.i).map((x) => x.it);
  }, [q, t, tickers, actions, hits, readOnly]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const run = (i: number) => {
    const it = items[i];
    if (!it) return;
    onClose();
    setTimeout(it.run, 0);
  };

  let lastGroup = "";
  return (
    <div className="palette-scrim" onClick={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t("sc.palette")} onClick={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <IconSearch />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("cmd.placeholder")}
            aria-label={t("cmd.placeholder")}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(items.length - 1, s + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(sel);
              } else if (e.key === "Escape") onClose();
            }}
          />
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {items.length === 0 && <div className="palette-group">{t("cmd.empty")}</div>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? <div className="palette-group">{it.group}</div> : null;
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {header}
                <button className="palette-item" role="option" aria-selected={i === sel} data-i={i} onMouseMove={() => setSel(i)} onClick={() => run(i)}>
                  <span className="pi-icon">{it.icon}</span>
                  <span>{it.label}</span>
                  {it.sub && <span className="pi-sub">{it.sub}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">{t("cmd.hint")}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------ setup checklist */

interface StatusLite {
  providers: string[];
  store: "redis" | "file" | "ephemeral";
  password: boolean;
  cronSecret: boolean;
  email: "resend" | "smtp" | "none";
}

/** First-run checklist: which pieces of the deploy are configured, each with a one-line fix. */
export function SetupChecklist() {
  const { t, api } = usePrefs();
  const [s, setS] = useState<StatusLite | null>(null);
  useEffect(() => {
    api<StatusLite>("/api/status").then(setS).catch(() => {});
  }, [api]);
  if (!s) return null;
  const items: { ok: boolean; optional?: boolean; title: MsgKey; hint: MsgKey }[] = [
    { ok: s.providers.length > 0, title: "onb.ai", hint: "onb.aiHint" },
    { ok: s.store !== "ephemeral", title: "onb.store", hint: "onb.storeHint" },
    { ok: s.password, title: "onb.pw", hint: "onb.pwHint" },
    { ok: s.cronSecret, title: "onb.cron", hint: "onb.cronHint" },
    { ok: s.email !== "none", optional: true, title: "onb.email", hint: "onb.emailHint" },
  ];
  const required = items.filter((i) => !i.optional);
  const done = required.filter((i) => i.ok).length;
  return (
    <div className="checklist">
      <div className="checklist-head">
        <b>{t("onb.title")}</b>
        <span className="num">
          {done}/{required.length}
        </span>
      </div>
      <div className="checklist-bar">
        <i style={{ width: `${(done / required.length) * 100}%` }} />
      </div>
      {done === required.length && <p className="hint ok" style={{ margin: "8px 0 0" }}>{t("onb.ready")}</p>}
      <ul>
        {items.map((i) => (
          <li key={i.title} className={i.ok ? "done" : ""}>
            <span className="ck" aria-hidden="true">{i.ok ? "✓" : ""}</span>
            <span>
              <b>{t(i.title)}</b>
              {!i.ok && <small>{t(i.hint)}</small>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
