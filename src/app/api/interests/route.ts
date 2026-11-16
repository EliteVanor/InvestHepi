import { gate } from "@/lib/users";
import { z } from "zod";
import { DEFAULT_INTERESTS } from "@/lib/config";
import { background } from "@/lib/background";
import { OWNER, withUser } from "@/lib/context";
import { loadInterests, saveInterests } from "@/lib/interests";
import { ensureInterestBriefing } from "@/lib/pipeline";
import { autogenAllowed } from "@/lib/ratelimit";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const InterestList = z
  .array(
    z.object({
      id: z.string().min(1).max(40),
      name: z.string().min(1).max(60),
      query: z.string().min(1).max(300),
      tickers: z.array(z.string().regex(/^[A-Za-z0-9.^=\-]{1,14}$/)).min(1).max(12),
    }),
  )
  .min(1)
  .max(12);

export async function GET(req: Request) {
  return gate(req, {}, async () => {
    return Response.json({ interests: await loadInterests(), defaults: DEFAULT_INTERESTS });
  });
}

export async function PUT(req: Request) {
  return gate(req, { user: true }, async (user) => {
    const parsed = InterestList.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400 });
    const list = parsed.data.map((i) => ({ ...i, tickers: i.tickers.map((t) => t.toUpperCase()) }));
    await saveInterests(list);
    // First briefing for a brand-new set, in the background (the page polls until it appears).
    const uid = user?.uid ?? OWNER;
    void background(() => withUser(uid, () => ensureInterestBriefing(uid, autogenAllowed)));
    return Response.json({ interests: list });
  });
}
