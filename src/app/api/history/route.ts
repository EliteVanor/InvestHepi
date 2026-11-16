import { gate } from "@/lib/users";
import { loadHistory } from "@/lib/briefings";
import { SECTION_IDS, type SectionId } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return gate(req, {}, async () => {
    const p = new URL(req.url).searchParams;
    const section = (p.get("section") ?? "interests") as SectionId;
    if (!SECTION_IDS.includes(section)) return Response.json({ error: "bad section" }, { status: 400 });
    return Response.json({ history: await loadHistory(section) });
  });
}
