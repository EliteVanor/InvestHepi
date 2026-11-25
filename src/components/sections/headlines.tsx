"use client";

import { useEffect, useMemo, useState } from "react";
import { relTime } from "@/lib/i18n";
import type { Digest, Interest, NewsItem } from "@/lib/types";
import { IconBookmark, IconSearch, IconSparkles } from "../Icons";
import { usePrefs } from "../prefs";
import { safeHttpUrl } from "@/lib/safe-url";


/* ------------------------------------------------------------- Headlines */

export function Headlines({
  digest, items, interests, newIds, onMarkRead, searchRef, onExplain,
}: {
  onExplain?: (title: string) => void;
  digest: Digest;
  /** The live list (refreshed every 15/30 min); "Key" marks the headlines this briefing's events cite. */
  items?: NewsItem[];
  interests: Interest[];
  newIds: Set<string>;
  onMarkRead: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { t, lang, saved, toggleSaved, isSaved } = usePrefs();
  const [filter, setFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  useEffect(() => {
    const on = (e: Event) => {
      setFilter("all");
      setQ(String((e as CustomEvent).detail ?? ""));
      setTimeout(() => searchRef.current?.focus(), 300);
    };
    window.addEventListener("ih-search", on);
    return () => window.removeEventListener("ih-search", on);
  }, [searchRef]);
  const news = items ?? digest.news;
  // "Key": headlines the briefing's events cite (v18) or that belong to a story card (v19).
  const keyIds = useMemo(() => new Set([...digest.analysis.events.flatMap((e) => e.sourceIds.map((i) => digest.news[i]?.id)), ...(digest.stories ?? []).flatMap((c) => c.memberIds)].filter(Boolean)), [digest]);
  const tags = useMemo(() => [...new Set(news.flatMap((n) => n.tags ?? []))], [news]);
  const tagName = (id: string) => interests.find((i) => i.id === id)?.name ?? id;

  const base = filter === "saved" ? saved : filter === "new" ? news.filter((n) => newIds.has(n.id)) : filter === "all" ? news : news.filter((n) => n.tags?.includes(filter));
  const needle = q.trim().toLowerCase();
  const list = needle ? base.filter((n) => `${n.title} ${n.source} ${n.summary ?? ""}`.toLowerCase().includes(needle)) : base;

  return (
    <section className="card" aria-labelledby="news-h" id="headlines">
      <h2 className="card-title" id="news-h">
        {t("news.title")}
        <span className="spacer" />
        {newIds.size > 0 && (
          <button className="pill-btn" onClick={onMarkRead} style={{ textTransform: "none", letterSpacing: 0 }}>
            {t("news.markRead")}
          </button>
        )}
      </h2>
      <div className="search">
        <IconSearch />
        <input ref={searchRef} type="search" placeholder={t("nav.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("nav.search")} />
      </div>
      <div className="filters" role="toolbar">
        <button className="filter" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
          {t("news.all")}
        </button>
        {newIds.size > 0 && (
          <button className="filter" aria-pressed={filter === "new"} onClick={() => setFilter("new")}>
            {t("news.newCount", { n: newIds.size })}
          </button>
        )}
        {tags.length > 1 &&
          tags.map((tg) => (
            <button key={tg} className="filter" aria-pressed={filter === tg} onClick={() => setFilter(tg)}>
              {tagName(tg)}
            </button>
          ))}
        <button className="filter" aria-pressed={filter === "saved"} onClick={() => setFilter("saved")}>
          <IconBookmark width={12} height={12} style={{ verticalAlign: -1, marginRight: 4 }} />
          {t("news.saved")} {saved.length ? `(${saved.length})` : ""}
        </button>
      </div>
      {list.length === 0 && <p className="muted" style={{ padding: "12px 0" }}>{filter === "saved" && !needle ? t("news.savedEmpty") : t("news.none")}</p>}
      {list.map((n) => (
        <div className={`news ${newIds.has(n.id) ? "is-new" : ""}`} key={n.id}>
          <a href={safeHttpUrl(n.link) || undefined} target="_blank" rel="noreferrer" title={n.titleOrig}>
            {n.title}
          </a>
          <div className="news-actions">
            {onExplain && (
              <button className="save-btn" onClick={() => onExplain(n.title)} aria-label={t("news.explain")} title={t("news.explain")}>
                <IconSparkles />
              </button>
            )}
            <button className="save-btn" aria-pressed={isSaved(n.id)} onClick={() => toggleSaved(n)} aria-label={isSaved(n.id) ? t("news.unsave") : t("news.save")}>
              <IconBookmark filled={isSaved(n.id)} />
            </button>
          </div>
          <div className="news-meta">
            <span>{n.source}</span>
            <span>·</span>
            <span>{relTime(n.publishedAt, lang)}</span>
            {keyIds.has(n.id) && <span className="tag key">{t("news.key")}</span>}
            {n.alsoIn?.length ? <span className="tag" title={n.alsoIn.join(", ")}>{t("news.sources", { n: n.alsoIn.length })}</span> : null}
            {n.tags?.slice(0, 3).map((tg) => (
              <span className="tag" key={tg}>
                {tagName(tg)}
              </span>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
