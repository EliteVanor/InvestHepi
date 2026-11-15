import { authorized, unauthorized } from "@/lib/auth";
import { loadHistory } from "@/lib/pipeline";
import type { SectionId } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  const section = (new URL(req.url).searchParams.get("section") ?? "interests") as SectionId;
  if (!["interests", "world", "us"].includes(section)) return Response.json({ error: "bad section" }, { status: 400 });
  return Response.json({ history: await loadHistory(section) });
}
