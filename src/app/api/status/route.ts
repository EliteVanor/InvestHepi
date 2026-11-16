import { role } from "@/lib/auth";
import { emailProvider } from "@/lib/email";
import { providerChain } from "@/lib/llm";
import { multiUser } from "@/lib/mode";
import { currentInterestSet } from "@/lib/pipeline";
import { getJSON, storeKind } from "@/lib/store";
import { SHARED_SECTIONS } from "@/lib/types";
import { gate, listUsers } from "@/lib/users";

export const dynamic = "force-dynamic";

/** Setup checklist for the Settings → Status panel. Never returns secret values. */
export async function GET(req: Request) {
  return gate(req, {}, async (user) => {
    const { lang, hash } = await currentInterestSet(new URL(req.url).searchParams.get("lang") ?? undefined);
    const last: Record<string, unknown> = { interests: await getJSON(`ib:${hash}:last`) };
    for (const s of SHARED_SECTIONS) last[s] = (await getJSON(`digest:${s}:${lang}:last`)) ?? (await getJSON(`lastRefresh:${s}`));
    const multi = multiUser();
    return Response.json({
      role: multi ? (user ? "owner" : "viewer") : role(req),
      mode: multi ? "multi" : "single",
      users: multi && user?.admin ? (await listUsers()).length : undefined,
      providers: providerChain().map((p) => p.id),
      store: storeKind,
      finnhub: Boolean(process.env.FINNHUB_API_KEY),
      password: multi || Boolean(process.env.APP_PASSWORD),
      cronSecret: Boolean(process.env.CRON_SECRET),
      email: emailProvider(),
      lastRefresh: last,
    });
  });
}
