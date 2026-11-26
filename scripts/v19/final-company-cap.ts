/**
 * v19 recheck (Nov 26, owner decision): at most 2 cards per company per run in shared sections. The US 02:15 run
 * had 4 of 5 important cards about Nvidia (export rules, Trump-portfolio trades, Fed signals, congressional
 * questions): different events, so one-subject grouping kept them all. A story is about a company when one of
 * its headlines names a single-company ticker of the snapshot (code or name, `headlineMentions`); indexes,
 * funds and futures don't count. The cap applies to the model's candidates and to the shown cards.
 * My Interests has no cap (a reader who follows one company wants its news).
 */
import assert from "node:assert/strict";
import { pinClock } from "../clock";
pinClock("2026-11-26T03:00:00Z");

(async () => {
  const P = await import("../../src/lib/stories/pick");
  const C = await import("../../src/lib/stories/cluster");
  type Card = import("../../src/lib/stories/types").StoryCard;
  type Quote = import("../../src/lib/types").Quote;

  const q = (symbol: string, changePct = 0): Quote => ({ symbol, price: 100, changePct } as Quote);
  const quotes = [q("NVDA", -3), q("AAPL", 1), q("^GSPC", -1), q("SPY", -1), q("CL=F", 2)];
  const one = (title: string, id: string, kind?: "interesting") =>
    C.clusterStories([{ id, title, link: "https://e.com", source: `o-${id}`, publishedAt: "2026-11-26T02:00:00Z", ...(kind ? { feedKind: kind } : {}) }], null, new Date())[0];

  // Which companies a story is about.
  assert.deepEqual(P.storyCompanies(one("Nvidia faces new chip export rules", "n1"), quotes), ["NVDA"], "a name counts (Nvidia → NVDA)");
  assert.deepEqual(P.storyCompanies(one("NVDA and Apple lead Wall Street lower", "n2"), quotes), ["NVDA", "AAPL"], "two companies");
  assert.deepEqual(P.storyCompanies(one("S&P 500 slips as oil climbs", "m1"), quotes), [], "indexes, funds and futures are not companies");

  // capPerCompany keeps order and drops the third story about the same company.
  const ids = P.capPerCompany(["a", "b", "c", "d"], (x) => (x === "d" ? [] : ["NVDA"]), 2);
  assert.deepEqual(ids, ["a", "b", "d"]);
  assert.deepEqual(P.capPerCompany(["a", "b", "c"], () => ["NVDA"]), ["a", "b", "c"], "no limit without max");

  // Candidates: four Nvidia events (different subjects) and other news; at most 2 Nvidia go to the model.
  const nv = [
    one("Nvidia hit by tougher export rules for China", "nv1"),
    one("Trump portfolio trades in Nvidia draw scrutiny", "nv2"),
    one("Fed signals weigh on Nvidia shares overnight", "nv3"),
    one("Lawmakers question Nvidia over smuggling claims", "nv4"),
  ];
  const others = ["Storm warnings spread across Gulf coast", "Senate passes stopgap spending bill", "Apple unveils cheaper iPhone lineup", "Oil climbs after pipeline outage"].map((t, i) => one(t, `o${i}`));
  const cand = P.shownStories([...nv, ...others], quotes, P.SHARED_PICK);
  assert.equal(cand.filter((s) => P.storyCompanies(s, quotes).includes("NVDA")).length, 2, "2 Nvidia candidates");
  assert.deepEqual(cand.filter((s) => nv.some((n) => n.id === s.id)).map((s) => s.id), [nv[0].id, nv[1].id], "the best-ranked two are kept (equal scores: input order)");
  assert.equal(cand.length, 6, "the others fill in");
  assert.equal(P.shownStories([...nv, ...others], quotes, P.INTERESTS_PICK).length, 0, "My Interests (untagged pool) unchanged");
  const tagged = nv.map((s) => ({ ...s, members: s.members.map((m) => ({ ...m, tags: ["us-nvda"] })) }));
  assert.equal(P.shownStories(tagged, quotes, P.INTERESTS_PICK).length, 4, "My Interests: no company cap");

  // Shown cards: a third card on one company (an older kept card, say) gives its place to the next card.
  const card = (id: string, importance: number, kind: "important" | "interesting" = "important"): Card => ({ id, scope: "us", kind, lang: "en", explainedAt: "2026-11-26T02:00:00Z", outletsAtExplain: 1, title: id, outlets: ["x"], what: "w", why: "y", markets: [], world: "", past: null, concepts: [], memberIds: [], importance });
  const cards = [card("nv1", 5), card("nv2", 5), card("nv3", 4), card("nv4", 4), card("storm", 3), card("senate", 3), card("oil", 2), card("asteroid", 3, "interesting"), card("drug", 2, "interesting")];
  const companies = new Map([["nv1", ["NVDA"]], ["nv2", ["NVDA"]], ["nv3", ["NVDA"]], ["nv4", ["NVDA"]]]);
  const shown = P.selectCards(cards, P.SHARED_PICK, new Set(), companies).map((c) => c.id);
  assert.deepEqual(shown, ["nv1", "nv2", "storm", "senate", "oil", "asteroid", "drug"], "2 Nvidia cards, then the next most important");
  assert.equal(P.selectCards(cards, P.SHARED_PICK).filter((c) => c.id.startsWith("nv")).length, 4, "without company data nothing is capped");
  assert.equal(P.selectCards(cards, P.SHARED_PICK, new Set(["nv4"]), companies)[0].id, "nv4", "a pinned big story still shows first and counts toward the cap");
  assert.equal(P.selectCards(cards, P.SHARED_PICK, new Set(["nv4"]), companies).filter((c) => c.id.startsWith("nv")).length, 2);
  assert.equal(P.selectCards(cards, P.INTERESTS_PICK, new Set(), companies).filter((c) => c.id.startsWith("nv")).length, 4, "My Interests: no cap");
  console.log("FINAL COMPANY CAP OK");
})();
