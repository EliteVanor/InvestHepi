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
 * reader comes back after 5+ minutes away. A hidden page loads nothing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
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

export type LoadKind = "digest" | "news" | "predictions";
export type Load = { kind: LoadKind; section: SectionId };
/** When each (kind, section) was last requested, in ms; absent = never. */
export type LastLoaded = Record<LoadKind, Partial<Record<SectionId, number>>>;

const KINDS: LoadKind[] = ["digest", "news", "predictions"];

/**
 * What to load now. Never-loaded items are always due, even in a background tab (a page opened
 * behind others should still paint when shown). Everything else needs a visible page and concerns
 * the visible tab only; `hiddenSince` is when the page was hidden, if it just came back.
 */
export function dueLoads(o: { now: number; last: LastLoaded; tab: SectionId; visible: boolean; hiddenSince: number | null }): Load[] {
  const { now, last, tab, visible, hiddenSince } = o;
  const returned = visible && hiddenSince !== null && now - hiddenSince >= RETURN_AFTER_MS;
  const out: Load[] = [];
  for (const kind of KINDS) {
    for (const section of SECTION_IDS) {
      const at = last[kind][section];
      if (at === undefined) out.push({ kind, section });
      else if (visible && section === tab && (returned || now - at >= (kind === "digest" ? BRIEFING_EVERY_MS : NEWS_EVERY_MS))) out.push({ kind, section });
    }
  }
  return out;
}

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
  return { at: live.at > digest.generatedAt ? live.at : digest.generatedAt, items: live.items.map((n) => (tr.has(n.id) ? { ...n, title: tr.get(n.id)!.title, titleOrig: n.title } : n)) };
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
  const [preds, setPreds] = useState<PredSets>({});

  const last = useRef<LastLoaded>({ digest: {}, news: {}, predictions: {} });
  const hiddenSince = useRef<number | null>(null);
  // The loaders and timers below read the latest props through this, so they never go stale.
  const cur = useRef(o);
  cur.current = o;
  const timers = useRef(new Set<number>());

  /* ---- loaders: each marks itself loaded when asked, so a slow answer isn't asked for twice */
  const loadDigest = useCallback(
    async (s: SectionId) => {
      last.current.digest[s] = Date.now();
      // ?lang= lets signed-out visitors read shared sections in their language.
      const j = await cur.current.api<{ digest: Digest | null; aiFailedAt?: string | null }>(`/api/digest?section=${s}&lang=${cur.current.lang}`);
      // The same version again (already translated here) keeps the object the page and translation hold.
      setDigests((d) => (d[s] && j.digest && d[s]!.generatedAt === j.digest.generatedAt && d[s]!.language === cur.current.lang ? d : { ...d, [s]: j.digest }));
      setAiFail((a) => (a[s] === (j.aiFailedAt ?? null) ? a : { ...a, [s]: j.aiFailedAt ?? null }));
    },
    [],
  );
  const loadNews = useCallback(function loadNews(s: SectionId, retry = 0): Promise<void> {
    last.current.news[s] = Date.now();
    return cur.current
      .api<{ at: string | null; items: NewsItem[]; refreshing?: boolean }>(`/api/news?section=${s}`)
      .then((j) => {
        if (j.at && j.items.length) setNews((n) => (n[s]?.at === j.at ? n : { ...n, [s]: { at: j.at!, items: j.items } }));
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
    (s: SectionId) => {
      last.current.predictions[s] = Date.now();
      return cur.current
        .api<{ sets: PredictionSet[] }>(`/api/predictions?section=${s}&lang=${cur.current.lang}`)
        .then((j) => setPreds((p) => ({ ...p, [s]: j.sets })))
        .catch(() => setPreds((p) => ({ ...p, [s]: p[s] ?? [] })));
    },
    [],
  );

  /* ---- the adapter: clock + visibility in, due loads out */
  const evaluate = useCallback(() => {
    if (!cur.current.enabled) return;
    const visible = document.visibilityState !== "hidden";
    const loads = dueLoads({ now: Date.now(), last: last.current, tab: cur.current.tab, visible, hiddenSince: hiddenSince.current });
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
    if (!enabled) last.current = { digest: {}, news: {}, predictions: {} };
    evaluate();
  }, [enabled, evaluate]);
  // A language change reloads the language-dependent copies (briefings, predictions), not the headlines.
  const prevLang = useRef(lang);
  useEffect(() => {
    if (prevLang.current === lang) return;
    prevLang.current = lang;
    last.current.digest = {};
    last.current.predictions = {};
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
  const [rulesView, setRulesView] = useState<Set<SectionId>>(() => new Set());
  const [rulesDigests, setRulesDigests] = useState<Digests>({});
  useEffect(() => {
    lsTry(() => {
      const saved = JSON.parse(localStorage.getItem("ih-rules-view") ?? "[]") as SectionId[];
      setRulesView(new Set(saved.filter((s) => SECTION_IDS.includes(s))));
    });
  }, []);
  const isRulesTab = rulesView.has(tab) && !!aiFail[tab];
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
      setRulesView((c) => {
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
      .then((j) => j.digest && save((all) => ({ ...all, [tab]: j.digest })))
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
      .then((j) => j.sets?.length && setPreds((p) => ({ ...p, [tab]: j.sets })))
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

  return { digests, aiFail, liveNews: news, preds, rulesDigests, isRulesTab, toggleRules, translatingTab, translateFailed, translatingPreds, reloadDigest, waitForBriefing };
}
