import { after } from "next/server";
import { isScheduler } from "@/lib/auth";
import { lateNow, markTick, runTick } from "@/lib/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduler tick (see scheduler.ts). Answers at once, then does the work after the reply, so a
 * caller with a short timeout (cron-job.org: 30 s) is fine. 503 while a slot went late within the
 * last hour, so the caller's failure report doubles as the missed-run alert.
 */
async function handle(req: Request) {
  if (!isScheduler(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const ua = req.headers.get("user-agent") ?? "";
  const src = new URL(req.url).searchParams.get("src") ?? (ua.startsWith("vercel-cron") ? "vercel" : ua.includes("cron-job.org") ? "cron-job.org" : "other");
  const now = new Date();
  const [late] = await Promise.all([lateNow(now.getTime()), markTick(src, now)]);
  const work = () => runTick({ chain: true }).then(() => undefined, () => undefined);
  try {
    after(work);
  } catch {
    await work(); // outside a request (tests): run inline
  }
  return Response.json({ ok: late.length === 0, late }, { status: late.length ? 503 : 200 });
}

export const GET = handle;
export const POST = handle;
