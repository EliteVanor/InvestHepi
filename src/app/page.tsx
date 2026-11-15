"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Digest, Direction, Interest, Outlook, SectionId } from "@/lib/types";
import { SECTIONS } from "@/lib/types";
import type { TrackStats } from "@/lib/track";

const PW_KEY = "ih-password";
const TAB_KEY = "ih-tab";

function safeGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {}
}

function timeAgo(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

const arrow = (d: Direction) => (d === "up" ? "▲" : d === "down" ? "▼" : "◆");

export default function Home() {
  const [tab, setTab] = useState<SectionId>("interests");
  const [password, setPassword] = useState<string>("");
  const [needPw, setNeedPw] = useState(false);
  const [digests, setDigests] = useState<Partial<Record<SectionId, Digest | null>>>({});
  const [store, setStore] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showTrack, setShowTrack] = useState(false);

  useEffect(() => {
    setPassword(safeGet(PW_KEY) ?? "");
    const t = safeGet(TAB_KEY) as SectionId | null;
    if (t && SECTIONS.some((s) => s.id === t)) setTab(t);
  }, []);

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", "x-app-password": password, ...(init?.headers ?? {}) } });
      if (res.status === 401) {
        setNeedPw(true);
        throw new Error("Password required");
      }
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      return j;
    },
    [password],
  );

  const load = useCallback(
    async (section: SectionId) => {
      setLoading(true);
      setError("");
      try {
        const j = await api(`/api/digest?section=${section}`);
        setDigests((d) => ({ ...d, [section]: j.digest }));
        setStore(j.store);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    load(tab);
    safeSet(TAB_KEY, tab);
  }, [tab, load]);

  const refresh = async (section: SectionId) => {
    setRefreshing(true);
    setError("");
    try {
      const r = await api(`/api/refresh?section=${section}`, { method: "POST" });
      const failed = r.results?.find((x: { ok: boolean }) => !x.ok);
      if (failed) setError(failed.error);
      await load(section);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const digest = digests[tab];

  return (
    <>
      <header className="top">
        <div className="top-inner">
          <div className="brand">
            Invest Helper <span>· daily catch-up</span>
          </div>
          <nav className="tabs" aria-label="Sections">
            {SECTIONS.map((s) => (
              <button key={s.id} className={`tab ${tab === s.id ? "active" : ""}`} onClick={() => setTab(s.id)}>
                {s.label}
              </button>
            ))}
          </nav>
          <button className="icon-btn" onClick={() => refresh(tab)} disabled={refreshing} title="Fetch news and re-run the analysis">
            {refreshing ? "Analyzing…" : "↻ Refresh"}
          </button>
          <button className="icon-btn" onClick={() => setShowTrack(true)}>
            Track record
          </button>
          <button className="icon-btn" onClick={() => setShowSettings(true)}>
            ⚙ Interests
          </button>
        </div>
      </header>

      <main className="wrap">
        {digest?.quotes?.length ? (
          <div className="strip">
            {digest.quotes.map((q) => (
              <div className="quote" key={q.symbol}>
                <b>{q.symbol}</b>
                <span>{q.price.toFixed(2)}</span>
                <span className={q.changePct >= 0 ? "pos" : "neg"}>
                  {q.changePct >= 0 ? "+" : ""}
                  {q.changePct.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {error && <div className="warn">{error}</div>}
        {store === "ephemeral" && (
          <div className="warn">No database connected, so digests and the track record reset whenever Vercel recycles the server. Add the free Upstash Redis integration (see README).</div>
        )}

        {loading && !digest ? (
          <div className="empty">Loading…</div>
        ) : !digest ? (
          <div className="empty">
            <p>No briefing yet for this section.</p>
            <button className="btn-primary" onClick={() => refresh(tab)} disabled={refreshing}>
              {refreshing ? "Fetching news and analyzing (up to a minute)…" : "Generate briefing now"}
            </button>
          </div>
        ) : (
          <SectionView digest={digest} />
        )}

        <footer>
          AI-generated predictions from public headlines. They can be wrong. Check the track record before trusting the confidence numbers. Not financial advice.
        </footer>
      </main>

      {needPw && (
        <PasswordModal
          onSubmit={(pw) => {
            safeSet(PW_KEY, pw);
            setPassword(pw);
            setNeedPw(false);
          }}
        />
      )}
      {showSettings && (
        <SettingsModal
          api={api}
          onClose={() => setShowSettings(false)}
          onSaved={() => {
            setShowSettings(false);
            setTab("interests");
            refresh("interests");
          }}
        />
      )}
      {showTrack && <TrackModal api={api} onClose={() => setShowTrack(false)} />}
    </>
  );
}

function SectionView({ digest }: { digest: Digest }) {
  const a = digest.analysis;
  const tags = useMemo(() => [...new Set(digest.news.flatMap((n) => n.tags ?? []))], [digest.news]);
  const [filter, setFilter] = useState<string | null>(null);
  const news = filter ? digest.news.filter((n) => n.tags?.includes(filter)) : digest.news;

  return (
    <>
      <div className="meta">
        <span>Updated {timeAgo(digest.generatedAt)}</span>
        <span className="pill">{digest.provider === "rules" ? "rule-based (no AI key)" : digest.provider}</span>
        <span>{digest.news.length} stories</span>
        {digest.feedErrors.length > 0 && (
          <details>
            <summary>{digest.feedErrors.length} feed(s) failed</summary>
            <div className="small">{digest.feedErrors.join(" · ")}</div>
          </details>
        )}
      </div>
      {digest.providerNote && <div className="warn">{digest.providerNote}</div>}

      <section className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Briefing</h2>
          <span className={`mood ${a.mood}`}>{a.mood}</span>
        </div>
        <p className="headline">{a.headline}</p>
        <ul className="summary">
          {a.summary.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </section>

      {a.outlook.length > 0 && (
        <section className="card">
          <h2>What to do</h2>
          <div className="outlook-grid">
            {a.outlook.map((o, i) => (
              <OutlookCard key={i} o={o} />
            ))}
          </div>
        </section>
      )}

      <div className="two-col">
        <section className="card">
          <h2>Key events and impact</h2>
          {a.events.length === 0 && <p className="small">No major events detected.</p>}
          {a.events.map((e, i) => (
            <article className="event" key={i}>
              <h3>
                <span className="imp" title={`Importance ${e.importance}/5`}>
                  {"●".repeat(e.importance)}
                  {"○".repeat(5 - e.importance)}
                </span>
                {e.title}
              </h3>
              <p className="small">
                <b>What happened:</b> {e.whatHappened}
              </p>
              <p className="small">
                <b>Why it matters:</b> {e.whyItMatters}
              </p>
              <div className="impacts">
                {e.impacts.map((im, j) => (
                  <span key={j} className={`chip ${im.direction}`} title={im.reasoning}>
                    {arrow(im.direction)} {im.interest} · {im.magnitude} · {im.confidence}%
                  </span>
                ))}
              </div>
              {e.analog && (
                <div className="analog">
                  <b>Past example · {e.analog.date}</b>
                  {e.analog.event}: {e.analog.whatHappenedNext}
                </div>
              )}
              <p className="risk">⚠ What could go wrong: {e.whatCouldGoWrong}</p>
              {e.sourceIds.length > 0 && (
                <div className="sources">
                  Sources:{" "}
                  {e.sourceIds
                    .map((id) => digest.news[id])
                    .filter(Boolean)
                    .slice(0, 4)
                    .map((n) => (
                      <a key={n.id} href={n.link} target="_blank" rel="noreferrer">
                        {n.source}
                      </a>
                    ))}
                </div>
              )}
            </article>
          ))}
        </section>

        <div>
          {a.watchNext.length > 0 && (
            <section className="card">
              <h2>Watch next</h2>
              <ul className="summary">
                {a.watchNext.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </section>
          )}
          <section className="card">
            <h2>Headlines</h2>
            {tags.length > 1 && (
              <div className="filters">
                <button className={`filter ${!filter ? "active" : ""}`} onClick={() => setFilter(null)}>
                  All
                </button>
                {tags.map((t) => (
                  <button key={t} className={`filter ${filter === t ? "active" : ""}`} onClick={() => setFilter(t)}>
                    {t}
                  </button>
                ))}
              </div>
            )}
            {news.map((n) => (
              <div className="news-item" key={n.id}>
                <a href={n.link} target="_blank" rel="noreferrer">
                  {n.title}
                </a>
                <div className="news-meta">
                  {n.source} · {timeAgo(n.publishedAt)}
                  {n.tags?.map((t) => (
                    <span className="tag" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </section>
        </div>
      </div>
    </>
  );
}

function OutlookCard({ o }: { o: Outlook }) {
  return (
    <div className="ol">
      <div className="ol-top">
        <span className="ol-name">{o.interest}</span>
        <span className="ol-ticker">{o.ticker}</span>
        <span className={`action ${o.action}`}>{o.action}</span>
      </div>
      <div>
        <span className={`dir ${o.direction}`}>
          {arrow(o.direction)} {o.direction.toUpperCase()}
        </span>{" "}
        <span className="small">· {o.horizon}</span>
      </div>
      <div className="conf">
        <span>Confidence {o.confidence}%</span>
        <div className="bar">
          <i style={{ width: `${o.confidence}%` }} />
        </div>
      </div>
      <p className="trigger">{o.actionTrigger}</p>
      <p className="small">{o.rationale}</p>
      <p className="small">
        <b>Risks:</b> {o.risks}
      </p>
    </div>
  );
}

function PasswordModal({ onSubmit }: { onSubmit: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  return (
    <div className="overlay">
      <form
        className="modal"
        style={{ maxWidth: 380 }}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(pw);
        }}
      >
        <h2>Password</h2>
        <p className="small">Enter the APP_PASSWORD you set in Vercel. It's saved in this browser.</p>
        <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
        <div className="modal-actions">
          <button className="btn-primary" type="submit">
            Unlock
          </button>
        </div>
      </form>
    </div>
  );
}

type Api = (path: string, init?: RequestInit) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function SettingsModal({ api, onClose, onSaved }: { api: Api; onClose: () => void; onSaved: () => void }) {
  const [list, setList] = useState<(Interest & { tickerText: string })[]>([]);
  const [defaults, setDefaults] = useState<Interest[]>([]);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const withText = (l: Interest[]) => l.map((i) => ({ ...i, tickerText: i.tickers.join(", ") }));

  useEffect(() => {
    api("/api/interests")
      .then((j) => {
        setList(withText(j.interests));
        setDefaults(j.defaults);
      })
      .catch((e) => setErr(e.message));
  }, [api]);

  const update = (i: number, patch: Partial<Interest & { tickerText: string }>) => setList((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      const body = list.map((x, i) => ({
        id: x.id || `${x.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30) || "interest"}-${i}`,
        name: x.name.trim(),
        query: x.query.trim() || x.name.trim(),
        tickers: x.tickerText
          .split(/[\s,]+/)
          .map((t) => t.trim().toUpperCase())
          .filter(Boolean),
      }));
      await api("/api/interests", { method: "PUT", body: JSON.stringify(body) });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Your interests</h2>
        <p className="small">
          Each interest gets its own news search and outlook. The <b>first ticker</b> is the benchmark used for the outlook and the track record. Use
          ETFs for broad themes (QQQ, SPY, SOXX, SMH, XLE…).
        </p>
        {list.map((x, i) => (
          <div className="row" key={i}>
            <div>
              <label>Name</label>
              <input type="text" value={x.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="e.g. Energy" />
            </div>
            <div>
              <label>News search (keywords, OR, "quoted phrases")</label>
              <input type="text" value={x.query} onChange={(e) => update(i, { query: e.target.value })} placeholder='oil prices OR "energy stocks"' />
            </div>
            <div>
              <label>Tickers (first = benchmark)</label>
              <input type="text" value={x.tickerText} onChange={(e) => update(i, { tickerText: e.target.value })} placeholder="XLE, XOM, CVX" />
            </div>
            <button className="icon-btn" onClick={() => setList((l) => l.filter((_, j) => j !== i))} aria-label="Remove">
              ✕
            </button>
          </div>
        ))}
        {err && <div className="warn">{err}</div>}
        <div className="modal-actions">
          <button className="icon-btn" onClick={() => setList(withText(defaults))}>
            Reset to defaults
          </button>
          <button className="icon-btn" onClick={() => setList((l) => [...l, { id: "", name: "", query: "", tickers: [], tickerText: "" }])}>
            + Add interest
          </button>
          <button className="icon-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save and re-analyze"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TrackModal({ api, onClose }: { api: Api; onClose: () => void }) {
  const [s, setS] = useState<TrackStats | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api("/api/track").then(setS).catch((e) => setErr(e.message));
  }, [api]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Track record</h2>
        <p className="small">
          Every outlook in My Interests is logged as a call on the next session that hasn't opened yet, then graded against the real close. If the
          70-79% bucket is right only 55% of the time, the AI is overconfident, and it sees these numbers on every run so it can adjust.
        </p>
        {err && <div className="warn">{err}</div>}
        {!s ? (
          <p className="small">Loading…</p>
        ) : (
          <>
            <p className="headline" style={{ fontSize: 20 }}>
              {s.hitRate == null ? "No graded calls yet" : `${(s.hitRate * 100).toFixed(0)}% hit rate`}
              <span className="small" style={{ fontWeight: 400 }}>
                {" "}
                · {s.graded} graded / {s.total} logged
              </span>
            </p>
            <table>
              <thead>
                <tr>
                  <th>Stated confidence</th>
                  <th>Calls</th>
                  <th>Actually right</th>
                </tr>
              </thead>
              <tbody>
                {s.buckets.map((b) => (
                  <tr key={b.label}>
                    <td>{b.label}</td>
                    <td>{b.n}</td>
                    <td>{b.n ? `${((b.hits / b.n) * 100).toFixed(0)}%` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h2 style={{ marginTop: 18, fontSize: 14 }}>Recent calls</h2>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>Ticker</th>
                    <th>Call</th>
                    <th>Conf</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {s.recent.map((c) => (
                    <tr key={c.id}>
                      <td>
                        {c.date}
                        {c.id.endsWith(":w") ? " (wk)" : ""}
                      </td>
                      <td>{c.ticker}</td>
                      <td className={`dir ${c.direction}`}>
                        {arrow(c.direction)} {c.action}
                      </td>
                      <td>{c.confidence}%</td>
                      <td>
                        {c.correct === undefined ? (
                          <span className="small">pending</span>
                        ) : (
                          <span className={c.correct ? "pos" : "neg"}>
                            {c.correct ? "✓" : "✗"} {c.returnPct! >= 0 ? "+" : ""}
                            {c.returnPct!.toFixed(2)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="modal-actions">
          <button className="icon-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
