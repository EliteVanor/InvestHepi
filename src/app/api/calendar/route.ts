import { gate } from "@/lib/users";
import { getCalendar } from "@/lib/calendar";
import { loadInterests } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return gate(req, {}, async () => {
    return Response.json(await getCalendar(await loadInterests()));
  });
}
