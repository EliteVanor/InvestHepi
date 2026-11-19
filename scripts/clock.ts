/**
 * Test clock. `pinClock(at)` starts `Date.now()` and `new Date()` at `at` (an ISO string or ms) for the
 * rest of the process, then lets them run at real speed, so timeouts and cooldowns still work while a
 * suite's fixtures and the code under test agree on the day and hour: the result doesn't depend on when
 * the suite runs. `new Date(x)` with an argument is unchanged. Call it before importing anything from `src/`.
 * It covers one instant per suite: behaviour that changes with the time of day (midnight, weekends, summer
 * time, cutoffs) needs explicit-time cases in the suite, not the pin. `Date` becomes a subclass, so a Date
 * made before the pin fails `instanceof Date` (nothing in src or scripts uses instanceof Date today).
 */
export function pinClock(at: string | number): number {
  const base = typeof at === "number" ? at : Date.parse(at);
  if (!Number.isFinite(base)) throw new Error(`pinClock: bad time ${at}`);
  const Real = Date;
  const started = performance.now();
  const nowMs = () => base + Math.round(performance.now() - started);
  class PinnedDate extends Real {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(nowMs());
      else super(...(args as [number]));
    }
    static now() {
      return nowMs();
    }
  }
  globalThis.Date = PinnedDate as unknown as DateConstructor;
  return base;
}
