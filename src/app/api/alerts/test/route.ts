import { loadAlertSettings, sendTestEmail } from "@/lib/alerts";
import { authorized, passwordRequired, unauthorized, ownerOnly } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  const ro = ownerOnly(req);
  if (ro) return ro;
  const locked = passwordRequired();
  if (locked) return locked;
  // Only ever send to the saved address, so this can't be used to email strangers.
  const to = (await loadAlertSettings()).email;
  const res = await sendTestEmail(to);
  return Response.json(res, { status: res.ok ? 200 : 400 });
}
