/** Every UI language must translate every key, and placeholders must survive translation. */
import assert from "node:assert/strict";
import { makeT, missingKeys } from "../src/lib/i18n";
import { LANGUAGES } from "../src/lib/languages";

const missing = Object.entries(missingKeys()).filter(([, keys]) => keys.length);
assert.deepEqual(missing, [], `missing translations: ${JSON.stringify(missing)}`);
for (const l of LANGUAGES) {
  const t = makeT(l.code);
  for (const [key, vars] of [["mkt.opensIn", { t: "1h" }], ["news.sources", { n: 3 }], ["track.counts", { g: 1, t: 2 }], ["brief.langMismatch", { lang: "X" }]] as const) {
    const out = t(key, vars as Record<string, string | number>);
    assert.ok(!/\{[a-z]+\}/.test(out), `${l.code} ${key} left a placeholder: ${out}`);
  }
}
console.log(`I18N OK (${LANGUAGES.length} languages)`);
