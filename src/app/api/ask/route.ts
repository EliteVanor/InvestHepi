import { gate } from "@/lib/users";
import { z } from "zod";
import { ask } from "@/lib/ask";
import { getCalendar } from "@/lib/calendar";
import { isLang } from "@/lib/languages";
import { hit, limits } from "@/lib/ratelimit";
import { currentCallsKey, loadDigest, loadInterests } from "@/lib/pipeline";
import { SECTION_IDS } from "@/lib/types";
import { loadHoldings, positionsAsText } from "@/lib/portfolio";
import { computeStats, loadCalls, trackRecordText } from "@/lib/track";
import type { Digest } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  question: z.string().trim().min(2).max(500),
  lang: z.string().optional(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(10).default([]),
});

export async function POST(req: Request) {
  return gate(req, { user: true }, async () => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400 });
    const { question, history, lang } = parsed.data;
    const rl = await hit("ask", limits.ask());
    if (!rl.ok) return Response.json({ error: `Daily Ask AI limit reached (${rl.limit}). It resets at midnight ET.` }, { status: 429 });
    const [digests, interests, calls] = await Promise.all([
      Promise.all(SECTION_IDS.map((s) => loadDigest(s))),
      loadInterests(),
      currentCallsKey().then((k) => loadCalls(k)),
    ]);
    const ds = digests.filter((d): d is Digest => !!d);
    if (!ds.length) return Response.json({ error: "No briefings yet. Refresh a section first." }, { status: 409 });
    const cal = await getCalendar(interests).catch(() => ({ events: [] }));
    try {
      const main = ds.find((d) => d.section === "interests") ?? ds[0];
      const positions = positionsAsText(await loadHoldings().catch(() => []), main.quotes);
      return Response.json(await ask(question, history, ds, cal.events, trackRecordText(computeStats(calls)), isLang(lang) ? lang : "en", positions));
    } catch (e) {
      const msg = (e as Error).message;
      return Response.json({ error: msg === "NO_PROVIDER" ? "NO_PROVIDER" : msg }, { status: msg === "NO_PROVIDER" ? 412 : 502 });
    }
  });
}
