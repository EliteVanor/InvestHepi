import { authorized, unauthorized } from "@/lib/auth";
import { priceLimited } from "@/lib/ratelimit";
import { currentQuotes } from "@/lib/quote";

export const dynamic = "force-dynamic";

/** Current quotes (quote.ts) for the strip, watchlist, portfolio and heatmap; `windows=1` adds 5D/1M. The per-address limit is counted in memory. */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  const limited = priceLimited(req);
  if (limited) return limited;
  const raw = new URL(req.url).searchParams.get("symbols") ?? "";
  const symbols = raw.split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9.^=\-]{1,12}$/.test(s));
  if (!symbols.length) return Response.json({ quotes: [] });
  const windows = new URL(req.url).searchParams.get("windows") === "1";
  return Response.json({ quotes: await currentQuotes(symbols, { windows }), at: Date.now() }, { headers: { "Cache-Control": "private, max-age=10" } });
}
