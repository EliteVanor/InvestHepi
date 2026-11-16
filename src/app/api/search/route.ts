import { authorized, unauthorized } from "@/lib/auth";
import { searchTickers } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  const p = new URL(req.url).searchParams;
  const lang = (p.get("lang") ?? "").slice(0, 5);
  return Response.json({ hits: await searchTickers(p.get("q") ?? "", { lang }) }, { headers: { "Cache-Control": "private, max-age=300" } });
}
