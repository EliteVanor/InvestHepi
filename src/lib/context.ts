/**
 * Request-scoped user context. Route handlers (and the scheduler, per user) run inside
 * withUser(uid, ...), and per-user storage keys are namespaced through ukey().
 * The "owner" uid keeps the original un-prefixed keys, so a single-user install (and the owner
 * account in multi-user mode) keeps all its existing data with no migration.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const als = new AsyncLocalStorage<{ uid: string }>();

export const OWNER = "owner";
export const GUEST = "guest";

export function withUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  return als.run({ uid }, fn);
}

export function currentUid(): string {
  return als.getStore()?.uid ?? OWNER;
}

/** Storage key for the current user. */
export function ukey(k: string): string {
  const uid = currentUid();
  return uid === OWNER ? k : `u:${uid}:${k}`;
}
