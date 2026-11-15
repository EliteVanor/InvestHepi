import { authorized, unauthorized } from "@/lib/auth";
import { loadDigest } from "@/lib/pipeline";
import { storeKind } from "@/lib/store";
import type { SectionId } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  const params = new URL(req.url).searchParams;
  const section = (params.get("section") ?? "interests") as SectionId;
  const at = params.get("at")?.replace(/[^0-9]/g, "") || undefined;
  if (!["interests", "world", "us"].includes(section)) return Response.json({ error: "bad section" }, { status: 400 });
  return Response.json({ digest: await loadDigest(section, at), store: storeKind });
}
