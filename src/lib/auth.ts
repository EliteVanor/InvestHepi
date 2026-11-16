import { multiUser } from "./mode";
/**
 * Access control for a personal app on a public URL.
 * - APP_PASSWORD: required for every API call (UI asks once and remembers it in your browser).
 * - CRON_SECRET: lets schedulers (Vercel cron, GitHub Actions) call /api/refresh.
 * If neither is set (local dev), everything is open.
 */
export function authorized(req: Request, { allowCron = false } = {}): boolean {
  // Multi-user mode: reads are public and accounts decide the rest (see users.ts gate()).
  if (multiUser()) return true;
  const pw = process.env.APP_PASSWORD?.trim();
  const cron = process.env.CRON_SECRET?.trim();
  if (allowCron && cron && (req.headers.get("authorization") ?? "") === `Bearer ${cron}`) return true;
  // No password configured: let the request through. Costly routes still refuse on Vercel via
  // passwordRequired(), with a clear "set APP_PASSWORD" message instead of a 401 that would make
  // the browser ask for a password the server can't check.
  if (!pw) return true;
  return role(req) !== null;
}

export type Role = "owner" | "viewer";

/**
 * Who is calling. APP_PASSWORD = owner (full access). VIEWER_PASSWORD (optional) = guest:
 * read-only briefings, no holdings, alerts, Ask AI, refresh or edits. No password configured = owner.
 */
export function role(req: Request): Role | null {
  if (multiUser()) return null;
  const pw = process.env.APP_PASSWORD?.trim();
  if (!pw) return "owner";
  const given = passwordFrom(req);
  if (given === pw) return "owner";
  const viewer = process.env.VIEWER_PASSWORD?.trim();
  if (viewer && given === viewer) return "viewer";
  return null;
}

/** 403 for guests on owner-only routes (403, not 401, so the browser doesn't re-ask for a password). */
export function ownerOnly(req: Request): Response | null {
  return role(req) === "viewer" ? Response.json({ error: "View-only access. Sign in with the owner password to do this." }, { status: 403 }) : null;
}

/** The browser sends the password URI-encoded so any character survives an HTTP header. */
export function passwordFrom(req: Request): string {
  const raw = req.headers.get("x-app-password") ?? "";
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

export const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });

/**
 * Safe by default on a public URL: endpoints that cost money (AI calls, emails) or change settings
 * refuse to run on Vercel until APP_PASSWORD is set. Local dev stays open.
 */
export function passwordRequired(): Response | null {
  if (process.env.VERCEL && !process.env.APP_PASSWORD?.trim() && !multiUser()) {
    return Response.json({ error: "Set APP_PASSWORD in Vercel before using this on a public URL." }, { status: 403 });
  }
  return null;
}

/** The scheduler tick: CRON_SECRET (Vercel sends it), or TICK_SECRET, which can only poke the tick. */
export function isScheduler(req: Request): boolean {
  const got = req.headers.get("authorization") ?? "";
  return [process.env.CRON_SECRET, process.env.TICK_SECRET].some((s) => !!s?.trim() && got === `Bearer ${s.trim()}`);
}

