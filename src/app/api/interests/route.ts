import { gate } from "@/lib/users";
import { z } from "zod";
import { DEFAULT_INTERESTS } from "@/lib/config";
import { after } from "next/server";
import { OWNER, withUser } from "@/lib/context";
import { ensureInterestBriefing, loadInterests, saveInterests } from "@/lib/pipeline";
import { hit } from "@/lib/ratelimit";

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
    background(() => withUser(uid, () => ensureInterestBriefing(uid, async () => (await hit("autogen", Number(process.env.AUTOGEN_DAILY_LIMIT) || 6)).ok)).then(() => {}));
    return Response.json({ interests: list });
  });
}

/** Run after the response is sent (Vercel keeps the function alive); plain fire-and-forget elsewhere. */
function background(fn: () => Promise<void>) {
  const run = () => fn().catch(() => {});
  try {
    after(run);
  } catch {
    void run();
  }
}
