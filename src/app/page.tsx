"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconGear, IconGlobe, IconFlag, IconRefresh, IconSearch, IconSparkles, IconStar, IconTarget, IconAlert, IconNews, IconSidebar } from "@/components/Icons";
import { PrefsProvider, lsGet, usePrefs } from "@/components/prefs";
import { Briefing, Calls, Events, Headlines, MarketStrip, Movers, StatusPill, UpNext, WatchNext } from "@/components/sections";
import { HistorySheet, PasswordSheet, SettingsSheet, TickerSheet, TrackSheet, type Tab as SettingsTab } from "@/components/sheets";
import { ChartCard, CommandPalette, SectorHeatmap, SetupChecklist, canOverlay, mergeLive, useLiveQuotes, type PaletteActions } from "@/components/v3";
import { CatchUp, MoodGaugeCard, PortfolioCard, ScenariosCard, SinceLastVisit, ToastProvider, Watchlist, useToast } from "@/components/v4";
import { relTime, type MsgKey } from "@/lib/i18n";
import { isLang, langInfo } from "@/lib/languages";
import { SECTION_IDS as ALL_SECTIONS, type CalendarEvent, type Digest, type Holding, type Interest, type Quote, type SectionId } from "@/lib/types";
import { AccountButton, AccountCtx, InterestsGate, SignInCard, SignInSheet, type Account } from "@/components/account";
import { FollowButton, StockSearchSheet, useFollow } from "@/components/search";
import { AskPanel, AskSheet } from "@/components/ask";
import { symLabel } from "@/lib/symbols";
import { SECTION_MACRO, SECTION_STRIPS, type SharedSection } from "@/lib/config";

const SECTION_IDS: SectionId[] = ALL_SECTIONS;
const TAB_KEY = "ih-tab";

export default function Page() {
  return (
    <PrefsProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </PrefsProvider>
  );
}

type Sheet =
  | null
  | { kind: "settings"; tab?: SettingsTab; symbol?: string }
  | { kind: "track" }
  | { kind: "ticker"; symbol: string; back?: "search" }
  | { kind: "search" }
  | { kind: "history" }
  | { kind: "ask"; q?: string }
  | { kind: "catchup" }
  | { kind: "palette" };

function App() {
  const { ready, t, lang, setLang, api, needPassword, seen, markSeen, toggleTheme } = usePrefs();
  const [tab, setTab] = useState<SectionId>("interests");
  const [digests, setDigests] = useState<Partial<Record<SectionId, Digest | null>>>({});
  const [oldDigest, setOldDigest] = useState<{ section: SectionId; key: string; digest: Digest } | null>(null);
  const [calendar, setCalendar] = useState<{ events: CalendarEvent[]; notes: string[] }>({ events: [], notes: [] });
  const [interests, setInterests] = useState<Interest[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  // Guests (VIEWER_PASSWORD) get a read-only view. The server enforces it; this just hides controls.
  const [readOnly, setReadOnly] = useState(false);
  const [account, setAccount] = useState<Account>({ mode: "single", user: null, admin: false });
  const [accountKnown, setAccountKnown] = useState(false);
  // Briefings refresh on a schedule. The admin can force any section (10 a day); signed-in users can
  // refresh their own My Interests (5 a day, 90 minutes apart, on a lighter model).
  const canRefresh = account.admin || (account.mode === "multi" && !!account.user && tab === "interests");
  const quota = account.refresh ?? null;
  const waitUntil = !account.admin && quota?.nextAt && new Date(quota.nextAt) > new Date() ? quota.nextAt : null;
  const refreshBlocked = !account.admin && !!quota && (quota.left <= 0 || !!waitUntil);
  const fmtClock = (iso: string) => new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const refreshTitle = account.admin
    ? `${t("nav.refresh")} (R)`
    : waitUntil
      ? t("refresh.waitUntil", { time: fmtClock(waitUntil) })
      : quota && quota.left <= 0
        ? t("refresh.limit", { limit: quota.limit })
        : t("refresh.left", { n: quota?.left ?? 0, limit: quota?.limit ?? 0 });
  // The last run couldn't use AI: per section, when. Readers may switch to a rule-based copy (saved per device).
  const [aiFail, setAiFail] = useState<Partial<Record<SectionId, string | null>>>({});
  const [rulesView, setRulesView] = useState<Set<SectionId>>(() => new Set());
  const [rulesDigests, setRulesDigests] = useState<Partial<Record<SectionId, Digest | null>>>({});
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("ih-rules-view") ?? "[]") as SectionId[];
      setRulesView(new Set(saved.filter((s) => SECTION_IDS.includes(s))));
    } catch {}
  }, []);
  // Only while the AI briefing is behind: once a newer AI briefing arrives, it shows again.
  const isRulesTab = rulesView.has(tab) && !!aiFail[tab];
  const [signIn, setSignIn] = useState(false);
  useEffect(() => {
    const on = () => setSignIn(true);
    window.addEventListener("ih-signin", on);
    return () => window.removeEventListener("ih-signin", on);
  }, []);
  const [titleHidden, setTitleHidden] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const toast = useToast();
  // iOS-style collapsing title: once the large title scrolls away, the top bar shows the section name.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setTitleHidden(!e.isIntersecting), { rootMargin: "-56px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const [refreshing, setRefreshing] = useState<SectionId | null>(null);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [newSnap, setNewSnap] = useState<Partial<Record<SectionId, { at: string; ids: Set<string> }>>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  // Render only the layout that matches the viewport so widgets don't mount (and poll) twice.
  const [isMobile, setIsMobile] = useState(false);
  // Wide screens: sections and actions in a left sidebar, Ask AI docked on the right.
  const [isWide, setIsWide] = useState(false);
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
  // Wide screens: the sidebar can shrink to an icon rail and the Ask AI dock can hide (saved per device).
  const [sideRail, setSideRail] = useState(false);
  const [dockOpen, setDockOpen] = useState(true);
  useEffect(() => {
    try {
      setSideRail(localStorage.getItem("ih-side") === "rail");
      setDockOpen(localStorage.getItem("ih-dock") !== "closed");
    } catch {}
  }, []);
  const toggleRail = useCallback(() => {
    setSideRail((r) => {
      try {
        localStorage.setItem("ih-side", r ? "open" : "rail");
      } catch {}
      return !r;
    });
  }, []);
  const toggleDock = useCallback((open?: boolean) => {
    setDockOpen((d) => {
      const next = open ?? !d;
      try {
        localStorage.setItem("ih-dock", next ? "open" : "closed");
      } catch {}
      return next;
    });
  }, []);
  // One way to start a question: the docked panel on wide screens (reopened if hidden), the sheet elsewhere.
  const [askReq, setAskReq] = useState<{ q?: string; n: number } | null>(null);
  const openAsk = useCallback(
    (q?: string) => {
      if (isWide) {
        toggleDock(true);
        setAskReq({ q, n: Date.now() });
      } else setSheet({ kind: "ask", q });
    },
    [isWide, toggleDock],
  );
  // The headlines list sits at the end of the page: jump there from the sidebar, the top bar or "N".
  const jumpToNews = useCallback(() => {
    document.getElementById("headlines")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Restore last tab.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY) as SectionId | null;
      if (saved && SECTION_IDS.includes(saved)) setTab(saved);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {}
  }, [tab]);

  const loadDigest = useCallback(
    async (s: SectionId) => {
      // ?lang= lets signed-out visitors read shared sections in their language.
      const j = await api<{ digest: Digest | null; aiFailedAt?: string | null }>(`/api/digest?section=${s}&lang=${lang}`);
      setDigests((d) => ({ ...d, [s]: j.digest }));
      setAiFail((a) => ({ ...a, [s]: j.aiFailedAt ?? null }));
    },
    [api, lang],
  );
  // The server makes an interest briefing in the background (a new set's first one, or a catch-up
  // for an old one): poll until a version other than `since` shows up (or ~3 minutes pass).
  const pollRef = useRef<number | null>(null);
  const waitForBriefing = useCallback((since?: string) => {
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
  }, [api, lang]);
  useEffect(() => () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
  }, []);
  // The calendar follows the tab (shared tabs: their market groups, not personal earnings dates).
  const calTab = useRef<SectionId>("interests");
  const loadCalendar = useCallback(() => api<{ events: CalendarEvent[]; notes: string[] }>(`/api/calendar?section=${calTab.current}`).then(setCalendar).catch(() => {}), [api]);
  const loadInterests = useCallback(() => api<{ interests: Interest[] }>("/api/interests").then((j) => setInterests(j.interests)).catch(() => {}), [api]);

  // Initial load waits for prefs (read state) so "new" dots are computed correctly.
  useEffect(() => {
    if (!ready || needPassword) return;
    Promise.all(SECTION_IDS.map((s) => loadDigest(s))).catch((e) => {
      if (!["401", "signin"].includes((e as Error).message)) setError((e as Error).message);
    });
    loadCalendar();
    loadInterests();
    Promise.all([api<Account>("/api/me").catch(() => null), api<{ role?: "owner" | "viewer" | null }>("/api/status").catch(() => null)]).then(([me, st]) => {
      if (me) setAccount(me);
      setAccountKnown(true);
      if (me?.catchUp) waitForBriefing(me.catchUp);
      // One language per account: a device with no explicit choice adopts the saved one; otherwise the
      // device's choice is saved (it drives alert emails and which translations the scheduler keeps).
      if (me?.user || (me?.mode === "single" && st?.role !== "viewer")) {
        api<{ briefingLanguage: string }>("/api/settings")
          .then((s) => {
            const chosen = lsGet<string | null>("ih-lang", null);
            if (!chosen && isLang(s.briefingLanguage) && s.briefingLanguage !== lang) setLang(s.briefingLanguage);
            else if (s.briefingLanguage !== lang) api("/api/settings", { method: "PUT", body: JSON.stringify({ briefingLanguage: lang }) }).catch(() => {});
          })
          .catch(() => {});
      }
      // Signed-out visitors land on a section they can read (Vietnam for Vietnamese readers), unless
      // they picked a tab before.
      if (me?.mode === "multi" && !me.user) {
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(TAB_KEY);
        } catch {}
        if (!saved || saved === "interests") setTab(lang === "vi" ? "vn" : "world");
      }
      // Multi-user: visitors are read-only until they sign in. Single-user: guest password.
      const viewer = me?.mode === "multi" ? !me.user : st?.role === "viewer";
      setReadOnly(viewer);
      if (!viewer) api<{ holdings: Holding[] }>("/api/portfolio").then((h) => setHoldings(h.holdings)).catch(() => {});
    });
  }, [ready, needPassword, loadDigest, loadCalendar, loadInterests, api]);

  // First visit ever on this device: start with everything read, in every section.
  const firstVisit = useRef<boolean | null>(null);
  useEffect(() => {
    if (ready && firstVisit.current === null) firstVisit.current = seen.size === 0;
  }, [ready, seen]);

  // Snapshot which headlines are new for each digest.
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

  // Viewing a section for a few seconds marks its headlines as seen (dots stay until "mark all read").
  const active = isRulesTab && rulesDigests[tab] ? rulesDigests[tab] : digests[tab];
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => markSeen(active.news.map((n) => n.id)), 4000);
    return () => clearTimeout(id);
  }, [active, markSeen]);

  const badge = (s: SectionId) => {
    if (s === tab) return newSnap[s]?.ids.size ?? 0;
    const d = digests[s];
    if (!d) return 0;
    return d.news.filter((n) => !seen.has(n.id)).length;
  };

  const refresh = useCallback(
    async (s: SectionId) => {
      setRefreshing(s);
      setError("");
      try {
        const r = await api<{ results: { ok: boolean; error?: string; keptAi?: boolean }[]; quota?: Account["refresh"] }>(`/api/refresh?section=${s}&lang=${lang}`, { method: "POST" });
        if (r.quota) setAccount((a) => ({ ...a, refresh: r.quota }));
        const failed = r.results?.find((x) => !x.ok);
        if (failed) setError(failed.error ?? "Refresh failed");
        setOldDigest(null);
        setRulesDigests((all) => ({ ...all, [s]: undefined }));
        await Promise.all([loadDigest(s), loadCalendar()]);
        // Users see how many presses they have left after each one.
        const left = r.quota && !account.admin ? { n: r.quota.left, limit: r.quota.limit } : null;
        if (!failed) toast(r.results?.[0]?.keptAi ? t("refresh.keptAi") + (left ? ` ${t("refresh.left", left)}.` : "") : left ? t("refresh.doneLeft", left) : t("toast.updated"));
      } catch (e) {
        const m = (e as Error).message;
        if (m === "wait") toast(waitUntil ? t("refresh.waitUntil", { time: fmtClock(waitUntil) }) : t("refresh.limit", { limit: quota?.limit ?? 5 }));
        else if (m === "limit") toast(t("refresh.limit", { limit: quota?.limit ?? 5 }));
        else if (!["401", "signin"].includes(m)) setError(m);
      } finally {
        setRefreshing(null);
      }
    },
    [api, loadDigest, loadCalendar, toast, t, lang, account.admin, waitUntil, quota?.limit],
  );

  // Rule-based copy: fetched when a reader switches to it (cached server-side for 15 minutes).
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
        try {
          localStorage.setItem("ih-rules-view", JSON.stringify([...next]));
        } catch {}
        return next;
      });
      if (on) loadRules(s);
    },
    [loadRules],
  );

  // A briefing written in another language is translated (not regenerated): the server caches each
  // translation per briefing version, so only the first reader of a new briefing costs an AI call.
  const tried = useRef(new Set<string>());
  const [translatingTab, setTranslatingTab] = useState<SectionId | null>(null);
  const [translateFailed, setTranslateFailed] = useState<Set<string>>(new Set());
  useEffect(() => {
    const rules = isRulesTab && !!rulesDigests[tab];
    const d = rules ? rulesDigests[tab] : digests[tab];
    if (!d || oldDigest || !d.language || d.language === lang) return;
    const k = `${tab}:${lang}:${d.generatedAt}:${rules ? "rules" : ""}`;
    if (tried.current.has(k)) return;
    tried.current.add(k);
    setTranslatingTab(tab);
    const save = rules ? setRulesDigests : setDigests;
    api<{ digest: Digest | null }>(`/api/translate?section=${tab}&lang=${lang}${rules ? "&variant=rules" : ""}`, { method: "POST" })
      .then((j) => j.digest && save((all) => ({ ...all, [tab]: j.digest })))
      .catch(() => setTranslateFailed((f) => new Set(f).add(k)))
      .finally(() => setTranslatingTab((x) => (x === tab ? null : x)));
  }, [digests, rulesDigests, isRulesTab, tab, lang, oldDigest, api]);

  const pickHistory = async (key: string | null) => {
    setSheet(null);
    if (!key) return setOldDigest(null);
    try {
      const j = await api<{ digest: Digest | null }>(`/api/digest?section=${tab}&at=${key}`);
      if (j.digest) setOldDigest({ section: tab, key, digest: j.digest });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    if (calTab.current === tab) return;
    calTab.current = tab;
    if (ready) loadCalendar();
  }, [tab, ready, loadCalendar]);

  const switchTab = useCallback((s: SectionId) => {
    setTab(s);
    setOldDigest(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSheet((cur) => (cur?.kind === "palette" ? null : { kind: "palette" }));
        return;
      }
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return;
      if (sheet && e.key !== "Escape") return;
      const k = e.key.toLowerCase();
      if (k >= "1" && k <= String(SECTION_IDS.length) && k.length === 1) switchTab(SECTION_IDS[Number(k) - 1]);
      else if (k === "r" && canRefresh) refresh(tab);
      else if (k === "/") {
        e.preventDefault();
        document.getElementById("headlines")?.scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(() => searchRef.current?.focus(), 250);
      } else if (k === "t") setSheet({ kind: "track" });
      else if (k === "d") toggleTheme();
      else if (k === "l") window.dispatchEvent(new Event("ih-listen"));
      else if (k === "a" && !readOnly) {
        e.preventDefault();
        openAsk();
      } else if (k === "c") setSheet({ kind: "catchup" });
      else if (k === "n") jumpToNews();
      else if (e.key === "[" && isWide) toggleRail();
      else if (e.key === "]" && isWide && !readOnly) toggleDock();
      else if (e.key === "?") setSheet({ kind: "settings", tab: "shortcuts" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, tab, refresh, switchTab, toggleTheme, readOnly, canRefresh, openAsk, jumpToNews, isWide, toggleRail, toggleDock]);

  const shown = oldDigest?.section === tab ? oldDigest.digest : active;
  const allDigests = useMemo(() => SECTION_IDS.map((s) => digests[s]).filter((d): d is Digest => !!d), [digests]);
  const quoteFor = (sym: string) => allDigests.flatMap((d) => [...d.quotes, ...(d.macro ?? [])]).find((q) => q.symbol === sym);
  const newIds = newSnap[tab]?.ids ?? new Set<string>();
  // Market tabs show their market's date (Vietnam: Hanoi, US: New York), so the date matches the
  // session pill; My Interests and World use the reader's own date.
  const dateStr = useMemo(() => {
    if (!ready) return "";
    const timeZone = tab === "vn" ? "Asia/Ho_Chi_Minh" : tab === "us" ? "America/New_York" : undefined;
    return new Intl.DateTimeFormat(langInfo(lang).locale, { weekday: "long", month: "long", day: "numeric", timeZone }).format(new Date());
  }, [ready, lang, tab]);
  // Show the skeleton until preferences (and the saved password) are loaded, so nothing renders
  // and fires requests early.
  const loading = !ready || (!needPassword && active === undefined);

  // Strip: My Interests shows the user's tickers; shared sections show their own market groups
  // (from the digest, or from config for digests made before strips existed) and their macro list.
  const stripPlan = useMemo(() => {
    if (!shown) return { groups: [] as { key?: string; symbols: string[] }[], macro: [] as string[] };
    if (tab === "interests") return { groups: [{ symbols: shown.quotes.map((q) => q.symbol) }], macro: (shown.macro ?? []).map((q) => q.symbol) };
    const shared = tab as SharedSection;
    return { groups: shown.strip ?? SECTION_STRIPS[shared], macro: SECTION_MACRO[shared] };
  }, [shown, tab]);
  const stripSymbols = useMemo(() => [...stripPlan.groups.flatMap((g) => g.symbols), ...stripPlan.macro], [stripPlan]);
  const live = useLiveQuotes(stripSymbols, tab === "vn" ? "vn" : tab === "world" ? "world" : "us");
  const liveQuotes = useMemo(() => (shown ? mergeLive(shown.quotes, live) : []), [shown, live]);
  const stripRows = useMemo(() => {
    const known = new Map<string, Quote>();
    for (const q of [...(shown?.quotes ?? []), ...(shown?.macro ?? [])]) known.set(q.symbol, q);
    const resolve = (s: string): Quote | null => {
      const q = known.get(s);
      const l = live.get(s);
      // Live wins (same numbers as the chart sheet), with its intraday path for the sparkline.
      const spark = l?.intraday ? l.spark : undefined;
      const flags = l ? { estimatedVia: l.estimatedVia, dailyOnly: l.dailyOnly, session: l.session } : {};
      if (q) return l && canOverlay(q.proxy, l.proxy) ? { ...q, proxy: l.proxy, price: l.price, prevClose: l.prevClose, changePct: l.changePct, stale: false, spark, ...flags } : q;
      if (l) return { symbol: s, price: l.price, prevClose: l.prevClose, changePct: l.changePct, history: l.intraday ? [] : l.spark.map((c, i) => [String(i), c] as [string, number]), spark, source: "yahoo", proxy: l.proxy, ...flags };
      return null;
    };
    const ok = (q: Quote | null): q is Quote => q != null && Number.isFinite(q.price) && Number.isFinite(q.changePct);
    const pick = (syms: string[]) => syms.map(resolve).filter(ok);
    return { groups: stripPlan.groups.map((g) => ({ key: g.key, quotes: pick(g.symbols) })), macro: pick(stripPlan.macro) };
  }, [shown, live, stripPlan]);
  const chartSymbols = useMemo(() => {
    const bench = interests.map((i) => i.tickers[0]).filter(Boolean);
    const rest = interests.flatMap((i) => i.tickers.slice(1));
    const list = [...new Set([...bench, ...rest])];
    return list.length ? list.slice(0, 14) : ["SPY", "QQQ", "SOXX"];
  }, [interests]);
  const openTicker = useCallback((symbol: string) => setSheet({ kind: "ticker", symbol }), []);
  // Follow/unfollow from search and stock pages. The personal briefing is refreshed once, when the
  // search sheet closes, not on every tap (each refresh of a new interest set is one AI call).
  const followDirty = useRef(false);
  const follow = useFollow(interests, readOnly, (list) => {
    setInterests(list);
    followDirty.current = true;
  });
  const closeSearch = useCallback(() => {
    setSheet(null);
    if (followDirty.current) {
      followDirty.current = false;
      switchTab("interests");
      waitForBriefing();
    }
  }, [waitForBriefing, switchTab]);
  const watchSymbols = useMemo(() => [...new Set([...interests.flatMap((i) => i.tickers), ...holdings.map((h) => h.symbol)])], [interests, holdings]);
  const interestsDigest = digests.interests;
  const interestsLive = useMemo(() => (interestsDigest ? mergeLive(interestsDigest.quotes, live) : []), [interestsDigest, live]);
  const isHome = tab === "interests";
  // Multi-user mode: My Interests is personal, so signed-out visitors get a sign-in invitation there.
  const gated = isHome && account.mode === "multi" && !account.user && accountKnown;
  const paletteActions: PaletteActions = useMemo(
    () => ({
      section: switchTab,
      ticker: openTicker,
      ask: (q?: string) => openAsk(q),
      catchup: () => setSheet({ kind: "catchup" }),
      searchNews: (q: string) => {
        document.getElementById("headlines")?.scrollIntoView({ behavior: "smooth", block: "start" });
        window.dispatchEvent(new CustomEvent("ih-search", { detail: q }));
      },
      refresh: canRefresh ? () => refresh(tab) : undefined,
      theme: toggleTheme,
      track: () => setSheet({ kind: "track" }),
      settings: (tabName?: SettingsTab) => setSheet({ kind: "settings", tab: tabName }),
    }),
    [switchTab, openTicker, refresh, tab, toggleTheme, canRefresh, openAsk],
  );

  return (
    <AccountCtx.Provider value={account}>
      <div className="ambient" data-section={tab} aria-hidden="true">
        <div className="ambient-orb a" />
        <div className="ambient-orb b" />
        <div className="ambient-orb c" />
        <div className="ambient-dots" />
        <div className="ambient-grain" />
      </div>
      {!isWide && (
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <span>{isMobile && titleHidden ? t(`sec.${tab}` as MsgKey) : "InvestHepi"}</span>
          </div>
          <span className="spacer" />
          <nav className="segmented desktop-only" aria-label={t("ui.sections")}>
            {SECTION_IDS.map((s, i) => (
              <button key={s} aria-pressed={tab === s} onClick={() => switchTab(s)} title={`${t(`sec.${s}` as MsgKey)} (${i + 1})`}>
                {t(`sec.${s}` as MsgKey)}
                {badge(s) > 0 && <span className="badge">{badge(s) > 99 ? "99+" : badge(s)}</span>}
              </button>
            ))}
          </nav>
          <span className="spacer desktop-only" />
          <button className="icon-btn" aria-label={t("search.title")} title={t("search.title")} onClick={() => setSheet({ kind: "search" })}>
            <IconSearch />
          </button>
          <button className="icon-btn news-jump" aria-label={t("news.title")} title={`${t("news.title")} (N)`} onClick={jumpToNews} disabled={!shown}>
            <IconNews />
            {newIds.size > 0 && <span className="refresh-left num">{newIds.size > 99 ? "99+" : newIds.size}</span>}
          </button>
          <button className="icon-btn desktop-only cmd-btn" aria-label={t("sc.palette")} title={`${t("sc.palette")} (⌘K)`} onClick={() => setSheet({ kind: "palette" })}>
            <span aria-hidden="true">⌘</span>
          </button>
          <button className="icon-btn" aria-label={t("nav.track")} title={`${t("nav.track")} (T)`} onClick={() => setSheet({ kind: "track" })}>
            <IconTarget />
          </button>
          {readOnly && account.mode !== "multi" && <span className="chip" title={t("ro.hint")}>{t("ro.badge")}</span>}
          {canRefresh && (
            <button className="icon-btn refresh-btn" aria-label={`${t("nav.refresh")}: ${refreshTitle}`} title={refreshTitle} onClick={() => refresh(tab)} disabled={!!refreshing || refreshBlocked}>
              <IconRefresh className={refreshing ? "spin" : ""} />
              {!account.admin && quota && <span className="refresh-left num">{quota.left}</span>}
            </button>
          )}
          <AccountButton />
          <button className="icon-btn" aria-label={t("nav.settings")} title={t("nav.settings")} onClick={() => setSheet({ kind: "settings" })}>
            <IconGear />
          </button>
        </div>
      </header>
      )}

      {refreshing && (
        <div className="progress" role="progressbar" aria-label={t("nav.refreshing")}>
          <i />
        </div>
      )}

      <div className={isWide ? `shell${sideRail ? " rail" : ""}${readOnly || !dockOpen ? " nodock" : ""}` : undefined}>
      {isWide && (
        <aside className={`sidebar${sideRail ? " rail" : ""}`} aria-label={t("ui.sections")}>
          <div className="side-top">
            <div className="brand">
              <span className="brand-mark" aria-hidden="true" />
              <span className="side-label">InvestHepi</span>
            </div>
            <button className="icon-btn side-toggle" onClick={toggleRail} aria-label={sideRail ? t("ui.expand") : t("ui.collapse")} title={`${sideRail ? t("ui.expand") : t("ui.collapse")} ([)`} aria-expanded={!sideRail}>
              <IconSidebar />
            </button>
          </div>
          <nav className="side-nav">
            {SECTION_IDS.map((s, i) => {
              const Icon = s === "interests" ? IconStar : s === "world" ? IconGlobe : s === "vn" ? IconVn : IconFlag;
              return (
                <button key={s} aria-current={tab === s ? "page" : undefined} onClick={() => switchTab(s)} title={`${t(`sec.${s}` as MsgKey)} (${i + 1})`}>
                  <Icon />
                  <span className="side-label">{t(`sec.${s}` as MsgKey)}</span>
                  {badge(s) > 0 && <span className="badge">{badge(s) > 99 ? "99+" : badge(s)}</span>}
                </button>
              );
            })}
            {/* The headlines list is at the end of the page: jump straight to it. */}
            <button className="side-news-btn" onClick={jumpToNews} title={`${t("news.title")} (N)`} disabled={!shown}>
              <IconNews />
              <span className="side-label">{t("news.title")}</span>
              {newIds.size > 0 && <span className="badge">{newIds.size > 99 ? "99+" : newIds.size}</span>}
            </button>
          </nav>
          {!sideRail && shown && shown.news.length > 0 && (
            <div className="side-headlines" aria-label={t("side.top")}>
              <div className="side-caption">{t("side.top")}</div>
              {shown.news.slice(0, 5).map((n) => (
                <a key={n.id} href={n.link} target="_blank" rel="noreferrer" title={n.titleOrig ?? n.title} className={newIds.has(n.id) ? "is-new" : undefined}>
                  <span className="side-hl-title">{n.title}</span>
                  <small>{n.source} · {relTime(n.publishedAt, lang)}</small>
                </a>
              ))}
              <button className="side-more" onClick={jumpToNews}>{t("side.allNews", { n: shown.news.length })}</button>
            </div>
          )}
          <div className="side-actions">
            <button onClick={() => setSheet({ kind: "search" })} title={t("search.title")}>
              <IconSearch />
              <span className="side-label">{t("search.title")}</span>
            </button>
            <button onClick={() => setSheet({ kind: "palette" })} title={`${t("sc.palette")} (⌘K)`}>
              <span className="side-kbd" aria-hidden="true">⌘</span>
              <span className="side-label">{t("sc.palette")}</span>
              <kbd className="side-label">⌘K</kbd>
            </button>
            <button onClick={() => setSheet({ kind: "track" })} title={`${t("nav.track")} (T)`}>
              <IconTarget />
              <span className="side-label">{t("nav.track")}</span>
              <kbd className="side-label">T</kbd>
            </button>
            {canRefresh && (
              <button className="refresh-btn" onClick={() => refresh(tab)} disabled={!!refreshing || refreshBlocked} title={refreshTitle}>
                <IconRefresh className={refreshing ? "spin" : ""} />
                <span className="side-label">{t("nav.refresh")}</span>
                {!account.admin && quota && <span className="badge">{quota.left}</span>}
              </button>
            )}
          </div>
          <span className="spacer" />
          <div className="side-foot">
            {readOnly && account.mode !== "multi" && !sideRail && <span className="chip" title={t("ro.hint")}>{t("ro.badge")}</span>}
            <AccountButton />
            <button className="icon-btn" aria-label={t("nav.settings")} title={t("nav.settings")} onClick={() => setSheet({ kind: "settings" })}>
              <IconGear />
            </button>
          </div>
        </aside>
      )}
      <main className="page">
        <div className="page-head">
          <div className="page-title">
            <div className="eyebrow" suppressHydrationWarning>{dateStr}</div>
            <h1 className="large-title" ref={titleRef}>{t(`sec.${tab}` as MsgKey)}</h1>
          </div>
          {/* World spans many exchanges with different hours, so there's no single open/closed. */}
          {tab !== "world" && <StatusPill market={tab === "vn" ? "vn" : "us"} />}
        </div>

        {shown && !gated && <MarketStrip groups={stripRows.groups} macro={stripRows.macro} onOpen={openTicker} />}
        {isHome && !gated && !readOnly && (
          <button className="ss-bar" onClick={() => setSheet({ kind: "search" })}>
            <IconSearch />
            <span>{t("search.placeholder")}</span>
          </button>
        )}

        {error && (
          <div className="banner">
            <IconAlert />
            <span style={{ wordBreak: "break-word" }}>{error}</span>
            <button onClick={() => setError("")}>✕</button>
          </div>
        )}
        {shown?.providerNote && !oldDigest && (
          <div className="banner">
            <IconAlert />
            <span style={{ wordBreak: "break-word" }}>{shown.providerNote}</span>
          </div>
        )}

        {loading ? (
          <Skeleton />
        ) : gated ? (
          <InterestsGate onBrowse={() => switchTab(lang === "vi" ? "vn" : "world")} />
        ) : !shown ? (
          !canRefresh ? (
            <div className="card empty">
              <div className="empty-orb" />
              <h2>{t("empty.waitTitle")}</h2>
              <p>{t("empty.waitBody")}</p>
            </div>
          ) : (
            <div className="card empty">
              <div className="empty-orb" />
              <h2>{t("empty.title")}</h2>
              <p>{t("empty.body")}</p>
              <button className="btn-primary" onClick={() => refresh(tab)} disabled={!!refreshing}>
                {refreshing ? t("empty.working") : t("empty.cta")}
              </button>
              {/* Setup steps are for whoever runs the app, not for every signed-in user. */}
              {(account.mode !== "multi" || account.admin) && <SetupChecklist />}
            </div>
          )
        ) : (
          <>
            {interestsDigest && (
              <div style={{ display: isHome && !oldDigest ? undefined : "none" }}>
                <SinceLastVisit digest={interestsDigest} quotes={interestsLive} newCount={newSnap.interests?.ids.size ?? 0} onTicker={openTicker} />
              </div>
            )}
            <Briefing digest={shown} translating={translatingTab === tab} translateFailed={translateFailed.has(`${tab}:${lang}:${shown.generatedAt}:${isRulesTab && rulesDigests[tab] ? "rules" : ""}`)} aiFailedAt={oldDigest ? null : (aiFail[tab] ?? null)} rulesView={isRulesTab && !!rulesDigests[tab]} onToggleRules={(on) => toggleRules(tab, on)} viewingOld={!!oldDigest} onBackToLatest={() => setOldDigest(null)} onHistory={() => setSheet({ kind: "history" })} onCatchUp={() => setSheet({ kind: "catchup" })} />
            <Calls outlook={shown.analysis.outlook} onTicker={openTicker} />
            <ScenariosCard scenarios={shown.analysis.scenarios} />
            {isHome && <ChartCard symbols={chartSymbols} quotes={liveQuotes} onOpen={openTicker} />}
            {isHome && <Watchlist symbols={watchSymbols} quotes={liveQuotes} technicals={shown.technicals} outlook={shown.analysis.outlook} onOpen={openTicker} />}
            <div className="grid">
              <div>
                {isMobile && (
                  <>
                    <MoodGaugeCard gauge={shown.gauge} />
                    {isHome && !readOnly && <PortfolioCard holdings={holdings} onEdit={() => setSheet({ kind: "settings", tab: "holdings" })} onOpen={openTicker} />}
                {isHome && readOnly && account.mode === "multi" && <SignInCard />}
                    <Movers movers={shown.analysis.movers} quotes={liveQuotes} onTicker={openTicker} />
                    {(tab === "us" || tab === "interests") && <SectorHeatmap sectors={shown.sectors} onOpen={openTicker} />}
                  </>
                )}
                <Events events={shown.analysis.events} news={shown.news} />
                {isMobile && (
                  <>
                    <UpNext events={calendar.events} notes={calendar.notes} timeZone={tab === "vn" ? "Asia/Ho_Chi_Minh" : "America/New_York"} />
                    <WatchNext items={shown.analysis.watchNext} />
                  </>
                )}
                <Headlines
                  digest={shown}
                  interests={interests}
                  newIds={newIds}
                  searchRef={searchRef}
                  onExplain={readOnly ? undefined : (title) => openAsk(t("ask.explain", { title }))}
                  onMarkRead={() => {
                    markSeen(shown.news.map((n) => n.id));
                    setNewSnap((p) => ({ ...p, [tab]: { at: shown.generatedAt, ids: new Set() } }));
                  }}
                />
              </div>
              {!isMobile && (
              <aside className="rail">
                <MoodGaugeCard gauge={shown.gauge} />
                {isHome && !readOnly && <PortfolioCard holdings={holdings} onEdit={() => setSheet({ kind: "settings", tab: "holdings" })} onOpen={openTicker} />}
                {isHome && readOnly && account.mode === "multi" && <SignInCard />}
                <Movers movers={shown.analysis.movers} quotes={liveQuotes} onTicker={openTicker} />
                {(tab === "us" || tab === "interests") && <SectorHeatmap sectors={shown.sectors} onOpen={openTicker} />}
                <UpNext events={calendar.events} notes={calendar.notes} timeZone={tab === "vn" ? "Asia/Ho_Chi_Minh" : "America/New_York"} />
                <WatchNext items={shown.analysis.watchNext} />
              </aside>
              )}
            </div>
          </>
        )}

        <footer className="foot">
          {t("foot.disclaimer")}
          <br />
          <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
            {t("foot.charts")}
          </a>
          {" · "}
          <a href="/privacy" style={{ color: "inherit" }}>{t("foot.privacy")}</a>
          {" · "}
          <a href="/terms" style={{ color: "inherit" }}>{t("foot.terms")}</a>
        </footer>
      </main>
      {isWide && !readOnly && dockOpen && (
        <aside className="chat-dock">
          <AskPanel docked digest={shown} calendar={calendar.events} section={tab} request={askReq} onClose={() => toggleDock(false)} closeLabel={`${t("ui.hideChat")} (])`} />
        </aside>
      )}
      </div>

      <nav className="tabbar" role="tablist" aria-label={t("ui.sections")}>
        {SECTION_IDS.map((s) => {
          const Icon = s === "interests" ? IconStar : s === "world" ? IconGlobe : s === "vn" ? IconVn : IconFlag;
          return (
            <button key={s} role="tab" aria-selected={tab === s} onClick={() => switchTab(s)}>
              <Icon />
              <span>{t(`sec.${s}` as MsgKey)}</span>
              {badge(s) > 0 && <span className="badge">{badge(s) > 99 ? "99+" : badge(s)}</span>}
            </button>
          );
        })}
        {readOnly ? (
          <button role="tab" aria-selected={sheet?.kind === "track"} onClick={() => setSheet({ kind: "track" })}>
            <IconTarget />
            <span>{t("nav.track")}</span>
          </button>
        ) : (
          <button role="tab" aria-selected={sheet?.kind === "ask"} onClick={() => openAsk()}>
            <IconSparkles />
            <span>{t("ask.title")}</span>
          </button>
        )}
      </nav>

      {!readOnly && (!isWide || !dockOpen) && (
        <button className="ask-fab" onClick={() => openAsk()} aria-label={t("ask.title")} title={isWide ? `${t("ui.showChat")} (])` : undefined}>
          <IconSparkles /> <span className="fab-text">{t("ask.title")}</span> <kbd>A</kbd>
        </button>
      )}

      {needPassword && account.mode !== "multi" && <PasswordSheet />}
      {signIn && <SignInSheet onClose={() => setSignIn(false)} />}
      {sheet?.kind === "settings" && (
        <SettingsSheet
          readOnly={readOnly}
          initialTab={sheet.tab}
          prefillSymbol={sheet.symbol}
          onClose={() => setSheet(null)}
          onInterestsSaved={() => {
            setSheet(null);
            switchTab("interests");
            loadInterests();
            waitForBriefing();
          }}
          onHoldingsSaved={setHoldings}
        />
      )}
      {sheet?.kind === "track" && <TrackSheet onClose={() => setSheet(null)} section={tab} />}
      {sheet?.kind === "history" && <HistorySheet section={tab} current={oldDigest?.key ?? null} onPick={pickHistory} onClose={() => setSheet(null)} />}
      {sheet?.kind === "ticker" && (
        <TickerSheet
          symbol={sheet.symbol}
          quote={quoteFor(sheet.symbol)}
          digests={allDigests}
          onClose={() => (sheet.back === "search" ? setSheet({ kind: "search" }) : followDirty.current ? closeSearch() : setSheet(null))}
          onAlert={readOnly ? undefined : (symbol) => setSheet({ kind: "settings", tab: "alerts", symbol })}
          action={<FollowButton symbol={sheet.symbol} name={symLabel(sheet.symbol)} region={sheet.symbol.endsWith(".VN") ? "vn" : "intl"} type={sheet.symbol.startsWith("^") ? "INDEX" : undefined} follow={follow} label />}
        />
      )}
      {sheet?.kind === "search" && <StockSearchSheet onClose={closeSearch} onOpen={(symbol) => setSheet({ kind: "ticker", symbol, back: "search" })} follow={follow} readOnly={readOnly} />}
      {sheet?.kind === "ask" && <AskSheet onClose={() => setSheet(null)} initial={sheet.q} digest={shown} calendar={calendar.events} section={tab} />}
      {sheet?.kind === "catchup" && shown && (
        <CatchUp digest={shown} calendar={calendar.events} onClose={() => setSheet(null)} onAsk={() => { setSheet(null); openAsk(); }} />
      )}
      {sheet?.kind === "palette" && <CommandPalette onClose={() => setSheet(null)} tickers={chartSymbols} actions={paletteActions} readOnly={readOnly} />}
    </AccountCtx.Provider>
  );
}

function IconVn(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m12 8.6 1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z" />
    </svg>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true">
      <div className="card hero">
        <div className="skeleton" style={{ height: 22, width: 120 }} />
        <div className="skeleton" style={{ height: 34, width: "80%", margin: "16px 0" }} />
        <div className="skeleton" style={{ height: 16, width: "95%", marginBottom: 10 }} />
        <div className="skeleton" style={{ height: 16, width: "88%", marginBottom: 10 }} />
        <div className="skeleton" style={{ height: 16, width: "70%" }} />
      </div>
      <div className="card">
        <div className="calls">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 150 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
