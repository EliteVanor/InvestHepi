/**
 * Waiting for another instance that holds a store lock (`takeLock` / `releaseLock` in store.ts): the
 * loser of a lock polls for the winner's result instead of paying for the same AI work twice.
 * Tests shorten `lockWait`.
 */
export const lockWait = { waitMs: 20_000, pollMs: 500 };

/** Poll `ready` until it is true or `waitMs` passes; returns whether it became true. Never throws. */
export async function waitUntil(ready: () => Promise<boolean>, waitMs = lockWait.waitMs, pollMs = lockWait.pollMs): Promise<boolean> {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, pollMs));
    if (await ready().catch(() => false)) return true;
  }
  return false;
}
