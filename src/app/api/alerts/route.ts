import { z } from "zod";
import { DEFAULT_ALERTS, loadAlertLog, loadAlertSettings, saveAlertSettings } from "@/lib/alerts";
import { authorized, passwordRequired, unauthorized } from "@/lib/auth";
import { emailProvider } from "@/lib/email";

export const dynamic = "force-dynamic";

const PriceAlert = z.object({
  id: z.string().min(1).max(40),
  symbol: z.string().regex(/^[A-Za-z0-9.^=\-]{1,12}$/).transform((s) => s.toUpperCase()),
  op: z.enum(["above", "below", "pct_up", "pct_down"]),
  value: z.number().positive().max(1e7),
  repeat: z.boolean(),
  active: z.boolean(),
  note: z.string().max(120).optional(),
  createdAt: z.string(),
  lastFiredAt: z.string().optional(),
});

const Settings = z.object({
  email: z.union([z.literal(""), z.string().email()]),
  enabled: z.boolean(),
  morningBriefing: z.boolean(),
  weeklyRecap: z.boolean(),
  bigMove: z.object({ enabled: z.boolean(), pct: z.number().min(0.5).max(50) }),
  callChanges: z.boolean(),
  highConfidence: z.object({ enabled: z.boolean(), min: z.number().min(50).max(99) }),
  catalysts: z.boolean(),
  priceAlerts: z.array(PriceAlert).max(50),
});

export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  const [settings, log] = await Promise.all([loadAlertSettings(), loadAlertLog()]);
  return Response.json({ settings, log: log.slice(0, 30), provider: emailProvider(), defaults: DEFAULT_ALERTS });
}

export async function PUT(req: Request) {
  if (!authorized(req)) return unauthorized();
  const locked = passwordRequired();
  if (locked) return locked;

  const parsed = Settings.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400 });
  await saveAlertSettings(parsed.data);
  return Response.json({ settings: parsed.data });
}
