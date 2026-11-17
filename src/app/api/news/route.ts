import { loadHeadlines } from "@/lib/headlines";
import { currentInterestSet } from "@/lib/interests";
import { SECTION_IDS, type SectionId } from "@/lib/types";
import { gate } from "@/lib/users";

export const dynamic = "force-dynamic";

/** GET /api/news?section=world → the live headline list (refreshed every 15 min; interest sets every 30). */
export async function GET(req: Request) {
  return gate(req, {}, async () => {
    const section = (new URL(req.url).searchParams.get("section") ?? "interests") as SectionId;
    if (!SECTION_IDS.includes(section)) return Response.json({ error: "bad section" }, { status: 400 });
    const hash = section === "interests" ? (await currentInterestSet()).hash : undefined;
    const n = await loadHeadlines(section, hash);
    return Response.json({ at: n?.at ?? null, items: n?.items ?? [] });
  });
}
