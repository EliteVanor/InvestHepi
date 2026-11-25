/** v19b D4: the verified past-event data is loaded, well-formed, and still off until the owner approves. */
import assert from "node:assert/strict";
import { pinClock } from "../clock";
pinClock("2026-11-25T08:00:00Z");

(async () => {
  const P = await import("../../src/lib/stories/past");
  const { clusterStories } = await import("../../src/lib/stories/cluster");
  assert.equal(P.LIBRARY_APPROVED, false, "off until the owner approves the list");
  assert.ok(P.PAST_EVENTS.length >= 70, `the verified list is loaded (${P.PAST_EVENTS.length})`);
  const ids = new Set<string>();
  for (const e of P.PAST_EVENTS) {
    assert.ok(e.id && !ids.has(e.id), `unique id ${e.id}`);
    ids.add(e.id);
    assert.match(e.date, /^\d{4}-\d{2}(-\d{2})?( to \d{4}-\d{2}(-\d{2})?)?$/, `date format ${e.id}`);
    assert.match(e.source, /^https:\/\//, `https source ${e.id}`);
    assert.ok(e.move.trim() && e.event.trim() && e.keywords.length, `move, event and keywords ${e.id}`);
  }
  const story = (title: string) => clusterStories([{ id: "x", title, link: "https://e.com", source: "S", publishedAt: "2026-11-25T07:00:00Z" }], null, new Date())[0];
  // While off: nothing is offered.
  assert.deepEqual(P.candidates(story("US announces new tariffs on imports"), "us"), []);
  // When approved: a tariff story finds tariff events; Vietnam's section prefers Vietnam entries.
  const us = P.candidates(story("US announces new tariffs on imports"), "us", 3, { approved: true });
  assert.ok(us.length > 0 && us.every((e) => /tariff/i.test(e.keywords.join(" ") + e.event)), "tariff story → tariff events");
  const vn = P.candidates(story("Mỹ áp thuế đối ứng 46% lên hàng hóa Việt Nam, VN-Index lao dốc"), "vn", 3, { approved: true });
  assert.ok(vn.length === 0 || vn[0].region === "vn", "Vietnam section: Vietnam entries first");
  assert.equal(P.resolve(P.PAST_EVENTS[0].id)?.id, P.PAST_EVENTS[0].id);
  console.log("D4 PAST EVENTS OK");
})();
