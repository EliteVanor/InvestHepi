import { authorized, unauthorized } from "@/lib/auth";
import { computeStats, loadCalls } from "@/lib/track";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  return Response.json(computeStats(await loadCalls()));
}
