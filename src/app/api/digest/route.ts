import { authorized, role, unauthorized } from "@/lib/auth";
import { BENCHMARKS } from "@/lib/config";
import { loadDigest, loadInterests } from "@/lib/pipeline";
import { storeKind } from "@/lib/store";
import type { SectionId } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  const params = new URL(req.url).searchParams;
  const section = (params.get("section") ?? "interests") as SectionId;
  const at = params.get("at")?.replace(/[^0-9]/g, "") || undefined;
  if (!["interests", "world", "us"].includes(section)) return Response.json({ error: "bad section" }, { status: 400 });
  const digest = await loadDigest(section, at);
  if (digest && role(req) === "viewer") {
    // Hide tickers that are only there because the owner holds them.
    const interests = await loadInterests();
    const allowed = new Set([...BENCHMARKS, ...interests.flatMap((i) => i.tickers)]);
    digest.quotes = digest.quotes.filter((q) => allowed.has(q.symbol));
    if (digest.technicals) digest.technicals = Object.fromEntries(Object.entries(digest.technicals).filter(([s]) => allowed.has(s)));
  }
  return Response.json({ digest, store: storeKind });
}
