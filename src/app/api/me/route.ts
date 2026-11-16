import { limits, peek, userRefreshQuota } from "@/lib/ratelimit";
import { asCaller, multiUser, touchUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/** Who am I: account mode, the signed-in user (if any), and whether they're the admin. */
export async function GET(req: Request) {
  return asCaller(req, async (user) => {
    if (user) await touchUser(user).catch(() => {});
    return Response.json({
      mode: multiUser() ? "multi" : "single",
      user: user ? { email: user.email, name: user.name, image: user.image } : null,
      admin: user?.admin ?? false,
      // Refresh button: users get 5 a day (90 min apart) for My Interests; the admin 10 for any section.
      refresh: !user ? null : user.admin ? { ...(await peek("refresh", limits.refresh())), nextAt: null } : await userRefreshQuota(),
    });
  });
}
