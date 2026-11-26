/**
 * Public docs (Nov 26, owner: the repository and the site's documents are for public readers):
 * no private report links in tracked text, every relative link in the public docs resolves, the MIT license
 * is there, and the About page renders in English and Vietnamese with links to the other public pages.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import React, { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = path.join(__dirname, "../..");

(async () => {
  const tracked = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" }).split("\n").filter((f) => /\.(md|ts|tsx|json|yml)$/.test(f));
  const leaks = tracked.filter((f) => f !== "scripts/v19/final-public-docs.ts" && existsSync(path.join(ROOT, f)) && /claude\.ai\/artifact\//.test(readFileSync(path.join(ROOT, f), "utf8")));
  assert.deepEqual(leaks, [], "no private report links in the repository");

  for (const doc of ["README.md", "README.vi.md", "CONTRIBUTING.md", "SECURITY.md", "CLAUDE.md", "docs/dev-notes/README.md"]) {
    const text = readFileSync(path.join(ROOT, doc), "utf8");
    for (const m of text.matchAll(/(?:\]\(|src=")((?!https?:|mailto:|#)[^)"#\s]+)/g)) {
      assert.ok(existsSync(path.join(ROOT, path.dirname(doc), m[1])), `${doc} links to ${m[1]}, which exists`);
    }
  }
  assert.match(readFileSync(path.join(ROOT, "LICENSE"), "utf8"), /^MIT License/);

  (globalThis as { React?: typeof React }).React = React; // tsx compiles the page's JSX to React.createElement
  const { default: About } = await import("../../src/app/about/page");
  const render = async (lang?: string) => renderToStaticMarkup((await About({ searchParams: Promise.resolve(lang ? { lang } : {}) })) as ReactElement);
  const en = await render();
  const vi = await render("vi");
  assert.match(en, /About InvestHepi/);
  assert.match(en, /Not financial advice/);
  assert.match(en, /href="\/about\?lang=vi"/, "English links to the Vietnamese page");
  assert.match(vi, /Giới thiệu InvestHepi/);
  assert.match(vi, /lang="vi"/);
  assert.match(vi, /href="\/about"/, "Vietnamese links back to English");
  for (const page of [en, vi]) for (const href of ["/terms", "/privacy"]) assert.ok(page.includes(`href="${href}"`), `links to ${href}`);
  console.log("FINAL PUBLIC DOCS OK");
})();
