/** v19 audit 2 (owner open item 6): a concept label is the term alone; explanations the model writes into it go. */
import assert from "node:assert/strict";

(async () => {
  const { conceptTerm, conceptSlug } = await import("../../src/lib/stories/view");
  const cases: [string, string][] = [
    ["tariff (a tax on imports)", "tariff"],
    ["yield: what a bond pays", "yield"],
    ["central bank independence - why it matters for prices", "central bank independence"],
    ["Ngân hàng Nhà nước (NHNN)", "Ngân hàng Nhà nước"],
    ["lãi suất điều hành", "lãi suất điều hành"],
    ["P/E ratio", "P/E ratio"],
    ["rate cut.", "rate cut"],
    ["a very long explanation of what this concept is all about", ""],
    ["(only a note)", ""],
  ];
  for (const [raw, want] of cases) assert.equal(conceptTerm(raw), want, raw);
  // The slug follows the clean term, so "tariff (a tax on imports)" and "tariff" share one concept card.
  assert.equal(conceptSlug(conceptTerm("tariff (a tax on imports)")), conceptSlug("tariff"));
  console.log("AUDIT2 CONCEPTS OK");
})();
