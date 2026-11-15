import { role } from "@/lib/auth";
import { BENCHMARKS } from "@/lib/config";
import { loadDigest, loadInterests } from "@/lib/pipeline";
import { storeKind } from "@/lib/store";
import { SECTION_IDS, type SectionId } from "@/lib/types";
import { gate } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return gate(req, {}, async () => {
    const params = new URL(req.url).searchParams;
    const section = (params.get("section") ?? "interests") as SectionId;
    const at = params.get("at")?.replace(/[^0-9]/g, "") || undefined;
    if (!SECTION_IDS.includes(section)) return Response.json({ error: "bad section" }, { status: 400 });
    // Signed-out visitors pick their language with ?lang= (signed-in users use their setting).
    const digest = await loadDigest(section, at, params.get("lang") ?? undefined);
    if (digest && role(req) === "viewer") {
      // Single-user guest password: hide tickers that are only there because the owner holds them.
      const interests = await loadInterests();
      const allowed = new Set([...BENCHMARKS, ...interests.flatMap((i) => i.tickers)]);
      digest.quotes = digest.quotes.filter((q) => allowed.has(q.symbol));
      if (digest.technicals) digest.technicals = Object.fromEntries(Object.entries(digest.technicals).filter(([s]) => allowed.has(s)));
    }
    return Response.json({ digest, store: storeKind });
  });
}
