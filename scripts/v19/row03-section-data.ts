/**
 * v19 row 3: when each section's digest, headlines and predictions are loaded. Pins the pure
 * decision (`dueLoads`): first paint loads everything once, then only the visible tab is polled
 * (headlines and predictions every 5 min, the briefing every 10), a reader who was away 5+ min gets
 * the visible tab reloaded on return, and a hidden page loads nothing new.
 */
import assert from "node:assert/strict";

(async () => {
  const D = await import("../../src/components/shell/section-data");
  type Last = import("../../src/components/shell/section-data").LastLoaded;
  type Tab = "interests" | "world" | "us" | "vn";
  const MIN = 60_000;
  const T0 = Date.parse("2026-11-19T08:00:00Z");
  const empty = (): Last => ({ digest: {}, news: {}, predictions: {} });
  const all = (at: number): Last => {
    const l = empty();
    for (const s of ["interests", "world", "us", "vn"] as const) for (const k of ["digest", "news", "predictions"] as const) l[k][s] = at;
    return l;
  };
  const ask = (o: { now: number; last: Last; tab?: Tab; visible?: boolean; hiddenSince?: number | null }) =>
    D.dueLoads({ now: o.now, last: o.last, tab: o.tab ?? "world", visible: o.visible ?? true, hiddenSince: o.hiddenSince ?? null })
      .map((l) => `${l.kind}:${l.section}`)
      .sort();

  /* first load: all four sections' three kinds (tab switches stay instant), once */
  const first = ask({ now: T0, last: empty() });
  assert.equal(first.length, 12, "4 digests + 4 news lists + 4 prediction sets");
  assert.ok(first.includes("digest:vn") && first.includes("news:interests") && first.includes("predictions:us"));
  assert.equal(ask({ now: T0, last: all(T0) }).length, 0, "just loaded: nothing due");
  assert.equal(ask({ now: T0 + MIN, last: all(T0) }).length, 0, "1 minute later: still nothing");
  assert.equal(ask({ now: T0, last: empty(), visible: false }).length, 12, "a page opened in a background tab still does its first load");

  /* visible tab: news and predictions at 5 min, other tabs not polled */
  assert.deepEqual(ask({ now: T0 + 4 * MIN + 59_000, last: all(T0) }), [], "just under 5 min");
  assert.deepEqual(ask({ now: T0 + 5 * MIN, last: all(T0), tab: "world" }), ["news:world", "predictions:world"], "5 min: the visible tab's headlines and predictions only");
  assert.deepEqual(ask({ now: T0 + 5 * MIN, last: all(T0), tab: "vn" }), ["news:vn", "predictions:vn"], "follows the tab");
  assert.deepEqual(ask({ now: T0 + 30 * MIN, last: all(T0), tab: "us" }).filter((k) => !k.endsWith(":us")), [], "other tabs are never polled, however old");

  /* the briefing: 10 min open */
  assert.ok(!ask({ now: T0 + 9 * MIN + 59_000, last: all(T0) }).includes("digest:world"), "briefing not reloaded before 10 min");
  assert.deepEqual(ask({ now: T0 + 10 * MIN, last: all(T0), tab: "world" }), ["digest:world", "news:world", "predictions:world"], "10 min: briefing too");
  const half = all(T0);
  half.news.world = T0 + 6 * MIN;
  half.predictions.world = T0 + 6 * MIN;
  assert.deepEqual(ask({ now: T0 + 10 * MIN, last: half }), ["digest:world"], "headlines were polled at 6, so only the briefing is due at 10");

  /* switching to a tab whose data is old loads it at once; a fresh one doesn't */
  const mixed = all(T0 + 8 * MIN);
  mixed.digest.vn = T0;
  mixed.news.vn = T0;
  mixed.predictions.vn = T0;
  assert.deepEqual(ask({ now: T0 + 12 * MIN, last: mixed, tab: "vn" }), ["digest:vn", "news:vn", "predictions:vn"], "back on an old tab: reload");
  assert.deepEqual(ask({ now: T0 + 12 * MIN, last: mixed, tab: "us" }), [], "a fresh tab: nothing");

  /* coming back after being hidden */
  const hid = T0 + MIN;
  assert.deepEqual(ask({ now: hid + 2 * MIN, last: all(T0 + MIN), hiddenSince: hid }), [], "hidden 2 min: no reload on return");
  assert.deepEqual(ask({ now: hid + 6 * MIN, last: all(T0 + MIN), hiddenSince: hid, tab: "us" }), ["digest:us", "news:us", "predictions:us"], "hidden 6 min: the visible tab reloads on return");
  assert.equal(ask({ now: hid + 5 * MIN, last: all(T0 + MIN), hiddenSince: hid, tab: "us" }).length, 3, "5 min exactly counts");

  /* nothing polled while the document is hidden */
  assert.deepEqual(ask({ now: T0 + 60 * MIN, last: all(T0), visible: false }), [], "hidden: no polling, even when everything is old");
  assert.deepEqual(ask({ now: T0 + 60 * MIN, last: all(T0), visible: false, hiddenSince: T0 + MIN }), [], "hidden: no return reload either");
  const part = all(T0);
  delete part.news.vn;
  assert.deepEqual(ask({ now: T0 + MIN, last: part, visible: false }), ["news:vn"], "hidden but never loaded: only the missing first load");

  /* helpers that moved with the module */
  assert.notEqual(D.translateKey("us", "vi", "2026-11-17T01:00:00Z", false), D.translateKey("us", "vi", "2026-11-17T01:00:00Z", true));
  const n = (id: string, title: string, titleOrig?: string) => ({ id, title, titleOrig }) as never;
  const dg = { generatedAt: "2026-11-19T07:00:00Z", news: [n("a", "Dịch A", "A")] } as never;
  const merged = D.newsFor(dg, { at: "2026-11-19T08:00:00Z", items: [n("a", "A"), n("b", "B")] })!;
  assert.equal(merged.items[0].title, "Dịch A");
  assert.equal(merged.items[1].title, "B");
  assert.equal(merged.at, "2026-11-19T08:00:00Z");
  assert.equal(D.newsFor(null, undefined), null);

  console.log("ROW03 OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
