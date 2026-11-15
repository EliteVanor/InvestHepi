/**
 * Access control for a personal app on a public URL.
 * - APP_PASSWORD: required for every API call (UI asks once and remembers it in your browser).
 * - CRON_SECRET: lets schedulers (Vercel cron, GitHub Actions) call /api/refresh.
 * If neither is set (local dev), everything is open.
 */
export function authorized(req: Request, { allowCron = false } = {}): boolean {
  const pw = process.env.APP_PASSWORD?.trim();
  const cron = process.env.CRON_SECRET?.trim();
  if (allowCron && cron && (req.headers.get("authorization") ?? "") === `Bearer ${cron}`) return true;
  // No password configured: let the request through. Costly routes still refuse on Vercel via
  // passwordRequired(), with a clear "set APP_PASSWORD" message instead of a 401 that would make
  // the browser ask for a password the server can't check.
  if (!pw) return true;
  return passwordFrom(req) === pw;
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
  if (process.env.VERCEL && !process.env.APP_PASSWORD?.trim()) {
    return Response.json({ error: "Set APP_PASSWORD in Vercel before using this on a public URL." }, { status: 403 });
  }
  return null;
}

export function isCron(req: Request): boolean {
  const cron = process.env.CRON_SECRET;
  return !!cron && req.headers.get("authorization") === `Bearer ${cron}`;
}
