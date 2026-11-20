import { gate } from "@/lib/users";
import { z } from "zod";
import { ask } from "@/lib/ask";
import { appendToChat } from "@/lib/chats";
import { getCalendar } from "@/lib/calendar";
import { isLang } from "@/lib/languages";
import { userAiBusy } from "@/lib/llm/models";
import { hit, limits } from "@/lib/ratelimit";
import { loadDigest } from "@/lib/briefings";
import { currentCallsKey, loadInterests } from "@/lib/interests";
import { SECTION_IDS, type SectionId } from "@/lib/types";
import { loadPredictions, predictionsAsText } from "@/lib/predictions";
import { loadHoldings, positionsAsText } from "@/lib/portfolio";
import { computeStats, loadCalls, trackRecordText } from "@/lib/track";
import type { Digest } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  question: z.string().trim().min(2).max(500),
  lang: z.string().optional(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(10).default([]),
  /** Saved conversation to add this exchange to (created when missing). */
  chatId: z.string().max(40).optional(),
  section: z.enum(SECTION_IDS as unknown as [string, ...string[]]).optional(),
});

export async function POST(req: Request) {
  return gate(req, { user: true }, async (user) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400 });
    const { question, history, lang, chatId, section } = parsed.data;
    if (!user?.admin && (await userAiBusy("ask"))) return Response.json({ error: "busy" }, { status: 503 });
    const rl = await hit("ask", limits.ask());
    if (!rl.ok) return Response.json({ error: `Daily Ask AI limit reached (${rl.limit}). It resets at midnight ET.` }, { status: 429 });
    const [digests, interests, calls, preds] = await Promise.all([
      Promise.all(SECTION_IDS.map((s) => loadDigest(s))),
      loadInterests(),
      currentCallsKey().then((k) => loadCalls(k)),
      // The section being read first, then the others.
      Promise.all([...new Set([section ?? "interests", ...SECTION_IDS])].map((s) => loadPredictions(s as SectionId).catch(() => []))),
    ]);
    const ds = digests.filter((d): d is Digest => !!d);
    if (!ds.length) return Response.json({ error: "No briefings yet. Refresh a section first." }, { status: 409 });
    const cal = await getCalendar(interests).catch(() => ({ events: [] }));
    try {
      const main = ds.find((d) => d.section === "interests") ?? ds[0];
      const positions = positionsAsText(await loadHoldings().catch(() => []), main.quotes);
      const r = await ask(question, history, ds, cal.events, trackRecordText(computeStats(calls)), isLang(lang) ? lang : "en", positions, predictionsAsText(preds.flat()));
      // Saved to the account so the conversation can be reopened later (a failed save doesn't lose the answer).
      const id = await appendToChat(chatId, question, { role: "assistant", content: r.answer, sources: r.sources, provider: r.provider }, section).catch(() => chatId);
      return Response.json({ ...r, chatId: id });
    } catch (e) {
      const msg = (e as Error).message;
      return Response.json({ error: msg === "NO_PROVIDER" ? "NO_PROVIDER" : msg }, { status: msg === "NO_PROVIDER" ? 412 : 502 });
    }
  });
}
