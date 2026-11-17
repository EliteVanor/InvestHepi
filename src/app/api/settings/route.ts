import { gate } from "@/lib/users";
import { isLang } from "@/lib/languages";
import { isZone } from "@/lib/zones";
import { loadSettings, saveSettings } from "@/lib/interests";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return gate(req, {}, async () => {
    return Response.json(await loadSettings());
  });
}

export async function PUT(req: Request) {
  return gate(req, { user: true }, async () => {

    const body = (await req.json().catch(() => null)) as { briefingLanguage?: unknown; timeZone?: unknown } | null;
    if (!body || (body.briefingLanguage === undefined && body.timeZone === undefined)) return Response.json({ error: "nothing to save" }, { status: 400 });
    if (body.briefingLanguage !== undefined && !isLang(body.briefingLanguage)) return Response.json({ error: "invalid briefingLanguage" }, { status: 400 });
    if (body.timeZone !== undefined && !isZone(body.timeZone)) return Response.json({ error: "invalid timeZone" }, { status: 400 });
    const cur = await loadSettings();
    const next = { ...cur, ...(body.briefingLanguage !== undefined ? { briefingLanguage: body.briefingLanguage as string } : {}), ...(body.timeZone !== undefined ? { timeZone: body.timeZone as string } : {}) };
    await saveSettings(next);
    return Response.json(next);
  });
}
