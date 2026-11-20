import { translateLatest } from "@/lib/briefings";
import { currentInterestSet } from "@/lib/interests";
import { refreshInterestSet, refreshShared } from "@/lib/pipeline";
import { hit, limits, markUserRefresh, userRefreshQuota } from "@/lib/ratelimit";
import { userAiBusy } from "@/lib/llm/models";
import { isLang } from "@/lib/languages";
import { SECTION_IDS, type SectionId } from "@/lib/types";
import { gate } from "@/lib/users";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const params = new URL(req.url).searchParams;
  const s = params.get("section");
  const section = (s && SECTION_IDS.includes(s as SectionId) ? s : "interests") as SectionId;

  // Manual refresh only; the timetable runs through /api/cron/tick (scheduler.ts).
  return gate(req, { user: true }, async (user) => {
    const set = await currentInterestSet();
    const { interests } = set;
    // Every briefing is written in English, then translated for the reader (?lang=).
    const asked = params.get("lang");
    const lang = asked && isLang(asked) ? asked : set.display;

    if (!user?.admin) {
      // Users: their own My Interests only, on the lighter model, 5 a day with 90 minutes between
      // presses. Every press writes a new briefing (it isn't swapped for a recent copy).
      if (section !== "interests") return Response.json({ error: "Shared sections refresh automatically several times a day." }, { status: 403 });
      if (await userAiBusy("userManual")) return Response.json({ error: "busy" }, { status: 503 });
      const quota = await userRefreshQuota();
      if (quota.nextAt) return Response.json({ error: "wait", quota }, { status: 429 });
      const rl = await hit("refresh-user", limits.userRefresh());
      if (!rl.ok) return Response.json({ error: "limit", quota }, { status: 429 });
      await markUserRefresh();
      try {
        const d = await refreshInterestSet(interests, set.lang, [user!.uid], new Date(), "userManual");
        if (d.language !== lang) await translateLatest(section, lang).catch(() => null);
        return Response.json({ results: [{ section, ok: true, provider: d.provider, keptAi: !!d.keptAi }], quota: await userRefreshQuota() });
      } catch (e) {
        console.error("refresh (user) failed:", e); // the reader gets a generic line, the log has the cause
        return Response.json({ results: [{ section, ok: false, error: "Refresh failed" }], quota: await userRefreshQuota() });
      }
    }

    // Admin: any section, best model first, 10 a day.
    const rl = await hit("refresh", limits.refresh());
    if (!rl.ok) return Response.json({ error: `Daily manual refresh limit reached (${rl.limit}). Scheduled refreshes still run.` }, { status: 429 });
    try {
      const d = section === "interests" ? await refreshInterestSet(interests, set.lang, [user.uid], new Date(), "adminManual") : await refreshShared(section, "en", new Date(), "shared");
      if (d.language !== lang) await translateLatest(section, lang).catch(() => null);
      return Response.json({ results: [{ section, ok: true, provider: d.provider, keptAi: !!d.keptAi }], quota: { left: rl.limit - rl.used, limit: rl.limit, nextAt: null } });
    } catch (e) {
      return Response.json({ results: [{ section, ok: false, error: (e as Error).message }] });
    }
  });
}

