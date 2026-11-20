import { authorized, unauthorized } from "@/lib/auth";
import { priceLimited } from "@/lib/ratelimit";
import { getLiveQuotes } from "@/lib/chart";

export const dynamic = "force-dynamic";

/** Batched live quotes for the strip and sector heatmap. One Redis command per request (a per-address counter), none for the prices. */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  const limited = await priceLimited(req);
  if (limited) return limited;
  const raw = new URL(req.url).searchParams.get("symbols") ?? "";
  const symbols = raw.split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9.^=\-]{1,12}$/.test(s));
  if (!symbols.length) return Response.json({ quotes: [] });
  return Response.json({ quotes: await getLiveQuotes(symbols), at: Date.now() }, { headers: { "Cache-Control": "private, max-age=10" } });
}
