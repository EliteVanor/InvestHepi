/**
 * Auth.js (NextAuth v5) with Google sign-in. JWT sessions, no database adapter: user data lives
 * in our own store keyed by a hash of the verified email (see src/lib/users.ts).
 * Env: AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET (and optionally OWNER_EMAIL).
 */
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 90 },
  trustHost: true,
  pages: {},
});
