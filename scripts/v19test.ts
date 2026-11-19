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
let failed = 0;
for (const p of parts) {
  const r = spawnSync(process.execPath, ["--import", "tsx", path.join(dir, p)], { stdio: "inherit", env: process.env });
  if (r.status !== 0) {
    failed++;
    console.error(`v19 part ${p} FAILED`);
  }
}
if (failed) process.exit(1);
console.log(`V19 OK (${parts.length} parts)`);
