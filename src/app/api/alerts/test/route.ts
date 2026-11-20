import { gate } from "@/lib/users";
import { loadAlertSettings, sendTestEmail } from "@/lib/alerts";
import { hit, limits } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return gate(req, { user: true }, async () => {
    // Only ever send to the saved address (and, in multi-user mode, only to the account's own: see
    // emailBlocked), a few times a day per person, so this can't be used to email strangers or spam.
    const rl = await hit("alert-test", limits.alertTest());
    if (!rl.ok) return Response.json({ ok: false, error: "limit" }, { status: 429 });
    const to = (await loadAlertSettings()).email;
    const res = await sendTestEmail(to);
    return Response.json(res, { status: res.ok ? 200 : 400 });
  });
}
