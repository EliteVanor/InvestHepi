/**
 * Tiny key-value store.
 * - Upstash Redis when configured (Vercel's Upstash integration sets KV_REST_API_URL / KV_REST_API_TOKEN).
 * - Local JSON files in .data/ otherwise (fine for `npm run dev`; NOT persistent on Vercel).
 */
import { Redis } from "@upstash/redis";
import { promises as fs } from "fs";
import path from "path";

const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

export const storeKind = redis ? "redis" : process.env.VERCEL ? "ephemeral" : "file";

const dir = process.env.VERCEL ? "/tmp/invest-helper" : path.join(process.cwd(), ".data");
const fileFor = (key: string) => path.join(dir, key.replace(/[^a-z0-9_-]/gi, "_") + ".json");

export async function getJSON<T>(key: string): Promise<T | null> {
  if (redis) return (await redis.get<T>(key)) ?? null;
  try {
    return JSON.parse(await fs.readFile(fileFor(key), "utf8")) as T;
  } catch {
    return null;
  }
}

/** `ttlSec` lets Redis expire the key (local files keep it; they're for development only). */
export async function setJSON<T>(key: string, value: T, ttlSec?: number): Promise<void> {
  if (redis) {
    await (ttlSec ? redis.set(key, value, { ex: ttlSec }) : redis.set(key, value));
    return;
  }
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(fileFor(key), JSON.stringify(value, null, 2));
}

export async function delJSON(key: string): Promise<void> {
  if (redis) {
    await redis.del(key);
    return;
  }
  await fs.rm(fileFor(key), { force: true });
}

/**
 * A lock that expires on its own: returns a token if taken, null if someone else holds it.
 * Atomic on Redis (SET NX EX); the local file version is good enough for one dev server.
 */
export async function takeLock(key: string, ttlSec: number): Promise<string | null> {
  const token = Math.random().toString(36).slice(2);
  if (redis) return (await redis.set(key, token, { nx: true, ex: ttlSec })) === "OK" ? token : null;
  // Files: create-exclusive ("wx"), so two callers in one process (or two dev servers) can't both win.
  await fs.mkdir(dir, { recursive: true });
  const file = fileFor(key);
  for (let tries = 0; tries < 2; tries++) {
    try {
      await fs.writeFile(file, JSON.stringify({ token, until: Date.now() + ttlSec * 1000 }), { flag: "wx" });
      return token;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const held = await getJSON<{ token: string; until: number }>(key);
      if (held && held.until > Date.now()) return null;
      await fs.rm(file, { force: true }); // expired (or unreadable): take over
    }
  }
  return null;
}

export async function releaseLock(key: string, token: string): Promise<void> {
  const held = redis ? await redis.get<string>(key) : (await getJSON<{ token: string }>(key))?.token;
  if (held === token) await delJSON(key);
}
