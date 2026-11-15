/** Per-day counters in the store. Not atomic, which is fine for a single-user app. */
import { ukey } from "./context";
import { getJSON, setJSON } from "./store";

function etDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export async function hit(name: string, limitPerDay: number, now = new Date()): Promise<{ ok: boolean; used: number; limit: number }> {
  const key = ukey(`rl:${name}`);
  const day = etDay(now);
  const cur = await getJSON<{ day: string; n: number }>(key);
  const used = cur && cur.day === day ? cur.n : 0;
  if (used >= limitPerDay) return { ok: false, used, limit: limitPerDay };
  await setJSON(key, { day, n: used + 1 });
  return { ok: true, used: used + 1, limit: limitPerDay };
}

export const limits = {
  ask: () => Number(process.env.ASK_DAILY_LIMIT) || 60,
  refresh: () => Number(process.env.REFRESH_DAILY_LIMIT) || 60,
};
