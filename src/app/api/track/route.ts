import { gate } from "@/lib/users";
import { SHARED_CALLS, currentCallsKey } from "@/lib/pipeline";
import { computeStats, loadCalls } from "@/lib/track";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return gate(req, {}, async () => {
    const p = new URL(req.url).searchParams;
    // ?section=world|us|vn → that shared section's calls; otherwise the caller's own interest set.
    const section = p.get("section") as keyof typeof SHARED_CALLS | null;
    const key = section && SHARED_CALLS[section] ? SHARED_CALLS[section] : await currentCallsKey(p.get("lang") ?? undefined);
    const calls = await loadCalls(key);
    if (new URL(req.url).searchParams.get("format") === "csv") {
      const head = "session,horizon,ticker,interest,direction,action,confidence,provider,base_close,outcome_close,return_pct,correct,made_at";
      const rows = calls.map((c) =>
        [c.date, c.id.endsWith(":w") ? "week" : "day", c.ticker, `"${c.interest.replace(/"/g, '""')}"`, c.direction, c.action, c.confidence, c.provider, c.baseClose ?? "", c.outcomeClose ?? "", c.returnPct?.toFixed(3) ?? "", c.correct ?? "", c.madeAt].join(","),
      );
      return new Response([head, ...rows].join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="investhepi-calls${section && SHARED_CALLS[section] ? `-${section}` : ""}.csv"' } });
    }
    const ticker = new URL(req.url).searchParams.get("ticker")?.toUpperCase();
    if (ticker) return Response.json({ calls: calls.filter((c) => c.ticker === ticker).slice(-150) });
    return Response.json(computeStats(calls));
  });
}
