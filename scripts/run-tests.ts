/**
 * Runs every offline suite, one after another (they share the local store, so never in parallel),
 * keeps going when one fails, prints a summary and exits non-zero if any failed.
 * This list is the one place suites are registered: add a new suite here.
 * `npm test`, or `npx tsx scripts/run-tests.ts v18test selftest` to run only some.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const SUITES = [
  "i18ntest",
  "selftest",
  "llmtest",
  "v3test",
  "v4test",
  "v4btest",
  "v5test",
  "vntest",
  "searchtest",
  "securitytest",
  "v9test",
  "budgettest",
  "v10test",
  "v13test",
  "v14test",
  "v15test",
  "v16test",
  "v17test",
  "v18test",
  "v19test",
];

const dir = __dirname;

function main() {
  // A suite file that isn't in the list would never run in CI: fail loudly.
  const unlisted = readdirSync(dir)
    .filter((f) => /test\.ts$/.test(f))
    .map((f) => f.replace(/\.ts$/, ""))
    .filter((n) => !SUITES.includes(n));
  const listedMissing = SUITES.filter((n) => !existsSync(path.join(dir, `${n}.ts`)));
  if (unlisted.length || listedMissing.length) {
    console.error(`Suite list out of date: not listed [${unlisted.join(", ")}], missing files [${listedMissing.join(", ")}]`);
    process.exit(2);
  }

  const only = process.argv.slice(2).map((a) => a.replace(/^scripts\//, "").replace(/\.ts$/, ""));
  const unknown = only.filter((n) => !SUITES.includes(n));
  if (unknown.length) {
    console.error(`Unknown suite: ${unknown.join(", ")}`);
    process.exit(2);
  }
  const todo = only.length ? SUITES.filter((n) => only.includes(n)) : SUITES;

  const results: { name: string; ok: boolean; secs: number }[] = [];
  for (const name of todo) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, ["--import", "tsx", path.join(dir, `${name}.ts`)], { stdio: "inherit", env: process.env });
    const ok = r.status === 0;
    results.push({ name, ok, secs: (Date.now() - t0) / 1000 });
    if (!ok) console.error(`\n>>> ${name} FAILED (${r.signal ?? `exit ${r.status}`})\n`);
  }

  console.log("\nSuite summary");
  for (const r of results) console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.name} (${r.secs.toFixed(1)}s)`);
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\n${failed.length} of ${results.length} suites failed: ${failed.map((f) => f.name).join(", ")}` : `\nAll ${results.length} suites passed`);
  process.exit(failed.length ? 1 : 0);
}

main();
