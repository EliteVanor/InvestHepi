import { gate } from "@/lib/users";
import { loadAlertSettings, sendTestEmail } from "@/lib/alerts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return gate(req, { user: true }, async () => {
    // Only ever send to the saved address, so this can't be used to email strangers.
    const to = (await loadAlertSettings()).email;
    const res = await sendTestEmail(to);
    return Response.json(res, { status: res.ok ? 200 : 400 });
  });
}
