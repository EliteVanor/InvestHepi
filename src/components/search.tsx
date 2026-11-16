"use client";

/**
 * Stock search, Apple Stocks style: one field for US, Vietnamese and global stocks, ETFs and
 * indexes, live prices beside each result, and a round + / ✓ to follow or unfollow it in My
 * Interests. Following a single stock creates a one-ticker interest (its own news search and its
 * own call in the personal briefing).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SearchHit } from "@/lib/search";
import { queryFor } from "@/lib/follow";
import { SYMBOL_LABELS, symLabel } from "@/lib/symbols";
import type { Interest } from "@/lib/types";
import { IconSearch } from "./Icons";
import { usePrefs } from "./prefs";
import { Sheet, fmtPct, fmtPrice } from "./primitives";
import { useToast } from "./toast";
import { useLiveQuotes } from "./live";

export const MAX_INTERESTS = 12;

export type FollowState = { kind: "own"; interest: Interest } | { kind: "group"; interest: Interest } | null;

/**
 * Follow / unfollow single stocks. Saves immediately; `onChanged` gets the new list. The personal
 * briefing is refreshed once by the caller (not on every tap) to spare the free AI quota.
 */
export function useFollow(interests: Interest[], readOnly: boolean, onChanged: (list: Interest[]) => void) {
  const { t, api } = usePrefs();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const state = useCallback(
    (symbol: string): FollowState => {
      const own = interests.find((i) => i.tickers.length === 1 && i.tickers[0] === symbol);
      if (own) return { kind: "own", interest: own };
      const group = interests.find((i) => i.tickers.includes(symbol));
      return group ? { kind: "group", interest: group } : null;
    },
    [interests],
  );
  const toggle = useCallback(
    async (hit: Pick<SearchHit, "symbol" | "name" | "region" | "type">) => {
      if (readOnly) {
        window.dispatchEvent(new Event("ih-signin"));
        return;
      }
      const s = state(hit.symbol);
      if (s?.kind === "group") return;
      let next: Interest[];
      if (s?.kind === "own") {
        next = interests.filter((i) => i !== s.interest);
        if (!next.length) return;
      } else {
        if (interests.length >= MAX_INTERESTS) {
          toast(t("search.limit", { n: MAX_INTERESTS }), "error");
          return;
        }
        const id = `s-${hit.symbol.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.slice(0, 40);
        next = [...interests, { id, name: (symLabel(hit.symbol) === hit.symbol.replace(/\.VN$/, "") ? hit.name || hit.symbol : symLabel(hit.symbol)).slice(0, 60), query: queryFor(hit).slice(0, 300), tickers: [hit.symbol] }];
      }
      setBusy(hit.symbol);
      try {
        const j = await api<{ interests: Interest[] }>("/api/interests", { method: "PUT", body: JSON.stringify(next) });
        onChanged(j.interests);
        toast(t(s ? "search.removed" : "search.added"));
      } catch (e) {
        if (!["signin", "401"].includes((e as Error).message)) toast((e as Error).message, "error");
      } finally {
        setBusy(null);
      }
    },
    [api, interests, onChanged, readOnly, state, t, toast],
  );
  return { state, toggle, busy };
}

function FollowGlyph({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {on ? <path d="m6 12.5 4 4 8-9" /> : <path d="M12 5.5v13M5.5 12h13" />}
    </svg>
  );
}

/** The round + / ✓ button, also used on the stock page. */
export function FollowButton({ symbol, name, region, type, follow, label }: { symbol: string; name: string; region?: "vn" | "intl"; type?: string; follow: ReturnType<typeof useFollow>; label?: boolean }) {
  const { t } = usePrefs();
  const s = follow.state(symbol);
  const on = !!s;
  const title = s?.kind === "group" ? t("search.inGroup", { name: s.interest.name }) : on ? t("search.remove") : t("search.add");
  return (
    <button
      className={`follow-btn${on ? " on" : ""}${label ? " labeled" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        void follow.toggle({ symbol, name, region, type });
      }}
      disabled={follow.busy === symbol || s?.kind === "group"}
      aria-pressed={on}
      aria-label={title}
      title={title}
    >
      <FollowGlyph on={on} />
      {label && <span>{s?.kind === "group" ? t("search.inGroup", { name: s.interest.name }) : on ? t("search.following") : t("search.add")}</span>}
    </button>
  );
}

const POPULAR: SearchHit[] = [
  { symbol: "AAPL", name: "Apple", region: "intl", type: "EQUITY" },
  { symbol: "NVDA", name: "Nvidia", region: "intl", type: "EQUITY" },
  { symbol: "MSFT", name: "Microsoft", region: "intl", type: "EQUITY" },
  { symbol: "TSLA", name: "Tesla", region: "intl", type: "EQUITY" },
  { symbol: "FPT.VN", name: "FPT", region: "vn", type: "EQUITY", exchange: "HOSE" },
  { symbol: "VCB.VN", name: "Vietcombank", region: "vn", type: "EQUITY", exchange: "HOSE" },
  { symbol: "HPG.VN", name: "Hòa Phát", region: "vn", type: "EQUITY", exchange: "HOSE" },
  { symbol: "VNM.VN", name: "Vinamilk", region: "vn", type: "EQUITY", exchange: "HOSE" },
  { symbol: "^GSPC", name: SYMBOL_LABELS["^GSPC"], region: "intl", type: "INDEX" },
  { symbol: "^VNINDEX.VN", name: SYMBOL_LABELS["^VNINDEX.VN"], region: "vn", type: "INDEX" },
  { symbol: "BTC-USD", name: "Bitcoin", region: "intl", type: "CRYPTOCURRENCY" },
  { symbol: "GC=F", name: "Gold", region: "intl", type: "FUTURE" },
];

export function StockSearchSheet({
  onClose,
  onOpen,
  follow,
  readOnly,
}: {
  onClose: () => void;
  onOpen: (symbol: string) => void;
  follow: ReturnType<typeof useFollow>;
  readOnly: boolean;
}) {
  const { t, api, lang } = usePrefs();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const id = setTimeout(() => input.current?.focus(), 60);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setHits(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = setTimeout(() => {
      api<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(query)}&lang=${lang}`)
        .then((j) => {
          setHits(j.hits);
          setSel(0);
        })
        .catch(() => setHits([]))
        .finally(() => setLoading(false));
    }, 220);
    return () => clearTimeout(id);
  }, [q, api, lang]);

  const typing = q.trim().length > 0;
  // Once something is typed, never show the popular list (a tap mid-search must hit a real result).
  const list = typing ? hits ?? [] : lang === "vi" ? [...POPULAR.filter((p) => p.region === "vn"), ...POPULAR.filter((p) => p.region !== "vn")] : POPULAR;
  const syms = useMemo(() => list.slice(0, 12).map((h) => h.symbol), [list]);
  const live = useLiveQuotes(syms, "world");

  return (
    <Sheet title={t("search.title")} onClose={onClose} wide>
      <div className="ss-field">
        <IconSearch />
        <input
          ref={input}
          type="search"
          value={q}
          placeholder={t("search.placeholder")}
          aria-label={t("search.title")}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(list.length - 1, s + 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(0, s - 1)));
            else if (e.key === "Enter" && list[sel]) (e.preventDefault(), onOpen(list[sel].symbol));
          }}
        />
        {loading && <span className="ss-spin" aria-hidden="true" />}
      </div>
      <p className="ss-hint">{readOnly ? t("search.signin") : t("search.hint")}</p>
      {!typing && <div className="ss-section">{t("search.popular")}</div>}
      {typing && loading && !hits?.length && (
        <div className="ss-loading" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 52, marginTop: 8, borderRadius: 12 }} />
          ))}
        </div>
      )}
      {typing && hits && hits.length === 0 && !loading && <p className="ss-empty">{t("search.empty")}</p>}
      <ul className="ss-list" role="listbox" aria-label={t("search.title")}>
        {list.map((h, i) => {
          const l = live.get(h.symbol);
          return (
            <li key={h.symbol}>
              <div
                className="ss-row"
                role="option"
                aria-selected={i === sel}
                tabIndex={-1}
                onMouseMove={() => setSel(i)}
                onClick={() => onOpen(h.symbol)}
              >
                <div className="ss-main">
                  <div className="ss-sym">
                    <b>{symLabel(h.symbol)}</b>
                    {h.region === "vn" && <span className="ss-flag" title={t("sec.vn")}>VN</span>}
                    {(h.exchange || h.type === "INDEX") && <span className="ss-ex">{h.type === "INDEX" ? "Index" : h.exchange}</span>}
                  </div>
                  <div className="ss-name">{h.name}{h.sub && h.sub !== h.name ? <span> · {h.sub}</span> : null}</div>
                </div>
                {l && (
                  <div className="ss-px">
                    <span className="num">{fmtPrice(l.price)}</span>
                    <span className={`ss-chg num ${Math.abs(l.changePct) < 0.005 ? "flat-bg" : l.changePct > 0 ? "up-bg" : "down-bg"}`}>{fmtPct(l.changePct)}</span>
                  </div>
                )}
                <FollowButton symbol={h.symbol} name={h.name} region={h.region} type={h.type} follow={follow} />
              </div>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
