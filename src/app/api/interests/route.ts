import { z } from "zod";
import { authorized, passwordRequired, unauthorized } from "@/lib/auth";
import { DEFAULT_INTERESTS } from "@/lib/config";
import { loadInterests, saveInterests } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

const InterestList = z
  .array(
    z.object({
      id: z.string().min(1).max(40),
      name: z.string().min(1).max(60),
      query: z.string().min(1).max(300),
      tickers: z.array(z.string().regex(/^[A-Za-z.^\-]{1,10}$/)).min(1).max(12),
    }),
  )
  .min(1)
  .max(12);

export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  return Response.json({ interests: await loadInterests(), defaults: DEFAULT_INTERESTS });
}

export async function PUT(req: Request) {
  if (!authorized(req)) return unauthorized();
  const locked = passwordRequired();
  if (locked) return locked;

  const parsed = InterestList.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400 });
  const list = parsed.data.map((i) => ({ ...i, tickers: i.tickers.map((t) => t.toUpperCase()) }));
  await saveInterests(list);
  return Response.json({ interests: list });
}
