import { after } from "next/server";

/**
 * Run work after the response is sent (Vercel keeps the function alive up to its maxDuration).
 * Outside a request (tests, scripts) `after` throws, so the work runs right away instead: awaited
 * when `inline` is "await" (tests can check its result), fire-and-forget otherwise.
 */
export async function background(fn: () => Promise<unknown>, inline: "await" | "detach" = "detach"): Promise<void> {
  const run = () => fn().then(() => undefined, () => undefined);
  try {
    after(run);
  } catch {
    if (inline === "await") await run();
    else void run();
  }
}
