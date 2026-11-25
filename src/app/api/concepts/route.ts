import { withCeiling } from "@/lib/context";
import { isLang } from "@/lib/languages";
import { loadConcepts } from "@/lib/stories/concepts";
import { CONCEPTS_PER_REQUEST, SLUG_MAX, SLUG_RE } from "@/lib/stories/view";
import { gate } from "@/lib/users";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/concepts?slugs=interest-rate,inflation&lang=vi → the stored concept cards (plain explanation
 * and example), in the reader's language. Public read; the page asks when a reader taps a concept chip.
 * Unknown slugs are left out. A concept not yet in that language is translated once and cached for good
 * (concepts are capped at 10 new a day app-wide, so this is bounded); a signed-out visitor's translation
 * stays under the AI ceiling for visitors.
 */
export async function GET(req: Request) {
  return gate(req, {}, async (user) => {
    const p = new URL(req.url).searchParams;
    const lang = p.get("lang") ?? "en";
    const slugs = [...new Set((p.get("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
    if (!isLang(lang) || !slugs.length || slugs.length > CONCEPTS_PER_REQUEST || slugs.some((s) => s.length > SLUG_MAX || !SLUG_RE.test(s))) {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    try {
      const load = () => loadConcepts(slugs, lang);
      const concepts = await (user ? load() : withCeiling(load));
      return Response.json({ concepts: concepts.map(({ slug, term, plain, example, lang: l }) => ({ slug, term, plain, ...(example ? { example } : {}), lang: l })) });
    } catch (e) {
      console.error("concepts failed:", e);
      return Response.json({ error: "Concepts unavailable, try again later" }, { status: 502 });
    }
  });
}
