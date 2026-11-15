import { authorized, unauthorized } from "@/lib/auth";
import { computeStats, loadCalls } from "@/lib/track";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  const calls = await loadCalls();
  if (new URL(req.url).searchParams.get("format") === "csv") {
    const head = "session,horizon,ticker,interest,direction,action,confidence,provider,base_close,outcome_close,return_pct,correct,made_at";
    const rows = calls.map((c) =>
      [c.date, c.id.endsWith(":w") ? "week" : "day", c.ticker, `"${c.interest.replace(/"/g, '""')}"`, c.direction, c.action, c.confidence, c.provider, c.baseClose ?? "", c.outcomeClose ?? "", c.returnPct?.toFixed(3) ?? "", c.correct ?? "", c.madeAt].join(","),
    );
    return new Response([head, ...rows].join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="invest-helper-calls.csv"' } });
  }
  const ticker = new URL(req.url).searchParams.get("ticker")?.toUpperCase();
  if (ticker) return Response.json({ calls: calls.filter((c) => c.ticker === ticker).slice(-150) });
  return Response.json(computeStats(calls));
}
