/** Links from feeds and AI sources go into href: only http(s) is allowed (never javascript:, data:, ...). */
export function safeHttpUrl(link: unknown): string {
  if (typeof link !== "string") return "";
  const s = link.trim();
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? s : "";
  } catch {
    return "";
  }
}
