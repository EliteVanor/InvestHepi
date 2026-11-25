// Row 23 (Q21): every number in the historical playbook traces to an opened source; unverified figures are gone.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PLAYBOOK } from "../../src/lib/analogs";

const all = (e: (typeof PLAYBOOK)[number]) => `${e.event} ${e.whatHappenedNext} ${e.lesson}`;
const find = (re: RegExp) => {
  const e = PLAYBOOK.find((p) => re.test(p.event));
  assert.ok(e, `entry ${re}`);
  return e!;
};

// Corrections
assert.match(find(/10-year Treasury/).whatHappenedNext, /about 12%/);
assert.doesNotMatch(find(/10-year Treasury/).whatHappenedNext, /roughly 10%/);
const tariff = find(/46% tariff/).whatHappenedNext;
assert.match(tariff, /low on Apr 9/);
assert.match(tariff, /rebounded ~6\.8% on Apr 10/);
const bond = find(/bond freeze/).whatHappenedNext;
assert.match(bond, /~12% from Oct 7/);
assert.match(bond, /911\.90/);
assert.match(bond, /Sep 30/);
const china = find(/yuan devaluation/).whatHappenedNext;
assert.match(china, /~10% from Aug 10 to Aug 24/);
assert.doesNotMatch(china, /11%|early November/);

// Removed figures and claims
const text = PLAYBOOK.map(all).join("\n");
for (const gone of [/Sahm/i, /VIX/, /bear market/i, /\$590B/, /\$5\.5B/, /\$11B/, /chip index/i, /AMD/, /ASML/, /small caps/i, /foreign funds/i, /SCB/, /some pain/, /opened ~3%/, /regional banks crashed/i, /15-20%/, /~-9%/])
  assert.doesNotMatch(text, gone, String(gone));

// Confirmed figures stay
assert.match(find(/August 2022 CPI/).whatHappenedNext, /4\.3%.*5\.2%/);
assert.match(find(/Liberation/).whatHappenedNext, /10\.5%/);

// Every entry has a source URL comment just above its event line
const src = readFileSync(path.join(__dirname, "../../src/lib/analogs.ts"), "utf8");
for (const e of PLAYBOOK) {
  const i = src.indexOf(`event: "${e.event}"`);
  assert.ok(i > 0, `entry found: ${e.event}`);
  assert.match(src.slice(Math.max(0, i - 400), i), /\/\/ Source: https?:\/\//, `source comment for ${e.event}`);
}
console.log("ROW23 ANALOGS OK");
