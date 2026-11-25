"use client";

import { useEffect, useState } from "react";
import { relTime, type MsgKey } from "@/lib/i18n";
import { SECTION_IDS, type SectionId } from "@/lib/types";
import { IconCheck } from "../Icons";
import { usePrefs } from "../prefs";

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

export function StatusTab() {
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
