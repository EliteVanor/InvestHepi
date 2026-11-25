import { background } from "@/lib/background";
import { withCeiling } from "@/lib/context";
import { translateHeadlines } from "@/lib/headline-translate";
import { isLang } from "@/lib/languages";
import { userAiBusy } from "@/lib/llm/models";
import { ipHit, limits } from "@/lib/ratelimit";
import { loadHeadlines, noteReading, refreshSetIfStale, setStale } from "@/lib/headlines";
import { currentInterestSet } from "@/lib/interests";
import { multiUser } from "@/lib/mode";
import { SECTION_IDS, type SectionId } from "@/lib/types";
import { gate } from "@/lib/users";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/news?section=world → the live headline list (shared sections refresh every 15 min).
 * For My Interests, asking marks the reader's set as being read (the tick keeps it fresh every 30 min
 * while it is), and a list that's gone stale (a user signing in or coming back) is refreshed in the
 * background right away; `refreshing: true` tells the page to ask again shortly.
 * `&lang=xx` returns titles translated into that language (`titleOrig` = as published).
 */
export async function GET(req: Request) {
  return gate(req, {}, async (user) => {
    const section = (new URL(req.url).searchParams.get("section") ?? "interests") as SectionId;
    if (!SECTION_IDS.includes(section)) return Response.json({ error: "bad section" }, { status: 400 });
    let refreshing = false;
    let hash: string | undefined;
    if (section === "interests") {
      const set = await currentInterestSet();
      hash = set.hash;
      // Signed-out visitors don't see My Interests (multi-user mode), so they don't keep a set awake.
      if (!multiUser() || user) {
        const now = new Date();
        await noteReading(set.hash, set.interests, now);
        if (await setStale(set.hash, now)) {
          refreshing = true;
          await background(() => refreshSetIfStale(set.hash, set.interests, now));
        }
      }
    }
    const n = await loadHeadlines(section, hash);
    let items = n?.items ?? [];
    // ?lang=xx → titles in that language (cached per headline; a failure leaves them as published).
    const lang = new URL(req.url).searchParams.get("lang");
    if (lang && isLang(lang) && items.length) {
      // A signed-out visitor starts a batch only per address (daily) and while the AI is under its visitor ceiling.
      const mayStart = async () => (user ? true : !(await userAiBusy("translate")) && (await ipHit("headlines", req, limits.headlineIp(), 86400)).ok);
      items = await (user ? translateHeadlines(items, lang, mayStart) : withCeiling(() => translateHeadlines(items, lang, mayStart)));
    }
    return Response.json({ at: n?.at ?? null, items, ...(refreshing ? { refreshing } : {}) });
  });
}
