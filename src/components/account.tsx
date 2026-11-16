"use client";

/** Sign-in / account UI for multi-user mode (Auth.js + Google). */
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { signInWithGoogle, signOutAction } from "@/app/actions";
import { usePrefs } from "./prefs";
import { Sheet } from "./primitives";

export interface Account {
  mode: "multi" | "single";
  user: { email?: string; name?: string; image?: string } | null;
  admin: boolean;
}

export const AccountCtx = createContext<Account>({ mode: "single", user: null, admin: false });
export const useAccount = () => useContext(AccountCtx);

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.2 44 33 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function GoogleButton({ label }: { label: string }) {
  return (
    <form action={signInWithGoogle}>
      <button type="submit" className="google-btn">
        <GoogleG /> {label}
      </button>
    </form>
  );
}

/** Top-bar control: "Sign in" for visitors, avatar menu for signed-in users. */
export function AccountButton() {
  const { t } = usePrefs();
  const acc = useAccount();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (acc.mode !== "multi") return null;
  if (!acc.user)
    return (
      <form action={signInWithGoogle}>
        <button type="submit" className="pill-btn signin-pill">{t("auth.short")}</button>
      </form>
    );
  const initial = (acc.user.name || acc.user.email || "?").trim()[0]?.toUpperCase();
  return (
    <div className="acct" ref={ref}>
      <button className="avatar" onClick={() => setOpen((o) => !o)} aria-label={acc.user.email} aria-expanded={open}>
        {acc.user.image ? <img src={acc.user.image} alt="" referrerPolicy="no-referrer" /> : <span>{initial}</span>}
      </button>
      {open && (
        <div className="acct-menu" role="menu">
          <div className="acct-who">
            <b>{acc.user.name}</b>
            <small>{acc.user.email}</small>
          </div>
          <form action={signOutAction}>
            <button type="submit" role="menuitem" className="acct-item">{t("auth.signout")}</button>
          </form>
        </div>
      )}
    </div>
  );
}

/** Shown when a visitor tries something that needs an account. */
export function SignInSheet({ onClose }: { onClose: () => void }) {
  const { t } = usePrefs();
  return (
    <Sheet title={t("auth.title")} onClose={onClose}>
      <p className="hint" style={{ marginTop: 0, fontSize: 15 }}>{t("auth.body")}</p>
      <div className="sheet-actions" style={{ justifyContent: "flex-start" }}>
        <GoogleButton label={t("auth.signin")} />
      </div>
    </Sheet>
  );
}

/** Home-page invitation for signed-out visitors (sits where the holdings card would be). */
export function SignInCard() {
  const { t } = usePrefs();
  return (
    <section className="card signin-card">
      <h3 style={{ margin: "0 0 6px" }}>{t("auth.title")}</h3>
      <p className="hint" style={{ margin: "0 0 14px" }}>{t("auth.body")}</p>
      <GoogleButton label={t("auth.signin")} />
    </section>
  );
}

/**
 * My Interests for signed-out visitors (multi-user mode): what an account gets, one button to sign
 * in, and a way back to the sections anyone can read.
 */
export function InterestsGate({ onBrowse }: { onBrowse: () => void }) {
  const { t } = usePrefs();
  const points = [t("gate.point1"), t("gate.point2"), t("gate.point3")];
  return (
    <section className="card gate" aria-labelledby="gate-h">
      <div className="gate-orb" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
        </svg>
      </div>
      <h2 id="gate-h">{t("gate.title")}</h2>
      <p className="gate-body">{t("gate.body")}</p>
      <ul className="gate-points">
        {points.map((p) => (
          <li key={p}>
            <span className="gate-check" aria-hidden="true">✓</span>
            {p}
          </li>
        ))}
      </ul>
      <div className="gate-actions">
        <GoogleButton label={t("auth.signin")} />
        <button className="btn-plain" onClick={onBrowse}>
          {t("gate.browse")} →
        </button>
      </div>
    </section>
  );
}
