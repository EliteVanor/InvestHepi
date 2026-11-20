"use client";

/** The watchlist, the holdings card and editor, and the ticker search they use. */
import { useEffect, useMemo, useState } from "react";
import { type MsgKey } from "@/lib/i18n";
import { type Holding, type Outlook, type Quote } from "@/lib/types";
import { IconEye, IconPlus, IconSearch, IconTarget, IconX } from "./Icons";
import { lsGet, lsSet, usePrefs } from "./prefs";
import { fmtPct, fmtPrice } from "./primitives";
import { langInfo } from "@/lib/languages";
import { priceDigits } from "@/lib/symbols";
import { summarize } from "@/lib/portfolioMath";
import { windowChange, type QuoteWindow } from "@/lib/quote-view";
import { type SearchHit } from "@/lib/search";
import { type Technicals } from "@/lib/technicals";
import { useLiveQuotes } from "./live";
import { useToast } from "./toast";

type SortKey = "symbol" | "price" | "day" | "d5" | "m1" | "rsi" | "vs50" | "range" | "call";

export function Watchlist({ symbols, quotes, technicals, outlook, onOpen }: { symbols: string[]; quotes: Quote[]; technicals?: Record<string, Technicals>; outlook: Outlook[]; onOpen: (s: string) => void }) {
  const { t } = usePrefs();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "day", dir: -1 });

  const rows = useMemo(() => {
    const list = symbols
      .map((s) => {
        const q = quotes.find((x) => x.symbol === s);
        const tech = technicals?.[s];
        const o = outlook.find((x) => x.ticker === s);
        if (!q && !tech) return null;
        const price = q?.price ?? tech!.price;
        // 5D and 1M: the one window rule, on the quote's own series when there is one.
        const win = (w: QuoteWindow) => (q ? windowChange(q.history, price, w, q.session) ?? undefined : undefined);
        const range = tech?.high52 != null && tech.low52 != null && tech.high52 > tech.low52 ? ((price - tech.low52) / (tech.high52 - tech.low52)) * 100 : undefined;
        return {
          symbol: s,
          price,
          proxy: q?.proxy,
          estimated: !!q?.estimatedVia,
          stale: !!q?.stale,
          day: q?.changePct,
          d5: win("5d") ?? tech?.chg5d,
          m1: win("1mo") ?? tech?.chg1m,
          rsi: tech?.rsi14,
          vs50: tech?.sma50 ? ((price - tech.sma50) / tech.sma50) * 100 : undefined,
          range,
          low: tech?.low52,
          high: tech?.high52,
          o,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r != null);
    const val = (r: (typeof list)[number]): number | string => {
      if (sort.key === "symbol") return r.symbol;
      if (sort.key === "call") return r.o?.confidence ?? -1;
      return (r[sort.key] as number | undefined) ?? -Infinity;
    };
    return list.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      return (typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number)) * sort.dir;
    });
  }, [symbols, quotes, technicals, outlook, sort]);

  if (!rows.length) return null;
  const th = (key: SortKey, label: string, cls = "") => (
    <th className={cls} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "symbol" ? 1 : -1 }))}>
        {label}
        <span className="wl-sort">{sort.key === key ? (sort.dir === 1 ? "↑" : "↓") : ""}</span>
      </button>
    </th>
  );
  const pct = (n: number | undefined, d = 1) => (n == null ? <span className="muted">–</span> : <span className={`num ${n >= 0 ? "up" : "down"}`}>{fmtPct(n, d)}</span>);

  return (
    <section className="card" aria-labelledby="wl-h">
      <h2 className="card-title" id="wl-h">
        <IconTarget /> {t("wl.title")}
      </h2>
      <div className="wl-wrap">
        <table className="wl">
          <thead>
            <tr>
              {th("symbol", t("wl.ticker"), "wl-sticky")}
              {th("price", t("wl.price"))}
              {th("day", t("wl.day"))}
              {th("d5", t("wl.5d"), "wl-m-hide")}
              {th("m1", t("wl.1m"))}
              {th("rsi", t("wl.rsi"))}
              {th("vs50", t("wl.vs50"), "wl-m-hide")}
              {th("range", t("wl.range"), "wl-m-hide")}
              {th("call", t("wl.call"))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} onClick={() => onOpen(r.symbol)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen(r.symbol)}>
                <td className="wl-sticky"><b>{r.symbol}</b></td>
                <td className={`num${r.stale ? " stale" : ""}`} title={r.stale ? t("strip.stale") : undefined}>{r.proxy ? t("strip.viaShort", { etf: r.proxy }) : `${r.estimated ? "≈" : ""}${fmtPrice(r.price, priceDigits(r.symbol, r.price))}`}</td>
                <td>{pct(r.day, 2)}</td>
                <td className="wl-m-hide">{pct(r.d5)}</td>
                <td>{pct(r.m1)}</td>
                <td>
                  {r.rsi == null ? <span className="muted">–</span> : <span className={`num ${r.rsi >= 70 ? "down" : r.rsi <= 30 ? "up" : ""}`}>{r.rsi.toFixed(0)}</span>}
                </td>
                <td className="wl-m-hide">{pct(r.vs50)}</td>
                <td className="wl-m-hide">
                  {r.range == null ? (
                    <span className="muted">–</span>
                  ) : (
                    <span className="wl-range" title={`${fmtPrice(r.low!)} – ${fmtPrice(r.high!)}`}>
                      <i style={{ left: `${Math.max(0, Math.min(100, r.range))}%` }} />
                    </span>
                  )}
                </td>
                <td>
                  {r.o ? (
                    <span className={`action ${r.o.action}`} style={{ marginLeft: 0, fontSize: 12, padding: "3px 9px" }}>
                      {t(`act.${r.o.action}` as MsgKey)} <span className="num" style={{ opacity: 0.8 }}>{r.o.confidence}</span>
                    </span>
                  ) : (
                    <span className="muted">–</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const money = (n: number, currency: string, locale: string, sign = false) =>
  `${sign && n > 0 ? "+" : ""}${new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: Math.abs(n) >= 1000 || currency === "VND" ? 0 : 2 }).format(n)}`;

export function PortfolioCard({ holdings, onEdit, onOpen }: { holdings: Holding[]; onEdit: () => void; onOpen: (s: string) => void }) {
  const { t, lang } = usePrefs();
  const locale = langInfo(lang).locale;
  const [hide, setHide] = useState(false);
  useEffect(() => setHide(lsGet("ih-pf-hide", false)), []);
  const live = useLiveQuotes(useMemo(() => holdings.map((h) => h.symbol), [holdings]));
  const s = useMemo(() => summarize(holdings, [...live.values()]), [holdings, live]);

  if (!holdings.length)
    return (
      <section className="card" aria-labelledby="pf-h">
        <h2 className="card-title" id="pf-h">{t("pf.title")}</h2>
        <p className="muted" style={{ marginTop: 0 }}>{t("pf.empty")}</p>
        <button className="pill-btn" onClick={onEdit}>
          <IconPlus /> {t("pf.add")}
        </button>
      </section>
    );
  const amt = (n: number, currency: string, sign = false) => (hide ? "•••" : money(n, currency, locale, sign));
  return (
    <section className="card" aria-labelledby="pf-h">
      <h2 className="card-title" id="pf-h">
        {t("pf.title")}
        <span className="spacer" />
        <button
          className="icon-btn"
          style={{ width: 28, height: 28 }}
          onClick={() => {
            setHide((h) => (lsSet("ih-pf-hide", !h), !h));
          }}
          aria-label={hide ? t("pf.show") : t("pf.hide")}
          aria-pressed={hide}
        >
          <IconEye />
        </button>
        <button className="pill-btn" style={{ textTransform: "none", letterSpacing: 0, height: 28 }} onClick={onEdit}>
          {t("pf.edit")}
        </button>
      </h2>
      {s.positions.length === 0 ? (
        <div className="skeleton" style={{ height: 90 }} />
      ) : (
        <>
          {/* One subtotal per currency: VND and USD are never added together (no conversion). */}
          {s.groups.map((g) => (
            <div className="pf-group" key={g.currency}>
              <div className="pf-total num">{amt(g.value, g.currency)}</div>
              <div className="pf-sub">
                <span className={`num ${g.dayPnl >= 0 ? "up" : "down"}`}>
                  {amt(g.dayPnl, g.currency, true)} ({fmtPct(g.dayPct)})
                </span>
                <span className="muted">{t("pf.today")}</span>
                <span className={`num ${g.totalPnl >= 0 ? "up" : "down"}`}>{fmtPct(g.totalPct, 1)}</span>
                <span className="muted">{t("pf.total")}</span>
              </div>
              <div className="pf-rows">
                {g.positions.map((p) => (
                  <button key={p.symbol} className="pf-row" onClick={() => onOpen(p.symbol)}>
                    <b>{p.symbol}</b>
                    <span className="pf-weight" title={`${p.weight.toFixed(0)}%`}>
                      <i style={{ width: `${p.weight}%` }} />
                    </span>
                    <span className={`num ${p.dayPct >= 0 ? "up" : "down"}`}>{fmtPct(p.dayPct)}</span>
                    <span className="num pf-val">{amt(p.value, p.currency)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {s.groups.length > 1 && <p className="hint">{t("pf.perCurrency")}</p>}
        </>
      )}
    </section>
  );
}

/** Debounced ticker / company search with a dropdown. */
export function TickerSearch({ onPick, placeholder }: { onPick: (symbol: string) => void; placeholder?: string }) {
  const { t, api } = usePrefs();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setHits([]);
      return;
    }
    const id = setTimeout(() => {
      api<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(query)}`)
        .then((j) => {
          setHits(j.hits);
          setSel(0);
        })
        .catch(() => setHits([]));
    }, 220);
    return () => clearTimeout(id);
  }, [q, api]);
  const pick = (s: string) => {
    onPick(s);
    setQ("");
    setHits([]);
  };
  return (
    <div className="tsearch">
      <div className="search" style={{ marginBottom: 0 }}>
        <IconSearch />
        <input
          type="search"
          value={q}
          placeholder={placeholder ?? t("pf.search")}
          aria-label={placeholder ?? t("pf.search")}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(hits.length - 1, s + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (hits[sel]) pick(hits[sel].symbol);
              else if (/^[A-Za-z0-9.^=\-]{1,12}$/.test(q.trim())) pick(q.trim().toUpperCase());
            }
          }}
        />
      </div>
      {hits.length > 0 && (
        <div className="tsearch-list" role="listbox">
          {hits.map((h, i) => (
            <button key={h.symbol} role="option" aria-selected={i === sel} onMouseMove={() => setSel(i)} onClick={() => pick(h.symbol)}>
              <b>{h.symbol}</b>
              <span>{h.name}</span>
              <small>{h.exchange ?? h.type ?? ""}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function HoldingsEditor({ onSaved }: { onSaved: (h: Holding[]) => void }) {
  const { t, api } = usePrefs();
  const toast = useToast();
  type Row = { symbol: string; shares: string; cost: string };
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ holdings: Holding[] }>("/api/portfolio")
      .then((j) => setRows(j.holdings.map((h) => ({ symbol: h.symbol, shares: String(h.shares), cost: String(h.cost) }))))
      .catch(() => setRows([]));
  }, [api]);
  if (!rows) return <div className="skeleton" style={{ height: 160, marginTop: 18 }} />;
  const up = (i: number, patch: Partial<Row>) => setRows((r) => r!.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async () => {
    setBusy(true);
    try {
      const body = rows.filter((r) => r.symbol && Number(r.shares) > 0).map((r) => ({ symbol: r.symbol.toUpperCase(), shares: Number(r.shares), cost: Number(r.cost) || 0 }));
      const j = await api<{ holdings: Holding[] }>("/api/portfolio", { method: "PUT", body: JSON.stringify(body) });
      setRows(j.holdings.map((h) => ({ symbol: h.symbol, shares: String(h.shares), cost: String(h.cost) })));
      onSaved(j.holdings);
      toast(t("set.saved"));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sheet-section">
      <p className="hint" style={{ marginTop: 0 }}>{t("pf.privacy")}</p>
      <div className="group">
        {rows.length === 0 && (
          <div className="row"><span className="label muted">{t("pf.empty")}</span></div>
        )}
        {rows.map((r, i) => (
          <div className="row hold-row" key={i}>
            <b className="hold-sym">{r.symbol}</b>
            <label>
              <span>{t("pf.shares")}</span>
              <input className="num-input" type="number" min={0} step="any" value={r.shares} onChange={(e) => up(i, { shares: e.target.value })} />
            </label>
            <label>
              <span>{t("pf.cost")}</span>
              <input className="num-input" type="number" min={0} step="any" value={r.cost} onChange={(e) => up(i, { cost: e.target.value })} />
            </label>
            <button className="icon-btn" onClick={() => setRows((x) => x!.filter((_, j) => j !== i))} aria-label={t("int.remove")}>
              <IconX />
            </button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <TickerSearch onPick={(symbol) => setRows((r) => (r!.some((x) => x.symbol === symbol) ? r : [...r!, { symbol, shares: "", cost: "" }]))} />
      </div>
      <div className="sheet-actions">
        <button className="btn-primary" onClick={save} disabled={busy}>
          {busy ? t("set.saving") : t("set.save")}
        </button>
      </div>
    </div>
  );
}
