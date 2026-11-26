/**
 * v19 final check (Nov 26): the file store writes atomically. `fs.writeFile` empties the file and then writes it,
 * so a reader in between got null: CI failed v14test at `(await getJSON(...))!.at` while a background catch-up
 * rewrote `ib:<hash>:last`. Writes now go to a temp file and are renamed into place.
 */
import assert from "node:assert/strict";

(async () => {
  const { getJSON, setJSON } = await import("../../src/lib/store");
  const big = (n: number) => ({ n, rows: Array.from({ length: 4000 }, (_, i) => ({ i, text: "headline text ".repeat(4) })) });
  await setJSON("atomic:test", big(0));
  let writing = true;
  let nulls = 0;
  let reads = 0;
  const reader = (async () => {
    while (writing) {
      const v = await getJSON<{ n: number }>("atomic:test");
      reads++;
      if (v === null) nulls++;
    }
  })();
  for (let n = 1; n <= 40; n++) await setJSON("atomic:test", big(n));
  writing = false;
  await reader;
  assert.ok(reads > 10, `the reader ran during the writes (${reads} reads)`);
  assert.equal(nulls, 0, `a reader never sees a half-written value (${nulls} of ${reads} reads were null)`);
  assert.equal((await getJSON<{ n: number }>("atomic:test"))?.n, 40, "the last write wins");
  console.log("FINAL STORE OK");
})();
