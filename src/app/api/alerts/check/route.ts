import { checkPriceAlerts, loadAlertSettings } from "@/lib/alerts";
import { authorized, isCron, unauthorized } from "@/lib/auth";
import { withUser } from "@/lib/context";
import { multiUser } from "@/lib/mode";
import { loadInterests, withHoldings } from "@/lib/pipeline";
import { loadHoldings } from "@/lib/portfolio";
import { activeUsers } from "@/lib/users";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Price and big-move alerts for every user who has alerts on. Cheap (no AI). Scheduler only. */
async function handle(req: Request) {
  if (multiUser() ? !isCron(req) : !authorized(req, { allowCron: true })) return unauthorized();
  const results: Record<string, unknown> = {};
  for (const uid of await activeUsers(30)) {
    await withUser(uid, async () => {
      if (!(await loadAlertSettings()).enabled) return;
      const [interests, held] = await Promise.all([loadInterests(), loadHoldings().catch(() => [])]);
      results[uid] = await checkPriceAlerts(withHoldings(interests, held.map((h) => h.symbol))).catch((e) => ({ error: (e as Error).message }));
    });
  }
  return Response.json({ users: Object.keys(results).length, results });
}

export const GET = handle;
export const POST = handle;
