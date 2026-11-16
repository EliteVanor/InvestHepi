/** Per-day counters in the store. Not atomic, which is fine for a single-user app. */
import { ukey } from "./context";
import { getJSON, setJSON } from "./store";
import { dayIn, NY } from "./dates";


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
};

/** Counts one background briefing against the caller's daily cap; false when the cap is reached. */
export const autogenAllowed = async () => (await hit("autogen", limits.autogen())).ok;

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
