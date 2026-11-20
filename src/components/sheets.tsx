"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { relTime, type MsgKey } from "@/lib/i18n";
import { LANGUAGES, langInfo, type LangCode } from "@/lib/languages";
import type { AlertSettings } from "@/lib/alerts";
import { tickerMatcher } from "@/lib/tickers";
import { exchangeTz } from "@/lib/symbols";
import { SECTION_IDS, type Digest, type Holding, type Interest, type Outlook, type Quote, type SectionId } from "@/lib/types";
import { IconArrow, IconBolt, IconChart, IconCheck, IconGear, IconMoon, IconPlus, IconStar, IconX } from "./Icons";
import { usePrefs, type Theme } from "./prefs";
import { LiveChart, type ChartReply } from "./LiveChart";
import { showsLevel, windowChange, type CurrentQuote } from "@/lib/quote-view";
import { Ring, Sheet, arrow, fmtPct, fmtPrice, symLabel, openOverlay } from "./primitives";
import { AlertsTab } from "./alerts-tab";
import { useAccount } from "./account";
import { VN_PRESET } from "@/lib/config";
import { QUICK_ZONES, allZones, deviceZone, zoneOffset } from "@/lib/zones";
import { HoldingsEditor, TickerSearch } from "./portfolio";
import { safeHttpUrl } from "@/lib/safe-url";

/* -------------------------------------------------------------- Settings */

export type Tab = "general" | "interests" | "holdings" | "alerts" | "status" | "shortcuts";

/** iOS-style settings: a root list that drills into pages. */
export function SettingsSheet({
  onClose, initialTab, onInterestsSaved, onHoldingsSaved, prefillSymbol, readOnly,
}: {
  readOnly?: boolean;
  onClose: () => void;
  initialTab?: Tab;
  onInterestsSaved: () => void;
  onHoldingsSaved: (h: Holding[]) => void;
  prefillSymbol?: string;
}) {
  const { t, theme, lang, tz, zoneName } = usePrefs();
  const [page, setPage] = useState<Tab | null>(initialTab ?? null);
  const allPages: { id: Tab; label: MsgKey; icon: ReactNode; tint: string; value?: string; desktopOnly?: boolean }[] = [
    { id: "general", label: "set.root.appearance", icon: <IconMoon />, tint: "#5e5ce6", value: `${t(`set.${theme}` as MsgKey)} · ${langInfo(lang).native} · ${zoneName(tz)}` },
    { id: "interests", label: "set.interests", icon: <IconStar />, tint: "#ff9f0a" },
    { id: "holdings", label: "pf.title", icon: <IconChart />, tint: "#30b0c7" },
    { id: "alerts", label: "set.alerts", icon: <IconBolt />, tint: "#ff453a" },
    { id: "status", label: "set.status", icon: <IconCheck />, tint: "#34c759" },
    { id: "shortcuts", label: "set.shortcuts", icon: <IconGear />, tint: "#8e8e93", desktopOnly: true },
  ];
  const pages = allPages.filter((p) => !readOnly || p.id === "general" || p.id === "status" || p.id === "shortcuts");
  const current = pages.find((p) => p.id === page);
  return (
    <Sheet
      title={
        current ? (
          <span className="set-title">
            <button className="set-back" onClick={() => setPage(null)} aria-label={t("set.back")}>
              <IconArrow style={{ transform: "rotate(180deg)" }} /> {t("set.title")}
            </button>
            <span>{t(current.label)}</span>
          </span>
        ) : (
          t("set.title")
        )
      }
      onClose={onClose}
    >
      {!page && (
        <div className="group set-root" role="list">
          {pages.map((p) => (
            <button key={p.id} role="listitem" className={`row set-row ${p.desktopOnly ? "desktop-only" : ""}`} onClick={() => setPage(p.id)}>
              <span className="set-icon" style={{ background: p.tint }}>{p.icon}</span>
              <span className="label">{t(p.label)}</span>
              {p.value && <span className="value">{p.value}</span>}
              <IconArrow className="set-chev" />
            </button>
          ))}
        </div>
      )}
      {page === "general" && <GeneralTab />}
      {page === "interests" && <InterestsTab onSaved={onInterestsSaved} />}
      {page === "holdings" && <HoldingsEditor onSaved={onHoldingsSaved} />}
      {page === "alerts" && <AlertsTab prefillSymbol={prefillSymbol} />}
      {page === "status" && <StatusTab />}
      {page === "shortcuts" && <ShortcutsTab />}
    </Sheet>
  );
}

function GeneralTab() {
  const { t, theme, setTheme, lang, setLang, api, forgetPassword, tzSetting, tz, setTz, zoneName, timeAt } = usePrefs();
  const zones = useMemo(() => allZones().filter((z) => !(QUICK_ZONES as readonly string[]).includes(z)), []);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  // Saved per account (like the language) and on this device; "auto" follows the device.
  const pickZone = (z: string) => {
    setTz(z);
    const canSave = acc.mode === "multi" ? !!acc.user : true;
    if (canSave) api("/api/settings", { method: "PUT", body: JSON.stringify({ timeZone: z }) }).catch(() => {});
  };
  const zoneOption = (z: string) => `${zoneName(z)} (${zoneOffset(z, now)})`;
  const acc = useAccount();
  // One language for everything: the interface, briefing translations and alert emails. Briefings are
  // always written in English and translated, so changing it never re-runs an analysis.
  const pickLang = (l: LangCode) => {
    setLang(l);
    const canSave = acc.mode === "multi" ? !!acc.user : true;
    if (canSave) api("/api/settings", { method: "PUT", body: JSON.stringify({ briefingLanguage: l }) }).catch(() => {});
  };

  const themes: [Theme, MsgKey][] = [
    ["system", "set.system"],
    ["light", "set.light"],
    ["dark", "set.dark"],
  ];

  return (
    <>
      <div className="sheet-section">
        <h3>{t("set.appearance")}</h3>
        <div className="segmented" style={{ display: "flex" }}>
          {themes.map(([id, key]) => (
            <button key={id} aria-pressed={theme === id} onClick={() => setTheme(id)} style={{ flex: 1 }}>
              {t(key)}
            </button>
          ))}
        </div>
      </div>
      <div className="sheet-section">
        <div className="group">
          <label className="row">
            <span className="label">{t("set.uiLang")}</span>
            <select value={lang} onChange={(e) => pickLang(e.target.value as LangCode)}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.native}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="hint">{t("set.briefLangHint")}</p>
      </div>
      <div className="sheet-section">
        <h3>{t("set.tz")}</h3>
        <div className="group">
          <label className="row">
            <span className="label">{t("set.tzShow")}</span>
            <select value={tzSetting} onChange={(e) => pickZone(e.target.value)} aria-label={t("set.tz")}>
              <option value="auto">{t("set.tzAuto", { zone: zoneName(deviceZone()) })}</option>
              <optgroup label={t("set.tzCommon")}>
                {QUICK_ZONES.map((z) => (
                  <option key={z} value={z}>
                    {zoneOption(z)}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t("set.tzAll")}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, " ")} ({zoneOffset(z, now)})
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <div className="row">
            <span className="label">{t("set.tzNow")}</span>
            <span className="value num">{timeAt(now, { tz })}</span>
          </div>
        </div>
        <p className="hint">{t("set.tzHint")}</p>
      </div>
      {acc.mode !== "multi" && (
        <div className="sheet-section">
          <button
            className="btn-plain"
            onClick={() => {
              forgetPassword();
              location.reload();
            }}
          >
            {t("set.signOut")}
          </button>
        </div>
      )}
    </>
  );
}

function InterestsTab({ onSaved }: { onSaved: () => void }) {
  const { t, api } = usePrefs();
  type Row = Interest & { tickerText: string };
  const [list, setList] = useState<Row[]>([]);
  const [defaults, setDefaults] = useState<Interest[]>([]);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const withText = (l: Interest[]): Row[] => l.map((i) => ({ ...i, tickerText: i.tickers.join(", ") }));

  useEffect(() => {
    api<{ interests: Interest[]; defaults: Interest[] }>("/api/interests")
      .then((j) => {
        setList(withText(j.interests));
        setDefaults(j.defaults);
      })
      .catch((e) => setErr((e as Error).message));
  }, [api]);

  const update = (i: number, patch: Partial<Row>) => setList((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      const body = list
        .filter((x) => x.name.trim())
        .map((x, i) => ({
          id: x.id || `${x.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30) || "interest"}-${i}`,
          name: x.name.trim(),
          query: x.query.trim() || x.name.trim(),
          tickers: x.tickerText.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean),
        }));
      await api("/api/interests", { method: "PUT", body: JSON.stringify(body) });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sheet-section">
      <p className="hint" style={{ marginTop: 0 }}>{t("int.intro")}</p>
      {list.map((x, i) => (
        <div className="int-card" key={i}>
          <div className="field">
            <label>{t("int.name")}</label>
            <input className="input" value={x.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Energy" />
          </div>
          <div className="field">
            <label>
              {t("int.query")} <span>· {t("int.queryHint")}</span>
            </label>
            <input className="input" value={x.query} onChange={(e) => update(i, { query: e.target.value })} placeholder='oil prices OR "energy stocks"' />
          </div>
          <div className="field">
            <label>
              {t("int.tickers")} <span>· {t("int.tickersHint")}</span>
            </label>
            <input className="input num" value={x.tickerText} onChange={(e) => update(i, { tickerText: e.target.value })} placeholder="XLE, XOM, CVX" />
          </div>
          <div className="int-search">
            <TickerSearch onPick={(sym) => update(i, { tickerText: [...new Set([...x.tickerText.split(/[\s,]+/).filter(Boolean), sym])].join(", ") })} />
          </div>
          <button className="icon-btn" onClick={() => setList((l) => l.filter((_, j) => j !== i))} aria-label={t("int.remove")}>
            <IconX />
          </button>
        </div>
      ))}
      {err && <p className="hint bad">{err}</p>}
      <div className="sheet-actions">
        <button className="btn-plain" onClick={() => setList(withText(defaults))}>
          {t("int.reset")}
        </button>
        {!list.some((x) => x.id === VN_PRESET.id) && (
          <button className="btn-plain" onClick={() => setList((l) => [...l, ...withText([VN_PRESET])])}>
            🇻🇳 {t("int.vnPreset")}
          </button>
        )}
        <button className="btn-plain" onClick={() => setList((l) => [...l, { id: "", name: "", query: "", tickers: [], tickerText: "" }])}>
          <IconPlus width={15} height={15} style={{ verticalAlign: -2 }} /> {t("int.add")}
        </button>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? t("set.saving") : t("int.save")}
        </button>
      </div>
    </div>
  );
}

interface Status {
  providers: string[];
  store: "redis" | "file" | "ephemeral";
  finnhub: boolean;
  password: boolean;
  cronSecret: boolean;
  email: "resend" | "smtp" | "none";
  lastRefresh: Record<SectionId, { at: string; ok: boolean; provider?: string; error?: string } | null>;
  schedule?: { lastTick: { at: string; src: string } | null; late: string[]; slots?: { slot: string; start: string }[]; grading?: { lastOk: string | null; failing: { at: string; n: number; error: string; retryAt: string } | null } };
  /** Admin only: today's use per model against its free allowance. */
  aiUsage?: { key: string; model: string; tokens: number; tokensPerDay?: number; requests: number; requestsPerDay?: number; byRoute: Record<string, number>; cooldownUntil?: string; lastError?: string }[];
}

/** What each model does (models.ts routes), for the admin's usage list. */
const MODEL_JOB: Record<string, MsgKey> = { groq120: "st.job120", groq20: "st.job20", qwen: "st.jobQwen", gem35: "st.jobGem", gem31: "st.jobGem" };

/** Today's AI use per model: a bar against the free daily allowance (tokens for Groq, requests for Gemini). */
function AiUsage({ rows }: { rows: NonNullable<Status["aiUsage"]> }) {
  const { t, timeAt } = usePrefs();
  return (
    <div className="sheet-section">
      <h3>{t("st.aiUsage")}</h3>
      <div className="group">
        {rows.map((u) => {
          const used = u.tokensPerDay ? u.tokens / u.tokensPerDay : u.requestsPerDay ? u.requests / u.requestsPerDay : 0;
          const label = u.tokensPerDay ? `${Math.round(u.tokens / 1000)}K / ${Math.round(u.tokensPerDay / 1000)}K ${t("st.tokens")}` : `${u.requests} / ${u.requestsPerDay} ${t("st.requests")}`;
          return (
            <div className="row usage-row" key={u.key}>
              <span className="label">
                <span className="num" style={{ fontSize: 14 }}>{u.model.replace(/^openai\//, "")}</span>
                <small className="muted">{t(MODEL_JOB[u.key] ?? "st.jobGem")}{u.cooldownUntil ? ` · ${t("st.cooling", { time: timeAt(u.cooldownUntil) })}` : ""}</small>
              </span>
              <span className="usage">
                <span className={`num ${used >= 0.85 ? "bad" : ""}`}>{label}</span>
                <span className="usage-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.round(used * 100))}%` }} className={used >= 0.85 ? "hot" : ""} /></span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="hint">{t("st.aiUsageHint")}</p>
    </div>
  );
}

function StatusTab() {
  const { t, api, lang, timeAt } = usePrefs();
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api<Status>("/api/status?schedule=1").then(setS).catch((e) => setErr((e as Error).message));
  }, [api]);
  const onOff = (b: boolean) => <span className={b ? "ok" : "bad"}>{b ? t("st.on") : t("st.off")}</span>;
  if (err) return <p className="hint bad">{err}</p>;
  if (!s) return <div className="skeleton" style={{ height: 180, marginTop: 18 }} />;
  return (
    <>
      <div className="sheet-section">
        <h3>{t("st.providers")}</h3>
        <div className="group">
          {s.providers.length === 0 ? (
            <div className="row"><span className="label bad">{t("st.providersNone")}</span></div>
          ) : (
            s.providers.map((p, i) => (
              <div className="row" key={p}>
                <span className="label num" style={{ fontSize: 14 }}>{i + 1}. {p}</span>
                <IconCheck width={18} height={18} style={{ color: "var(--green)" }} />
              </div>
            ))
          )}
        </div>
      </div>
      <div className="sheet-section">
        <div className="group">
          <div className="row">
            <span className="label">{t("st.storage")}</span>
            <span className={`value ${s.store === "ephemeral" ? "bad" : ""}`}>{t(`st.store.${s.store}` as MsgKey)}</span>
          </div>
          <div className="row"><span className="label">{t("st.finnhub")}</span>{onOff(s.finnhub)}</div>
          <div className="row"><span className="label">{t("st.password")}</span>{onOff(s.password)}</div>
          <div className="row"><span className="label">{t("st.cron")}</span>{onOff(s.cronSecret)}</div>
          {s.schedule && (
            <div className="row">
              <span className="label">{t("st.sched")}</span>
              {s.schedule.late.length ? (
                <span className="value bad">
                  {t("st.late")}: {s.schedule.late.map((id) => { const o = s.schedule!.slots?.find((x) => x.slot === id); return o ? timeAt(o.start) : id; }).join(", ")}
                </span>
              ) : (
                <span className="value">{s.schedule.lastTick ? `${relTime(s.schedule.lastTick.at, lang)} · ${s.schedule.lastTick.src}` : t("st.never")}</span>
              )}
            </div>
          )}
          {s.schedule?.grading?.failing && (
            <div className="row">
              <span className="label">{t("st.gradeFail")}</span>
              <span className="value bad">{s.schedule.grading.failing.n}× · {relTime(s.schedule.grading.failing.at, lang)} · {s.schedule.grading.failing.error}</span>
            </div>
          )}
          <div className="row"><span className="label">{t("st.email")}</span>{s.email === "none" ? onOff(false) : <span className="ok">{s.email === "resend" ? "Resend" : "SMTP"}</span>}</div>
        </div>
      </div>
      {s.aiUsage?.length ? <AiUsage rows={s.aiUsage} /> : null}
      <div className="sheet-section">
        <h3>{t("st.last")}</h3>
        <div className="group">
          {SECTION_IDS.map((sec) => {
            const l = s.lastRefresh[sec];
            return (
              <div className="row" key={sec}>
                <span className="label">{t(`sec.${sec}` as MsgKey)}</span>
                <span className="value">
                  {!l ? t("st.never") : l.ok ? `${relTime(l.at, lang)} · ${l.provider?.split(":")[0]}` : <span className="bad" title={l.error}>{t("st.failed")}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function ShortcutsTab() {
  const { t } = usePrefs();
  const rows: [string[], MsgKey][] = [
    [["1", "2", "3", "4"], "sc.sections"],
    [["N"], "sc.news"],
    [["["], "sc.sidebar"],
    [["]"], "sc.chat"],
    [["R"], "sc.refresh"],
    [["/"], "sc.search"],
    [["⌘", "K"], "sc.palette"],
    [["A"], "sc.ask"],
    [["C"], "sc.catchup"],
    [["L"], "sc.listen"],
    [["T"], "sc.track"],
    [["D"], "sc.theme"],
    [["?"], "sc.help"],
    [["Esc"], "sc.close"],
  ];
  return (
    <div className="sheet-section">
      <div className="group">
        {rows.map(([keys, label]) => (
          <div className="row" key={label}>
            <span className="label">{t(label)}</span>
            <span style={{ display: "flex", gap: 4 }}>
              {keys.map((k) => (
                <span className="kbd" key={k}>{k}</span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- Track record */

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
  const chg5 = cq ? cq.changes?.["5d"] ?? null : quote ? windowChange(quote.history, quote.price, "5d", quote.session) : null;
  const chg1m = cq ? cq.changes?.["1mo"] ?? null : quote ? windowChange(quote.history, quote.price, "1mo", quote.session) : null;
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
      {tech && (
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

/* --------------------------------------------------------------- History */

export interface HistoryEntry {
  key: string;
  generatedAt: string;
  provider: string;
  headline: string;
  mood: "risk-on" | "risk-off" | "mixed";
}

export function HistorySheet({ section, current, onPick, onClose }: { section: SectionId; current: string | null; onPick: (key: string | null) => void; onClose: () => void }) {
  const { t, api, timeAt } = usePrefs();
  const [items, setItems] = useState<HistoryEntry[] | null>(null);
  useEffect(() => {
    api<{ history: HistoryEntry[] }>(`/api/history?section=${section}`).then((j) => setItems(j.history)).catch(() => setItems([]));
  }, [api, section]);
  return (
    <Sheet title={t("brief.history")} onClose={onClose}>
      {!items ? (
        <div className="skeleton" style={{ height: 160 }} />
      ) : (
        <div className="group">
          {items.map((h, i) => {
            const active = current ? current === h.key : i === 0;
            return (
              <button key={h.key} className="row" style={{ width: "100%", textAlign: "left", alignItems: "flex-start" }} onClick={() => onPick(i === 0 ? null : h.key)}>
                <span className="label">
                  <span style={{ display: "block", fontSize: 13, color: "var(--label-2)" }}>
                    {timeAt(h.generatedAt, { date: true })} {i === 0 ? `· ${t("brief.latest")}` : ""} · <span className={`mood ${h.mood}`} style={{ background: "none", padding: 0 }}>{t(`mood.${h.mood}` as MsgKey)}</span>
                  </span>
                  <span style={{ fontWeight: 500 }}>{h.headline}</span>
                </span>
                {active && <IconCheck width={18} height={18} style={{ color: "var(--accent)", flex: "none", marginTop: 10 }} />}
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

/* -------------------------------------------------------------- Password */

export function PasswordSheet() {
  const { t, setPassword } = usePrefs();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // Check the password with the server before saving it, so a typo shows a message instead of looping.
  const submit = async () => {
    const candidate = pw.trim();
    if (!candidate) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/status", { headers: { "x-app-password": encodeURIComponent(candidate) } });
      if (res.status === 401) {
        setErr(t("pw.wrong"));
        return;
      }
      setPassword(candidate);
      location.reload();
    } catch {
      setErr(t("pw.network"));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => openOverlay(), []);
  return (
    <div className="scrim">
      <form
        className="sheet"
        style={{ maxWidth: 400 }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grabber" />
        <div className="sheet-head">
          <h2>{t("pw.title")}</h2>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>{t("pw.body")}</p>
        <input className="input" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" aria-invalid={!!err} />
        {err && <p className="hint bad" role="alert">{err}</p>}
        <div className="sheet-actions">
          <button className="btn-primary" type="submit" disabled={busy || !pw.trim()}>{t("pw.unlock")}</button>
        </div>
      </form>
    </div>
  );
}
