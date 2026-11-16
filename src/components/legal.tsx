/** Shared shell for the privacy policy and terms pages (server components, no client JS). */
import type { ReactNode } from "react";

export const UPDATED = "November 16, 2026";

/** Shown as the contact on legal pages. Set CONTACT_EMAIL in Vercel; nothing personal is hard-coded. */
export function contact(): ReactNode {
  const e = process.env.CONTACT_EMAIL?.trim();
  return e ? <a href={`mailto:${e}`}>{e}</a> : "the support email shown on the Google sign-in screen";
}

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="legal">
      <a href="/" className="legal-back">← InvestHepi</a>
      <h1>{title}</h1>
      <p className="legal-updated">Last updated: {UPDATED}</p>
      {children}
      <footer className="legal-foot">
        <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/">InvestHepi</a>
      </footer>
    </main>
  );
}
