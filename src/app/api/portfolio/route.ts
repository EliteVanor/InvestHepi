import { z } from "zod";
import { authorized, passwordRequired, unauthorized } from "@/lib/auth";
import { loadHoldings, saveHoldings } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

const Holdings = z
  .array(
    z.object({
      symbol: z.string().regex(/^[A-Za-z0-9.^=\-]{1,12}$/).transform((s) => s.toUpperCase()),
      shares: z.number().positive().max(1e9),
      cost: z.number().min(0).max(1e7),
    }),
  )
  .max(40);

export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  return Response.json({ holdings: await loadHoldings() });
}

export async function PUT(req: Request) {
  if (!authorized(req)) return unauthorized();
  const locked = passwordRequired();
  if (locked) return locked;
  const parsed = Holdings.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400 });
  // Merge duplicate symbols into one position with a blended cost.
  const merged = new Map<string, { symbol: string; shares: number; cost: number }>();
  for (const h of parsed.data) {
    const cur = merged.get(h.symbol);
    if (!cur) merged.set(h.symbol, { ...h });
    else merged.set(h.symbol, { symbol: h.symbol, shares: cur.shares + h.shares, cost: (cur.cost * cur.shares + h.cost * h.shares) / (cur.shares + h.shares) });
  }
  const holdings = [...merged.values()];
  await saveHoldings(holdings);
  return Response.json({ holdings });
}
