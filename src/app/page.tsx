"use client";

/**
 * The single page. State lives in hooks (components/shell/hooks.ts), the frame (top bar, sidebar,
 * tab bar) in components/shell/chrome.tsx; this file loads data, wires actions, and lays out the
 * section's content.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccountCtx, InterestsGate, SignInCard, SignInSheet, type Account } from "@/components/account";
import { AskPanel, AskSheet } from "@/components/ask";
import { ChartCard, MoodGaugeCard, ScenariosCard, SectorHeatmap } from "@/components/cards";
import { CatchUp, SinceLastVisit } from "@/components/catchup";
import { IconAlert, IconPanelRight, IconSearch, IconSparkles } from "@/components/Icons";
import { mergeLive, useLiveQuotes } from "@/components/live";
import { CommandPalette, type PaletteActions } from "@/components/palette";
import { PortfolioCard, Watchlist } from "@/components/portfolio";
import { PrefsProvider, lsGet, usePrefs } from "@/components/prefs";
import { FollowButton, StockSearchSheet, useFollow } from "@/components/search";
import { Briefing, Events, Headlines, MarketStrip, Movers, StatusPill, UpNext, WatchNext } from "@/components/sections";
import { PredictionsCard } from "@/components/predictions";
import { callsOf } from "@/lib/predictions-view";
import { SetupChecklist } from "@/components/setup";
import { HistorySheet, PasswordSheet, SettingsSheet, TickerSheet, type Tab as SettingsTab } from "@/components/sheets";
import { TrackSheet } from "@/components/track";
import { Ambient, Footer, Sidebar, Skeleton, TabBar, TopBar, sectionName, type FrameActions } from "@/components/shell/chrome";
import {
  refreshState,
  savedTab,
  translateKey,
  useBriefingPoll,
  newsFor,
  useLiveNews,
  useNewHeadlines,
  usePredictions,
  useRulesView,
  useSavedTab,
  useShortcuts,
  useTitleHidden,
  useTranslateOnRead,
  useViewport,
  useWideLayout,
  type Digests,
  type RefreshUi,
} from "@/components/shell/hooks";
import { chartSymbols as chartSymbolsFor, planSymbols, stripPlan, stripRows as buildStripRows } from "@/components/shell/strip";
import { ToastProvider, useToast } from "@/components/toast";
import { isLang, langInfo } from "@/lib/languages";
import { symLabel } from "@/lib/symbols";
import { SECTION_IDS, type CalendarEvent, type Digest, type Holding, type Interest, type SectionId } from "@/lib/types";

export default function Page() {
  return (
    <PrefsProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </PrefsProvider>
  );
}

/** At most one sheet (overlay) is open at a time. */
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

const marketTz = (tab: SectionId) => (tab === "vn" ? "Asia/Ho_Chi_Minh" : "America/New_York");

function App() {
  const { ready, t, lang, setLang, api, needPassword, seen, markSeen, toggleTheme, tz, tzSetting, setTz } = usePrefs();
  const toast = useToast();
  const [tab, setTab] = useSavedTab();
  const { isMobile, isWide } = useViewport();
  const { sideRail, dockOpen, toggleRail, toggleDock } = useWideLayout();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleHidden = useTitleHidden(titleRef);
  const searchRef = useRef<HTMLInputElement>(null);

  /* ---------------------------------------------------------- data */
  const [digests, setDigests] = useState<Digests>({});
  // The last run couldn't use AI: per section, when (readers may switch to a rule-based copy).
  const [aiFail, setAiFail] = useState<Partial<Record<SectionId, string | null>>>({});
  const [oldDigest, setOldDigest] = useState<{ section: SectionId; key: string; digest: Digest } | null>(null);
  const [calendar, setCalendar] = useState<{ events: CalendarEvent[]; notes: string[] }>({ events: [], notes: [] });
  const [interests, setInterests] = useState<Interest[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  // Guests (VIEWER_PASSWORD, or signed-out in multi-user mode) are read-only. The server enforces
  // it; this just hides controls.
  const [readOnly, setReadOnly] = useState(false);
  const [account, setAccount] = useState<Account>({ mode: "single", user: null, admin: false });
  const [accountKnown, setAccountKnown] = useState(false);
  const [refreshing, setRefreshing] = useState<SectionId | null>(null);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [signIn, setSignIn] = useState(false);
  useEffect(() => {
    const on = () => setSignIn(true);
    window.addEventListener("ih-signin", on);
    return () => window.removeEventListener("ih-signin", on);
  }, []);

  const loadDigest = useCallback(
    async (s: SectionId) => {
      // ?lang= lets signed-out visitors read shared sections in their language.
      const j = await api<{ digest: Digest | null; aiFailedAt?: string | null }>(`/api/digest?section=${s}&lang=${lang}`);
      setDigests((d) => ({ ...d, [s]: j.digest }));
      setAiFail((a) => ({ ...a, [s]: j.aiFailedAt ?? null }));
    },
    [api, lang],
  );
  const waitForBriefing = useBriefingPoll(api, lang, setDigests);
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
        api<{ briefingLanguage: string; timeZone?: string }>("/api/settings")
          .then((s) => {
            const chosen = lsGet<string | null>("ih-lang", null);
            if (!chosen && isLang(s.briefingLanguage) && s.briefingLanguage !== lang) setLang(s.briefingLanguage);
            else if (s.briefingLanguage !== lang) api("/api/settings", { method: "PUT", body: JSON.stringify({ briefingLanguage: lang }) }).catch(() => {});
            // Time zone: same rule (a device without its own choice adopts the account's).
            const zoneChosen = lsGet<string | null>("ih-tz", null);
            if (!zoneChosen && s.timeZone && s.timeZone !== tzSetting) setTz(s.timeZone);
            else if (zoneChosen && s.timeZone !== tzSetting) api("/api/settings", { method: "PUT", body: JSON.stringify({ timeZone: tzSetting }) }).catch(() => {});
          })
          .catch(() => {});
      }
      // Signed-out visitors land on a section they can read (Vietnam for Vietnamese readers), unless
      // they picked a tab before.
      if (me?.mode === "multi" && !me.user) {
        const saved = savedTab();
        if (!saved || saved === "interests") setTab(lang === "vi" ? "vn" : "world");
      }
      const viewer = me?.mode === "multi" ? !me.user : st?.role === "viewer";
      setReadOnly(viewer);
      if (!viewer) api<{ holdings: Holding[] }>("/api/portfolio").then((h) => setHoldings(h.holdings)).catch(() => {});
    });
  }, [ready, needPassword, loadDigest, loadCalendar, loadInterests, api]);

  useEffect(() => {
    if (calTab.current === tab) return;
    calTab.current = tab;
    if (ready) loadCalendar();
  }, [tab, ready, loadCalendar]);

  /* ------------------------------------------- what the tab shows */
  const { rulesDigests, setRulesDigests, isRulesTab, toggleRules } = useRulesView(tab, aiFail, api, lang);
  const active = isRulesTab && rulesDigests[tab] ? rulesDigests[tab] : digests[tab];
  const shown = oldDigest?.section === tab ? oldDigest.digest : active;
  const { translatingTab, translateFailed } = useTranslateOnRead({ tab, lang, api, digests, setDigests, rulesDigests, setRulesDigests, isRulesTab, viewingOld: !!oldDigest });
  // Headlines: the live list (refreshed every 15/30 min without AI), titles translated where the briefing has them.
  const { liveNews } = useLiveNews({ ready: ready && !needPassword, api });
  const lists = useMemo(() => Object.fromEntries(SECTION_IDS.map((s) => [s, newsFor(digests[s], liveNews[s])])), [digests, liveNews]);
  const activeList = useMemo(() => (oldDigest?.section === tab ? { at: oldDigest.digest.generatedAt, items: oldDigest.digest.news } : newsFor(active, liveNews[tab])), [oldDigest, tab, active, liveNews]);
  const { newIds, interestsNew, badge, markAllRead } = useNewHeadlines({ ready, seen, markSeen, lists, active: activeList, tab });
  const { preds, translatingPreds } = usePredictions({ ready: ready && !needPassword, api, lang, tab });
  const allCalls = useMemo(() => SECTION_IDS.flatMap((s) => callsOf(preds[s] ?? [])), [preds]);
  // Show the skeleton until preferences (and the saved password) are loaded, so nothing renders and fires requests early.
  const loading = !ready || (!needPassword && active === undefined);
  const isHome = tab === "interests";
  // Multi-user mode: My Interests is personal, so signed-out visitors get a sign-in invitation there.
  const gated = isHome && account.mode === "multi" && !account.user && accountKnown;

  /* -------------------------------------------------------- prices */
  const plan = useMemo(() => stripPlan(shown, tab), [shown, tab]);
  const stripSyms = useMemo(() => planSymbols(plan), [plan]);
  const live = useLiveQuotes(stripSyms, tab === "vn" ? "vn" : tab === "world" ? "world" : "us");
  const strip = useMemo(() => buildStripRows(shown, plan, live), [shown, plan, live]);
  const liveQuotes = useMemo(() => (shown ? mergeLive(shown.quotes, live) : []), [shown, live]);
  const interestsDigest = digests.interests;
  const interestsLive = useMemo(() => (interestsDigest ? mergeLive(interestsDigest.quotes, live) : []), [interestsDigest, live]);
  const chartSymbols = useMemo(() => chartSymbolsFor(interests), [interests]);
  const watchSymbols = useMemo(() => [...new Set([...interests.flatMap((i) => i.tickers), ...holdings.map((h) => h.symbol)])], [interests, holdings]);
  const allDigests = useMemo(() => SECTION_IDS.map((s) => digests[s]).filter((d): d is Digest => !!d), [digests]);
  const quoteFor = (sym: string) => allDigests.flatMap((d) => [...d.quotes, ...(d.macro ?? [])]).find((q) => q.symbol === sym);
  // Market tabs show their market's date (Vietnam: Hanoi, US: New York), so the date matches the
  // session pill; My Interests and World use the reader's own date.
  const dateStr = useMemo(() => {
    if (!ready) return "";
    const timeZone = tab === "vn" ? "Asia/Ho_Chi_Minh" : tab === "us" ? "America/New_York" : undefined;
    return new Intl.DateTimeFormat(langInfo(lang).locale, { weekday: "long", month: "long", day: "numeric", timeZone }).format(new Date());
  }, [ready, lang, tab]);

  /* ------------------------------------------------------- actions */
  const switchTab = useCallback(
    (s: SectionId) => {
      setTab(s);
      setOldDigest(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [setTab],
  );
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
  const jumpToNews = useCallback(() => document.getElementById("headlines")?.scrollIntoView({ behavior: "smooth", block: "start" }), []);
  const openTicker = useCallback((symbol: string) => setSheet({ kind: "ticker", symbol }), []);

  const rs = refreshState(account, tab, t, lang, new Date(), tz);
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
        if (m === "wait") toast(rs.waitText ?? rs.limitText);
        else if (m === "limit") toast(rs.limitText);
        else if (!["401", "signin"].includes(m)) setError(m);
      } finally {
        setRefreshing(null);
      }
    },
    [api, loadDigest, loadCalendar, toast, t, lang, account.admin, rs.waitText, rs.limitText, setRulesDigests],
  );
  const refreshUi: RefreshUi | null = rs.can
    ? { busy: !!refreshing, disabled: !!refreshing || rs.blocked, title: rs.title, left: !account.admin && rs.quota ? rs.quota.left : undefined, run: () => refresh(tab) }
    : null;

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

  const frame: FrameActions = {
    section: switchTab,
    search: () => setSheet({ kind: "search" }),
    palette: () => setSheet({ kind: "palette" }),
    track: () => setSheet({ kind: "track" }),
    settings: () => setSheet({ kind: "settings" }),
    news: jumpToNews,
  };
  useShortcuts({
    sheetOpen: !!sheet,
    palette: () => setSheet((cur) => (cur?.kind === "palette" ? null : { kind: "palette" })),
    section: switchTab,
    refresh: rs.can ? () => refresh(tab) : undefined,
    findInNews: () => {
      jumpToNews();
      setTimeout(() => searchRef.current?.focus(), 250);
    },
    track: frame.track,
    theme: toggleTheme,
    listen: () => window.dispatchEvent(new Event("ih-listen")),
    ask: readOnly ? undefined : () => openAsk(),
    catchup: () => setSheet({ kind: "catchup" }),
    news: jumpToNews,
    rail: isWide ? toggleRail : undefined,
    dock: isWide && !readOnly ? () => toggleDock() : undefined,
    help: () => setSheet({ kind: "settings", tab: "shortcuts" }),
  });
  const paletteActions: PaletteActions = useMemo(
    () => ({
      section: switchTab,
      ticker: openTicker,
      ask: (q?: string) => openAsk(q),
      catchup: () => setSheet({ kind: "catchup" }),
      searchNews: (q: string) => {
        jumpToNews();
        window.dispatchEvent(new CustomEvent("ih-search", { detail: q }));
      },
      refresh: rs.can ? () => refresh(tab) : undefined,
      theme: toggleTheme,
      track: () => setSheet({ kind: "track" }),
      settings: (tabName?: SettingsTab) => setSheet({ kind: "settings", tab: tabName }),
    }),
    [switchTab, openTicker, refresh, tab, toggleTheme, rs.can, openAsk, jumpToNews],
  );

  /* -------------------------------------------------------- layout */
  const guestChip = readOnly && account.mode !== "multi";
  const editHoldings = () => setSheet({ kind: "settings", tab: "holdings" });
  // Side cards: in the right rail on larger screens, inline (between the briefing parts) on phones.
  const marketCards = shown && (
    <>
      <MoodGaugeCard gauge={shown.gauge} />
      {isHome && !readOnly && <PortfolioCard holdings={holdings} onEdit={editHoldings} onOpen={openTicker} />}
      {isHome && readOnly && account.mode === "multi" && <SignInCard />}
      <Movers movers={shown.analysis.movers} quotes={liveQuotes} onTicker={openTicker} />
      {(tab === "us" || tab === "interests") && <SectorHeatmap sectors={shown.sectors} onOpen={openTicker} />}
    </>
  );
  const aheadCards = shown && (
    <>
      <UpNext events={calendar.events} notes={calendar.notes} timeZone={marketTz(tab)} />
      <WatchNext items={shown.analysis.watchNext} />
    </>
  );

  return (
    <AccountCtx.Provider value={account}>
      <Ambient section={tab} />
      {!isWide && <TopBar tab={tab} brand={isMobile && titleHidden ? t(sectionName(tab)) : "InvestHepi"} badge={badge} newCount={newIds.size} hasBriefing={!!shown} guestChip={guestChip} refresh={refreshUi} actions={frame} />}

      {refreshing && (
        <div className="progress" role="progressbar" aria-label={t("nav.refreshing")}>
          <i />
        </div>
      )}

      <div className={isWide ? `shell${sideRail ? " rail" : ""}${readOnly ? " nodock" : !dockOpen ? " dockclosed" : ""}` : undefined}>
        {isWide && <Sidebar tab={tab} rail={sideRail} toggleRail={toggleRail} badge={badge} newIds={newIds} news={activeList?.items ?? null} guestChip={guestChip} refresh={refreshUi} actions={frame} />}
        <main className="page">
          <div className="page-head">
            <div className="page-title">
              <div className="eyebrow" suppressHydrationWarning>
                {dateStr}
              </div>
              <h1 className="large-title" ref={titleRef}>
                {t(sectionName(tab))}
              </h1>
            </div>
            {/* World spans many exchanges with different hours, so there's no single open/closed. */}
            {tab !== "world" && <StatusPill market={tab === "vn" ? "vn" : "us"} />}
          </div>

          {shown && !gated && <MarketStrip groups={strip.groups} macro={strip.macro} onOpen={openTicker} />}
          {isHome && !gated && !readOnly && (
            <button className="ss-bar" onClick={frame.search}>
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
            !rs.can ? (
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
                  <SinceLastVisit digest={interestsDigest} calls={callsOf(preds.interests ?? [])} quotes={interestsLive} newCount={interestsNew} onTicker={openTicker} />
                </div>
              )}
              <Briefing
                digest={shown}
                translating={translatingTab === tab}
                translateFailed={translateFailed.has(translateKey(tab, lang, shown.generatedAt, isRulesTab && !!rulesDigests[tab]))}
                aiFailedAt={oldDigest ? null : (aiFail[tab] ?? null)}
                rulesView={isRulesTab && !!rulesDigests[tab]}
                onToggleRules={(on) => toggleRules(tab, on)}
                viewingOld={!!oldDigest}
                onBackToLatest={() => setOldDigest(null)}
                onHistory={() => setSheet({ kind: "history" })}
                onCatchUp={() => setSheet({ kind: "catchup" })}
              />
              {!oldDigest && <PredictionsCard sets={preds[tab]} section={tab} onTicker={openTicker} onTrack={frame.track} translating={translatingPreds === tab} />}
              <ScenariosCard scenarios={shown.analysis.scenarios} />
              {isHome && <ChartCard symbols={chartSymbols} quotes={liveQuotes} onOpen={openTicker} />}
              {isHome && <Watchlist symbols={watchSymbols} quotes={liveQuotes} technicals={shown.technicals} outlook={callsOf(preds.interests ?? [])} onOpen={openTicker} />}
              <div className="grid">
                <div>
                  {isMobile && marketCards}
                  <Events events={shown.analysis.events} news={shown.news} />
                  {isMobile && aheadCards}
                  <Headlines
                    digest={shown}
                    items={activeList?.items ?? shown.news}
                    interests={interests}
                    newIds={newIds}
                    searchRef={searchRef}
                    onExplain={readOnly ? undefined : (title) => openAsk(t("ask.explain", { title }))}
                    onMarkRead={() => activeList && markAllRead(activeList)}
                  />
                </div>
                {!isMobile && (
                  <aside className="rail">
                    {marketCards}
                    {aheadCards}
                  </aside>
                )}
              </div>
            </>
          )}

          <Footer />
        </main>
        {/* Ask AI stays mounted when hidden, so it slides away and back (and keeps the conversation);
            folded, it's a slim rail whose button sits where the close button was. */}
        {isWide && !readOnly && (
          <aside className={`chat-dock${dockOpen ? "" : " closed"}`}>
            <button className="icon-btn dock-open" onClick={() => toggleDock(true)} aria-label={`${t("ui.showChat")} (])`} title={`${t("ui.showChat")} (])`} tabIndex={dockOpen ? -1 : 0} aria-hidden={dockOpen}>
              <IconPanelRight />
            </button>
            <div className="dock-panel" inert={!dockOpen}>
              <AskPanel docked digest={shown} calls={callsOf(preds[tab] ?? [])} calendar={calendar.events} section={tab} request={askReq} onClose={() => toggleDock(false)} closeLabel={`${t("ui.hideChat")} (])`} />
            </div>
          </aside>
        )}
      </div>

      <TabBar tab={tab} badge={badge} readOnly={readOnly} sheet={sheet?.kind} section={switchTab} track={frame.track} ask={() => openAsk()} />

      {!readOnly && !isWide && (
        <button className="ask-fab" onClick={() => openAsk()} aria-label={t("ask.title")}>
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
          calls={allCalls}
          onClose={() => (sheet.back === "search" ? setSheet({ kind: "search" }) : followDirty.current ? closeSearch() : setSheet(null))}
          onAlert={readOnly ? undefined : (symbol) => setSheet({ kind: "settings", tab: "alerts", symbol })}
          action={<FollowButton symbol={sheet.symbol} name={symLabel(sheet.symbol)} region={sheet.symbol.endsWith(".VN") ? "vn" : "intl"} type={sheet.symbol.startsWith("^") ? "INDEX" : undefined} follow={follow} label />}
        />
      )}
      {sheet?.kind === "search" && <StockSearchSheet onClose={closeSearch} onOpen={(symbol) => setSheet({ kind: "ticker", symbol, back: "search" })} follow={follow} readOnly={readOnly} />}
      {sheet?.kind === "ask" && <AskSheet onClose={() => setSheet(null)} initial={sheet.q} digest={shown} calls={callsOf(preds[tab] ?? [])} calendar={calendar.events} section={tab} />}
      {sheet?.kind === "catchup" && shown && (
        <CatchUp
          digest={shown}
          calls={callsOf(preds[tab] ?? [])}
          calendar={calendar.events}
          onClose={() => setSheet(null)}
          onAsk={() => {
            setSheet(null);
            openAsk();
          }}
        />
      )}
      {sheet?.kind === "palette" && <CommandPalette onClose={() => setSheet(null)} tickers={chartSymbols} actions={paletteActions} readOnly={readOnly} />}
    </AccountCtx.Provider>
  );
}
