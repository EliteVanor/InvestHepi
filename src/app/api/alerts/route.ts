import { gate } from "@/lib/users";
import { z } from "zod";
import { DEFAULT_ALERTS, emailBlocked, loadAlertLog, loadAlertSettings, saveAlertSettings } from "@/lib/alerts";
import { emailProvider } from "@/lib/email";
import { multiUser } from "@/lib/mode";

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
  return gate(req, { user: true }, async () => {
    const [settings, log] = await Promise.all([loadAlertSettings(), loadAlertLog()]);
    // emailBlocked: the saved address isn't this account's, so nothing is sent to it (the tab says so).
    return Response.json({ settings, log: log.slice(0, 30), provider: emailProvider(), defaults: DEFAULT_ALERTS, emailBlocked: await emailBlocked(settings.email) });
  });
}

export async function PUT(req: Request) {
  return gate(req, { user: true }, async (user) => {
    const parsed = Settings.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400 });
    // Multi-user: a non-owner can only use their own Google address (or none). The owner may use any.
    if (multiUser() && user && !user.admin && parsed.data.email && parsed.data.email.toLowerCase() !== (user.email ?? "").toLowerCase()) {
      return Response.json({ error: "email" }, { status: 400 });
    }
    await saveAlertSettings(parsed.data);
    return Response.json({ settings: parsed.data, emailBlocked: await emailBlocked(parsed.data.email) });
  });
}
