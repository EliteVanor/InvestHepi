import { checkPriceAlerts } from "@/lib/alerts";
import { authorized, unauthorized } from "@/lib/auth";
import { loadInterests, withHoldings } from "@/lib/pipeline";
import { loadHoldings } from "@/lib/portfolio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Price and big-move alerts. Cheap (no AI), so the scheduler can call it every ~15 minutes. */
async function handle(req: Request) {
  if (!authorized(req, { allowCron: true })) return unauthorized();
  const [interests, held] = await Promise.all([loadInterests(), loadHoldings().catch(() => [])]);
  return Response.json(await checkPriceAlerts(withHoldings(interests, held.map((h) => h.symbol))));
}

export const GET = handle;
export const POST = handle;
