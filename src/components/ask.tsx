"use client";

/**
 * Ask AI. One chat component, shown docked on the right on wide screens (AskPanel) and in a sheet on
 * phones (AskSheet). Conversations are saved to the account by /api/ask and listed by /api/chats;
 * the open chat is remembered per device. Suggested questions come from the briefing being read
 * (its calls, top event, biggest mover, next catalyst) and follow-ups from the last answer, so they
 * cost no AI calls.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarEvent, Digest } from "@/lib/types";
import type { T } from "@/lib/i18n";
import { relTime } from "@/lib/i18n";
import { useAccount } from "./account";
import { IconSparkles, IconX } from "./Icons";
import { calTitle, groupName, symName } from "./labels";
import { usePrefs } from "./prefs";
import { Sheet, fmtPct } from "./primitives";

export interface AskMsg {
  role: "user" | "assistant";
  content: string;
  sources?: { n: number; title: string; link: string; source: string }[];
  provider?: string;
  error?: boolean;
}

interface ChatMeta {
  id: string;
  title: string;
  section?: string;
  updatedAt: string;
  count: number;
}

export function renderAnswer(text: string) {
  const parts = text.split(/(\[\d{1,2}\])/g);
  return parts.map((p, i) => (/^\[\d{1,2}\]$/.test(p) ? <span className="cite" key={i}>{p.slice(1, -1)}</span> : <span key={i}>{p}</span>));
}

/** Questions about the briefing on screen, in the reader's language. Exported for tests. */
export function suggestionsFor(t: T, digest?: Digest | null, events: CalendarEvent[] = [], section?: string): string[] {
  const out: string[] = [];
  const a = digest?.analysis;
  if (a) {
    for (const o of a.outlook.slice(0, 2)) out.push(t("ask.sWhy", { action: t(`act.${o.action}`), name: groupName(t, o.interest) }));
    const ev = [...a.events].sort((x, y) => y.importance - x.importance)[0];
    const target = ev?.impacts[0]?.interest ?? a.outlook[0]?.interest;
    if (ev && target) out.push(t("ask.sEvent", { title: ev.title.length > 70 ? `${ev.title.slice(0, 68)}…` : ev.title, name: groupName(t, target) }));
    const mv = [...(a.movers ?? [])].sort((x, y) => Math.abs(y.changePct) - Math.abs(x.changePct))[0];
    if (mv) out.push(t("ask.sMover", { name: symName(t, mv.ticker), chg: fmtPct(mv.changePct) }));
  }
  const next = events.find((e) => section === "interests" || e.kind === "macro");
  if (next) out.push(t("ask.sWatch", { event: calTitle(t, next) }));
  out.push(t("ask.sSummary"));
  return [...new Set(out)].slice(0, 5);
}

const FOLLOW_UPS = ["ask.fRisks", "ask.fWrong", "ask.fSimple", "ask.fAct"] as const;
const CURRENT = "ih-chat-current";

export function AskPanel({
  digest, calendar, section, request, docked, onClose,
}: {
  digest?: Digest | null;
  calendar?: CalendarEvent[];
  section?: string;
  /** A question sent from elsewhere on the page ("explain this headline", the palette). */
  request?: { q?: string; n: number } | null;
  docked?: boolean;
  onClose?: () => void;
}) {
  const { t, api, lang } = usePrefs();
  const account = useAccount();
  // Saved chats need an account (or the single-user owner); visitors still get the intro and suggestions.
  const canSave = account.mode === "single" || !!account.user;
  const [msgs, setMsgs] = useState<AskMsg[]>([]);
  const [chatId, setChatId] = useState<string | undefined>();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [chats, setChats] = useState<ChatMeta[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reopen the chat this device was in.
  useEffect(() => {
    if (!canSave) return;
    let id: string | null = null;
    try {
      id = localStorage.getItem(CURRENT);
    } catch {}
    if (!id) return;
    api<{ chat: { id: string; messages: AskMsg[] } }>(`/api/chats?id=${encodeURIComponent(id)}`)
      .then((j) => {
        setChatId(j.chat.id);
        setMsgs(j.chat.messages);
      })
      .catch(() => {
        try {
          localStorage.removeItem(CURRENT);
        } catch {}
      });
  }, [api, canSave]);

  // Keep the newest message in view: the docked panel scrolls itself, the phone sheet scrolls its body.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const scroller = el.scrollHeight > el.clientHeight + 1 ? el : (el.closest(".sheet-body") as HTMLElement | null);
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [msgs, busy, view]);

  const remember = (id?: string) => {
    try {
      if (id) localStorage.setItem(CURRENT, id);
      else localStorage.removeItem(CURRENT);
    } catch {}
  };

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || busy) return;
      setView("chat");
      const history = msgs.filter((m) => !m.error).slice(-10).map((m) => ({ role: m.role, content: m.content }));
      setMsgs((m) => [...m, { role: "user", content: text }]);
      setQ("");
      setBusy(true);
      try {
        const r = await api<{ answer: string; sources: AskMsg["sources"]; provider: string; chatId?: string }>("/api/ask", {
          method: "POST",
          body: JSON.stringify({ question: text, history, lang, chatId, section }),
        });
        setMsgs((m) => [...m, { role: "assistant", content: r.answer, sources: r.sources, provider: r.provider }]);
        if (r.chatId) {
          setChatId(r.chatId);
          remember(r.chatId);
          setChats(null); // list is stale now
        }
      } catch (e) {
        const em = (e as Error).message;
        if (em !== "signin") setMsgs((m) => [...m, { role: "assistant", content: em === "NO_PROVIDER" ? t("ask.noProvider") : em, error: true }]);
        else setMsgs((m) => m.slice(0, -1));
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [api, busy, lang, msgs, t, chatId, section],
  );

  // Questions from elsewhere on the page.
  const lastReq = useRef(0);
  useEffect(() => {
    if (request?.q && request.n !== lastReq.current) {
      lastReq.current = request.n;
      send(request.q);
    } else if (request && request.n !== lastReq.current) {
      lastReq.current = request.n;
      inputRef.current?.focus();
    }
  }, [request, send]);

  const newChat = () => {
    setMsgs([]);
    setChatId(undefined);
    remember(undefined);
    setView("chat");
    inputRef.current?.focus();
  };

  const openHistory = () => {
    setView((v) => (v === "history" ? "chat" : "history"));
    if (chats === null && canSave) api<{ chats: ChatMeta[] }>("/api/chats").then((j) => setChats(j.chats)).catch(() => setChats([]));
  };

  const openChat = (id: string) =>
    api<{ chat: { id: string; messages: AskMsg[] } }>(`/api/chats?id=${encodeURIComponent(id)}`)
      .then((j) => {
        setChatId(j.chat.id);
        setMsgs(j.chat.messages);
        remember(j.chat.id);
        setView("chat");
      })
      .catch(() => {});

  const removeChat = (id: string) =>
    api(`/api/chats?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      .then(() => {
        setChats((c) => (c ?? []).filter((x) => x.id !== id));
        if (id === chatId) newChat();
      })
      .catch(() => {});

  const suggestions = suggestionsFor(t, digest, calendar, section);
  const lastAi = [...msgs].reverse().find((m) => m.role === "assistant" && !m.error);

  return (
    <div className={`ask ${docked ? "docked" : ""}`}>
      <div className="ask-head">
        {docked && (
          <>
            <IconSparkles width={18} height={18} style={{ color: "var(--purple)" }} />
            <b>{t("ask.title")}</b>
          </>
        )}
        <span className="spacer" />
        {canSave && (
          <button className="pill-btn" aria-pressed={view === "history"} onClick={openHistory}>
            {t("ask.history")}
          </button>
        )}
        {(msgs.length > 0 || view === "history") && (
          <button className="pill-btn" onClick={newChat}>
            {t("ask.clear")}
          </button>
        )}
        {onClose && (
          <button className="icon-btn" onClick={onClose} aria-label={t("set.close")}>
            <IconX />
          </button>
        )}
      </div>

      <div className="ask-body" ref={scrollRef}>
        {view === "history" ? (
          <div className="chat-history">
            {chats === null && <div className="skeleton" style={{ height: 120 }} />}
            {chats?.length === 0 && <p className="muted">{t("ask.noHistory")}</p>}
            {chats?.map((c) => (
              <div key={c.id} className={`chat-item ${c.id === chatId ? "on" : ""}`}>
                <button className="chat-open" onClick={() => openChat(c.id)}>
                  <span className="chat-title">{c.title}</span>
                  <small className="muted">
                    {relTime(c.updatedAt, lang)} · {t("ask.messages", { n: c.count })}
                  </small>
                </button>
                <button className="icon-btn" aria-label={t("ask.delete")} title={t("ask.delete")} onClick={() => removeChat(c.id)}>
                  <IconX />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="chat" aria-live="polite">
            {msgs.length === 0 && (
              <>
                <p className="hint" style={{ margin: 0 }}>{t("ask.intro")}</p>
                <div className="suggest">
                  {suggestions.map((s) => (
                    <button key={s} onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`bubble ${m.role === "user" ? "me" : "ai"}`} style={m.error ? { color: "var(--red)" } : undefined}>
                {m.role === "assistant" ? renderAnswer(m.content) : m.content}
                {m.role === "assistant" && (m.sources?.length || m.provider) ? (
                  <div className="bubble-meta">
                    {m.sources?.map((s) => (
                      <a key={s.n} href={s.link} target="_blank" rel="noreferrer" title={s.title}>
                        [{s.n}] {s.source}
                      </a>
                    ))}
                    {m.provider && <span>· {m.provider.split(":")[0]}</span>}
                  </div>
                ) : null}
              </div>
            ))}
            {busy && (
              <div className="bubble ai typing" aria-label={t("ask.thinking")}>
                <i />
                <i />
                <i />
              </div>
            )}
            {!busy && lastAi && msgs.at(-1) === lastAi && (
              <div className="suggest follow">
                {FOLLOW_UPS.map((k) => (
                  <button key={k} onClick={() => send(t(k))}>
                    {t(k)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(q);
        }}
      >
        <input ref={inputRef} autoFocus={!docked} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ask.placeholder")} maxLength={500} aria-label={t("ask.placeholder")} />
        <button type="submit" disabled={!q.trim() || busy} aria-label={t("ask.send")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
    </div>
  );
}

/** Phones and narrow windows: the same chat in a sheet. */
export function AskSheet({ onClose, initial, digest, calendar, section }: { onClose: () => void; initial?: string; digest?: Digest | null; calendar?: CalendarEvent[]; section?: string }) {
  const { t } = usePrefs();
  const [req] = useState(() => (initial ? { q: initial, n: Date.now() } : null));
  return (
    <Sheet
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <IconSparkles width={20} height={20} style={{ color: "var(--purple)" }} /> {t("ask.title")}
        </span>
      }
      onClose={onClose}
    >
      <AskPanel digest={digest} calendar={calendar} section={section} request={req} />
    </Sheet>
  );
}
