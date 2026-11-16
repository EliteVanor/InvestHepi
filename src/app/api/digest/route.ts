import { role } from "@/lib/auth";
import { BENCHMARKS } from "@/lib/config";
import { aiFailedSince, loadDigest } from "@/lib/briefings";
import { loadInterests } from "@/lib/interests";
import { rulesVariant } from "@/lib/pipeline";
import { hit, limits } from "@/lib/ratelimit";
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
    const lang = params.get("lang") ?? undefined;
    if (params.get("variant") === "rules") {
      // Rule-based copy (no AI): shared by everyone for 15 minutes; a fresh build counts against a
      // generous per-user daily cap (signed-out visitors share one).
      const rules = await rulesVariant(section, lang, async () => (await hit("rules", limits.rules())).ok);
      return Response.json({ digest: rules, store: storeKind });
    }
    const digest = await loadDigest(section, at, lang);
    if (digest && role(req) === "viewer") {
      // Single-user guest password: hide tickers that are only there because the owner holds them.
      const interests = await loadInterests();
      const allowed = new Set([...BENCHMARKS, ...interests.flatMap((i) => i.tickers)]);
      digest.quotes = digest.quotes.filter((q) => allowed.has(q.symbol));
      if (digest.technicals) digest.technicals = Object.fromEntries(Object.entries(digest.technicals).filter(([s]) => allowed.has(s)));
    }
    // The last run couldn't use AI: readers keep this briefing and may switch to the rule-based copy.
    const aiFailedAt = at ? null : await aiFailedSince(section, digest).catch(() => null);
    return Response.json({ digest, store: storeKind, aiFailedAt });
  });
}
