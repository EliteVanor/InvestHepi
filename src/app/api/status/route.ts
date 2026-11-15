import { authorized, unauthorized } from "@/lib/auth";
import { emailProvider } from "@/lib/email";
import { providerChain } from "@/lib/llm";
import { getJSON, storeKind } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Setup checklist for the Settings → Status panel. Never returns secret values. */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  const last = Object.fromEntries(
    await Promise.all((["interests", "world", "us"] as const).map(async (s) => [s, await getJSON(`lastRefresh:${s}`)])),
  );
  return Response.json({
    providers: providerChain().map((p) => p.id),
    store: storeKind,
    finnhub: Boolean(process.env.FINNHUB_API_KEY),
    password: Boolean(process.env.APP_PASSWORD),
    cronSecret: Boolean(process.env.CRON_SECRET),
    email: emailProvider(),
    lastRefresh: last,
  });
}
