// Row 2 (FE-01/FE-02): safe-area insets are read once and applied once.
import assert from "node:assert";
import { readFileSync } from "node:fs";

const css = readFileSync("src/app/globals.css", "utf8");
const lines = css.split("\n");
const rule = (sel: string) => lines.find((l) => l.startsWith(sel + " ") || l.startsWith(sel + "{"));

// env() is read only in the :root variables.
const envLines = lines.filter((l) => l.includes("env(safe-area-inset"));
assert.equal(envLines.length, 4, "env(safe-area-inset-*) appears only in the four :root variables");
assert(envLines.every((l) => /^\s*--safe-(top|right|bottom|left): env\(/.test(l)));

// The top bar height is one variable; no 52px offset literals remain besides its definition.
const px52 = lines.filter((l) => /\b52px\b/.test(l) && !l.includes("--topbar-h:"));
assert(px52.every((l) => /^\.pf-row|\.ask-fab/.test(l.trim())), "52px only left in unrelated rules: " + px52.join("|"));
assert(!/\.topbar-inner[^\n]*52px/.test(css));
assert(/\.progress \{[^}]*top: calc\(var\(--topbar-h\) \+ var\(--safe-top\)\)/.test(css), ".progress follows the variable");
assert(/\.topbar \{[^}]*padding: var\(--safe-top\)/.test(css), ".topbar clears the status bar");

// Catch-up applies the top inset once: on .cu, not on .cu-top.
const cu = rule(".cu")!, cuTop = rule(".cu-top")!;
assert(cu.includes("var(--safe-top)"), ".cu has the top inset");
assert(!cuTop.includes("--safe-top"), ".cu-top must not add it again");

// Sidebar and dock clear the status bar; the tab bar clears the sides.
assert(/\.sidebar \{[^}]*calc\(\d+px \+ var\(--safe-top\)\)/.test(css));
assert(/\.chat-dock \{[^}]*var\(--safe-top\)/.test(css));
assert(/\.tabbar \{[^}]*var\(--safe-left\)[^}]*var\(--safe-right\)/s.test(css));
console.log("ROW02 SAFE AREA OK");
