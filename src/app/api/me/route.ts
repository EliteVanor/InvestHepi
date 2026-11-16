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
    });
  });
}
