/**
 * Runs the timetable (timetable.ts). Anything may call `/api/cron/tick` at any time, as often as it
 * likes: Vercel Schedules, cron-job.org, GitHub, or the tick itself. Each tick:
 *   1. takes a lock (overlapping pokes do nothing),
 *   2. runs price alerts if they're due (every 20 min, 13:00-22:00 UTC weekdays, no AI),
 *   3. grades calls whose session closed (at most hourly) and refreshes headlines that are due (no AI),
 *   4. runs ONE unit of work: a prediction run (a market, or one interest set's part on that market's
 *      clock) or a briefing (a shared section, English then the Vietnamese translation, or one
 *      interest set). Predictions and briefings are two lanes with different first models
 *      (gpt-oss-120b vs Gemini Flash-Lite); each lane keeps 65 s between its units (Groq's
 *      tokens-per-minute limit), and the lane that can go first goes,
 *   5. calls the tick again if it ran a unit, so a slot finishes without waiting for the next poke.
 * Every unit records an attempt, so the chain always ends.
 *
 * Idempotent: a briefing already written since 30 min before the slot is skipped (a manual refresh
 * counts), and a unit whose AI failed is retried once, 20 min later; a prediction that still fails is
 * missed (no rule-based predictions). Each item stops at its own deadline (timetable.ts itemEnd): a
 * before-market prediction at the market's open. Progress lives in `sched:<date>:<slot>`.
 */
import { checkPriceAlerts, loadAlertSettings } from "./alerts";
import { OWNER, withUser } from "./context";
import { appUrl } from "./email";
import { holdOff, requests120 } from "./llm/models";
import { pretranslateSet, translateLatest } from "./briefings";
import { refreshHeadlines } from "./headlines";
import { interestGroups, loadInterests, withHoldings } from "./interests";
import { interestPart, type Phase, type SlotMarket } from "./markets";
import { refreshInterestSet, refreshShared, SHARED_CALLS } from "./pipeline";
import { runPrediction, translatePredictions } from "./predictions";
import { gradeCalls } from "./track";
import { loadHoldings } from "./portfolio";
import { delJSON, getJSON, releaseLock, setJSON, takeLock } from "./store";
import { LATE_AFTER_MIN, isPred, itemEnd, occurrences, openOccurrences, predParts, runKey, type Occurrence, type SlotItem } from "./timetable";
import type { Interest, SectionId } from "./types";
import { activeUsers } from "./users";

const MIN = 60_000;
const GAP_MS = 65_000;
const FRESH_BEFORE_MIN = 30;
const RETRY_AFTER_MIN = 20;
const MAX_ATTEMPTS = 2;
const LOCK = "sched:lock";
const RUN_TTL = 8 * 86_400; // keep a week of slot records

export interface Attempt {
  at: string;
  n: number;
  ok: boolean;
  note?: string;
}

/** What happened in one slot occurrence. `items` per timetable item, `sets` per interest set. */
export interface SlotRun {
  items: Partial<Record<SlotItem, Attempt>>;
  sets: Record<string, Attempt>;
  done?: string;
}

export type Lane = "pred" | "brief";
/** When a lane last started a unit, and whether it called gpt-oss-120b (the gap exists for its token rate). */
interface LastUnit {
  at: number;
  used120: boolean;
}
interface SetRef {
  hash: string;
  interests: Interest[];
  lang: string;
  uids: string[];
  admin: boolean;
}
type Unit = { occ: Occurrence; run: SlotRun; item: SlotItem; lane: Lane; set?: SetRef };

const final = (a?: Attempt) => !!a && (a.ok || a.n >= MAX_ATTEMPTS);
const waiting = (a: Attempt | undefined, now: number) => !!a && !final(a) && now < new Date(a.at).getTime() + RETRY_AFTER_MIN * MIN;
const iso = (ms: number) => new Date(ms).toISOString();
/** Where an interest set's attempt is kept: plain hash for briefings, "<item>#<hash>" for predictions. */
const setKey = (item: SlotItem, hash: string) => (isPred(item) ? `${item}#${hash}` : hash);

async function loadRun(o: Occurrence): Promise<SlotRun> {
  return (await getJSON<SlotRun>(runKey(o))) ?? { items: {}, sets: {} };
}
const saveRun = (o: Occurrence, r: SlotRun) => setJSON(runKey(o), r, RUN_TTL);

/** Written since 30 min before the slot, by an AI (a rule-based fallback doesn't count). */
function fresh(last: { at: string; ok?: boolean; provider?: string } | null, o: Occurrence): boolean {
  return !!last && last.ok !== false && last.provider !== "rules" && new Date(last.at).getTime() >= o.start - FRESH_BEFORE_MIN * MIN;
}

/** The interest sets an item works on: all active sets, the admin's only, or each set's part on a market. */
function setsFor(item: SlotItem, groups: Awaited<ReturnType<typeof interestGroups>>): SetRef[] {
  const all = [...groups.entries()].map(([hash, g]) => ({ hash, ...g, admin: g.uids.includes(OWNER) }));
  if (item === "interests:admin") return all.filter((s) => s.admin);
  if (item === "interests:all") return all;
  const { market } = predParts(item as `p:${SlotMarket}:${Phase}`);
  const part = market === "ius" ? "us" : "vn";
  return all.map((s) => ({ ...s, interests: interestPart(s.interests, part) })).filter((s) => s.interests.length);
}

/**
 * The next unit of each lane, oldest slot first. Marks items that need nothing (already fresh, no sets
 * due), items past their deadline (missed), and slots that are finished, so later ticks skip them cheaply.
 */
export async function nextUnits(now: number): Promise<Record<Lane, Unit | null>> {
  let groups: Awaited<ReturnType<typeof interestGroups>> | null = null;
  const found: Record<Lane, Unit | null> = { pred: null, brief: null };
  for (const occ of openOccurrences(now)) {
    const run = await loadRun(occ);
    if (run.done) continue;
    let dirty = false;
    let open = false;
    for (const item of occ.slot.items) {
      const lane: Lane = isPred(item) ? "pred" : "brief";
      const a = run.items[item];
      if (final(a)) continue;
      if (now >= itemEnd(occ, item)) {
        // Too late: a before-market call after the open, a mid-day call 90 min on, a briefing whose next run started.
        run.items[item] = { at: iso(now), n: MAX_ATTEMPTS, ok: false, note: a ? `gave up: ${a.note ?? "failed"}` : "missed: too late" };
        dirty = true;
        continue;
      }
      if (waiting(a, now) || found[lane]) {
        open = true;
        continue;
      }
      const sets = !isPred(item) ? item.startsWith("interests") : predParts(item).market === "ius" || predParts(item).market === "ivn";
      if (!sets) {
        if (!isPred(item) && fresh(await getJSON(`digest:${item}:en:last`), occ)) {
          run.items[item] = { at: iso(now), n: 0, ok: true, note: "fresh" };
          dirty = true;
          continue;
        }
        found[lane] = { occ, run, item, lane };
        open = true;
        continue;
      }
      // Interest sets: the admin's first, then the stalest (briefings) or in a fixed order (predictions).
      groups ??= await interestGroups();
      let due: SetRef | null = null;
      let dueAt = "";
      let pending = false;
      for (const s of setsFor(item, groups)) {
        const sa = run.sets[setKey(item, s.hash)];
        if (final(sa)) continue;
        if (waiting(sa, now)) {
          pending = true;
          continue;
        }
        let at = s.hash;
        if (!isPred(item)) {
          const last = await getJSON<{ at: string; ok?: boolean; provider?: string }>(`ib:${s.hash}:last`);
          if (fresh(last, occ)) continue;
          at = last?.at ?? "";
        }
        // Briefings: the admin's set, then the sets with the most followers (they use the daily pre-translation budget first), then the stalest.
        const more = !isPred(item) && !!due && s.uids.length !== due.uids.length ? s.uids.length > due.uids.length : null;
        if (!due || (s.admin && !due.admin) || (s.admin === due.admin && (more ?? at < dueAt))) [due, dueAt] = [s, at];
      }
      if (due) {
        found[lane] = { occ, run, item, lane, set: due };
        open = true;
        continue;
      }
      if (pending) {
        open = true;
        continue;
      }
      run.items[item] = { at: iso(now), n: 0, ok: true, note: "no sets due" };
      dirty = true;
    }
    if (!open) run.done = iso(now);
    if (dirty || run.done) await saveRun(occ, run);
  }
  return found;
}

/** The next unit of either lane (tests and tools; the tick picks between lanes by their wait). */
export async function nextUnit(now: number): Promise<Unit | null> {
  const u = await nextUnits(now);
  return u.pred ?? u.brief;
}

async function record(u: Unit, a: Attempt) {
  const run = await loadRun(u.occ); // re-read: a slow unit shouldn't overwrite newer marks
  if (u.set) run.sets[setKey(u.item, u.set.hash)] = a;
  else run.items[u.item] = a;
  await saveRun(u.occ, run);
}

async function runUnit(u: Unit, now: Date): Promise<Attempt> {
  const prev = u.set ? u.run.sets[setKey(u.item, u.set.hash)] : u.run.items[u.item];
  const n = (prev?.n ?? 0) + 1;
  // Counted before it runs: if the function is cut off at its time limit, this stays a failed try
  // (retried once, 20 min later) instead of being re-run, and paid for, on every poke.
  await record(u, { at: now.toISOString(), n, ok: false, note: "started" });
  let ok = false;
  let note: string | undefined;
  try {
    if (isPred(u.item)) {
      const { market, phase } = predParts(u.item);
      const r = await runPrediction({ market, phase, now, set: u.set ? { hash: u.set.hash, interests: u.set.interests, uids: u.set.uids, admin: u.set.admin } : undefined });
      ok = r.ok;
      note = r.note;
      // Vietnam's predictions are pre-translated into Vietnamese (its main readers); others on first read.
      if (ok && market === "vn") await translatePredictions("vn", "vi").catch(() => null);
    } else {
      const d = u.set
        ? await refreshInterestSet(u.set.interests, u.set.lang, u.set.uids, now, u.set.admin ? "adminAuto" : "userAuto")
        : await refreshShared(u.item as SectionId, "en", now, "shared");
      ok = !d.keptAi && d.provider !== "rules";
      note = d.provider;
      // World and US are pre-translated into Vietnamese only (Vietnam is written in Vietnamese); other languages on first read.
      // An interest set is pre-translated into the languages of its followers seen in the last day.
      if (!u.set) {
        if (u.item !== "vn") await translateLatest(u.item as SectionId, "vi").catch(() => null);
      } else if (ok) await pretranslateSet(u.set.hash, u.set.uids).catch(() => []);
    }
  } catch (e) {
    note = (e as Error).message.slice(0, 200);
  }
  const a: Attempt = { at: now.toISOString(), n, ok, note };
  await record(u, a);
  return a;
}

/* ------------------------------------------------------------- grading */

const GRADE_KEY = "sched:graded";
const GRADE_FAIL_KEY = "sched:gradeFail";
/** A failed grading pass is retried after 5, 10, 20, 40 min, then every 55 (the normal hourly rhythm). */
const gradeBackoffMin = (fails: number) => Math.min(55, 5 * 2 ** Math.max(0, fails - 1));

export interface GradeFailure {
  at: string;
  n: number;
  error: string;
  retryAt: string;
}

/**
 * Grade every call store: the shared sections' and each active interest set's. One store failing
 * doesn't stop the others; the errors come back so the tick can record them.
 */
export async function gradeAll(now = new Date()): Promise<{ graded: number; errors: string[] }> {
  const keys = [...Object.values(SHARED_CALLS), ...[...(await interestGroups()).keys()].map((h) => `calls:${h}`)];
  let graded = 0;
  const errors: string[] = [];
  for (const k of keys) {
    try {
      graded += await gradeCalls(now, k);
    } catch (e) {
      errors.push(`${k.slice(0, 14)}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  return { graded, errors };
}

/** Hourly grading with a visible failure: the "graded at" mark only moves after a clean pass. */
async function gradeIfDue(now: Date, out: TickResult) {
  const [last, fail] = await Promise.all([getJSON<{ at: string }>(GRADE_KEY), getJSON<GradeFailure>(GRADE_FAIL_KEY)]);
  const t = now.getTime();
  const due = fail ? t >= new Date(fail.retryAt).getTime() : !last || t - new Date(last.at).getTime() >= 55 * MIN;
  if (!due) return;
  // Marked BEFORE the pass: a pass cut off at the function's time limit writes nothing afterwards, and
  // without this every chained tick would start it again. Success clears it, a failure overwrites it.
  const n = (fail?.n ?? 0) + 1;
  const retryAt = new Date(t + gradeBackoffMin(n) * MIN).toISOString();
  await setJSON(GRADE_FAIL_KEY, { at: now.toISOString(), n, error: "started, not finished", retryAt } satisfies GradeFailure);
  let res: Awaited<ReturnType<typeof gradeAll>>;
  try {
    res = await gradeAll(now);
  } catch (e) {
    res = { graded: 0, errors: [(e as Error).message.slice(0, 120)] };
  }
  out.graded = res.graded;
  if (!res.errors.length) {
    await setJSON(GRADE_KEY, { at: now.toISOString() });
    await delJSON(GRADE_FAIL_KEY);
    return;
  }
  out.gradeError = res.errors[0];
  await setJSON(GRADE_FAIL_KEY, { at: now.toISOString(), n, error: res.errors.join("; ").slice(0, 160), retryAt } satisfies GradeFailure);
}

/* -------------------------------------------------------------- alerts */

const ALERTS_KEY = "sched:alerts";

export function alertsWindow(now: Date): boolean {
  const wd = now.getUTCDay();
  const h = now.getUTCHours();
  return wd >= 1 && wd <= 5 && h >= 13 && h < 22;
}

/** Price and big-move alerts for every user who has alerts on (no AI). */
export async function runAlerts(now = new Date()) {
  const results: Record<string, unknown> = {};
  // Alerts cost no AI, so they reach everyone seen in the last 30 days, not only the last day.
  for (const uid of await activeUsers(30, now)) {
    await withUser(uid, async () => {
      if (!(await loadAlertSettings()).enabled) return;
      const [interests, held] = await Promise.all([loadInterests(), loadHoldings().catch(() => [])]);
      results[uid] = await checkPriceAlerts(withHoldings(interests, held.map((h) => h.symbol))).catch((e) => ({ error: (e as Error).message }));
    });
  }
  return results;
}

/* --------------------------------------------------------------- tick */

export interface TickOptions {
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Call the tick again after a unit (off in tests and without a public URL). */
  chain?: boolean;
}

export interface TickResult {
  busy?: boolean;
  alerts?: number;
  graded?: number;
  /** Grading failed this pass (recorded at `sched:gradeFail`, retried after a short back-off). */
  gradeError?: string;
  headlines?: number;
  unit?: { slot: string; item: SlotItem; set?: string; ok: boolean; note?: string };
  chained?: boolean | string;
}

export async function runTick(opts: TickOptions = {}): Promise<TickResult> {
  const clock = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // A unit can take a few minutes; the lock outlives the function's 300 s limit only by a little.
  const token = await takeLock(LOCK, 310);
  if (!token) return { busy: true };
  const out: TickResult = {};
  try {
    const now = clock();
    if (alertsWindow(now)) {
      const last = await getJSON<{ at: string }>(ALERTS_KEY);
      if (!last || now.getTime() - new Date(last.at).getTime() >= 19 * MIN) {
        await setJSON(ALERTS_KEY, { at: now.toISOString() });
        out.alerts = Object.keys(await runAlerts(now).catch(() => ({}))).length;
      }
    }
    // Grade calls whose session has closed, at most hourly (no AI; prices only when something is due),
    // so results show up within the hour after each market closes, not at the next run.
    await gradeIfDue(now, out).catch((e) => void (out.gradeError = (e as Error).message.slice(0, 120)));
    // Headlines (no AI): shared sections every 15 minutes, active interest sets every 30.
    out.headlines = await refreshHeadlines(now).catch(() => 0);
    const units = await nextUnits(clock().getTime());
    const t0 = clock().getTime();
    const lastOf = async (lane: Lane): Promise<LastUnit> => {
      const v = (await getJSON<number | LastUnit>(`sched:lastUnit:${lane}`)) ?? (await getJSON<number>("sched:lastUnit")) ?? 0;
      return typeof v === "number" ? { at: v, used120: true } : v; // an old-format mark: assume the worst
    };
    const waitOf = async (lane: Lane) => (units[lane] ? Math.max(0, (await lastOf(lane)).at + GAP_MS - t0) : Infinity);
    const [wp, wb] = await Promise.all([waitOf("pred"), waitOf("brief")]);
    if (wp === Infinity && wb === Infinity) return out;
    const lane: Lane = wp <= wb ? "pred" : "brief";
    const u = units[lane]!;
    const end = itemEnd(u.occ, u.item);
    let wait = Math.min(wp, wb);
    // The lane's gap would end after this item's deadline (a before-market run waiting past the open):
    // a try now beats a certain miss. The gap protects Groq's tokens-per-minute on gpt-oss-120b, so when
    // the previous unit on this lane used it, 120b sits out the rest of the gap and the run starts on
    // the route's next model instead of risking a 429 (and a longer 120b cooldown).
    if (wait > 0 && t0 + wait >= end) {
      if ((await lastOf(lane)).used120) await holdOff("groq120", t0 + wait);
      wait = 0;
    }
    if (wait > 0) await sleep(wait);
    const unit = { slot: u.occ.slot.id, item: u.item, set: u.set?.hash.slice(0, 8) };
    if (clock().getTime() >= end) {
      // The wait itself ran past the deadline: don't start a run that can no longer count; record it so the chain ends.
      const prev = u.set ? u.run.sets[setKey(u.item, u.set.hash)] : u.run.items[u.item];
      const note = prev ? `gave up: ${prev.note ?? "failed"}` : "missed: too late";
      await record(u, { at: iso(clock().getTime()), n: MAX_ATTEMPTS, ok: false, note });
      out.unit = { ...unit, ok: false, note };
    } else {
      const startedAt = clock().getTime();
      await setJSON(`sched:lastUnit:${lane}`, { at: startedAt, used120: true } satisfies LastUnit); // until we know (a cut-off run counts as 120b)
      const before = await requests120();
      const a = await runUnit(u, clock());
      await setJSON(`sched:lastUnit:${lane}`, { at: startedAt, used120: (await requests120()) > before } satisfies LastUnit);
      out.unit = { ...unit, ok: a.ok, note: a.note };
    }
  } finally {
    await releaseLock(LOCK, token);
  }
  if (opts.chain && out.unit) out.chained = await chainTick();
  return out;
}

/** Start the next tick. It answers at once (the work runs after the reply), so this is quick. */
async function chainTick(): Promise<boolean | string> {
  const base = appUrl();
  const secret = process.env.CRON_SECRET?.trim() || process.env.TICK_SECRET?.trim();
  if (!base || !secret) return false;
  try {
    const r = await fetch(`${base}/api/cron/tick?src=chain`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(20_000) });
    return r.status === 200 || r.status === 503 ? true : `HTTP ${r.status}`;
  } catch (e) {
    return (e as Error).message.slice(0, 100);
  }
}

/* ------------------------------------------------------------- report */

export type SlotState = "done" | "partial" | "running" | "late" | "missed";

/**
 * When this timetable went live (v18's deploy). Slots before it never existed under their ids, so they
 * aren't reported as late or missed (that would page the watchdog for slots nobody scheduled).
 */
let TIMETABLE_SINCE = Date.parse("2026-11-17T02:50:00Z");
/** Tests only: report slots from an earlier date. */
export const setTimetableSince = (ms: number) => void (TIMETABLE_SINCE = ms);

export interface SlotReport {
  slot: string;
  start: string;
  state: SlotState;
  sets?: { ran: number; ok: number };
  failed?: string[];
}

/**
 * What gets reported (503 window, admin's "Late" list): a slot that is late or missed, and one that
 * finished with an item that failed for good ("partial": a prediction run that failed twice has no
 * rule-based fallback, so it is a missed run and must not pass silently).
 */
const isReportable = (r: SlotReport) => r.state === "late" || r.state === "missed" || r.state === "partial";

function stateOf(o: Occurrence, run: SlotRun | null, now: number): SlotReport {
  const failed = run ? [...Object.entries(run.items), ...Object.entries(run.sets)].filter(([, a]) => a && !a.ok && a.n >= MAX_ATTEMPTS).map(([k]) => k) : [];
  // A run that couldn't start for lack of data ("unavailable: ...", shown on the card) is a data gap, not a missed run.
  const missed = run ? [...Object.entries(run.items), ...Object.entries(run.sets)].filter(([k, a]) => failed.includes(k) && !/^(gave up: )?unavailable/.test(a?.note ?? "")) : [];
  let state: SlotState;
  if (run?.done) state = missed.length ? "partial" : "done";
  else if (now < o.start + LATE_AFTER_MIN * MIN) state = "running";
  else state = now < o.end ? "late" : "missed";
  // Interest sets that ran (no hashes: counts only).
  const sets = run ? Object.values(run.sets) : [];
  return { slot: o.slot.id, start: iso(o.start), state, ...(sets.length ? { sets: { ran: sets.length, ok: sets.filter((a) => a.ok).length } } : {}), ...(failed.length ? { failed: failed.map((f) => f.slice(0, 15)) } : {}) };
}

/**
 * Slots that went late (or had an item fail for good) within the last hour: a tick answers 503 while this isn't empty, so whatever
 * poked it (cron-job.org emails on failure, Vercel and GitHub show a failed run) reports it once or
 * twice, not for hours.
 */
export async function lateNow(now: number): Promise<SlotReport[]> {
  const recent = occurrences(now - 2 * LATE_AFTER_MIN * MIN, now - LATE_AFTER_MIN * MIN).filter((o) => o.start >= TIMETABLE_SINCE);
  const reports = await Promise.all(recent.map(async (o) => stateOf(o, await getJSON<SlotRun>(runKey(o)), now)));
  return reports.filter(isReportable);
}

/** Everything that was due in the last 24 h, for the admin's Status panel and `/api/status?schedule=1`. */
export async function scheduleReport(now = Date.now()) {
  const recent = occurrences(now - 24 * 60 * MIN, now).filter((o) => o.start >= TIMETABLE_SINCE);
  const slots = await Promise.all(recent.map(async (o) => stateOf(o, await getJSON<SlotRun>(runKey(o)), now)));
  const [lastTick, alerts, graded, failing] = await Promise.all([getJSON<{ at: string; src: string }>("sched:tick"), getJSON<{ at: string }>(ALERTS_KEY), getJSON<{ at: string }>(GRADE_KEY), getJSON<GradeFailure>(GRADE_FAIL_KEY)]);
  return {
    lastTick,
    /** The hourly grading pass: when it last finished cleanly, and the failure still being retried, if any. */
    grading: { lastOk: graded?.at ?? null, failing: failing ?? null },
    lastAlerts: alerts?.at ?? null,
    late: slots.filter(isReportable).map((s) => s.slot),
    slots: slots.reverse(),
  };
}

export async function markTick(src: string, now = new Date()) {
  await setJSON("sched:tick", { at: now.toISOString(), src });
}
