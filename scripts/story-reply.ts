/**
 * Test helper (v19b D6): a valid story-explain reply for a mocked AI request, built from the prompt itself.
 * Every story in the prompt gets a card citing its first headline; no numbers, so the number guard keeps it.
 * Not a suite (no `test` in the name).
 */

/** Whether a mocked chat request is the story-explain call. */
export const isStoryCall = (system: string) => system.includes("news explainer");

export function storyReply(user: string, o: { bigPicture?: string[]; movers?: { ticker: string; why: string; source_ids: string[] }[] } = {}): string {
  const stories: { n: string; ids: string[]; title: string }[] = [];
  for (const line of user.split("\n")) {
    const s = line.match(/^S(\d+) \(\d+ outlets?/);
    if (s) stories.push({ n: `S${s[1]}`, ids: [], title: "" });
    const m = line.match(/^\[([^\]]+)\] [^:]*: (.*)$/);
    if (m && stories.length) {
      const cur = stories[stories.length - 1];
      cur.ids.push(m[1]);
      cur.title ||= m[2].split(" | ")[0];
    }
  }
  return JSON.stringify({
    big_picture: o.bigPicture ?? ["Markets weighed the day's news.", "Investors watched rates.", "Several stories moved prices."],
    stories: stories.map((s) => ({
      story: s.n,
      title: s.title.replace(/\d/g, "").trim() || "A story",
      what: "The outlets reported it.",
      why: "It may matter for prices.",
      markets: [],
      world: "Not clear from the reports.",
      past_id: null,
      different: "",
      concepts: [],
      source_ids: s.ids.slice(0, 1),
    })),
    movers: o.movers ?? [],
    watch: ["The next data release."],
  });
}
