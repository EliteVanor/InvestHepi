/**
 * Curated historical playbook. Numbers are approximate daily closes and well documented.
 * The LLM is told to prefer these over its own recall (less hallucinated history), and the
 * rule-based fallback uses `type` + `bias` to produce a baseline view when no LLM is configured.
 *
 * bias: typical first-reaction direction for each interest group (nasdaq / sp500 / chips).
 */
import type { Direction } from "./types";

export type EventType =
  | "fed_hawkish"
  | "fed_dovish"
  | "inflation_hot"
  | "inflation_cool"
  | "jobs_weak"
  | "jobs_strong"
  | "tariffs_escalation"
  | "tariffs_relief"
  | "chip_export_controls"
  | "ai_demand_strong"
  | "ai_disruption_scare"
  | "geopolitical_shock"
  | "financial_stress"
  | "yields_spike"
  | "earnings_beat"
  | "earnings_miss"
  | "shutdown_politics"
  | "china_slowdown"
  | "china_stimulus";

export interface PlaybookEntry {
  type: EventType;
  event: string;
  date: string;
  whatHappenedNext: string;
  lesson: string;
  /** Market the entry is about; preferred for that section (Vietnam). Unset = US / global. */
  region?: "vn";
}

export const EVENT_KEYWORDS: Record<EventType, RegExp> = {
  fed_hawkish: /\b(rate hike|hawkish|higher for longer|fewer (rate )?cuts|fed (holds|pauses)|no rush to cut)\b/i,
  fed_dovish: /\b(rate cut|cuts rates|dovish|fed (cuts|eases)|easing cycle|lower interest rates)\b/i,
  inflation_hot: /\b(inflation (rises|accelerates|hotter|jumps|heats)|hotter[- ]than[- ]expected|cpi (rises|jumps|tops)|sticky inflation)\b/i,
  inflation_cool: /\b(inflation (cools|eases|slows|falls)|cooler[- ]than[- ]expected|cpi (eases|falls|cools)|disinflation)\b/i,
  jobs_weak: /\b(jobless claims (rise|jump)|unemployment (rises|jumps|climbs)|layoffs|job cuts|payrolls (miss|fall|slow)|hiring slows)\b/i,
  jobs_strong: /\b(payrolls (beat|surge|jump)|strong jobs|hiring (surges|accelerates)|unemployment (falls|drops))\b/i,
  tariffs_escalation: /\b(new tariffs?|tariff (hike|increase|threat)|trade war|retaliat\w*|import duties|raises tariffs)\b|thuế đối ứng|áp thuế|chiến tranh thương mại/i,
  tariffs_relief: /\b(trade (deal|truce|agreement)|tariff (pause|cut|relief|exemption)|lifts tariffs|eases tariffs)\b/i,
  chip_export_controls: /\b(export (controls?|curbs?|restrictions?|ban)|entity list|chip (ban|curbs))\b/i,
  ai_demand_strong: /\b(ai (spending|capex|demand|boom)|data ?center (spending|build|demand)|raises (guidance|outlook|forecast)|record revenue)\b/i,
  ai_disruption_scare: /\b(ai bubble|cheaper ai|deepseek|ai (spending|capex) (cut|doubts|concerns)|capex cuts?)\b/i,
  geopolitical_shock: /\b(invasion|invades|missile|airstrikes?|war\b|military escalation|strait of hormuz|blockade|taiwan strait)\b/i,
  financial_stress: /\b(bank (run|failure|collapse)|credit (crunch|crisis|stress)|default|liquidity crisis|margin calls?)\b|call margin|giải chấp|vỡ nợ trái phiếu|chậm trả trái phiếu/i,
  yields_spike: /\b(yields? (surge|spike|jump|soar|climb)|bond (selloff|rout)|10-year (yield )?(hits|tops))\b/i,
  earnings_beat: /\b(beats? (estimates|expectations)|tops (estimates|forecasts)|earnings beat|blowout quarter)\b/i,
  earnings_miss: /\b(miss(es)? (estimates|expectations)|falls short|weak guidance|cuts (guidance|outlook|forecast)|profit warning)\b/i,
  shutdown_politics: /\b(government shutdown|debt ceiling|stopgap|continuing resolution)\b/i,
  // "China’s economy misses forecasts", "Chinese factory output slows"
  china_slowdown: /\b(china['’]?s?|chinese)\s+(economy|economic|growth|gdp|factory|industrial|exports?|retail sales|data|property)\b.{0,40}\b(slow\w*|miss\w*|weak\w*|contract\w*|falls?|cool\w*|disappoint\w*|slump\w*)|\b(china slowdown|yuan devaluation)\b/i,
  china_stimulus: /\b(china|chinese|pboc|beijing)\b.{0,40}\b(stimulus|rate cuts?|cuts rates|rrr cut|support measures|bazooka)\b/i,
};

/** Typical first reaction: [nasdaq, sp500, chips]. */
export const EVENT_BIAS: Record<EventType, [Direction, Direction, Direction]> = {
  fed_hawkish: ["down", "down", "down"],
  fed_dovish: ["up", "up", "up"],
  inflation_hot: ["down", "down", "down"],
  inflation_cool: ["up", "up", "up"],
  jobs_weak: ["down", "down", "down"],
  jobs_strong: ["flat", "flat", "flat"],
  tariffs_escalation: ["down", "down", "down"],
  tariffs_relief: ["up", "up", "up"],
  chip_export_controls: ["down", "flat", "down"],
  ai_demand_strong: ["up", "up", "up"],
  ai_disruption_scare: ["down", "down", "down"],
  geopolitical_shock: ["down", "down", "down"],
  financial_stress: ["down", "down", "down"],
  yields_spike: ["down", "down", "down"],
  earnings_beat: ["up", "up", "up"],
  earnings_miss: ["down", "down", "down"],
  shutdown_politics: ["flat", "flat", "flat"],
  china_slowdown: ["down", "down", "down"],
  china_stimulus: ["flat", "flat", "up"],
};

export const PLAYBOOK: PlaybookEntry[] = [
  {
    type: "inflation_hot",
    event: "August 2022 CPI came in hotter than expected",
    date: "2022-09-13",
    whatHappenedNext: "S&P 500 fell ~4.3% and Nasdaq ~5.2% that day, the worst day since June 2020.",
    lesson: "When markets are positioned for cooling inflation, a hot print hits long-duration tech hardest.",
  },
  {
    type: "inflation_cool",
    event: "October 2022 CPI came in cooler than expected",
    date: "2022-11-10",
    whatHappenedNext: "S&P 500 jumped ~5.5% and Nasdaq ~7.4% in one day.",
    lesson: "A cool print when sentiment is very bearish produces violent short-covering rallies.",
  },
  {
    type: "fed_hawkish",
    event: "Powell's Jackson Hole speech warning of 'some pain' to fight inflation",
    date: "2022-08-26",
    whatHappenedNext: "S&P 500 fell ~3.4% and Nasdaq ~3.9% the same day.",
    lesson: "Fed tone alone, with no rate change, can move indexes 3%+ when it resets rate expectations.",
  },
  {
    type: "fed_hawkish",
    event: "Fed cut 25bp but projected fewer 2025 cuts (hawkish cut)",
    date: "2024-12-18",
    whatHappenedNext: "S&P 500 fell ~2.9% and Nasdaq ~3.6%; small caps hit harder.",
    lesson: "The dot plot and guidance matter more than the cut itself.",
  },
  {
    type: "fed_dovish",
    event: "Fed opened its easing cycle with a 50bp cut",
    date: "2024-09-18",
    whatHappenedNext: "S&P 500 dipped ~0.3% on the day, then rose ~1.7% the next day to a record.",
    lesson: "Big cuts can first read as 'the Fed sees trouble' before markets settle on the positive.",
  },
  {
    type: "jobs_weak",
    event: "Weak July jobs report triggered the Sahm rule, then the yen carry-trade unwind",
    date: "2024-08-02 to 2024-08-05",
    whatHappenedNext:
      "S&P 500 fell ~1.8% Aug 2 and ~3.0% Aug 5; Nasdaq ~-3.4% Aug 5; Nikkei ~-12%; VIX spiked above 65 intraday. Indexes recovered the losses within about two weeks.",
    lesson: "Growth scares plus crowded positioning cause sharp, often short-lived flushes. Panic selling into them was usually wrong.",
  },
  {
    type: "tariffs_escalation",
    event: "'Liberation Day' reciprocal tariffs announced",
    date: "2025-04-02 to 2025-04-04",
    whatHappenedNext: "S&P 500 fell ~4.8% on Apr 3 and ~6% on Apr 4 (about -10.5% in two days). Nasdaq entered a bear market.",
    lesson: "Tariff shocks bigger than expected hit globally exposed tech and chips hardest.",
  },
  {
    type: "tariffs_relief",
    event: "90-day pause on most reciprocal tariffs",
    date: "2025-04-09",
    whatHappenedNext: "S&P 500 rose ~9.5% and Nasdaq ~12.2% in one day, one of the biggest rallies on record.",
    lesson: "Policy-driven selloffs can reverse violently on one headline. Selling after a policy panic carries that risk.",
  },
  {
    type: "ai_disruption_scare",
    event: "DeepSeek R1 sparked fears that AI needs far fewer chips",
    date: "2025-01-27",
    whatHappenedNext: "Nvidia fell ~17% (~$590B market cap lost), Nasdaq ~-3.1%, chip index ~-9%. Nvidia recovered a good part of it within weeks.",
    lesson: "Threats to the AI capex story hit chips hardest. The index-level damage was much smaller.",
  },
  {
    type: "ai_demand_strong",
    event: "Nvidia guided Q2 FY24 revenue ~$11B vs ~$7B expected",
    date: "2023-05-25",
    whatHappenedNext: "Nvidia rose ~24% the next day and lifted the whole chip sector and Nasdaq.",
    lesson: "Large guidance beats from AI leaders re-rate the whole chip group.",
  },
  {
    type: "chip_export_controls",
    event: "US required licenses for Nvidia H20 sales to China ($5.5B charge)",
    date: "2025-04-16",
    whatHappenedNext: "Nvidia fell ~7%, AMD ~7%, and the chip index ~4% that day.",
    lesson: "Export curbs hit chip names directly. The broad index impact is usually limited.",
  },
  {
    type: "chip_export_controls",
    event: "Reports of tighter US chip curbs plus comments questioning Taiwan defense",
    date: "2024-07-17",
    whatHappenedNext: "The Philadelphia chip index fell ~6.8%, its worst day since 2020; ASML dropped ~13%.",
    lesson: "Geopolitics plus export controls is a fast way to deflate a crowded chip trade.",
  },
  {
    type: "geopolitical_shock",
    event: "Russia invaded Ukraine",
    date: "2022-02-24",
    whatHappenedNext: "Nasdaq opened ~3% lower but closed ~3.3% higher; S&P 500 closed ~+1.5%.",
    lesson: "War headlines often see 'sell the rumor, buy the news'. Opening panic reversed the same day.",
  },
  {
    type: "financial_stress",
    event: "Silicon Valley Bank collapsed",
    date: "2023-03-10",
    whatHappenedNext:
      "Regional banks crashed, but Nasdaq rose over the following weeks as yields fell and the Fed backstopped deposits.",
    lesson: "Financial stress can help big tech if it pulls yields down and brings in a policy backstop.",
  },
  {
    type: "yields_spike",
    event: "10-year Treasury yield reached ~5%",
    date: "2023-10-19",
    whatHappenedNext: "Nasdaq fell roughly 10% from its July high into late October, then rallied hard once yields reversed in November.",
    lesson: "Rising long yields compress tech valuations. The turn in yields marked the bottom.",
  },
  {
    type: "shutdown_politics",
    event: "35-day government shutdown",
    date: "2018-12-22 to 2019-01-25",
    whatHappenedNext: "S&P 500 rose ~10% during the shutdown (it began near the December 2018 low).",
    lesson: "Shutdowns historically have small market impact. Fed and earnings dominate.",
  },
  {
    type: "china_slowdown",
    event: "China growth scare after the surprise yuan devaluation",
    date: "2015-08-11 to 2015-08-24",
    whatHappenedNext: "Shanghai fell ~8.5% on Aug 24; the S&P 500 dropped ~11% in a week and recovered by early November.",
    lesson: "China growth scares hit commodities, Asian markets and chipmakers first; the US damage was sharp but temporary.",
  },
  {
    type: "china_stimulus",
    event: "Beijing's broad stimulus package (rate cuts, bank reserve cut, stock-market support)",
    date: "2024-09-24",
    whatHappenedNext: "Chinese stocks rallied roughly 25-30% in under three weeks, then gave back part of it when fiscal details disappointed.",
    lesson: "Chinese stimulus rallies are fast and policy-driven; they fade unless follow-through spending arrives.",
  },
  {
    type: "tariffs_escalation",
    region: "vn",
    event: "US announced a 46% tariff on Vietnamese goods",
    date: "2025-04-03",
    whatHappenedNext: "VN-Index fell ~6.7% that day and kept falling for several sessions, then rebounded sharply when the US paused the tariffs on April 9.",
    lesson: "Vietnam's export-driven market sells off hard on US trade threats; negotiation headlines reverse it just as fast.",
  },
  {
    type: "financial_stress",
    region: "vn",
    event: "Vietnam corporate bond freeze after the Van Thinh Phat and SCB arrests",
    date: "2022-10 to 2022-11",
    whatHappenedNext: "VN-Index fell roughly 15-20% in six weeks to a mid-November low near 900, then rebounded sharply as foreign funds bought heavily.",
    lesson: "Credit and bond stress in Vietnam hits real estate, banks and brokers through margin calls; forced selling tends to overshoot.",
  },
];

export function playbookFor(types: EventType[]): PlaybookEntry[] {
  const set = new Set(types);
  return PLAYBOOK.filter((p) => set.has(p.type));
}
