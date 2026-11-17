import { loadPredictions } from "@/lib/predictions";
import { SECTION_IDS, type SectionId } from "@/lib/types";
import { gate } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * GET /api/predictions?section=vn&lang=vi → the section's latest predictions: per market, the latest
 * daily run (before market or mid-day) and the latest weekly run, translated when a translation of
 * that version is cached (otherwise English; the page then asks /api/translate?kind=predictions).
 */
export async function GET(req: Request) {
  return gate(req, {}, async () => {
    const p = new URL(req.url).searchParams;
    const section = (p.get("section") ?? "interests") as SectionId;
    if (!SECTION_IDS.includes(section)) return Response.json({ error: "bad section" }, { status: 400 });
    return Response.json({ sets: await loadPredictions(section, p.get("lang") ?? undefined) });
  });
}
