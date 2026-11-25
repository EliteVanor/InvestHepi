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

// STORE_DIR lets each test process use its own directory (the test runners set it), so parallel runs never share state.
const dir = process.env.STORE_DIR || (process.env.VERCEL ? "/tmp/invest-helper" : path.join(process.cwd(), ".data"));
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

/**
 * Counter that expires on its own: the new count. One pipelined request (INCR + EXPIRE). Files (local dev) read and write, which is fine for one process.
 */
export async function incrWindow(key: string, ttlSec: number): Promise<number> {
  if (redis) {
    const [n] = await redis.pipeline().incr(key).expire(key, ttlSec).exec<[number, number]>(); // one request, atomic
    return n;
  }
  const n = ((await getJSON<number>(key)) ?? 0) + 1;
  await setJSON(key, n);
  return n;
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
 * Atomic on Redis (SET NX EX). Files (local dev): create-exclusive, and an expired lock is taken over by
 * moving it aside (rename is atomic), so two callers can't both delete-and-recreate it.
 */
export async function takeLock(key: string, ttlSec: number): Promise<string | null> {
  const token = Math.random().toString(36).slice(2);
  if (redis) return (await redis.set(key, token, { nx: true, ex: ttlSec })) === "OK" ? token : null;
  await fs.mkdir(dir, { recursive: true });
  const file = fileFor(key);
  for (let tries = 0; tries < 3; tries++) {
    try {
      await fs.writeFile(file, JSON.stringify({ token, until: Date.now() + ttlSec * 1000 }), { flag: "wx" });
      return token;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const taken = await moveAside(file);
    if (!taken) continue; // it vanished: try to create it
    const held = taken.value as { until?: number } | null;
    if (held && (held.until ?? 0) > Date.now()) {
      await restore(taken.tmp, file); // still valid: put it back
      return null;
    }
    await fs.rm(taken.tmp, { force: true }); // expired: gone, try again
  }
  return null;
}

async function moveAside(file: string): Promise<{ tmp: string; value: unknown } | null> {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fs.rename(file, tmp);
  } catch {
    return null;
  }
  let value: unknown = null;
  try {
    value = JSON.parse(await fs.readFile(tmp, "utf8"));
  } catch {}
  return { tmp, value };
}

async function restore(tmp: string, file: string): Promise<void> {
  try {
    await fs.link(tmp, file); // fails if someone created a new lock meanwhile: theirs stays
  } catch {}
  await fs.rm(tmp, { force: true });
}

const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

/** Delete the lock only if `token` still holds it: one step on Upstash (a server-side script), an atomic move on files. */
export async function releaseLock(key: string, token: string): Promise<void> {
  if (redis) {
    await redis.eval(RELEASE_SCRIPT, [key], [token]);
    return;
  }
  const taken = await moveAside(fileFor(key));
  if (!taken) return;
  if ((taken.value as { token?: string } | null)?.token === token) await fs.rm(taken.tmp, { force: true });
  else await restore(taken.tmp, fileFor(key)); // someone else's lock (ours expired): put it back
}
