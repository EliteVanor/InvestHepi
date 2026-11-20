/** Per-day counters in the store. Not atomic, which is fine for a single-user app. */
import { ukey } from "./context";
import { getJSON, incrWindow, setJSON } from "./store";
import { dayIn, NY } from "./dates";
import { userAiBusy } from "./llm/models";


export async function hit(name: string, limitPerDay: number, now = new Date()): Promise<{ ok: boolean; used: number; limit: number }> {
  const key = ukey(`rl:${name}`);
  const day = dayIn(NY, now);
  const cur = await getJSON<{ day: string; n: number }>(key);
  const used = cur && cur.day === day ? cur.n : 0;
  if (used >= limitPerDay) return { ok: false, used, limit: limitPerDay };
  await setJSON(key, { day, n: used + 1 });
  return { ok: true, used: used + 1, limit: limitPerDay };
}

/** Today's count without spending one. */
export async function peek(name: string, limitPerDay: number, now = new Date()): Promise<{ used: number; limit: number; left: number }> {
  const cur = await getJSON<{ day: string; n: number }>(ukey(`rl:${name}`));
  const used = cur && cur.day === dayIn(NY, now) ? cur.n : 0;
  return { used, limit: limitPerDay, left: Math.max(0, limitPerDay - used) };
}

export const limits = {
  ask: () => Number(process.env.ASK_DAILY_LIMIT) || 60,
  /** Admin's refresh button (best model). */
  refresh: () => Number(process.env.REFRESH_DAILY_LIMIT) || 10,
  /** Users' refresh button for My Interests (Flash-Lite), and the wait between presses. */
  userRefresh: () => Number(process.env.USER_REFRESH_DAILY_LIMIT) || 5,
  userRefreshGapMin: () => Number(process.env.USER_REFRESH_GAP_MIN) || 90,
  /** Fresh rule-based copies per user per day (no AI, so generous). */
  rules: () => Number(process.env.RULES_DAILY_LIMIT) || 30,
  /** Background briefings per user per day: a new set's first one, and the catch-up after an absence. */
  autogen: () => Number(process.env.AUTOGEN_DAILY_LIMIT) || 6,
  /** Price routes per address per minute (a page polls a few times a minute). */
  pricePerMin: () => Number(process.env.PRICE_IP_PER_MIN) || 90,
  /** Translations a signed-out visitor can start per address per day (the shared TRANSLATE_DAILY_LIMIT stays as the outer cap). */
  translateIp: () => Number(process.env.TRANSLATE_IP_DAILY_LIMIT) || 10,
  /** "Send test email" presses per person per day. */
  alertTest: () => Number(process.env.ALERT_TEST_DAILY_LIMIT) || 3,
};

/** Counts one background briefing against the caller's daily cap; false when the cap is reached. */
/** Also false while visitor-triggered AI work is paused for the day (every model in the chain past the ceiling): nothing is counted then. */
export const autogenAllowed = async () => !(await userAiBusy("userAuto")) && (await hit("autogen", limits.autogen())).ok;

/** A user's refresh-button state: presses left today and when the next one is allowed. */
export async function userRefreshQuota(now = new Date()): Promise<{ left: number; limit: number; nextAt: string | null }> {
  const q = await peek("refresh-user", limits.userRefresh(), now);
  const last = await getJSON<{ at: string }>(ukey("rl:refresh-user:last"));
  const next = last ? new Date(new Date(last.at).getTime() + limits.userRefreshGapMin() * 60_000) : null;
  return { left: q.left, limit: q.limit, nextAt: next && next > now ? next.toISOString() : null };
}

export async function markUserRefresh(now = new Date()): Promise<void> {
  await setJSON(ukey("rl:refresh-user:last"), { at: now.toISOString() });
}

/* ------------------------------------------------------------ per IP */

/** The caller's address as the platform reports it (Vercel sets these), or "unknown". */
export function clientIp(req: Request): string {
  const h = req.headers;
  const ip = h.get("x-real-ip") || h.get("x-vercel-forwarded-for") || h.get("x-forwarded-for")?.split(",")[0] || "";
  return ip.trim().slice(0, 64).replace(/[^0-9a-fA-F:.]/g, "") || "unknown";
}

/**
 * Per-address counter in a fixed window (the window number is part of the key, which expires on its own).
 * Costs ONE Redis command per call (INCR), plus one EXPIRE on the first call of a window: an
 * `ipHit` for a price request is 1 command, 2 once per minute per address.
 */
export async function ipHit(name: string, req: Request, limit: number, windowSec: number, now = new Date()): Promise<{ ok: boolean; used: number; retryAfterSec: number }> {
  const win = Math.floor(now.getTime() / (windowSec * 1000));
  const used = await incrWindow(`rl:ip:${name}:${clientIp(req)}:${win}`, windowSec + 5).catch(() => 0); // a store hiccup lets the request through
  return { ok: used <= limit, used, retryAfterSec: Math.max(1, Math.ceil(((win + 1) * windowSec * 1000 - now.getTime()) / 1000)) };
}

/** Price routes (/api/quotes, /api/chart): requests per address per minute. */
export async function priceLimited(req: Request): Promise<Response | null> {
  const r = await ipHit("px", req, limits.pricePerMin(), 60);
  return r.ok ? null : Response.json({ error: "slow down" }, { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } });
}
