import { authorized, passwordRequired, unauthorized, ownerOnly } from "@/lib/auth";
import { isLang } from "@/lib/languages";
import { loadSettings, saveSettings } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  return Response.json(await loadSettings());
}

export async function PUT(req: Request) {
  if (!authorized(req)) return unauthorized();
  const ro = ownerOnly(req);
  if (ro) return ro;
  const locked = passwordRequired();
  if (locked) return locked;

  const body = (await req.json().catch(() => null)) as { briefingLanguage?: unknown } | null;
  if (!body || !isLang(body.briefingLanguage)) return Response.json({ error: "invalid briefingLanguage" }, { status: 400 });
  const next = { ...(await loadSettings()), briefingLanguage: body.briefingLanguage };
  await saveSettings(next);
  return Response.json(next);
}
