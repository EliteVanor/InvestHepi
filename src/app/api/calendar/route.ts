import { gate } from "@/lib/users";
import { getCalendar } from "@/lib/calendar";
import { SECTION_GROUPS, type SharedSection } from "@/lib/config";
import { loadInterests } from "@/lib/interests";

export const dynamic = "force-dynamic";

/**
 * GET /api/calendar?section= → upcoming catalysts for that tab: the reader's own stocks for My
 * Interests, the section's market groups for World / US / Vietnam (macro releases, and for Vietnam
 * the VN30 futures expiry), never someone's personal earnings dates on a shared tab.
 */
export async function GET(req: Request) {
  return gate(req, {}, async () => {
    const s = new URL(req.url).searchParams.get("section");
    const shared = s === "world" || s === "us" || s === "vn" ? (s as SharedSection) : null;
    return Response.json(await getCalendar(shared ? SECTION_GROUPS[shared] : await loadInterests()));
  });
}
