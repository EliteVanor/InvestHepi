/** Per-day counters in the store. Not atomic, which is fine for a single-user app. */
import { currentUid, OWNER, ukey } from "./context";
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
export const autogenAllowed = async () => (currentUid() === OWNER || !(await userAiBusy("userAuto"))) && (await hit("autogen", limits.autogen())).ok;

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

/** The key a caller is limited by: an IPv4 address, or an IPv6 address's /64 (one household gets billions of addresses). */
export function ipKey(req: Request): string {
  const ip = clientIp(req);
  if (!ip.includes(":")) return ip;
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];
  const [h, t] = ip.split("::");
  const head = h ? h.split(":") : [];
  const tail = t ? t.split(":") : [];
  const fill = ip.includes("::") ? Array(Math.max(0, 8 - head.length - tail.length)).fill("0") : [];
  const groups = [...head, ...fill, ...tail].map((x) => x.toLowerCase().replace(/^0+(?=.)/, ""));
  return `${groups.slice(0, 4).join(":")}::/64`;
}

/** Per-address daily/other counter in the store: one pipeline (INCR + EXPIRE, one request) per call. For rare paid actions. */
export async function ipHit(name: string, req: Request, limit: number, windowSec: number, now = new Date()): Promise<{ ok: boolean; used: number; retryAfterSec: number }> {
  const win = Math.floor(now.getTime() / (windowSec * 1000));
  const used = await incrWindow(`rl:ip:${name}:${ipKey(req)}:${win}`, windowSec + 5).catch(() => 0); // a store hiccup lets the request through
  return { ok: used <= limit, used, retryAfterSec: Math.max(1, Math.ceil(((win + 1) * windowSec * 1000 - now.getTime()) / 1000)) };
}

/** In-memory counters, per server instance: no store commands. Good enough to stop hammering of the price routes. */
const mem = new Map<string, { win: number; n: number }>();
export function memHit(name: string, req: Request, limit: number, windowSec: number, now = new Date()): { ok: boolean; retryAfterSec: number } {
  const win = Math.floor(now.getTime() / (windowSec * 1000));
  const key = `${name}:${ipKey(req)}`;
  const cur = mem.get(key);
  const e = cur && cur.win === win ? cur : { win, n: 0 };
  e.n++;
  mem.set(key, e);
  if (mem.size > 5000) for (const [k, v] of mem) if (v.win !== win) mem.delete(k);
  return { ok: e.n <= limit, retryAfterSec: Math.max(1, Math.ceil(((win + 1) * windowSec * 1000 - now.getTime()) / 1000)) };
}

/** Price routes (/api/quotes, /api/chart): requests per address per minute, counted in memory (no Redis commands). */
export function priceLimited(req: Request): Response | null {
  const r = memHit("px", req, limits.pricePerMin(), 60);
  return r.ok ? null : Response.json({ error: "slow down" }, { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } });
}
