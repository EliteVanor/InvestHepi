import { authorized, isCron, passwordRequired, unauthorized } from "@/lib/auth";
import { refreshAll } from "@/lib/pipeline";
import { hit, limits } from "@/lib/ratelimit";
import type { SectionId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request) {
  if (!authorized(req, { allowCron: true })) return unauthorized();
  if (!isCron(req)) {
    const locked = passwordRequired();
    if (locked) return locked;
    const rl = await hit("refresh", limits.refresh());
    if (!rl.ok) return Response.json({ error: `Daily manual refresh limit reached (${rl.limit}). Scheduled refreshes still run.` }, { status: 429 });
  }
  const s = new URL(req.url).searchParams.get("section");
  const sections: SectionId[] = s && ["interests", "world", "us"].includes(s) ? [s as SectionId] : ["interests", "world", "us"];
  return Response.json(await refreshAll(sections));
}

export const GET = handle; // Vercel cron uses GET
export const POST = handle;
