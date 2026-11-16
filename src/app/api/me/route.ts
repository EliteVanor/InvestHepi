import { background } from "@/lib/background";
import { withUser } from "@/lib/context";
import { interestBriefingStale } from "@/lib/briefings";
import { currentInterestSet } from "@/lib/interests";
import { CATCH_UP_AFTER_MS, ensureInterestBriefing } from "@/lib/pipeline";
import { autogenAllowed, limits, peek, userRefreshQuota } from "@/lib/ratelimit";
import { asCaller, multiUser, touchUser, type User } from "@/lib/users";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Who am I: account mode, the signed-in user (if any), and whether they're the admin.
 * A signed-in user whose briefing is over 12 h old (the timetable only refreshes people seen in the
 * last day) gets a fresh one in the background; `catchUp` is the old version's time so the page can
 * wait for the new one.
 */
export async function GET(req: Request) {
  return asCaller(req, async (user) => {
    if (user) await touchUser(user).catch(() => {});
    return Response.json({
      mode: multiUser() ? "multi" : "single",
      user: user ? { email: user.email, name: user.name, image: user.image } : null,
      admin: user?.admin ?? false,
      // Refresh button: users get 5 a day (90 min apart) for My Interests; the admin 10 for any section.
      refresh: !user ? null : user.admin ? { ...(await peek("refresh", limits.refresh())), nextAt: null } : await userRefreshQuota(),
      catchUp: await catchUp(user),
    });
  });
}

async function catchUp(user: User | null): Promise<string | undefined> {
  if (!user || user.admin || !multiUser()) return undefined;
  const stale = await interestBriefingStale((await currentInterestSet()).hash, CATCH_UP_AFTER_MS).catch(() => null);
  if (!stale?.at) return undefined; // fresh, or no briefing yet (saving interests makes the first one)
  void background(() => withUser(user.uid, () => ensureInterestBriefing(user.uid, autogenAllowed, CATCH_UP_AFTER_MS)));
  return stale.at;
}
