"use client";

import { useEffect, useRef, useState } from "react";
import { relTime } from "@/lib/i18n";
import { langInfo } from "@/lib/languages";
import type { Digest } from "@/lib/types";
import { IconCopy, IconHistory, IconShare, IconSparkles, IconSpeaker, IconStop } from "../Icons";
import { usePrefs } from "../prefs";


/* -------------------------------------------------------------- Briefing */

export function briefingText(d: Digest, t: ReturnType<typeof usePrefs>["t"]): string {
  const a = d.analysis;
  const { headline, summary } = heroLines(d);
  const lines = [headline, "", ...summary.map((s) => `• ${s}`)];
  if (a.watchNext.length) lines.push("", t("watch.title"), ...a.watchNext.map((w) => `• ${w}`));
  return lines.join("\n");
}

/** v19 digests lead with "The big picture" (its first line as the headline, the rest below); older ones with the briefing headline and summary. */
function heroLines(d: Digest): { big: boolean; headline: string; summary: string[] } {
  const big = d.bigPicture ?? [];
  return big.length ? { big: true, headline: big[0], summary: big.slice(1) } : { big: false, headline: d.analysis.headline, summary: d.analysis.summary };
}

export function Briefing({
  digest, viewingOld, onBackToLatest, onHistory, onCatchUp, translating, translateFailed, aiFailedAt, rulesView, onToggleRules,
}: {
  digest: Digest; viewingOld: boolean; onBackToLatest: () => void; onHistory: () => void; onCatchUp: () => void; translating?: boolean; translateFailed?: boolean;
  /** The latest run couldn't use AI (when): the briefing shown is the last AI one. */
  aiFailedAt?: string | null;
  /** Showing the rule-based copy instead. */
  rulesView?: boolean;
  onToggleRules?: (on: boolean) => void;
}) {
  const { t, lang, timeAt } = usePrefs();
  const a = digest.analysis;
  const hero = heroLines(digest);
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => () => { if (canSpeak) window.speechSynthesis.cancel(); }, [canSpeak, digest]);

  const speak = () => {
    if (!canSpeak) return;
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    // Speak in the language the briefing was written in, not the UI language.
    const info = langInfo(digest.language ?? "en");
    const text = briefingText(digest, t).replace(/•/g, "").replace(/\n+/g, ". ");
    const u = new SpeechSynthesisUtterance(text);
    u.lang = info.speech;
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(info.code));
    if (voice) u.voice = voice;
    u.rate = 1.02;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    synth.cancel();
    synth.speak(u);
    setSpeaking(true);
  };

  const share = async () => {
    const text = briefingText(digest, t);
    try {
      if (navigator.share && window.matchMedia("(max-width: 719px)").matches) {
        await navigator.share({ title: "InvestHepi", text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };

  // Keyboard shortcut "L" dispatches this event.
  const speakRef = useRef(speak);
  speakRef.current = speak;
  useEffect(() => {
    const on = () => speakRef.current();
    window.addEventListener("ih-listen", on);
    return () => window.removeEventListener("ih-listen", on);
  }, []);

  const langMismatch = digest.provider !== "rules" && digest.language && digest.language !== lang;

  return (
    <section className="card hero" aria-labelledby="brief-h">
      {aiFailedAt && !viewingOld && onToggleRules && (
        <div className="banner ai-fallback top" role="status">
          <IconInfo16 />
          <span>
            {rulesView
              ? t("ai.rulesBanner")
              : t("ai.failedBanner", { age: relTime(digest.generatedAt, lang), time: timeAt(aiFailedAt) })}
          </span>
          <button onClick={() => onToggleRules(!rulesView)}>{rulesView ? t("ai.backToAi") : t("ai.showRules")}</button>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="chip accent">
          <IconSparkles width={13} height={13} /> {t(hero.big ? "story.bigPicture" : "brief.title")}
        </span>
        <span className={`chip mood ${a.mood}`}>{t(`mood.${a.mood}`)}</span>
      </div>
      <h2 id="brief-h" className="hero-headline">{hero.headline}</h2>
      <ul className="hero-summary">
        {hero.summary.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      {viewingOld && (
        <div className="banner info">
          <IconHistory />
          <span>{t("brief.viewingOld")}</span>
          <button onClick={onBackToLatest}>{t("brief.backToLatest")}</button>
        </div>
      )}
      {langMismatch && !viewingOld && (
        <div className="banner info">
          <IconInfo16 />
          <span>{translating ? t("brief.translating", { lang: langInfo(lang).native }) : translateFailed ? t("brief.translateFailed") : t("brief.langMismatch", { lang: langInfo(digest.language!).native })}</span>
        </div>
      )}
      <div className="hero-meta">
        <span title={timeAt(digest.generatedAt, { date: true })}>
          {t("brief.updated", { t: relTime(digest.generatedAt, lang) })} · {timeAt(digest.generatedAt)}
        </span>
        <span>{digest.provider === "rules" ? t("brief.rules") : providerName(digest.provider)}</span>
        {/* The story count jumps to the headlines list at the end of the page. */}
        <button className="meta-link" onClick={() => document.getElementById("headlines")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
          {t("brief.stories", { n: digest.news.length })}
        </button>
        <div className="hero-actions">
          <button className="pill-btn catch-btn" onClick={onCatchUp} title="C">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
            {t("catch.button")}
          </button>
          {canSpeak && (
            <button className={`pill-btn ${speaking ? "active" : ""}`} onClick={speak} aria-pressed={speaking}>
              {speaking ? <IconStop /> : <IconSpeaker />} {speaking ? t("nav.stop") : t("nav.listen")}
            </button>
          )}
          <button className="pill-btn" onClick={share}>
            {copied ? <IconCopy /> : <IconShare />} {copied ? t("nav.copied") : t("nav.share")}
          </button>
          <button className="pill-btn" onClick={onHistory}>
            <IconHistory /> <span className="desktop-only">{t("brief.history")}</span>
          </button>
        </div>
      </div>
    </section>
  );
}

function IconInfo16() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}


export function providerName(id: string): string {
  const p = id.split(":")[0];
  return { claude: "Claude", groq: "Groq", gemini: "Gemini" }[p] ?? p;
}
