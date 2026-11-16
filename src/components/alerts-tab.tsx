"use client";

/** Settings → Alerts: price and big-move rules, briefing alerts, the morning/weekly emails and the alert log. */
import { type ReactNode, useEffect, useState } from "react";
import { type AlertLogEntry, type AlertSettings, type PriceAlert, type PriceOp } from "@/lib/alerts";
import { type MsgKey, relTime } from "@/lib/i18n";
import { IconX } from "./Icons";
import { usePrefs } from "./prefs";
import { Toggle } from "./primitives";

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
          <select value={form.op} onChange={(e) => setForm({ ...form, op: e.target.value as PriceOp })} aria-label={t("ui.condition")}>
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
