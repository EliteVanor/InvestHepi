/**
 * Access control for a personal app on a public URL.
 * - APP_PASSWORD: required for every API call (UI asks once and remembers it in your browser).
 * - CRON_SECRET: lets schedulers (Vercel cron, GitHub Actions) call /api/refresh.
 * If neither is set (local dev), everything is open.
 */
export function authorized(req: Request, { allowCron = false } = {}): boolean {
  const pw = process.env.APP_PASSWORD;
  const cron = process.env.CRON_SECRET;
  if (!pw && !cron) return true;
  const auth = req.headers.get("authorization") ?? "";
  if (allowCron && cron && auth === `Bearer ${cron}`) return true;
  if (pw && req.headers.get("x-app-password") === pw) return true;
  if (!pw && !allowCron) return true; // only a cron secret configured: reads stay open
  return false;
}

export const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });

/**
 * Safe by default on a public URL: endpoints that cost money (AI calls, emails) or change settings
 * refuse to run on Vercel until APP_PASSWORD is set. Local dev stays open.
 */
export function passwordRequired(): Response | null {
  if (process.env.VERCEL && !process.env.APP_PASSWORD) {
    return Response.json({ error: "Set APP_PASSWORD in Vercel before using this on a public URL." }, { status: 403 });
  }
  return null;
}

export function isCron(req: Request): boolean {
  const cron = process.env.CRON_SECRET;
  return !!cron && req.headers.get("authorization") === `Bearer ${cron}`;
}
