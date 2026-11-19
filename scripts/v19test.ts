/**
 * v19 regression tests. Each v19 fix adds its own part as `scripts/v19/<topic>.ts` (a standalone
 * script using node:assert, printing "<TOPIC> OK"); this suite runs every part in its own process,
 * so parts can be written in parallel without sharing state or editing this file.
 * A part that reads the clock calls pinClock from ../clock before importing src/.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const dir = path.join(__dirname, "v19");
const parts = readdirSync(dir).filter((f) => f.endsWith(".ts")).sort();
if (!parts.length) {
  console.error("v19: no parts found in scripts/v19");
  process.exit(1);
}
let failed = 0;
for (const p of parts) {
  // A part passes only if it exits 0 AND prints its "<TOPIC> OK" line, so a part that quits early can't pass.
  const r = spawnSync(process.execPath, ["--import", "tsx", path.join(dir, p)], { encoding: "utf8", env: process.env, timeout: 120_000 });
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  if (r.status !== 0 || !/\bOK\b/.test(r.stdout ?? "")) {
    failed++;
    console.error(`v19 part ${p} FAILED`);
  }
}
if (failed) process.exit(1);
console.log(`V19 OK (${parts.length} parts)`);
