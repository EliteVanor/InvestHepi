import { isLang } from "@/lib/languages";
import { translateLatest } from "@/lib/pipeline";
import { hit } from "@/lib/ratelimit";
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
  return gate(req, {}, async () => {
    const p = new URL(req.url).searchParams;
    const section = p.get("section") as SectionId;
    const lang = p.get("lang") ?? "";
    if (!SECTION_IDS.includes(section) || !isLang(lang)) return Response.json({ error: "bad request" }, { status: 400 });
    const cap = Number(process.env.TRANSLATE_DAILY_LIMIT) || 80;
    try {
      const digest = await translateLatest(section, lang, async () => (await hit("translate", cap)).ok);
      return Response.json({ digest, translated: digest?.language === lang });
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 502 });
    }
  });
}
