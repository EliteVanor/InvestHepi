/**
 * No-LLM fallback. Classifies headlines into event types by keyword, then maps them to the
 * historical playbook. Crude on purpose: it keeps the app useful with zero keys and shows the
 * structure, but confidence is capped low.
 */
import { EVENT_BIAS, EVENT_KEYWORDS, PLAYBOOK, type EventType } from "../analogs";
import { tickerMatcher } from "../tickers";
import type { Analysis, Direction, Interest, KeyEvent, NewsItem, Outlook, Quote } from "../types";

function biasIndex(it: Interest): 0 | 1 | 2 {
  const s = `${it.name} ${it.query} ${it.tickers.join(" ")}`.toLowerCase();
  if (/chip|semi|nvda|soxx|smh|amd|tsm/.test(s)) return 2;
  if (/s&p|spy|wall street|stock market/.test(s)) return 1;
  return 0; // tech / growth / anything else behaves most like Nasdaq
}

export function analyzeWithRules(news: NewsItem[], interests: Interest[], quotes: Quote[]): Analysis {
  const hits = new Map<EventType, number[]>();
  news.forEach((n, idx) => {
    const hay = `${n.title} ${n.summary ?? ""}`;
    for (const [type, re] of Object.entries(EVENT_KEYWORDS) as [EventType, RegExp][]) {
      if (re.test(hay)) hits.set(type, [...(hits.get(type) ?? []), idx]);
    }
  });
  const usedLead = new Set<number>();
  const ranked = [...hits.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .filter(([, ids]) => {
      // one event card per lead headline
      if (usedLead.has(ids[0])) return false;
      usedLead.add(ids[0]);
      return true;
    })
    .slice(0, 5);

  const events: KeyEvent[] = ranked.map(([type, ids]) => {
    const analog = PLAYBOOK.find((p) => p.type === type) ?? null;
    return {
      title: news[ids[0]].title,
      whatHappened: `${ids.length} headline(s) point to: ${type.replace(/_/g, " ")}.`,
      whyItMatters: analog ? analog.lesson : "Pattern detected by keyword rules.",
      importance: Math.min(5, 1 + ids.length),
      sourceIds: ids.slice(0, 5),
      impacts: interests.map((it) => ({
        interest: it.name,
        direction: EVENT_BIAS[type][biasIndex(it)],
        magnitude: ids.length > 3 ? "moderate" : "small",
        confidence: Math.min(55, 40 + ids.length * 3),
        reasoning: "Typical first reaction for this event type (rule-based).",
      })),
      analog: analog ? { event: analog.event, date: analog.date, whatHappenedNext: analog.whatHappenedNext } : null,
      whatCouldGoWrong: "Keyword rules can't tell whether the news was already expected or priced in.",
    };
  });

  const outlook: Outlook[] = interests.map((it) => {
    let score = 0;
    for (const [type, ids] of ranked) {
      const d = EVENT_BIAS[type][biasIndex(it)];
      score += (d === "up" ? 1 : d === "down" ? -1 : 0) * ids.length;
    }
    const q = quotes.find((x) => x.symbol === it.tickers[0]);
    const direction: Direction = score > 1 ? "up" : score < -1 ? "down" : "flat";
    return {
      interest: it.name,
      ticker: it.tickers[0],
      direction,
      confidence: Math.min(55, 45 + Math.abs(score)),
      horizon: "today",
      action: direction === "flat" ? "WAIT" : direction === "up" ? "HOLD" : "WAIT",
      actionTrigger: "Rule-based view only. Add a free GROQ_API_KEY or GEMINI_API_KEY for a real analysis.",
      rationale: `Net headline score ${score >= 0 ? "+" : ""}${score}${q ? `; ${q.symbol} last session ${q.changePct.toFixed(1)}%` : ""}.`,
      risks: "Keyword matching misses context, sarcasm, and what's already priced in.",
    };
  });

  return {
    headline: ranked.length
      ? `Rule-based read: dominant theme is ${ranked[0][0].replace(/_/g, " ")}.`
      : "No strong market-moving themes detected by the keyword rules.",
    mood: outlook.filter((o) => o.direction === "down").length > outlook.length / 2 ? "risk-off" : outlook.some((o) => o.direction === "up") ? "risk-on" : "mixed",
    summary: news.slice(0, 5).map((n) => n.title),
    events,
    outlook,
    watchNext: [],
    movers: rulesMovers(news, interests, quotes),
    scenarios: [],
  };
}

/** Biggest movers among the user's tickers, explained by the first headline that names them. */
function rulesMovers(news: NewsItem[], interests: Interest[], quotes: Quote[]) {
  const mine = new Set(interests.flatMap((i) => i.tickers));
  return quotes
    .filter((q) => mine.has(q.symbol))
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 3)
    .filter((q) => Math.abs(q.changePct) >= 1)
    .map((q) => {
      const re = tickerMatcher(q.symbol);
      const hit = news.find((n) => re.test(n.title));
      return { ticker: q.symbol, changePct: q.changePct, why: hit ? `Headline: ${hit.title}` : "No clear news catalyst in today's headlines." };
    });
}
