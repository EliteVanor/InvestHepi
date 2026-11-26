/** Shared shell for the privacy policy and terms pages (server components, no client JS). */
import type { ReactNode } from "react";

export const UPDATED = "November 26, 2026";
const UPDATED_VI = "26 tháng 11, 2026";

/** Shown as the contact on legal pages. Set CONTACT_EMAIL in Vercel; nothing personal is hard-coded. */
export function contact(): ReactNode {
  const e = process.env.CONTACT_EMAIL?.trim();
  return e ? <a href={`mailto:${e}`}>{e}</a> : "the support email shown on the Google sign-in screen";
}

export function LegalPage({ title, children, lang = "en" }: { title: string; children: ReactNode; lang?: string }) {
  return (
    <main className="legal" lang={lang}>
      <a href="/" className="legal-back">← InvestHepi</a>
      <h1>{title}</h1>
      <p className="legal-updated">{lang === "vi" ? `Cập nhật: ${UPDATED_VI}` : `Last updated: ${UPDATED}`}</p>
      {children}
      <footer className="legal-foot">
        <a href="/about">About</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/">InvestHepi</a>
      </footer>
    </main>
  );
}
