import { isLang } from "@/lib/languages";
import { translateLatest } from "@/lib/briefings";
import { translatePredictions } from "@/lib/predictions";
import { userAiBusy } from "@/lib/llm/models";
import { hit, ipHit, limits } from "@/lib/ratelimit";
import { SECTION_IDS, type SectionId } from "@/lib/types";
import { gate } from "@/lib/users";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/translate?section=world&lang=vi → the latest briefing in that language. Cached per
 * briefing version for every reader, so only the first reader of a new briefing triggers an AI call
 * (counted against a daily cap per account; signed-out visitors share one cap).
 */
export async function POST(req: Request) {
  return gate(req, {}, async (user) => {
    const p = new URL(req.url).searchParams;
    const section = p.get("section") as SectionId;
    const lang = p.get("lang") ?? "";
    if (!SECTION_IDS.includes(section) || !isLang(lang)) return Response.json({ error: "bad request" }, { status: 400 });
    const cap = Number(process.env.TRANSLATE_DAILY_LIMIT) || 80;
    // Starting a translation costs AI tokens (a cached copy is free and never asks). Signed-in readers
    // have their own daily cap. A signed-out visitor is limited per address first (so one address can't
    // use up everyone's share), then by the shared cap, and not at all once the AI is past its daily
    // ceiling for visitors.
    const mayTranslate = async () => {
      if (user) return (await hit("translate", cap)).ok;
      if (await userAiBusy("translate")) return false;
      if (!(await ipHit("translate", req, limits.translateIp(), 86400)).ok) return false;
      return (await hit("translate", cap)).ok;
    };
    try {
      // ?kind=predictions → the section's prediction notes (all its markets in one go).
      if (p.get("kind") === "predictions") {
        const sets = await translatePredictions(section, lang, mayTranslate);
        return Response.json({ sets, translated: sets.every((s) => s.language === lang) });
      }
      const variant = p.get("variant") === "rules" ? "rules" : undefined;
      const digest = await translateLatest(section, lang, mayTranslate, variant);
      return Response.json({ digest, translated: digest?.language === lang });
    } catch (e) {
      console.error("translate failed:", e);
      return Response.json({ error: "Translation unavailable, try again later" }, { status: 502 });
    }
  });
}
