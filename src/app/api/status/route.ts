import { role } from "@/lib/auth";
import { emailProvider } from "@/lib/email";
import { providerChain } from "@/lib/llm";
import { usageReport } from "@/lib/llm/models";
import { multiUser } from "@/lib/mode";
import { currentInterestSet } from "@/lib/pipeline";
import { scheduleReport } from "@/lib/scheduler";
import { getJSON, storeKind } from "@/lib/store";
import { SHARED_SECTIONS } from "@/lib/types";
import { gate, listUsers } from "@/lib/users";

export const dynamic = "force-dynamic";

/** Setup checklist for the Settings → Status panel. Never returns secret values. */
export async function GET(req: Request) {
  return gate(req, {}, async (user) => {
    const { lang, hash } = await currentInterestSet(new URL(req.url).searchParams.get("lang") ?? undefined);
    const last: Record<string, unknown> = { interests: await getJSON(`ib:${hash}:last`) };
    for (const s of SHARED_SECTIONS) last[s] = await getJSON(`digest:${s}:${lang}:last`);
    const multi = multiUser();
    // Opt-in (a few store reads): slot states and the last tick, no secrets. Public on purpose so
    // anyone can check the schedule is running without signing in.
    const schedule = new URL(req.url).searchParams.get("schedule") ? await scheduleReport() : undefined;
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
      schedule,
      // Admin only: today's AI use per model against its free allowance.
      aiUsage: user?.admin || (!multi && role(req) === "owner") ? await usageReport() : undefined,
    });
  });
}
