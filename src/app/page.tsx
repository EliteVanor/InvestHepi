"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconGear, IconGlobe, IconFlag, IconRefresh, IconSearch, IconStar, IconTarget, IconAlert } from "@/components/Icons";
import { PrefsProvider, usePrefs } from "@/components/prefs";
import { Briefing, Calls, Events, Headlines, MarketStrip, Movers, StatusPill, UpNext, WatchNext } from "@/components/sections";
import { HistorySheet, PasswordSheet, SettingsSheet, TickerSheet, TrackSheet } from "@/components/sheets";
import type { MsgKey } from "@/lib/i18n";
import { langInfo } from "@/lib/languages";
import type { CalendarEvent, Digest, Interest, SectionId } from "@/lib/types";

const SECTION_IDS: SectionId[] = ["interests", "world", "us"];
const TAB_KEY = "ih-tab";

export default function Page() {
  return (
    <PrefsProvider>
      <App />
    </PrefsProvider>
  );
}

type Sheet = null | { kind: "settings"; tab?: "general" | "interests" | "status" | "shortcuts" } | { kind: "track" } | { kind: "ticker"; symbol: string } | { kind: "history" };

function App() {
  const { ready, t, lang, api, needPassword, seen, markSeen, toggleTheme } = usePrefs();
  const [tab, setTab] = useState<SectionId>("interests");
  const [digests, setDigests] = useState<Partial<Record<SectionId, Digest | null>>>({});
  const [oldDigest, setOldDigest] = useState<{ section: SectionId; key: string; digest: Digest } | null>(null);
  const [calendar, setCalendar] = useState<{ events: CalendarEvent[]; notes: string[] }>({ events: [], notes: [] });
  const [interests, setInterests] = useState<Interest[]>([]);
  const [refreshing, setRefreshing] = useState<SectionId | null>(null);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [newSnap, setNewSnap] = useState<Partial<Record<SectionId, { at: string; ids: Set<string> }>>>({});
  const searchRef = useRef<HTMLInputElement>(null);

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
      const j = await api<{ digest: Digest | null }>(`/api/digest?section=${s}`);
      setDigests((d) => ({ ...d, [s]: j.digest }));
    },
    [api],
  );
  const loadCalendar = useCallback(() => api<{ events: CalendarEvent[]; notes: string[] }>("/api/calendar").then(setCalendar).catch(() => {}), [api]);
  const loadInterests = useCallback(() => api<{ interests: Interest[] }>("/api/interests").then((j) => setInterests(j.interests)).catch(() => {}), [api]);

  // Initial load waits for prefs (read state) so "new" dots are computed correctly.
  useEffect(() => {
    if (!ready || needPassword) return;
    Promise.all(SECTION_IDS.map((s) => loadDigest(s))).catch((e) => {
      if ((e as Error).message !== "401") setError((e as Error).message);
    });
    loadCalendar();
    loadInterests();
  }, [ready, needPassword, loadDigest, loadCalendar, loadInterests]);

  // Snapshot which headlines are new for each digest (first visit ever: nothing is "new").
  useEffect(() => {
    setNewSnap((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const s of SECTION_IDS) {
        const d = digests[s];
        if (!d || prev[s]?.at === d.generatedAt) continue;
        const ids = seen.size === 0 ? new Set<string>() : new Set(d.news.filter((n) => !seen.has(n.id)).map((n) => n.id));
        next[s] = { at: d.generatedAt, ids };
        changed = true;
      }
      return changed ? next : prev;
    });
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
    if (!d || seen.size === 0) return 0;
    return d.news.filter((n) => !seen.has(n.id)).length;
  };

  const refresh = useCallback(
    async (s: SectionId) => {
      setRefreshing(s);
      setError("");
      try {
        const r = await api<{ results: { ok: boolean; error?: string }[] }>(`/api/refresh?section=${s}`, { method: "POST" });
        const failed = r.results?.find((x) => !x.ok);
        if (failed) setError(failed.error ?? "Refresh failed");
        setOldDigest(null);
        await Promise.all([loadDigest(s), loadCalendar()]);
      } catch (e) {
        if ((e as Error).message !== "401") setError((e as Error).message);
      } finally {
        setRefreshing(null);
      }
    },
    [api, loadDigest, loadCalendar],
  );

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
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return;
      if (sheet && e.key !== "Escape") return;
      const k = e.key.toLowerCase();
      if (k === "1" || k === "2" || k === "3") switchTab(SECTION_IDS[Number(k) - 1]);
      else if (k === "r") refresh(tab);
      else if (k === "/") {
        e.preventDefault();
        document.getElementById("headlines")?.scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(() => searchRef.current?.focus(), 250);
      } else if (k === "t") setSheet({ kind: "track" });
      else if (k === "d") toggleTheme();
      else if (k === "l") window.dispatchEvent(new Event("ih-listen"));
      else if (e.key === "?") setSheet({ kind: "settings", tab: "shortcuts" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, tab, refresh, switchTab, toggleTheme]);

  const shown = oldDigest?.section === tab ? oldDigest.digest : active;
  const allDigests = useMemo(() => SECTION_IDS.map((s) => digests[s]).filter((d): d is Digest => !!d), [digests]);
  const quoteFor = (sym: string) => allDigests.flatMap((d) => [...d.quotes, ...(d.macro ?? [])]).find((q) => q.symbol === sym);
  const newIds = newSnap[tab]?.ids ?? new Set<string>();
  const dateStr = useMemo(
    () => (ready ? new Intl.DateTimeFormat(langInfo(lang).locale, { weekday: "long", month: "long", day: "numeric" }).format(new Date()) : ""),
    [ready, lang],
  );
  const loading = ready && !needPassword && active === undefined;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <span>Invest Helper</span>
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
          <button
            className="icon-btn"
            aria-label={t("nav.search")}
            title={`${t("nav.search")} (/)`}
            onClick={() => {
              document.getElementById("headlines")?.scrollIntoView({ behavior: "smooth", block: "start" });
              setTimeout(() => searchRef.current?.focus(), 300);
            }}
          >
            <IconSearch />
          </button>
          <button className="icon-btn desktop-only" aria-label={t("nav.track")} title={`${t("nav.track")} (T)`} onClick={() => setSheet({ kind: "track" })}>
            <IconTarget />
          </button>
          <button className="icon-btn" aria-label={t("nav.refresh")} title={`${t("nav.refresh")} (R)`} onClick={() => refresh(tab)} disabled={!!refreshing}>
            <IconRefresh className={refreshing ? "spin" : ""} />
          </button>
          <button className="icon-btn" aria-label={t("nav.settings")} title={t("nav.settings")} onClick={() => setSheet({ kind: "settings" })}>
            <IconGear />
          </button>
        </div>
      </header>

      <main className="page">
        <div className="page-head">
          <div className="page-title">
            <div className="eyebrow" suppressHydrationWarning>{dateStr}</div>
            <h1 className="large-title">{t(`sec.${tab}` as MsgKey)}</h1>
          </div>
          <StatusPill />
        </div>

        {shown && <MarketStrip quotes={shown.quotes} macro={shown.macro ?? []} onOpen={(symbol) => setSheet({ kind: "ticker", symbol })} />}

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
        ) : !shown ? (
          <div className="card empty">
            <div className="empty-orb" />
            <h2>{t("empty.title")}</h2>
            <p>{t("empty.body")}</p>
            <button className="btn-primary" onClick={() => refresh(tab)} disabled={!!refreshing}>
              {refreshing ? t("empty.working") : t("empty.cta")}
            </button>
          </div>
        ) : (
          <>
            <Briefing digest={shown} viewingOld={!!oldDigest} onBackToLatest={() => setOldDigest(null)} onHistory={() => setSheet({ kind: "history" })} />
            <Calls outlook={shown.analysis.outlook} onTicker={(symbol) => setSheet({ kind: "ticker", symbol })} />
            <div className="grid">
              <div>
                <div className="mobile-only">
                  <Movers movers={shown.analysis.movers} quotes={shown.quotes} onTicker={(symbol) => setSheet({ kind: "ticker", symbol })} />
                </div>
                <Events events={shown.analysis.events} news={shown.news} />
                <div className="mobile-only">
                  <UpNext events={calendar.events} notes={calendar.notes} />
                  <WatchNext items={shown.analysis.watchNext} />
                </div>
                <Headlines
                  digest={shown}
                  interests={interests}
                  newIds={newIds}
                  searchRef={searchRef}
                  onMarkRead={() => {
                    markSeen(shown.news.map((n) => n.id));
                    setNewSnap((p) => ({ ...p, [tab]: { at: shown.generatedAt, ids: new Set() } }));
                  }}
                />
              </div>
              <aside className="rail desktop-only">
                <Movers movers={shown.analysis.movers} quotes={shown.quotes} onTicker={(symbol) => setSheet({ kind: "ticker", symbol })} />
                <UpNext events={calendar.events} notes={calendar.notes} />
                <WatchNext items={shown.analysis.watchNext} />
              </aside>
            </div>
          </>
        )}

        <footer className="foot">{t("foot.disclaimer")}</footer>
      </main>

      <nav className="tabbar" role="tablist" aria-label="Sections">
        {SECTION_IDS.map((s) => {
          const Icon = s === "interests" ? IconStar : s === "world" ? IconGlobe : IconFlag;
          return (
            <button key={s} role="tab" aria-selected={tab === s} onClick={() => switchTab(s)}>
              <Icon />
              <span>{t(`sec.${s}` as MsgKey)}</span>
              {badge(s) > 0 && <span className="badge">{badge(s) > 99 ? "99+" : badge(s)}</span>}
            </button>
          );
        })}
        <button role="tab" aria-selected={false} onClick={() => setSheet({ kind: "track" })}>
          <IconTarget />
          <span>{t("nav.track")}</span>
        </button>
      </nav>

      {needPassword && <PasswordSheet />}
      {sheet?.kind === "settings" && (
        <SettingsSheet
          initialTab={sheet.tab}
          onClose={() => setSheet(null)}
          onInterestsSaved={() => {
            setSheet(null);
            switchTab("interests");
            loadInterests();
            refresh("interests");
          }}
          onBriefingLangSaved={() => refresh(tab)}
        />
      )}
      {sheet?.kind === "track" && <TrackSheet onClose={() => setSheet(null)} />}
      {sheet?.kind === "history" && <HistorySheet section={tab} current={oldDigest?.key ?? null} onPick={pickHistory} onClose={() => setSheet(null)} />}
      {sheet?.kind === "ticker" && <TickerSheet symbol={sheet.symbol} quote={quoteFor(sheet.symbol)} digests={allDigests} onClose={() => setSheet(null)} />}
    </>
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
