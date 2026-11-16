"use client";

/**
 * The page's state, one concern per hook (page.tsx composes them). Each hook owns its state and
 * the effects that keep it in sync; nothing here renders.
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Account } from "@/components/account";
import type { T } from "@/lib/i18n";
import { SECTION_IDS, type Digest, type SectionId } from "@/lib/types";

export type Api = <R = unknown>(url: string, init?: RequestInit) => Promise<R>;
export type Digests = Partial<Record<SectionId, Digest | null>>;
type SetDigests = Dispatch<SetStateAction<Digests>>;

const TAB_KEY = "ih-tab";

const lsTry = (fn: () => void) => {
  try {
    fn();
  } catch {}
};

/* -------------------------------------------------------------- layout */

/** Which layout fits the viewport. Only the matching one renders, so widgets don't mount (and poll) twice. */
export function useViewport() {
  const [isMobile, setIsMobile] = useState(false); // < 720px: bottom tab bar
  const [isWide, setIsWide] = useState(false); // ≥ 1280px: sidebar + docked Ask AI
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 719px)");
    const wq = window.matchMedia("(min-width: 1280px)");
    const on = () => {
      setIsMobile(mq.matches);
      setIsWide(wq.matches);
    };
    on();
    mq.addEventListener("change", on);
    wq.addEventListener("change", on);
    return () => {
      mq.removeEventListener("change", on);
      wq.removeEventListener("change", on);
    };
  }, []);
  return { isMobile, isWide };
}

/** Wide screens: the sidebar can fold to an icon rail ("[") and the Ask AI dock can hide ("]"), saved per device. */
export function useWideLayout() {
  const [sideRail, setSideRail] = useState(false);
  const [dockOpen, setDockOpen] = useState(true);
  useEffect(() => {
    lsTry(() => {
      setSideRail(localStorage.getItem("ih-side") === "rail");
      setDockOpen(localStorage.getItem("ih-dock") !== "closed");
    });
  }, []);
  const toggleRail = useCallback(() => {
    setSideRail((r) => {
      lsTry(() => localStorage.setItem("ih-side", r ? "open" : "rail"));
      return !r;
    });
  }, []);
  const toggleDock = useCallback((open?: boolean) => {
    setDockOpen((d) => {
      const next = open ?? !d;
      lsTry(() => localStorage.setItem("ih-dock", next ? "open" : "closed"));
      return next;
    });
  }, []);
  return { sideRail, dockOpen, toggleRail, toggleDock };
}

/** The open section, restored from this device and saved on every change. */
export function useSavedTab() {
  const [tab, setTab] = useState<SectionId>("interests");
  useEffect(() => {
    lsTry(() => {
      const saved = localStorage.getItem(TAB_KEY) as SectionId | null;
      if (saved && SECTION_IDS.includes(saved)) setTab(saved);
    });
  }, []);
  useEffect(() => lsTry(() => localStorage.setItem(TAB_KEY, tab)), [tab]);
  return [tab, setTab] as const;
}

/** The tab a visitor chose before on this device, if any. */
export function savedTab(): string | null {
  let saved: string | null = null;
  lsTry(() => (saved = localStorage.getItem(TAB_KEY)));
  return saved;
}

/** iOS-style collapsing title: true once the large title has scrolled under the top bar. */
export function useTitleHidden(ref: RefObject<HTMLElement | null>) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setHidden(!e.isIntersecting), { rootMargin: "-56px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return hidden;
}

/* ----------------------------------------------------------- briefings */

/**
 * The server makes an interest briefing in the background (a new set's first one, or a catch-up for
 * an old one): poll until a version other than `since` shows up (or ~3 minutes pass).
 */
export function useBriefingPoll(api: Api, lang: string, setDigests: SetDigests) {
  const pollRef = useRef<number | null>(null);
  const waitForBriefing = useCallback(
    (since?: string) => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      let n = 0;
      const tick = () => {
        n++;
        api<{ digest: Digest | null }>(`/api/digest?section=interests&lang=${lang}`)
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
    [api, lang, setDigests],
  );
  useEffect(
    () => () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    },
    [],
  );
  return waitForBriefing;
}

/**
 * The rule-based copy readers can switch to while the AI briefing is behind (`aiFail`). The choice is
 * saved per device and only applies while the AI briefing is behind: a newer AI briefing shows again.
 * The copy is fetched when needed (the server caches it 15 minutes).
 */
export function useRulesView(tab: SectionId, aiFail: Partial<Record<SectionId, string | null>>, api: Api, lang: string) {
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
      setRulesView((cur) => {
        const next = new Set(cur);
        if (on) next.add(s);
        else next.delete(s);
        lsTry(() => localStorage.setItem("ih-rules-view", JSON.stringify([...next])));
        return next;
      });
      if (on) loadRules(s);
    },
    [loadRules],
  );
  return { rulesDigests, setRulesDigests, isRulesTab, toggleRules };
}

/** Identifies one translation attempt (section, language, briefing version, rule-based or not). */
export const translateKey = (tab: SectionId, lang: string, generatedAt: string, rules: boolean) => `${tab}:${lang}:${generatedAt}:${rules ? "rules" : ""}`;

/**
 * A briefing written in another language is translated, not regenerated: the server caches each
 * translation per briefing version, so only the first reader of a new briefing costs an AI call.
 */
export function useTranslateOnRead(o: {
  tab: SectionId;
  lang: string;
  api: Api;
  digests: Digests;
  setDigests: SetDigests;
  rulesDigests: Digests;
  setRulesDigests: SetDigests;
  isRulesTab: boolean;
  viewingOld: boolean;
}) {
  const { tab, lang, api, digests, setDigests, rulesDigests, setRulesDigests, isRulesTab, viewingOld } = o;
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
  }, [digests, rulesDigests, isRulesTab, tab, lang, viewingOld, api, setDigests, setRulesDigests]);
  return { translatingTab, translateFailed };
}

/* ----------------------------------------------------------- headlines */

type NewSnap = Partial<Record<SectionId, { at: string; ids: Set<string> }>>;

/**
 * "New" dots. For each briefing version, which headlines the reader hadn't seen when it arrived
 * (a first visit on this device starts with everything read). Viewing a section for 4 seconds
 * marks its headlines seen; the open tab keeps its dots until "mark all read".
 */
export function useNewHeadlines(o: { ready: boolean; seen: Set<string>; markSeen: (ids: string[]) => void; digests: Digests; active: Digest | null | undefined; tab: SectionId }) {
  const { ready, seen, markSeen, digests, active, tab } = o;
  const [newSnap, setNewSnap] = useState<NewSnap>({});
  const firstVisit = useRef<boolean | null>(null);
  useEffect(() => {
    if (ready && firstVisit.current === null) firstVisit.current = seen.size === 0;
  }, [ready, seen]);

  const snapRef = useRef(newSnap);
  snapRef.current = newSnap;
  useEffect(() => {
    const prev = snapRef.current;
    const next = { ...prev };
    const toMark: string[] = [];
    let changed = false;
    for (const s of SECTION_IDS) {
      const d = digests[s];
      if (!d || prev[s]?.at === d.generatedAt) continue;
      const fresh = prev[s] === undefined && firstVisit.current;
      next[s] = { at: d.generatedAt, ids: fresh ? new Set<string>() : new Set(d.news.filter((n) => !seen.has(n.id)).map((n) => n.id)) };
      if (fresh) toMark.push(...d.news.map((n) => n.id));
      changed = true;
    }
    if (changed) setNewSnap(next);
    if (toMark.length) markSeen(toMark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digests]);

  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => markSeen(active.news.map((n) => n.id)), 4000);
    return () => clearTimeout(id);
  }, [active, markSeen]);

  /** Unread count per section (the open tab: what was new when its briefing arrived). */
  const badge = (s: SectionId) => {
    if (s === tab) return newSnap[s]?.ids.size ?? 0;
    const d = digests[s];
    return d ? d.news.filter((n) => !seen.has(n.id)).length : 0;
  };
  const markAllRead = (d: Digest) => {
    markSeen(d.news.map((n) => n.id));
    setNewSnap((p) => ({ ...p, [tab]: { at: d.generatedAt, ids: new Set() } }));
  };
  return { newIds: newSnap[tab]?.ids ?? new Set<string>(), interestsNew: newSnap.interests?.ids.size ?? 0, badge, markAllRead };
}

/* ------------------------------------------------------------- refresh */

export interface RefreshUi {
  busy: boolean;
  disabled: boolean;
  title: string;
  /** Presses left today (users; the admin has no visible count). */
  left?: number;
  run: () => void;
}

/**
 * Who may press Refresh and what the button says. The admin can refresh any section (10 a day);
 * signed-in users only their own My Interests (5 a day, 90 minutes apart, lighter model).
 */
export function refreshState(account: Account, tab: SectionId, t: T, lang: string, now = new Date()) {
  const can = account.admin || (account.mode === "multi" && !!account.user && tab === "interests");
  const quota = account.refresh ?? null;
  const waitUntil = !account.admin && quota?.nextAt && new Date(quota.nextAt) > now ? quota.nextAt : null;
  const blocked = !account.admin && !!quota && (quota.left <= 0 || !!waitUntil);
  const clock = (iso: string) => new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const waitText = waitUntil ? t("refresh.waitUntil", { time: clock(waitUntil) }) : null;
  const limitText = t("refresh.limit", { limit: quota?.limit ?? 5 });
  const title = account.admin
    ? `${t("nav.refresh")} (R)`
    : waitText
      ? waitText
      : quota && quota.left <= 0
        ? t("refresh.limit", { limit: quota.limit })
        : t("refresh.left", { n: quota?.left ?? 0, limit: quota?.limit ?? 0 });
  return { can, quota, blocked, title, waitText, limitText };
}

/* ----------------------------------------------------------- shortcuts */

export interface Shortcuts {
  /** A sheet is open: only Escape and ⌘K pass through. */
  sheetOpen: boolean;
  palette: () => void;
  section: (s: SectionId) => void;
  refresh?: () => void;
  findInNews: () => void;
  track: () => void;
  theme: () => void;
  listen: () => void;
  ask?: () => void;
  catchup: () => void;
  news: () => void;
  rail?: () => void;
  dock?: () => void;
  help: () => void;
}

/** Keyboard shortcuts (listed in Settings → Shortcuts). Always calls the latest handlers. */
export function useShortcuts(h: Shortcuts) {
  const ref = useRef(h);
  ref.current = h;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = ref.current;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        a.palette();
        return;
      }
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return;
      if (a.sheetOpen && e.key !== "Escape") return;
      const k = e.key.toLowerCase();
      if (k >= "1" && k <= String(SECTION_IDS.length) && k.length === 1) a.section(SECTION_IDS[Number(k) - 1]);
      else if (k === "r" && a.refresh) a.refresh();
      else if (k === "/") {
        e.preventDefault();
        a.findInNews();
      } else if (k === "t") a.track();
      else if (k === "d") a.theme();
      else if (k === "l") a.listen();
      else if (k === "a" && a.ask) {
        e.preventDefault();
        a.ask();
      } else if (k === "c") a.catchup();
      else if (k === "n") a.news();
      else if (e.key === "[" && a.rail) a.rail();
      else if (e.key === "]" && a.dock) a.dock();
      else if (e.key === "?") a.help();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
