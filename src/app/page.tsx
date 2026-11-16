"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconGear, IconGlobe, IconFlag, IconRefresh, IconSearch, IconSparkles, IconStar, IconTarget, IconAlert } from "@/components/Icons";
import { PrefsProvider, lsGet, usePrefs } from "@/components/prefs";
import { Briefing, Calls, Events, Headlines, MarketStrip, Movers, StatusPill, UpNext, WatchNext } from "@/components/sections";
import { HistorySheet, PasswordSheet, SettingsSheet, TickerSheet, TrackSheet, type Tab as SettingsTab } from "@/components/sheets";
import { AskSheet, ChartCard, CommandPalette, SectorHeatmap, SetupChecklist, mergeLive, useLiveQuotes, type PaletteActions } from "@/components/v3";
import { CatchUp, MoodGaugeCard, PortfolioCard, ScenariosCard, SinceLastVisit, ToastProvider, Watchlist, useToast } from "@/components/v4";
import type { MsgKey } from "@/lib/i18n";
import { isLang, langInfo } from "@/lib/languages";
import { SECTION_IDS as ALL_SECTIONS, type CalendarEvent, type Digest, type Holding, type Interest, type Quote, type SectionId } from "@/lib/types";
import { AccountButton, AccountCtx, InterestsGate, SignInCard, SignInSheet, type Account } from "@/components/account";
import { FollowButton, StockSearchSheet, useFollow } from "@/components/search";
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
  // Briefings refresh on a schedule; only the admin (the single-user owner, or OWNER_EMAIL) can force one.
  const canRefresh = account.admin;
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
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 719px)");
    const on = () => setIsMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
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
      const j = await api<{ digest: Digest | null }>(`/api/digest?section=${s}&lang=${lang}`);
      setDigests((d) => ({ ...d, [s]: j.digest }));
    },
    [api, lang],
  );
  // After interests change, the server makes the new set's first briefing in the background; poll
  // until it shows up (or ~3 minutes pass). Another user with the same interests means it's instant.
  const pollRef = useRef<number | null>(null);
  const waitForBriefing = useCallback(() => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    let n = 0;
    const tick = () => {
      n++;
      api<{ digest: Digest | null }>(`/api/digest?section=interests&lang=${lang}`)
        .then((j) => {
          setDigests((d) => ({ ...d, interests: j.digest }));
          if ((j.digest || n > 22) && pollRef.current) {
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
  const loadCalendar = useCallback(() => api<{ events: CalendarEvent[]; notes: string[] }>("/api/calendar").then(setCalendar).catch(() => {}), [api]);
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
  const active = digests[tab];
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
        const r = await api<{ results: { ok: boolean; error?: string }[] }>(`/api/refresh?section=${s}&lang=${lang}`, { method: "POST" });
        const failed = r.results?.find((x) => !x.ok);
        if (failed) setError(failed.error ?? "Refresh failed");
        setOldDigest(null);
        await Promise.all([loadDigest(s), loadCalendar()]);
        if (!failed) toast(t("toast.updated"));
      } catch (e) {
        if (!["401", "signin"].includes((e as Error).message)) setError((e as Error).message);
      } finally {
        setRefreshing(null);
      }
    },
    [api, loadDigest, loadCalendar, toast, t, lang],
  );

  // A briefing written in another language is translated (not regenerated): the server caches each
  // translation per briefing version, so only the first reader of a new briefing costs an AI call.
  const tried = useRef(new Set<string>());
  const [translatingTab, setTranslatingTab] = useState<SectionId | null>(null);
  useEffect(() => {
    const d = digests[tab];
    if (!d || oldDigest || d.provider === "rules" || !d.language || d.language === lang) return;
    const k = `${tab}:${lang}:${d.generatedAt}`;
    if (tried.current.has(k)) return;
    tried.current.add(k);
    setTranslatingTab(tab);
    api<{ digest: Digest | null }>(`/api/translate?section=${tab}&lang=${lang}`, { method: "POST" })
      .then((j) => j.digest && setDigests((all) => ({ ...all, [tab]: j.digest })))
      .catch(() => {})
      .finally(() => setTranslatingTab((x) => (x === tab ? null : x)));
  }, [digests, tab, lang, oldDigest, api]);

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
        setSheet({ kind: "ask" });
      } else if (k === "c") setSheet({ kind: "catchup" });
      else if (e.key === "?") setSheet({ kind: "settings", tab: "shortcuts" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, tab, refresh, switchTab, toggleTheme, readOnly, canRefresh]);

  const shown = oldDigest?.section === tab ? oldDigest.digest : active;
  const allDigests = useMemo(() => SECTION_IDS.map((s) => digests[s]).filter((d): d is Digest => !!d), [digests]);
  const quoteFor = (sym: string) => allDigests.flatMap((d) => [...d.quotes, ...(d.macro ?? [])]).find((q) => q.symbol === sym);
  const newIds = newSnap[tab]?.ids ?? new Set<string>();
  const dateStr = useMemo(
    () => (ready ? new Intl.DateTimeFormat(langInfo(lang).locale, { weekday: "long", month: "long", day: "numeric" }).format(new Date()) : ""),
    [ready, lang],
  );
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
      if (q) return l && (l.proxy ?? "") === (q.proxy ?? "") ? { ...q, price: l.price, prevClose: l.prevClose, changePct: l.changePct, stale: false } : q;
      if (l) return { symbol: s, price: l.price, prevClose: l.prevClose, changePct: l.changePct, history: l.spark.map((c, i) => [String(i), c] as [string, number]), source: "yahoo", proxy: l.proxy };
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
      ask: (q?: string) => setSheet({ kind: "ask", q }),
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
    [switchTab, openTicker, refresh, tab, toggleTheme, canRefresh],
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
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <span>{isMobile && titleHidden ? t(`sec.${tab}` as MsgKey) : "InvestHepi"}</span>
          </div>
          <span className="spacer" />
          <nav className="segmented desktop-only" aria-label="Sections">
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
          <button className="icon-btn desktop-only cmd-btn" aria-label={t("sc.palette")} title={`${t("sc.palette")} (⌘K)`} onClick={() => setSheet({ kind: "palette" })}>
            <span aria-hidden="true">⌘</span>
          </button>
          <button className="icon-btn" aria-label={t("nav.track")} title={`${t("nav.track")} (T)`} onClick={() => setSheet({ kind: "track" })}>
            <IconTarget />
          </button>
          {readOnly && account.mode !== "multi" && <span className="chip" title={t("ro.hint")}>{t("ro.badge")}</span>}
          {canRefresh && (
            <button className="icon-btn" aria-label={t("nav.refresh")} title={`${t("nav.refresh")} (R)`} onClick={() => refresh(tab)} disabled={!!refreshing}>
            <IconRefresh className={refreshing ? "spin" : ""} />
          </button>
          )}
          <AccountButton />
          <button className="icon-btn" aria-label={t("nav.settings")} title={t("nav.settings")} onClick={() => setSheet({ kind: "settings" })}>
            <IconGear />
          </button>
        </div>
      </header>

      {refreshing && (
        <div className="progress" role="progressbar" aria-label={t("nav.refreshing")}>
          <i />
        </div>
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
            <Briefing digest={shown} translating={translatingTab === tab} viewingOld={!!oldDigest} onBackToLatest={() => setOldDigest(null)} onHistory={() => setSheet({ kind: "history" })} onCatchUp={() => setSheet({ kind: "catchup" })} />
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
                    <UpNext events={calendar.events} notes={calendar.notes} />
                    <WatchNext items={shown.analysis.watchNext} />
                  </>
                )}
                <Headlines
                  digest={shown}
                  interests={interests}
                  newIds={newIds}
                  searchRef={searchRef}
                  onExplain={readOnly ? undefined : (title) => setSheet({ kind: "ask", q: t("ask.explain", { title }) })}
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
                <UpNext events={calendar.events} notes={calendar.notes} />
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

      <nav className="tabbar" role="tablist" aria-label="Sections">
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
          <button role="tab" aria-selected={sheet?.kind === "ask"} onClick={() => setSheet({ kind: "ask" })}>
            <IconSparkles />
            <span>{t("ask.title")}</span>
          </button>
        )}
      </nav>

      {!readOnly && (
        <button className="ask-fab" onClick={() => setSheet({ kind: "ask" })} aria-label={t("ask.title")}>
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
      {sheet?.kind === "ask" && <AskSheet onClose={() => setSheet(null)} tickers={chartSymbols} initial={sheet.q} />}
      {sheet?.kind === "catchup" && shown && (
        <CatchUp digest={shown} calendar={calendar.events} onClose={() => setSheet(null)} onAsk={() => setSheet({ kind: "ask" })} />
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
