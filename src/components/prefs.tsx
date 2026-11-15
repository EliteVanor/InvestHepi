"use client";

/**
 * Per-device preferences and helpers: theme, UI language, password, read state, saved headlines.
 * Everything here lives in localStorage (wrapped in try/catch so private mode still works).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { makeT, type T } from "@/lib/i18n";
import { isLang, type LangCode } from "@/lib/languages";
import type { NewsItem } from "@/lib/types";

export type Theme = "system" | "light" | "dark";

const K = { theme: "ih-theme", lang: "ih-lang", pw: "ih-password", seen: "ih-seen", saved: "ih-saved" };
const MAX_SEEN = 4000;
const MAX_SAVED = 200;

export function lsGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
export function lsSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
function lsDel(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

function detectLang(): LangCode {
  if (typeof navigator === "undefined") return "en";
  const code = navigator.language?.slice(0, 2).toLowerCase();
  return isLang(code) ? code : "en";
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#000000" : "#f5f5f7");
}

interface Prefs {
  ready: boolean;
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  lang: LangCode;
  setLang: (l: LangCode) => void;
  t: T;
  needPassword: boolean;
  setPassword: (pw: string) => void;
  forgetPassword: () => void;
  api: <R = unknown>(path: string, init?: RequestInit) => Promise<R>;
  seen: Set<string>;
  markSeen: (ids: string[]) => void;
  saved: NewsItem[];
  toggleSaved: (n: NewsItem) => void;
  isSaved: (id: string) => boolean;
}

const Ctx = createContext<Prefs | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [theme, setThemeState] = useState<Theme>("system");
  const [lang, setLangState] = useState<LangCode>("en");
  const pwRef = useRef("");
  const [needPassword, setNeedPassword] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<NewsItem[]>([]);

  useEffect(() => {
    setThemeState(lsGet<Theme>(K.theme, "system"));
    const l = lsGet<string | null>(K.lang, null);
    setLangState(isLang(l) ? l : detectLang());
    pwRef.current = lsGet<string>(K.pw, "");
    setSeen(new Set(lsGet<string[]>(K.seen, [])));
    setSaved(lsGet<NewsItem[]>(K.saved, []));
    setReady(true);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    if (!ready) return;
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [theme, ready]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    lsSet(K.theme, t);
  }, []);
  const toggleTheme = useCallback(() => {
    const dark = document.documentElement.getAttribute("data-theme") === "dark" ||
      (!document.documentElement.getAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setTheme(dark ? "light" : "dark");
  }, [setTheme]);
  const setLang = useCallback((l: LangCode) => {
    setLangState(l);
    lsSet(K.lang, l);
  }, []);

  const t = useMemo(() => makeT(lang), [lang]);

  const api = useCallback(async <R,>(path: string, init?: RequestInit): Promise<R> => {
    const res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", "x-app-password": pwRef.current, ...(init?.headers ?? {}) },
    });
    if (res.status === 401) {
      setNeedPassword(true);
      throw new Error("401");
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
    return j as R;
  }, []);

  const setPassword = useCallback((pw: string) => {
    pwRef.current = pw;
    lsSet(K.pw, pw);
    setNeedPassword(false);
  }, []);
  const forgetPassword = useCallback(() => {
    pwRef.current = "";
    lsDel(K.pw);
  }, []);

  const markSeen = useCallback((ids: string[]) => {
    setSeen((prev) => {
      if (ids.every((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      const arr = [...next].slice(-MAX_SEEN);
      lsSet(K.seen, arr);
      return new Set(arr);
    });
  }, []);

  const toggleSaved = useCallback((n: NewsItem) => {
    setSaved((prev) => {
      const next = prev.some((x) => x.id === n.id) ? prev.filter((x) => x.id !== n.id) : [n, ...prev].slice(0, MAX_SAVED);
      lsSet(K.saved, next);
      return next;
    });
  }, []);
  const savedIds = useMemo(() => new Set(saved.map((s) => s.id)), [saved]);
  const isSaved = useCallback((id: string) => savedIds.has(id), [savedIds]);

  const value: Prefs = {
    ready, theme, setTheme, toggleTheme, lang, setLang, t, needPassword, setPassword, forgetPassword, api, seen, markSeen, saved, toggleSaved, isSaved,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs(): Prefs {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePrefs outside PrefsProvider");
  return v;
}
