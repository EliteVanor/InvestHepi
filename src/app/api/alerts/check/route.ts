import { checkPriceAlerts } from "@/lib/alerts";
import { authorized, unauthorized } from "@/lib/auth";
import { loadInterests } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Price and big-move alerts. Cheap (no AI), so the scheduler can call it every ~15 minutes. */
async function handle(req: Request) {
  if (!authorized(req, { allowCron: true })) return unauthorized();
  return Response.json(await checkPriceAlerts(await loadInterests()));
}

export const GET = handle;
export const POST = handle;
