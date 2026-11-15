/**
 * Email delivery. Two options, whichever is configured:
 *  - Resend (RESEND_API_KEY): free tier ~3,000/month, 100/day. Without your own domain it sends
 *    from onboarding@resend.dev to the address you signed up with, which is all a personal app needs.
 *  - SMTP (SMTP_URL), e.g. Gmail with an app password: smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com:465
 */
import nodemailer from "nodemailer";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailResult {
  ok: boolean;
  provider: "resend" | "smtp" | "none";
  id?: string;
  error?: string;
}

export function emailProvider(): EmailResult["provider"] {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.SMTP_URL) return "smtp";
  return "none";
}

function fromAddress(): string {
  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM;
  if (emailProvider() === "smtp") {
    try {
      const u = new URL(process.env.SMTP_URL!);
      return `Invest Helper <${decodeURIComponent(u.username)}>`;
    } catch {}
  }
  return "Invest Helper <onboarding@resend.dev>";
}

export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const provider = emailProvider();
  if (provider === "none") return { ok: false, provider, error: "No email provider configured (set RESEND_API_KEY or SMTP_URL)." };
  if (!msg.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(msg.to)) return { ok: false, provider, error: "No valid recipient address." };
  try {
    if (provider === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromAddress(), to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
      });
      const j = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
      if (!res.ok) return { ok: false, provider, error: `Resend ${res.status}: ${j.message ?? j.name ?? "error"}` };
      return { ok: true, provider, id: j.id };
    }
    const transport = nodemailer.createTransport(process.env.SMTP_URL!);
    const info = await transport.sendMail({ from: fromAddress(), to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
    return { ok: true, provider, id: info.messageId };
  } catch (e) {
    return { ok: false, provider, error: (e as Error).message.slice(0, 300) };
  }
}

/** Public URL of the app for links in emails (Vercel sets VERCEL_PROJECT_PRODUCTION_URL automatically). */
export function appUrl(): string | null {
  const u = process.env.APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (!u) return null;
  return u.startsWith("http") ? u.replace(/\/$/, "") : `https://${u}`;
}
