import { authorized, unauthorized } from "@/lib/auth";
import { refreshAll } from "@/lib/pipeline";
import type { SectionId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request) {
  if (!authorized(req, { allowCron: true })) return unauthorized();
  const s = new URL(req.url).searchParams.get("section");
  const sections: SectionId[] = s && ["interests", "world", "us"].includes(s) ? [s as SectionId] : ["interests", "world", "us"];
  return Response.json(await refreshAll(sections));
}

export const GET = handle; // Vercel cron uses GET
export const POST = handle;
