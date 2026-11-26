/**
 * v19 recheck (Nov 26): no runtime import cycle between modules in `src/`. pipeline.ts and predictions.ts
 * imported each other, hidden behind a late `await import("./predictions")`; the price snapshot
 * (`coverage`, `marketData`) moved to `market-data.ts` and `alignAction`/`SHARED_CALLS` to `track.ts`.
 * Type-only imports are erased at build time and don't count; a dynamic `import()` of a local module
 * does (it hides the cycle, it doesn't remove it). Offline, reads the source files only.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "../..");
const SRC = path.join(ROOT, "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null; // a package
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

/** Local modules a file loads at run time: value imports, re-exports of values, and dynamic `import()` calls. */
export function runtimeImports(file: string, text: string): string[] {
  const out = new Set<string>();
  const add = (spec: string) => {
    const r = resolve(file, spec);
    if (r) out.add(r);
  };
  for (const m of text.matchAll(/^\s*(import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']/gms)) {
    const clause = m[2].trim();
    if (/^type\s/.test(clause)) continue; // import type / export type
    const named = clause.match(/\{([^}]*)\}/);
    const onlyTypes = named && !clause.replace(named[0], "").replace(/,/g, "").trim() && named[1].split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "));
    if (onlyTypes) continue;
    add(m[3]);
  }
  for (const m of text.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) add(m[1]); // side-effect import
  for (const m of text.matchAll(/await\s+import\(\s*["']([^"']+)["']\s*\)/g)) add(m[1]);
  return [...out];
}

function cycles(graph: Map<string, string[]>): string[][] {
  const found: string[][] = [];
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (n: string) => {
    state.set(n, 1);
    stack.push(n);
    for (const m of graph.get(n) ?? []) {
      if (state.get(m) === 1) found.push([...stack.slice(stack.indexOf(m)), m]);
      else if (!state.has(m)) visit(m);
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const n of graph.keys()) if (!state.has(n)) visit(n);
  return found;
}

// The parser itself: type-only imports are skipped, value and dynamic imports are kept.
const probe = path.join(SRC, "lib/pipeline.ts");
const seen = runtimeImports(probe, `import type { A } from "./types";\nimport { type B } from "./config";\nexport type { C } from "./briefings";\nimport { D, type E } from "./track";\nconst x = await import("./predictions");`).map((f) => path.basename(f));
assert.deepEqual(seen.sort(), ["predictions.ts", "track.ts"], "only value and dynamic imports count");

const graph = new Map<string, string[]>();
for (const f of files(SRC)) graph.set(f, runtimeImports(f, readFileSync(f, "utf8")));
const found = cycles(graph).map((c) => c.map((f) => path.relative(SRC, f)).join(" > "));
assert.deepEqual(found, [], `runtime import cycles in src/:\n${found.join("\n")}`);
assert.ok(!graph.get(path.join(SRC, "lib/predictions.ts"))!.some((f) => f.endsWith("lib/pipeline.ts")), "the prediction job doesn't import the briefing pipeline");
console.log("FINAL IMPORT CYCLES OK");
