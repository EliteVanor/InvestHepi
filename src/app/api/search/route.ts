import { authorized, unauthorized } from "@/lib/auth";
import { searchTickers } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json({ hits: await searchTickers(q) }, { headers: { "Cache-Control": "private, max-age=300" } });
}
