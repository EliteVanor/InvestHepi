import { authorized, unauthorized } from "@/lib/auth";
import { getCalendar } from "@/lib/calendar";
import { loadInterests } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  return Response.json(await getCalendar(await loadInterests()));
}
