"use client";

/** The ⌘K command palette. */
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { type SectionId } from "@/lib/types";
import { IconBolt, IconChart, IconFlag, IconGear, IconGlobe, IconMoon, IconRefresh, IconSearch, IconSparkles, IconStar, IconTarget } from "./Icons";
import { usePrefs } from "./prefs";

export interface PaletteActions {
  section: (s: SectionId) => void;
  ticker: (s: string) => void;
  ask: (q?: string) => void;
  catchup: () => void;
  searchNews: (q: string) => void;
  /** Only for the admin: briefings refresh on a schedule. */
  refresh?: () => void;
  theme: () => void;
  track: () => void;
  settings: (tab?: "general" | "interests" | "holdings" | "status" | "alerts") => void;
}

interface Item {
  id: string;
  group: string;
  label: string;
  sub?: string;
  icon: ReactNode;
  run: () => void;
  keywords?: string;
}

export function CommandPalette({ onClose, tickers, actions, readOnly }: { onClose: () => void; tickers: string[]; actions: PaletteActions; readOnly?: boolean }) {
  const { t } = usePrefs();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // Company-name search (e.g. "micro" → MSFT, AMD, MU), debounced.
  const { api } = usePrefs();
  const [hits, setHits] = useState<{ symbol: string; name: string }[]>([]);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      return;
    }
    const id = setTimeout(() => {
      api<{ hits: { symbol: string; name: string }[] }>(`/api/search?q=${encodeURIComponent(query)}`).then((j) => setHits(j.hits)).catch(() => setHits([]));
    }, 220);
    return () => clearTimeout(id);
  }, [q, api]);

  const items = useMemo<Item[]>(() => {
    const query = q.trim();
    const g = { sec: t("cmd.sections"), tk: t("cmd.tickers"), act: t("cmd.actions") };
    const base: Item[] = [
      { id: "s-i", group: g.sec, label: t("sec.interests"), sub: "1", icon: <IconStar />, run: () => actions.section("interests") },
      { id: "s-w", group: g.sec, label: t("sec.world"), sub: "2", icon: <IconGlobe />, run: () => actions.section("world") },
      { id: "s-u", group: g.sec, label: t("sec.us"), sub: "3", icon: <IconFlag />, run: () => actions.section("us") },
      ...tickers.map((s) => ({ id: `t-${s}`, group: g.tk, label: t("cmd.chart", { s }), sub: s, icon: <IconChart />, run: () => actions.ticker(s), keywords: s })),
      { id: "a-catch", group: g.act, label: t("sc.catchup"), sub: "C", icon: <IconBolt />, run: actions.catchup },
      { id: "a-ask", group: g.act, label: t("ask.title"), sub: "A", icon: <IconSparkles />, run: () => actions.ask() },
      ...(actions.refresh ? [{ id: "a-refresh", group: g.act, label: t("nav.refresh"), sub: "R", icon: <IconRefresh />, run: actions.refresh }] : []),
      { id: "a-track", group: g.act, label: t("nav.track"), sub: "T", icon: <IconTarget />, run: actions.track },
      { id: "a-alerts", group: g.act, label: t("set.alerts"), icon: <IconBolt />, run: () => actions.settings("alerts") },
      { id: "a-int", group: g.act, label: t("set.interests"), icon: <IconStar />, run: () => actions.settings("interests") },
      { id: "a-hold", group: g.act, label: t("pf.title"), icon: <IconChart />, run: () => actions.settings("holdings") },
      { id: "a-theme", group: g.act, label: t("cmd.theme"), sub: "D", icon: <IconMoon />, run: actions.theme },
      { id: "a-set", group: g.act, label: t("nav.settings"), icon: <IconGear />, run: () => actions.settings() },
    ];
    if (readOnly) {
      const ownerOnlyIds = new Set(["a-ask", "a-refresh", "a-alerts", "a-int", "a-hold"]);
      for (let k = base.length - 1; k >= 0; k--) if (ownerOnlyIds.has(base[k].id)) base.splice(k, 1);
    }
    if (!query) return base;
    const needle = query.toLowerCase();
    const matches = base.filter((i) => `${i.label} ${i.keywords ?? ""}`.toLowerCase().includes(needle));
    const extra: Item[] = [];
    const shownSyms = new Set(matches.map((m) => m.keywords));
    for (const h of hits) {
      if (shownSyms.has(h.symbol)) continue;
      shownSyms.add(h.symbol);
      extra.push({ id: `h-${h.symbol}`, group: t("cmd.search"), label: h.name, sub: h.symbol, icon: <IconChart />, run: () => actions.ticker(h.symbol) });
    }
    if (/^[A-Za-z.^=\-]{1,10}$/.test(query) && !shownSyms.has(query.toUpperCase())) {
      const s = query.toUpperCase();
      extra.push({ id: `t-any-${s}`, group: g.tk, label: t("cmd.chart", { s }), sub: s, icon: <IconChart />, run: () => actions.ticker(s) });
    }
    if (!readOnly) extra.push({ id: "q-ask", group: g.act, label: t("cmd.ask", { q: query }), icon: <IconSparkles />, run: () => actions.ask(query) });
    extra.push({ id: "q-news", group: g.act, label: t("cmd.searchNews", { q: query }), icon: <IconSearch />, run: () => actions.searchNews(query) });
    // Keep one header per group: sections, tickers, search results, actions.
    const order = [g.sec, g.tk, t("cmd.search"), g.act];
    return [...matches, ...extra].map((it, i) => ({ it, i })).sort((a, b) => order.indexOf(a.it.group) - order.indexOf(b.it.group) || a.i - b.i).map((x) => x.it);
  }, [q, t, tickers, actions, hits, readOnly]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const run = (i: number) => {
    const it = items[i];
    if (!it) return;
    onClose();
    setTimeout(it.run, 0);
  };

  let lastGroup = "";
  return (
    <div className="palette-scrim" onClick={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t("sc.palette")} onClick={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <IconSearch />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("cmd.placeholder")}
            aria-label={t("cmd.placeholder")}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(items.length - 1, s + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(sel);
              } else if (e.key === "Escape") onClose();
            }}
          />
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {items.length === 0 && <div className="palette-group">{t("cmd.empty")}</div>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? <div className="palette-group">{it.group}</div> : null;
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {header}
                <button className="palette-item" role="option" aria-selected={i === sel} data-i={i} onMouseMove={() => setSel(i)} onClick={() => run(i)}>
                  <span className="pi-icon">{it.icon}</span>
                  <span>{it.label}</span>
                  {it.sub && <span className="pi-sub">{it.sub}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">{t("cmd.hint")}</div>
      </div>
    </div>
  );
}
