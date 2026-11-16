"use client";

/** The page's frame: background, top bar (phones/tablets), sidebar (wide screens), tab bar, footer. */
import type { SVGProps } from "react";
import { AccountButton } from "@/components/account";
import { IconFlag, IconGear, IconGlobe, IconNews, IconRefresh, IconSearch, IconSidebar, IconSparkles, IconStar, IconTarget } from "@/components/Icons";
import { usePrefs } from "@/components/prefs";
import { relTime, type MsgKey } from "@/lib/i18n";
import { SECTION_IDS, type NewsItem, type SectionId } from "@/lib/types";
import type { RefreshUi } from "./hooks";

/** What the frame's buttons do (page.tsx wires these to sheets and tabs). */
export interface FrameActions {
  section: (s: SectionId) => void;
  search: () => void;
  palette: () => void;
  track: () => void;
  settings: () => void;
  news: () => void;
}

export const sectionName = (s: SectionId) => `sec.${s}` as MsgKey;

/** Unread count chip ("99+" past 99). */
export function Count({ n, className = "badge" }: { n: number; className?: string }) {
  return n > 0 ? <span className={className}>{n > 99 ? "99+" : n}</span> : null;
}

export function SectionIcon({ s }: { s: SectionId }) {
  const Icon = s === "interests" ? IconStar : s === "world" ? IconGlobe : s === "vn" ? IconVn : IconFlag;
  return <Icon />;
}

function IconVn(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m12 8.6 1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z" />
    </svg>
  );
}

/** Drifting color fields behind everything; the palette follows the section. */
export function Ambient({ section }: { section: SectionId }) {
  return (
    <div className="ambient" data-section={section} aria-hidden="true">
      <div className="ambient-orb a" />
      <div className="ambient-orb b" />
      <div className="ambient-orb c" />
      <div className="ambient-dots" />
      <div className="ambient-grain" />
    </div>
  );
}

/** Phones and tablets. On phones the brand turns into the section name once the large title scrolls away. */
export function TopBar(p: { tab: SectionId; brand: string; badge: (s: SectionId) => number; newCount: number; hasBriefing: boolean; guestChip: boolean; refresh: RefreshUi | null; actions: FrameActions }) {
  const { t } = usePrefs();
  const { tab, badge, actions: a } = p;
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>{p.brand}</span>
        </div>
        <span className="spacer" />
        <nav className="segmented desktop-only" aria-label={t("ui.sections")}>
          {SECTION_IDS.map((s, i) => (
            <button key={s} aria-pressed={tab === s} onClick={() => a.section(s)} title={`${t(sectionName(s))} (${i + 1})`}>
              {t(sectionName(s))}
              <Count n={badge(s)} />
            </button>
          ))}
        </nav>
        <span className="spacer desktop-only" />
        <button className="icon-btn" aria-label={t("search.title")} title={t("search.title")} onClick={a.search}>
          <IconSearch />
        </button>
        <button className="icon-btn news-jump" aria-label={t("news.title")} title={`${t("news.title")} (N)`} onClick={a.news} disabled={!p.hasBriefing}>
          <IconNews />
          <Count n={p.newCount} className="refresh-left num" />
        </button>
        <button className="icon-btn desktop-only cmd-btn" aria-label={t("sc.palette")} title={`${t("sc.palette")} (⌘K)`} onClick={a.palette}>
          <span aria-hidden="true">⌘</span>
        </button>
        <button className="icon-btn" aria-label={t("nav.track")} title={`${t("nav.track")} (T)`} onClick={a.track}>
          <IconTarget />
        </button>
        {p.guestChip && <span className="chip" title={t("ro.hint")}>{t("ro.badge")}</span>}
        {p.refresh && (
          <button className="icon-btn refresh-btn" aria-label={`${t("nav.refresh")}: ${p.refresh.title}`} title={p.refresh.title} onClick={p.refresh.run} disabled={p.refresh.disabled}>
            <IconRefresh className={p.refresh.busy ? "spin" : ""} />
            {p.refresh.left != null && <span className="refresh-left num">{p.refresh.left}</span>}
          </button>
        )}
        <AccountButton />
        <button className="icon-btn" aria-label={t("nav.settings")} title={t("nav.settings")} onClick={a.settings}>
          <IconGear />
        </button>
      </div>
    </header>
  );
}

/** Wide screens: sections, the top headlines and actions; folds to an icon rail. */
export function Sidebar(p: { tab: SectionId; rail: boolean; toggleRail: () => void; badge: (s: SectionId) => number; newIds: Set<string>; news: NewsItem[] | null; guestChip: boolean; refresh: RefreshUi | null; actions: FrameActions }) {
  const { t, lang } = usePrefs();
  const { tab, rail, badge, newIds, news, actions: a } = p;
  const toggleLabel = rail ? t("ui.expand") : t("ui.collapse");
  return (
    <aside className={`sidebar${rail ? " rail" : ""}`} aria-label={t("ui.sections")}>
      {/* The fold button sits top-left in both states, so it never moves under the pointer. */}
      <div className="side-top">
        <button className="icon-btn side-toggle" onClick={p.toggleRail} aria-label={toggleLabel} title={`${toggleLabel} ([)`} aria-expanded={!rail}>
          <IconSidebar />
        </button>
        <div className="brand" aria-hidden={rail}>
          <span className="brand-mark" aria-hidden="true" />
          <span className="side-label">InvestHepi</span>
        </div>
      </div>
      <nav className="side-nav">
        {SECTION_IDS.map((s, i) => (
          <button key={s} aria-current={tab === s ? "page" : undefined} onClick={() => a.section(s)} title={`${t(sectionName(s))} (${i + 1})`}>
            <SectionIcon s={s} />
            <span className="side-label">{t(sectionName(s))}</span>
            <Count n={badge(s)} />
          </button>
        ))}
        {/* The headlines list is at the end of the page: jump straight to it. */}
        <button className="side-news-btn" onClick={a.news} title={`${t("news.title")} (N)`} disabled={!news}>
          <IconNews />
          <span className="side-label">{t("news.title")}</span>
          <Count n={newIds.size} />
        </button>
      </nav>
      {!rail && news && news.length > 0 && (
        <div className="side-headlines" aria-label={t("side.top")}>
          <div className="side-caption">{t("side.top")}</div>
          {news.slice(0, 5).map((n) => (
            <a key={n.id} href={n.link} target="_blank" rel="noreferrer" title={n.titleOrig ?? n.title} className={newIds.has(n.id) ? "is-new" : undefined}>
              <span className="side-hl-title">{n.title}</span>
              <small>
                {n.source} · {relTime(n.publishedAt, lang)}
              </small>
            </a>
          ))}
          <button className="side-more" onClick={a.news}>
            {t("side.allNews", { n: news.length })}
          </button>
        </div>
      )}
      <div className="side-actions">
        <button onClick={a.search} title={t("search.title")}>
          <IconSearch />
          <span className="side-label">{t("search.title")}</span>
        </button>
        <button onClick={a.palette} title={`${t("sc.palette")} (⌘K)`}>
          <span className="side-kbd" aria-hidden="true">⌘</span>
          <span className="side-label">{t("sc.palette")}</span>
          <kbd className="side-label">⌘K</kbd>
        </button>
        <button onClick={a.track} title={`${t("nav.track")} (T)`}>
          <IconTarget />
          <span className="side-label">{t("nav.track")}</span>
          <kbd className="side-label">T</kbd>
        </button>
        {p.refresh && (
          <button className="refresh-btn" onClick={p.refresh.run} disabled={p.refresh.disabled} title={p.refresh.title}>
            <IconRefresh className={p.refresh.busy ? "spin" : ""} />
            <span className="side-label">{t("nav.refresh")}</span>
            {p.refresh.left != null && <span className="badge">{p.refresh.left}</span>}
          </button>
        )}
      </div>
      <span className="spacer" />
      <div className="side-foot">
        {p.guestChip && !rail && <span className="chip" title={t("ro.hint")}>{t("ro.badge")}</span>}
        <AccountButton />
        <button className="icon-btn" aria-label={t("nav.settings")} title={t("nav.settings")} onClick={a.settings}>
          <IconGear />
        </button>
      </div>
    </aside>
  );
}

/** Phones: the bottom tab bar. The last tab is Ask AI, or the track record for read-only guests. */
export function TabBar(p: { tab: SectionId; badge: (s: SectionId) => number; readOnly: boolean; sheet: string | undefined; section: (s: SectionId) => void; track: () => void; ask: () => void }) {
  const { t } = usePrefs();
  return (
    <nav className="tabbar" role="tablist" aria-label={t("ui.sections")}>
      {SECTION_IDS.map((s) => (
        <button key={s} role="tab" aria-selected={p.tab === s} onClick={() => p.section(s)}>
          <SectionIcon s={s} />
          <span>{t(sectionName(s))}</span>
          <Count n={p.badge(s)} />
        </button>
      ))}
      {p.readOnly ? (
        <button role="tab" aria-selected={p.sheet === "track"} onClick={p.track}>
          <IconTarget />
          <span>{t("nav.track")}</span>
        </button>
      ) : (
        <button role="tab" aria-selected={p.sheet === "ask"} onClick={p.ask}>
          <IconSparkles />
          <span>{t("ask.title")}</span>
        </button>
      )}
    </nav>
  );
}

export function Footer() {
  const { t } = usePrefs();
  return (
    <footer className="foot">
      {t("foot.disclaimer")}
      <br />
      <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
        {t("foot.charts")}
      </a>
      {" · "}
      <a href="/privacy" style={{ color: "inherit" }}>
        {t("foot.privacy")}
      </a>
      {" · "}
      <a href="/terms" style={{ color: "inherit" }}>
        {t("foot.terms")}
      </a>
    </footer>
  );
}

/** Placeholder while preferences and the first briefing load. */
export function Skeleton() {
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
