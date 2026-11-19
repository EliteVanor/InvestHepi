"use client";

/**
 * The page's state, one concern per hook (page.tsx composes them). Each hook owns its state and
 * the effects that keep it in sync; nothing here renders.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Account } from "@/components/account";
import type { T } from "@/lib/i18n";
import { SECTION_IDS, type Digest, type NewsItem, type SectionId } from "@/lib/types";

export type Api = <R = unknown>(url: string, init?: RequestInit) => Promise<R>;

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

/* ----------------------------------------------------------- headlines */

type NewSnap = Partial<Record<SectionId, { at: string; ids: Set<string> }>>;
/** A headline list and its version (the live list's refresh time, or the briefing's). */
export type NewsList = { at: string; items: NewsItem[] };

/**
 * "New" dots. For each version of a section's headline list, which headlines the reader hadn't seen
 * when it arrived (a first visit on this device starts with everything read). Viewing a section for 4
 * seconds marks its headlines seen; the open tab keeps its dots until "mark all read".
 */
export function useNewHeadlines(o: { ready: boolean; seen: Set<string>; markSeen: (ids: string[]) => void; lists: Partial<Record<SectionId, NewsList | null>>; active: NewsList | null | undefined; tab: SectionId }) {
  const { ready, seen, markSeen, lists, active, tab } = o;
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
      const d = lists[s];
      if (!d || prev[s]?.at === d.at) continue;
      const fresh = prev[s] === undefined && firstVisit.current;
      next[s] = { at: d.at, ids: fresh ? new Set<string>() : new Set(d.items.filter((n) => !seen.has(n.id)).map((n) => n.id)) };
      if (fresh) toMark.push(...d.items.map((n) => n.id));
      changed = true;
    }
    if (changed) setNewSnap(next);
    if (toMark.length) markSeen(toMark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists]);

  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => markSeen(active.items.map((n) => n.id)), 4000);
    return () => clearTimeout(id);
  }, [active, markSeen]);

  /** Unread count per section (the open tab: what was new when its list arrived). */
  const badge = (s: SectionId) => {
    if (s === tab) return newSnap[s]?.ids.size ?? 0;
    const d = lists[s];
    return d ? d.items.filter((n) => !seen.has(n.id)).length : 0;
  };
  const markAllRead = (d: NewsList) => {
    markSeen(d.items.map((n) => n.id));
    setNewSnap((p) => ({ ...p, [tab]: { at: d.at, ids: new Set() } }));
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
export function refreshState(account: Account, tab: SectionId, t: T, lang: string, now = new Date(), tz?: string) {
  const can = account.admin || (account.mode === "multi" && !!account.user && tab === "interests");
  const quota = account.refresh ?? null;
  const waitUntil = !account.admin && quota?.nextAt && new Date(quota.nextAt) > now ? quota.nextAt : null;
  const blocked = !account.admin && !!quota && (quota.left <= 0 || !!waitUntil);
  const clock = (iso: string) => new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(iso));
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
