/** Shared by server (briefing language) and client (UI language). */
export const LANGUAGES = [
  { code: "en", native: "English", english: "English", locale: "en-US", speech: "en-US" },
  { code: "vi", native: "Tiếng Việt", english: "Vietnamese", locale: "vi-VN", speech: "vi-VN" },
  { code: "zh", native: "简体中文", english: "Simplified Chinese", locale: "zh-CN", speech: "zh-CN" },
  { code: "ja", native: "日本語", english: "Japanese", locale: "ja-JP", speech: "ja-JP" },
  { code: "ko", native: "한국어", english: "Korean", locale: "ko-KR", speech: "ko-KR" },
  { code: "es", native: "Español", english: "Spanish", locale: "es-ES", speech: "es-ES" },
  { code: "fr", native: "Français", english: "French", locale: "fr-FR", speech: "fr-FR" },
  { code: "de", native: "Deutsch", english: "German", locale: "de-DE", speech: "de-DE" },
] as const;

export type LangCode = (typeof LANGUAGES)[number]["code"];

export const isLang = (c: unknown): c is LangCode => LANGUAGES.some((l) => l.code === c);
export const langInfo = (c: string) => LANGUAGES.find((l) => l.code === c) ?? LANGUAGES[0];
