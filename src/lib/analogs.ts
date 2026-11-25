/**
 * Curated historical playbook. Numbers are daily closes checked against opened source pages (see the
 * "Source" comment above each entry); a figure with no opened page is left out, not guessed.
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
    // Source: https://cafef.vn/lam-phat-my-bat-ngo-tang-bat-chap-gia-xang-giam-chung-khoan-bi-ban-thao-dow-jones-mat-hon-800-diem-2022091322382199.chn
    event: "August 2022 CPI came in hotter than expected",
    date: "2022-09-13",
    whatHappenedNext: "S&P 500 fell ~4.3% and Nasdaq ~5.2% that day, the worst day since June 2020.",
    lesson: "When markets are positioned for cooling inflation, a hot print hits long-duration tech hardest.",
  },
  {
    type: "inflation_cool",
    // Source: https://cafef.vn/lam-phat-thap-hon-du-bao-dow-jones-futures-tang-hon-800-diem-20221110210359357.chn
    event: "October 2022 CPI came in cooler than expected",
    date: "2022-11-10",
    whatHappenedNext: "S&P 500 jumped ~5.5% and Nasdaq ~7.4% in one day.",
    lesson: "A cool print when sentiment is very bearish produces violent short-covering rallies.",
  },
  {
    type: "fed_hawkish",
    // Source: https://cafef.vn/chung-khoan-my-giam-phien-thu-ba-lien-tiep-dow-jones-mat-hon-300-diem-20220831073910669.chn
    event: "Powell's hawkish Jackson Hole speech on fighting inflation",
    date: "2022-08-26",
    whatHappenedNext: "S&P 500 fell ~3.4% and Nasdaq ~3.9% the same day.",
    lesson: "Fed tone alone, with no rate change, can move indexes 3%+ when it resets rate expectations.",
  },
  {
    type: "fed_hawkish",
    // Source: https://cafef.vn/du-bao-cua-fed-khien-ttck-my-rung-chuyen-dow-jones-lao-doc-hon-1100-diem-ghi-nhan-chuoi-giam-diem-te-nhat-50-nam-188241219071213991.chn
    event: "Fed cut 25bp but projected fewer 2025 cuts (hawkish cut)",
    date: "2024-12-18",
    whatHappenedNext: "S&P 500 fell ~2.95% and Nasdaq ~3.6%.",
    lesson: "The dot plot and guidance matter more than the cut itself.",
  },
  {
    type: "fed_dovish",
    // Source: https://cafef.vn/fed-cat-giam-lai-suat-05-anh-huong-the-nao-den-kinh-te-viet-nam-18824091915223043.chn
    event: "Fed opened its easing cycle with a 50bp cut",
    date: "2024-09-18",
    whatHappenedNext: "S&P 500 dipped ~0.3% on the day, then rose ~1.7% the next day to a record.",
    lesson: "Big cuts can first read as 'the Fed sees trouble' before markets settle on the positive.",
  },
  {
    type: "jobs_weak",
    // Source: https://cafef.vn/nikkei-vua-trai-qua-ngay-toi-te-nhat-trong-gan-4-thap-ky-kospi-tam-dung-giao-dich-vi-ban-thao-manh-188240805144817439.chn
    event: "Weak July jobs report (rising US unemployment), then the yen carry-trade unwind",
    date: "2024-08-02 to 2024-08-05",
    whatHappenedNext:
      "S&P 500 fell ~1.8% Aug 2 and ~3.0% Aug 5; Nasdaq ~-3.4% Aug 5; Nikkei -12.4% Aug 5 (its worst day since 1987), then +10.2% on Aug 6.",
    lesson: "Growth scares plus crowded positioning cause sharp, often short-lived flushes. Selling into the panic meant selling near the low; Nikkei rebounded the next day.",
  },
  {
    type: "tariffs_escalation",
    // Source: https://cafef.vn/chung-khoan-my-rung-chuyen-vi-thue-quan-dow-jones-chot-phien-giam-1600-diem-sp-500-ghi-nhan-ngay-te-nhat-5-nam-188250404080736639.chn
    event: "'Liberation Day' reciprocal tariffs announced",
    date: "2025-04-02 to 2025-04-04",
    whatHappenedNext: "S&P 500 fell ~4.8% on Apr 3 and ~6% on Apr 4 (about -10.5% in two days); Nasdaq fell ~6% on Apr 3.",
    lesson: "Tariff shocks bigger than expected hit globally exposed tech and chips hardest.",
  },
  {
    type: "tariffs_relief",
    // Source: https://vnexpress.net/ong-trump-hoan-ap-thue-90-ngay-4872033.html
    event: "90-day pause on most reciprocal tariffs",
    date: "2025-04-09",
    whatHappenedNext: "S&P 500 rose ~9.5% and Nasdaq ~12.2% in one day, one of the biggest rallies on record.",
    lesson: "Policy-driven selloffs can reverse violently on one headline. Selling after a policy panic carries that risk.",
  },
  {
    type: "ai_disruption_scare",
    // Source: https://cafef.vn/tai-sao-deepseek-co-the-pha-gia-thi-truong-ai-khien-cho-von-hoa-nvidia-boc-hoi-hon-500-ty-usd-hang-loat-co-phieu-cong-nghe-do-lua-188250128104135378.chn
    event: "DeepSeek R1 sparked fears that AI needs far fewer chips",
    date: "2025-01-27",
    whatHappenedNext: "Nvidia fell ~17% and the Nasdaq ~3.1%; other chip stocks fell sharply too.",
    lesson: "Threats to the AI capex story hit chips hardest. The index-level damage was much smaller.",
  },
  {
    type: "ai_demand_strong",
    // Source: https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=105.NVDA&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=0&beg=19850101&end=20261231 (column 3 = close)
    event: "Nvidia raised its Q2 FY24 revenue guidance far above expectations",
    date: "2023-05-25",
    whatHappenedNext: "Nvidia rose ~24% the next day and lifted the whole chip sector and Nasdaq.",
    lesson: "Large guidance beats from AI leaders re-rate the whole chip group.",
  },
  {
    type: "chip_export_controls",
    // Source: https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=105.NVDA&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=0&beg=19850101&end=20261231 (column 3 = close)
    event: "US required licenses for Nvidia H20 sales to China",
    date: "2025-04-16",
    whatHappenedNext: "Nvidia fell ~6.9% and the S&P 500 ~2.2% that day.",
    lesson: "Export curbs hit chip names directly. The broad index impact is usually limited.",
  },
  {
    type: "chip_export_controls",
    // Source: https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=105.NVDA&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=0&beg=19850101&end=20261231 (column 3 = close)
    event: "Reports of tighter US chip curbs plus comments questioning Taiwan defense",
    date: "2024-07-17",
    whatHappenedNext: "Nvidia fell ~6.6% and the S&P 500 ~1.4% that day; chip stocks sold off hard.",
    lesson: "Geopolitics plus export controls is a fast way to deflate a crowded chip trade.",
  },
  {
    type: "geopolitical_shock",
    // Source: https://vnexpress.net/ngay-dau-nga-tien-quan-chop-nhoang-vao-ukraine-4431718.html
    event: "Russia invaded Ukraine",
    date: "2022-02-24",
    whatHappenedNext: "Nasdaq closed ~3.3% higher and the S&P 500 ~1.5% higher that day, despite the war headlines.",
    lesson: "War headlines often see 'sell the rumor, buy the news'. Stocks closed higher the same day.",
  },
  {
    type: "financial_stress",
    // Source: https://vnexpress.net/my-xay-ra-vu-sup-do-lon-thu-hai-lich-su-nganh-ngan-hang-4580041.html
    event: "Silicon Valley Bank collapsed",
    date: "2023-03-10",
    whatHappenedNext:
      "SVB's own shares fell ~60% on Mar 9, but the Nasdaq rose ~9.7% from Mar 10 to Mar 31 as yields fell and the Fed backstopped deposits.",
    lesson: "Financial stress can help big tech if it pulls yields down and brings in a policy backstop.",
  },
  {
    type: "yields_spike",
    // Source: https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2023/all?type=daily_treasury_yield_curve&field_tdr_date_value=2023&page&_format=csv
    event: "10-year Treasury yield reached ~5%",
    date: "2023-10-19",
    whatHappenedNext: "Nasdaq fell about 12% from Jul 19 to Oct 27 as the 10-year yield rose from 3.75% to 4.98%, then rallied once yields reversed in November (4.44% on Nov 17).",
    lesson: "Rising long yields compress tech valuations. The turn in yields marked the bottom.",
  },
  {
    type: "shutdown_politics",
    // Source: https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=100.SPX&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=0&beg=19850101&end=20261231 (column 3 = close)
    event: "35-day government shutdown",
    date: "2018-12-22 to 2019-01-25",
    whatHappenedNext: "S&P 500 rose ~10% from its Dec 21, 2018 close to Jan 25, 2019 (it began near the December 2018 low).",
    lesson: "Shutdowns historically have small market impact. Fed and earnings dominate.",
  },
  {
    type: "china_slowdown",
    // Source: https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=100.SPX&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=0&beg=19850101&end=20261231 (column 3 = close; also secid=1.000001 for Shanghai)
    event: "China growth scare after the surprise yuan devaluation",
    date: "2015-08-11 to 2015-08-24",
    whatHappenedNext: "Shanghai fell ~8.5% on Aug 24; the S&P 500 dropped ~10% from Aug 10 to Aug 24 (two weeks).",
    lesson: "China growth scares hit commodities, Asian markets and chipmakers first; the US damage was sharp.",
  },
  {
    type: "china_stimulus",
    // Source: https://cafef.vn/ke-khoc-nguoi-cuoi-tren-thi-truong-chung-khoan-chau-a-phien-dau-tuan-188240930094027784.chn
    event: "Beijing's broad stimulus package (rate cuts, bank reserve cut, stock-market support)",
    date: "2024-09-24",
    whatHappenedNext: "China's CSI 300 rose ~25% from Sep 23 to Sep 30 and ~32% by Oct 8; the Hang Seng rose ~27% to Oct 7, then fell ~9.4% on Oct 8.",
    lesson: "Chinese stimulus rallies are fast and policy-driven; they fade unless follow-through spending arrives.",
  },
  {
    type: "tariffs_escalation",
    region: "vn",
    // Source: https://cafef.vn/chung-khoan-viet-nam-giam-manh-nhat-lich-su-thanh-khoan-cao-ky-luc-188250403151726749.chn
    event: "US announced a 46% tariff on Vietnamese goods",
    date: "2025-04-03",
    whatHappenedNext: "VN-Index fell ~6.7% on Apr 3 and kept falling to a low on Apr 9 (about -17% from the Apr 2 close), then rebounded ~6.8% on Apr 10 after the US paused the tariffs.",
    lesson: "Vietnam's export-driven market sells off hard on US trade threats; negotiation headlines reverse it just as fast.",
  },
  {
    type: "financial_stress",
    region: "vn",
    // Source: https://vnexpress.net/chu-tich-tap-doan-van-thinh-phat-truong-my-lan-bi-bat-4520410.html
    event: "Vietnam corporate bond freeze after the arrest of the Van Thinh Phat chair",
    date: "2022-10 to 2022-11",
    whatHappenedNext: "VN-Index fell ~12% from Oct 7 (the eve of the arrest) to a Nov 15 closing low of 911.90 (about -19% counting from Sep 30).",
    lesson: "Credit and bond stress in Vietnam hits real estate, banks and brokers through margin calls; forced selling tends to overshoot.",
  },
];

