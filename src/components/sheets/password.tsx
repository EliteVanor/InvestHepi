"use client";

import { useEffect, useState } from "react";
import { usePrefs } from "../prefs";
import { openOverlay } from "../primitives";

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
