/**
 * Accounts. Multi-user mode turns on when Auth.js is configured (AUTH_SECRET + Google client);
 * otherwise the app stays in single-user password mode (APP_PASSWORD / VIEWER_PASSWORD).
 *
 * Users are identified by a hash of their verified email. OWNER_EMAIL maps to the "owner" uid,
 * which keeps the original single-user data.
 */
import { createHash } from "node:crypto";
import { authorized, ownerOnly, passwordRequired, role, unauthorized } from "./auth";
import { multiUser } from "./mode";
import { GUEST, OWNER, withUser } from "./context";
import { getJSON, setJSON } from "./store";

export interface User {
  uid: string;
  email?: string;
  name?: string;
  image?: string;
  admin: boolean;
}

export interface UserRecord {
  uid: string;
  email: string;
  name?: string;
  lastSeen: string;
}

export { multiUser };

export function uidFor(email: string): string {
  const e = email.trim().toLowerCase();
  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (owner && e === owner) return OWNER;
  return createHash("sha256").update(e).digest("hex").slice(0, 20);
}

type Session = { user?: { email?: string | null; name?: string | null; image?: string | null } } | null;
let resolver: (req: Request) => Promise<Session> = async () => {
  const { auth } = await import("@/auth");
  return (await auth()) as Session;
};

/** Tests (and local end-to-end runs) can swap the session source. */
export function setSessionResolver(fn: (req: Request) => Promise<Session>) {
  resolver = fn;
}

/** Local end-to-end testing only: never active on Vercel. */
function fakeSession(req: Request): Session | undefined {
  if (process.env.E2E_FAKE_AUTH !== "1" || process.env.VERCEL) return undefined;
  const email = req.headers.get("x-test-user");
  return email ? { user: { email, name: email.split("@")[0] } } : null;
}

/** The signed-in user, or null for a signed-out visitor. */
export async function getUser(req: Request): Promise<User | null> {
  if (!multiUser()) {
    return role(req) === "owner" ? { uid: OWNER, admin: true } : null;
  }
  const s = fakeSession(req) ?? (await resolver(req).catch(() => null));
  const email = s?.user?.email;
  if (!email) return null;
  const uid = uidFor(email);
  return { uid, email, name: s?.user?.name ?? undefined, image: s?.user?.image ?? undefined, admin: uid === OWNER };
}

/** Run a handler as the caller: their own namespace if signed in, otherwise as a guest. */
export async function asCaller<T>(req: Request, fn: (user: User | null) => Promise<T>): Promise<T> {
  const user = await getUser(req);
  return withUser(user?.uid ?? (multiUser() ? GUEST : OWNER), () => fn(user));
}

export const signInRequired = () => Response.json({ error: "signin" }, { status: 401 });

/**
 * One entry point for route handlers. Checks access for the current mode, then runs the handler in
 * the caller's data namespace. `user: true` = needs an account (multi-user) or the owner password
 * (single-user); otherwise readable by signed-out visitors / guests.
 */
export async function gate(req: Request, opts: { user?: boolean }, fn: (user: User | null) => Promise<Response>): Promise<Response> {
  if (!authorized(req)) return unauthorized();
  if (opts.user && !multiUser()) {
    const ro = ownerOnly(req);
    if (ro) return ro;
    const locked = passwordRequired();
    if (locked) return locked;
  }
  return asCaller(req, async (user) => {
    if (opts.user && multiUser() && !user) return signInRequired();
    return fn(user);
  });
}

/* ------------------------------------------------------------ registry */

export async function listUsers(): Promise<UserRecord[]> {
  return (await getJSON<UserRecord[]>("users")) ?? [];
}

/** Remember the user (throttled to once an hour) so the scheduler knows whose briefings to refresh. */
export async function touchUser(u: User, now = new Date()): Promise<void> {
  if (!u.email) return;
  const list = await listUsers();
  const i = list.findIndex((x) => x.uid === u.uid);
  if (i >= 0 && now.getTime() - new Date(list[i].lastSeen).getTime() < 3600_000) return;
  const rec: UserRecord = { uid: u.uid, email: u.email, name: u.name, lastSeen: now.toISOString() };
  if (i >= 0) list[i] = rec;
  else list.push(rec);
  await setJSON("users", list.slice(-5000));
}

/**
 * Users whose interest sets the timetable refreshes: seen in the last day (owner's decision, Nov 16).
 * Someone back after longer gets a catch-up briefing when they open the app (/api/me).
 */
export const SCHEDULED_ACTIVE_DAYS = 1;

/** Users seen in the last `days` days (the owner is always included). */
export async function activeUsers(days = SCHEDULED_ACTIVE_DAYS, now = new Date()): Promise<string[]> {
  const cutoff = now.getTime() - days * 86400_000;
  const uids = (await listUsers()).filter((u) => new Date(u.lastSeen).getTime() >= cutoff).map((u) => u.uid);
  return [...new Set([OWNER, ...uids])];
}
