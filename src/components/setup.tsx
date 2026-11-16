"use client";

/** First-run checklist (single-user mode or the admin): which keys and services are configured. */
import { useEffect, useState } from "react";
import { type MsgKey } from "@/lib/i18n";
import { usePrefs } from "./prefs";

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
