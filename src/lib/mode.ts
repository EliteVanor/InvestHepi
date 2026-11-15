/** Multi-user accounts are on when Auth.js with Google is configured. */
export function multiUser(): boolean {
  return Boolean(process.env.AUTH_SECRET?.trim() && process.env.AUTH_GOOGLE_ID?.trim() && process.env.AUTH_GOOGLE_SECRET?.trim());
}
