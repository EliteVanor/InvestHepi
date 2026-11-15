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

export async function setJSON<T>(key: string, value: T): Promise<void> {
  if (redis) {
    await redis.set(key, value);
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
