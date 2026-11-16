import { authorized, isCron, unauthorized } from "@/lib/auth";
import { currentInterestSet, loadDigest, refreshInterestSet, refreshScheduled, refreshShared, translateLatest } from "@/lib/pipeline";
import { hit, limits } from "@/lib/ratelimit";
import { isLang } from "@/lib/languages";
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
    // Briefings refresh on a schedule; only the admin can force one (e.g. after fixing a source).
    if (!user?.admin) return Response.json({ error: "Briefings refresh automatically several times a day." }, { status: 403 });
    const set = await currentInterestSet();
    const { interests, hash } = set;
    // Every briefing is written in English, then translated for the reader (?lang=).
    const asked = new URL(req.url).searchParams.get("lang");
    const lang = asked && isLang(asked) ? asked : set.lang;
    const key = section === "interests" ? `ib:${hash}:last` : `digest:${section}:en:last`;
    const last = await getJSON<{ at: string }>(key);
    const ageMin = last ? (Date.now() - new Date(last.at).getTime()) / 60_000 : Infinity;
    // Shared sections are the same for everyone, and an interest set may be shared by several users:
    // if it was refreshed moments ago, hand back the fresh copy instead of paying for another AI call.
    const cooldown = section === "interests" ? OWN_COOLDOWN_MIN : SHARED_COOLDOWN_MIN;
    if (ageMin < cooldown && !user?.admin) {
      return Response.json({ results: [{ section, ok: true, cached: true }], digest: await loadDigest(section, undefined, lang) });
    }
    const rl = await hit("refresh", limits.refresh());
    if (!rl.ok) return Response.json({ error: `Daily manual refresh limit reached (${rl.limit}). Scheduled refreshes still run.` }, { status: 429 });
    try {
      const d = section === "interests" ? await refreshInterestSet(interests, set.lang, [user?.uid ?? "owner"]) : await refreshShared(section, "en");
      if (d.language !== lang) await translateLatest(section, lang).catch(() => null);
      return Response.json({ results: [{ section, ok: true, provider: d.provider }] });
    } catch (e) {
      return Response.json({ results: [{ section, ok: false, error: (e as Error).message }] });
    }
  });
}

export const GET = handle; // Vercel cron uses GET
export const POST = handle;
