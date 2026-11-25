"use client";

/**
 * Everything the page loads per section: the briefing, the live headlines and the predictions, plus
 * the copies derived from the briefing (rule-based variant, translation). One schedule decides what
 * is due (`dueLoads`, pure, pinned by scripts/v19/row03-section-data.ts); `useSectionData` is the
 * adapter that feeds it the clock and the page's visibility and runs the loads.
 *
 * Rules (owner, v19): the first paint loads every section once, so switching tabs is instant and the
 * strip, catch-up and "new" dots have data for all four. After that only the visible tab is kept
 * fresh: headlines and predictions every 5 minutes, the briefing every 10, and all three when the
 * reader comes back after 5+ minutes away. My Interests headlines are also polled every 30 minutes
 * while another tab is showing (owner decision Q11), so its list and new-headline dot stay fresh.
 * A hidden page loads nothing.
 */
import { isStringArray, parseShaped } from "@/lib/ls-shape";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Api } from "@/components/shell/hooks";
import type { PredictionSet } from "@/lib/predictions-view";
import { SECTION_IDS, type Digest, type NewsItem, type SectionId } from "@/lib/types";

export type Digests = Partial<Record<SectionId, Digest | null>>;
export type PredSets = Partial<Record<SectionId, PredictionSet[]>>;
export type LiveNewsMap = Partial<Record<SectionId, { at: string; items: NewsItem[] }>>;

/* ------------------------------------------------------- the schedule */

export const NEWS_EVERY_MS = 5 * 60_000; // headlines and predictions
export const BRIEFING_EVERY_MS = 10 * 60_000;
export const RETURN_AFTER_MS = 5 * 60_000;
/** My Interests headlines while another tab is visible (the server refreshes an open set's list every 30 min). */
export const INTERESTS_BACKGROUND_MS = 30 * 60_000;

export type LoadKind = "digest" | "news" | "predictions";
export type Load = { kind: LoadKind; section: SectionId };
/** When each (kind, section) was last requested, in ms; absent = never. */
export type LastLoaded = Record<LoadKind, Partial<Record<SectionId, number>>>;

/** Failed attempts since the last success: when the latest one was and how many in a row. */
export type Failures = Record<LoadKind, Partial<Record<SectionId, { at: number; n: number }>>>;

const KINDS: LoadKind[] = ["digest", "news", "predictions"];

/** Wait before retrying a failing load: 30 s, 60 s, 2 min, 4 min, then 5 min at most. */
export const retryDelay = (failures: number) => Math.min(30_000 * 2 ** Math.max(0, failures - 1), 5 * 60_000);

/**
 * What to load now. Nothing is due while the page is hidden (a server outage must not make
 * background tabs hammer it; on return the rules below pick everything up). Never-loaded items are
 * due for every section, except a failed one waits out its back-off. Loaded items are due only for
 * the visible tab, plus My Interests headlines every 30 min behind another tab; `hiddenSince` is when
 * the page was hidden, if it just came back.
 */
export function dueLoads(o: { now: number; last: LastLoaded; tab: SectionId; visible: boolean; hiddenSince: number | null; failed?: Failures }): Load[] {
  const { now, last, tab, visible, hiddenSince, failed } = o;
  if (!visible) return [];
  const returned = visible && hiddenSince !== null && now - hiddenSince >= RETURN_AFTER_MS;
  const out: Load[] = [];
  for (const kind of KINDS) {
    for (const section of SECTION_IDS) {
      const at = last[kind][section];
      if (at === undefined) {
        const f = failed?.[kind][section];
        if (!f || now - f.at >= retryDelay(f.n)) out.push({ kind, section });
      } else if (section === tab && (returned || now - at >= (kind === "digest" ? BRIEFING_EVERY_MS : NEWS_EVERY_MS))) out.push({ kind, section });
      else if (kind === "news" && section === "interests" && now - at >= INTERESTS_BACKGROUND_MS) out.push({ kind, section });
    }
  }
  return out;
}

/**
 * Runs one load and records when it was asked for (so a slow answer isn't asked for twice). A load
 * that fails is forgotten and retried after a growing delay (`retryDelay`), reset by a success.
 */
export async function tracked<R>(last: LastLoaded, kind: LoadKind, section: SectionId, now: number, run: () => Promise<R>, failed?: Failures): Promise<R> {
  last[kind][section] = now;
  try {
    const r = await run();
    if (failed) delete failed[kind][section];
    return r;
  } catch (e) {
    delete last[kind][section];
    if (failed) failed[kind][section] = { at: now, n: (failed[kind][section]?.n ?? 0) + 1 };
    throw e;
  }
}

/** The same version again, already in the reader's language, keeps the object the page and translation hold. */
export const keepHeld = (held: Digest | null | undefined, incoming: Digest | null, lang: string) =>
  !!held && !!incoming && held.generatedAt === incoming.generatedAt && held.language === lang;

/** A translation reply is saved only if the reader still wants that language (they may have switched while it ran). */
export const stillWanted = (replyLang: string | undefined, current: string) => replyLang === current;

/* ------------------------------------------------------------ helpers */

/** Identifies one translation attempt (section, language, briefing version, rule-based or not). */
export const translateKey = (tab: SectionId, lang: string, generatedAt: string, rules: boolean) => `${tab}:${lang}:${generatedAt}:${rules ? "rules" : ""}`;

/**
 * Headlines a reader sees for a section: the live list, with titles translated where the briefing's
 * translated copy has the same headline (by id); newer ones show as published. Falls back to the
 * briefing's own list.
 */
export function newsFor(digest: Digest | null | undefined, live?: { at: string; items: NewsItem[] }): { at: string; items: NewsItem[] } | null {
  if (!live?.items.length) return digest ? { at: digest.generatedAt, items: digest.news } : null;
  if (!digest) return live;
  const tr = new Map(digest.news.filter((n) => n.titleOrig).map((n) => [n.id, n]));
  // Items the server already translated (titleOrig set) keep their title.
  return { at: live.at > digest.generatedAt ? live.at : digest.generatedAt, items: live.items.map((n) => (!n.titleOrig && tr.has(n.id) ? { ...n, title: tr.get(n.id)!.title, titleOrig: n.title } : n)) };
}

const lsTry = (fn: () => void) => {
  try {
    fn();
  } catch {}
};

/* ---------------------------------------------------------- the hook */

type Opts = {
  /** Prefs are loaded and no password is being asked for. */
  enabled: boolean;
  api: Api;
  lang: string;
  tab: SectionId;
  /** The reader is looking at an old briefing from History: don't translate it. */
  viewingOld: boolean;
  /** A first load failed (anything but a sign-in/password prompt is the caller's to show). */
  onError: (e: Error) => void;
};

export function useSectionData(o: Opts) {
  const { enabled, api, lang, tab, viewingOld } = o;
  const [digests, setDigests] = useState<Digests>({});
  // The last run couldn't use AI: per section, when (readers may switch to a rule-based copy).
  const [aiFail, setAiFail] = useState<Partial<Record<SectionId, string | null>>>({});
  const [news, setNews] = useState<LiveNewsMap>({});
  const newsSig = useRef<Record<string, string>>({});
  const [preds, setPreds] = useState<PredSets>({});

  const last = useRef<LastLoaded>({ digest: {}, news: {}, predictions: {} });
  const failures = useRef<Failures>({ digest: {}, news: {}, predictions: {} });
  const hiddenSince = useRef<number | null>(null);
  // Async callbacks that outlive a render (answers, timers, listeners) read the latest props here.
  const cur = useRef(o);
  useLayoutEffect(() => {
    cur.current = o;
  });
  // Which briefing version each section last showed: a newer one retires its rule-based copy.
  const seenAt = useRef<Partial<Record<SectionId, string>>>({});
  const timers = useRef(new Set<number>());

  /* ---- loaders: each marks itself loaded when asked, so a slow answer isn't asked for twice */
  const loadDigest = useCallback(async (s: SectionId) => {
    const lang = cur.current.lang;
    // ?lang= lets signed-out visitors read shared sections in their language.
    const j = await tracked(last.current, "digest", s, Date.now(), () => cur.current.api<{ digest: Digest | null; aiFailedAt?: string | null }>(`/api/digest?section=${s}&lang=${lang}`), failures.current);
    const at = j.digest?.generatedAt;
    if (at && seenAt.current[s] && seenAt.current[s] !== at) setRulesDigests((all) => (all[s] === undefined ? all : { ...all, [s]: undefined }));
    if (at) seenAt.current[s] = at;
    setDigests((d) => (keepHeld(d[s], j.digest, lang) ? d : { ...d, [s]: j.digest }));
    setAiFail((a) => (a[s] === (j.aiFailedAt ?? null) ? a : { ...a, [s]: j.aiFailedAt ?? null }));
  }, []);
  const loadNews = useCallback(function loadNews(s: SectionId, retry = 0): Promise<void> {
    return tracked(last.current, "news", s, Date.now(), () => cur.current.api<{ at: string | null; items: NewsItem[]; refreshing?: boolean }>(`/api/news?section=${s}&lang=${cur.current.lang}`), failures.current)
      .then((j) => {
        if (j.at && j.items.length) {
          // Same list version but more titles translated since (the server translates 40 new ones a request): replace it too.
          const sig = `${cur.current.lang}|${j.at}|${j.items.filter((i) => i.titleOrig).length}`;
          setNews((n) => (newsSig.current[s] === sig && n[s] ? n : ((newsSig.current[s] = sig), { ...n, [s]: { at: j.at!, items: j.items } })));
        }
        // My Interests' list was stale (back after a while): the server is fetching it now, ask again soon.
        if (j.refreshing && retry < 3) {
          const id = window.setTimeout(() => {
            timers.current.delete(id);
            void loadNews(s, retry + 1);
          }, 12_000);
          timers.current.add(id);
        }
      })
      .catch(() => {});
  }, []);
  const loadPreds = useCallback(
    (s: SectionId) =>
      tracked(last.current, "predictions", s, Date.now(), () => cur.current.api<{ sets: PredictionSet[] }>(`/api/predictions?section=${s}&lang=${cur.current.lang}`), failures.current)
        .then((j) => setPreds((p) => ({ ...p, [s]: j.sets })))
        .catch(() => setPreds((p) => ({ ...p, [s]: p[s] ?? [] }))),
    [],
  );

  /* ---- the adapter: clock + visibility in, due loads out */
  const evaluate = useCallback(() => {
    if (!cur.current.enabled) return;
    const visible = document.visibilityState !== "hidden";
    const loads = dueLoads({ now: Date.now(), last: last.current, tab: cur.current.tab, visible, hiddenSince: hiddenSince.current, failed: failures.current });
    if (visible) hiddenSince.current = null;
    for (const l of loads) {
      if (l.kind === "digest") {
        const first = last.current.digest[l.section] === undefined;
        loadDigest(l.section).catch((e: Error) => first && cur.current.onError(e));
      } else if (l.kind === "news") void loadNews(l.section);
      else void loadPreds(l.section);
    }
  }, [loadDigest, loadNews, loadPreds]);

  // Password prompt or prefs not ready: forget what was loaded, so everything loads again once allowed.
  useEffect(() => {
    if (!enabled) {
      last.current = { digest: {}, news: {}, predictions: {} };
      failures.current = { digest: {}, news: {}, predictions: {} };
    }
    evaluate();
  }, [enabled, evaluate]);
  // A language change reloads the language-dependent copies (briefings, predictions, headline titles).
  const prevLang = useRef(lang);
  useEffect(() => {
    if (prevLang.current === lang) return;
    prevLang.current = lang;
    last.current.digest = {};
    last.current.predictions = {};
    last.current.news = {};
    evaluate();
  }, [lang, evaluate]);
  // A different tab may hold old data: load it now rather than at the next check.
  useEffect(() => evaluate(), [tab, evaluate]);
  useEffect(() => {
    // Checking twice a minute costs nothing; requests only go out when something is due.
    const id = window.setInterval(evaluate, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenSince.current ??= Date.now();
      else evaluate();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const pending = timers.current;
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
      pending.forEach((t) => window.clearTimeout(t));
      pending.clear();
    };
  }, [evaluate]);

  /* ---- a briefing the server is making in the background (a new set's first one, a catch-up) */
  const pollRef = useRef<number | null>(null);
  const waitForBriefing = useCallback(
    (since?: string) => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      let n = 0;
      const tick = () => {
        n++;
        last.current.digest.interests = Date.now();
        cur.current
          .api<{ digest: Digest | null }>(`/api/digest?section=interests&lang=${cur.current.lang}`)
          .then((j) => {
            setDigests((d) => ({ ...d, interests: j.digest }));
            if (((j.digest && j.digest.generatedAt !== since) || n > 22) && pollRef.current) {
              window.clearInterval(pollRef.current);
              pollRef.current = null;
            }
          })
          .catch(() => {});
      };
      tick();
      pollRef.current = window.setInterval(tick, 8000);
    },
    [],
  );
  useEffect(
    () => () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    },
    [],
  );

  /* ---- the rule-based copy readers can switch to while the AI briefing is behind (`aiFail`).
     The choice is saved per device and only applies while the AI briefing is behind; the copy is
     fetched when needed (the server caches it 15 minutes). */
  const [rulesChosen, setRulesChosen] = useState<Set<SectionId>>(() => new Set());
  const [rulesDigests, setRulesDigests] = useState<Digests>({});
  useEffect(() => {
    lsTry(() => {
      const saved = parseShaped(localStorage.getItem("ih-rules-view"), [] as string[], isStringArray);
      setRulesChosen(new Set(saved.filter((s): s is SectionId => (SECTION_IDS as string[]).includes(s))));
    });
  }, []);
  const isRulesTab = rulesChosen.has(tab) && !!aiFail[tab];
  const loadRules = useCallback(
    (s: SectionId) =>
      api<{ digest: Digest | null }>(`/api/digest?section=${s}&lang=${lang}&variant=rules`)
        .then((j) => setRulesDigests((all) => ({ ...all, [s]: j.digest })))
        .catch(() => {}),
    [api, lang],
  );
  useEffect(() => {
    if (isRulesTab && rulesDigests[tab] === undefined) loadRules(tab);
  }, [isRulesTab, tab, rulesDigests, loadRules]);
  const toggleRules = useCallback(
    (s: SectionId, on: boolean) => {
      setRulesChosen((c) => {
        const next = new Set(c);
        if (on) next.add(s);
        else next.delete(s);
        lsTry(() => localStorage.setItem("ih-rules-view", JSON.stringify([...next])));
        return next;
      });
      if (on) loadRules(s);
    },
    [loadRules],
  );

  /* ---- translate on read: a briefing in another language is translated, not regenerated; the
     server caches each translation per briefing version, so only the first reader of a new one
     costs an AI call. */
  const tried = useRef(new Set<string>());
  const [translatingTab, setTranslatingTab] = useState<SectionId | null>(null);
  const [translateFailed, setTranslateFailed] = useState<Set<string>>(new Set());
  useEffect(() => {
    const rules = isRulesTab && !!rulesDigests[tab];
    const d = rules ? rulesDigests[tab] : digests[tab];
    if (!d || viewingOld || !d.language || d.language === lang) return;
    const k = translateKey(tab, lang, d.generatedAt, rules);
    if (tried.current.has(k)) return;
    tried.current.add(k);
    setTranslatingTab(tab);
    const save = rules ? setRulesDigests : setDigests;
    api<{ digest: Digest | null }>(`/api/translate?section=${tab}&lang=${lang}${rules ? "&variant=rules" : ""}`, { method: "POST" })
      .then((j) => j.digest && stillWanted(j.digest.language, cur.current.lang) && save((all) => ({ ...all, [tab]: j.digest })))
      .catch(() => setTranslateFailed((f) => new Set(f).add(k)))
      .finally(() => setTranslatingTab((x) => (x === tab ? null : x)));
  }, [digests, rulesDigests, isRulesTab, tab, lang, viewingOld, api]);

  /* ---- predictions' notes translated on read, the same way (one translation per prediction version) */
  const triedPreds = useRef(new Set<string>());
  const [translatingPreds, setTranslatingPreds] = useState<SectionId | null>(null);
  useEffect(() => {
    const sets = preds[tab];
    if (!sets?.length || lang === "en" || sets.every((s) => s.language === lang)) return;
    const k = `${tab}:${lang}:${sets.map((s) => `${s.daily?.at}|${s.weekly?.at}`).join(",")}`;
    if (triedPreds.current.has(k)) return;
    triedPreds.current.add(k);
    setTranslatingPreds(tab);
    api<{ sets: PredictionSet[] }>(`/api/translate?section=${tab}&lang=${lang}&kind=predictions`, { method: "POST" })
      .then((j) => j.sets?.length && j.sets.every((x) => stillWanted(x.language, cur.current.lang)) && setPreds((p) => ({ ...p, [tab]: j.sets })))
      .catch(() => {})
      .finally(() => setTranslatingPreds((x) => (x === tab ? null : x)));
  }, [preds, tab, lang, api]);

  /** After a manual refresh: the new briefing replaces any rule-based copy too. */
  const reloadDigest = useCallback(
    (s: SectionId) => {
      setRulesDigests((all) => ({ ...all, [s]: undefined }));
      return loadDigest(s);
    },
    [loadDigest],
  );

  // What the current tab shows: the rule-based copy while the reader has chosen it, else the briefing.
  const rulesView = isRulesTab && !!rulesDigests[tab];
  const active = rulesView ? rulesDigests[tab] : digests[tab];
  const translateFailedNow = !viewingOld && !!active && translateFailed.has(translateKey(tab, lang, active.generatedAt, rulesView));

  return { active, digests, aiFail, liveNews: news, preds, rulesView, toggleRules, translatingTab, translateFailed: translateFailedNow, translatingPreds, reloadDigest, waitForBriefing };
}
