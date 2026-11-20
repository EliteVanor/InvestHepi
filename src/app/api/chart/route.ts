import { authorized, unauthorized } from "@/lib/auth";
import { priceLimited } from "@/lib/ratelimit";
import { CHART_RANGES, getChart, type ChartRange } from "@/lib/chart";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  const limited = priceLimited(req);
  if (limited) return limited;
  const p = new URL(req.url).searchParams;
  const symbol = (p.get("symbol") ?? "").toUpperCase();
  const range = (p.get("range") ?? "1d") as ChartRange;
  if (!/^[A-Z0-9.^=\-]{1,12}$/.test(symbol)) return Response.json({ error: "bad symbol" }, { status: 400 });
  if (!CHART_RANGES.includes(range)) return Response.json({ error: "bad range" }, { status: 400 });
  try {
    return Response.json(await getChart(symbol, range), { headers: { "Cache-Control": "private, max-age=10" } });
  } catch (e) {
    console.error("chart failed:", symbol, range, e);
    return Response.json({ error: "Chart unavailable" }, { status: 502 });
  }
}
