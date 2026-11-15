import { authorized, isCron, unauthorized } from "@/lib/auth";
import { currentInterestSet, loadDigest, refreshInterestSet, refreshScheduled, refreshShared } from "@/lib/pipeline";
import { hit, limits } from "@/lib/ratelimit";
import { getJSON } from "@/lib/store";
import { SECTION_IDS, type SectionId } from "@/lib/types";
import { gate } from "@/lib/users";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SHARED_COOLDOWN_MIN = 30;
const OWN_COOLDOWN_MIN = 5;

async function handle(req: Request) {
  const s = new URL(req.url).searchParams.get("section");
  const section = (s && SECTION_IDS.includes(s as SectionId) ? s : "interests") as SectionId;

  // Scheduler: shared sections in every language in use; interests = the stalest sets first.
  if (isCron(req)) {
    if (!authorized(req, { allowCron: true })) return unauthorized();
    return Response.json(await refreshScheduled(section));
  }

  return gate(req, { user: true }, async (user) => {
    const { interests, lang, hash } = await currentInterestSet();
    const key = section === "interests" ? `ib:${hash}:last` : `digest:${section}:${lang}:last`;
    const last = await getJSON<{ at: string }>(key);
    const ageMin = last ? (Date.now() - new Date(last.at).getTime()) / 60_000 : Infinity;
    // Shared sections are the same for everyone, and an interest set may be shared by several users:
    // if it was refreshed moments ago, hand back the fresh copy instead of paying for another AI call.
    const cooldown = section === "interests" ? OWN_COOLDOWN_MIN : SHARED_COOLDOWN_MIN;
    if (ageMin < cooldown && !user?.admin) {
      return Response.json({ results: [{ section, ok: true, cached: true }], digest: await loadDigest(section) });
    }
    const rl = await hit("refresh", limits.refresh());
    if (!rl.ok) return Response.json({ error: `Daily manual refresh limit reached (${rl.limit}). Scheduled refreshes still run.` }, { status: 429 });
    try {
      const d = section === "interests" ? await refreshInterestSet(interests, lang, [user?.uid ?? "owner"]) : await refreshShared(section, lang);
      return Response.json({ results: [{ section, ok: true, provider: d.provider }] });
    } catch (e) {
      return Response.json({ results: [{ section, ok: false, error: (e as Error).message }] });
    }
  });
}

export const GET = handle; // Vercel cron uses GET
export const POST = handle;
