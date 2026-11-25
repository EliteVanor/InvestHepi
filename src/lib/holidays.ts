/**
 * Exchange holidays and early closes for 2026-2027: the single source of truth. Pure (no I/O, no
 * imports), so the scheduler, grading, price freshness and the browser's open/closed pill all agree.
 *
 * Each exchange has one table per year: `closed` (full-day closures on weekdays; weekends are never
 * listed), `early` (date -> local close "HH:MM"), `provisional` (dates not yet confirmed on the
 * exchange's own notice: still treated as closed, but flagged here so someone checks them) and `src`
 * (where the dates came from). A guard (`holidayGaps`, pinned by scripts/v19/row09-holidays.ts) fails
 * from Dec 1 of a year when next year's tables are missing: add the next year, with sources, first.
 *
 * Which exchange each benchmark follows (SESSIONS time zones in markets.ts):
 *  - America/New_York: NYSE (Nasdaq keeps the same days; its early closes match). Oil and gold futures
 *    (CME) are priced on this clock too, a close enough approximation.
 *  - Asia/Ho_Chi_Minh: HOSE (HNX and UPCoM keep the same days).
 *  - Asia/Tokyo: JPX (Nikkei 225). Asia/Hong_Kong: HKEX (Hang Seng).
 *  - Europe/London: LSE (FTSE 100). Europe/Berlin: Xetra / Deutsche Boerse (DAX; the Euro Stoxx 50 is
 *    priced on this clock too). Europe/Paris: Euronext Paris (CAC 40).
 *  - Seoul, Shanghai and Mumbai have no table yet: weekends only (Shanghai's 000001.SS is the one
 *    benchmark this affects; its holidays are not modeled).
 *
 * How the dates were collected (Nov 20 2026): the exchanges' own pages (nyse.com, jpx.co.jp,
 * hkex.com.hk, londonstockexchange.com, cashmarket.deutsche-boerse.com, live.euronext.com, hsx.vn,
 * hnx.vn) could not be opened from the build sandbox, so each date comes from search results that quote
 * those pages, cross-checked with a second source where one existed. Anything the sources left unclear
 * is in `provisional`.
 */

export type CalendarId = "NYSE" | "CME" | "HOSE" | "JPX" | "HKEX" | "LSE" | "XETRA" | "EURONEXT";

export interface YearTable {
  /** Full-day closures on weekdays, YYYY-MM-DD. */
  closed: string[];
  /** Early closes: date -> local closing time "HH:MM". */
  early: Record<string, string>;
  /** Dates (closures or early closes) not yet confirmed on an official exchange notice. */
  provisional?: string[];
  /** Sources, one per line. */
  src: string[];
}

/**
 * Calendar of each exchange time zone (those that have a table). A "key" is either one of these zones or a
 * calendar id ("CME": oil and gold futures, which trade on New York's clock but not on NYSE's calendar).
 */
export const CALENDAR_OF_TZ: Record<string, CalendarId> = {
  "America/New_York": "NYSE",
  "Asia/Ho_Chi_Minh": "HOSE",
  "Asia/Tokyo": "JPX",
  "Asia/Hong_Kong": "HKEX",
  "Europe/London": "LSE",
  "Europe/Berlin": "XETRA",
  "Europe/Paris": "EURONEXT",
};

export const HOLIDAYS: Record<CalendarId, Record<number, YearTable>> = {
  CME: {
    // CME Globex (oil CL=F, gold GC=F): the futures trade on most NYSE holidays (abbreviated sessions, settlement
    // times in https://www.cmegroup.com/tools-information/holiday-calendar.html), so only the full closures are
    // listed: New Year's Day, Good Friday, Christmas (observed). Thanksgiving is NOT a closure: Globex follows CME trading
    // hours that day (https://www.cmegroup.com/tools-information/holiday-calendar/files/2026/2026-thanksgiving-clearing-advisory.pdf)
    // and halts early. The early times (13:00 ET Thanksgiving and Christmas Eve, 13:15 the day after) are from a
    // third-party calendar; CME finalizes product hours about two weeks before each holiday: all provisional.
    2026: {
      closed: ["2026-01-01", "2026-04-03", "2026-12-25"],
      early: { "2026-11-26": "13:00", "2026-11-27": "13:15", "2026-12-24": "13:00" },
      provisional: ["2026-11-26", "2026-11-27", "2026-12-24"],
      src: ["https://www.cmegroup.com/tools-information/holiday-calendar.html", "https://www.cmegroup.com/trading-hours.html"],
    },
    2027: {
      closed: ["2027-01-01", "2027-03-26", "2027-12-24"],
      early: { "2027-11-25": "13:00", "2027-11-26": "13:15" },
      provisional: ["2027-12-24", "2027-11-25", "2027-11-26"],
      src: ["https://www.cmegroup.com/tools-information/holiday-calendar.html", "https://www.cmegroup.com/tools-information/holiday-calendar/files/2027/thanksgiving-holiday-settlement-times-2027.pdf"],
    },
  },

  NYSE: {
    // Dates and early closes: NYSE Group's "2026, 2027 and 2028 Holiday and Early Closings Calendar"
    // release (Dec 23 2025) and nyse.com/trade/hours-calendars. Early closes are 13:00 ET (13:15 for options).
    // Jul 3 2026 is the observed Independence Day holiday; NYSE lists no early close on Jul 2 2026
    // (one retail site says otherwise: not used).
    2026: {
      closed: ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"],
      early: { "2026-11-27": "13:00", "2026-12-24": "13:00" },
      src: [
        "https://www.nyse.com/trade/hours-calendars",
        "https://ir.theice.com/press/news-details/2025/NYSE-Group-Announces-2026-2027-and-2028-Holiday-and-Early-Closings-Calendar/default.aspx",
        "https://www.businesswire.com/news/home/20251223981478/en/NYSE-Group-Announces-2026-2027-and-2028-Holiday-and-Early-Closings-Calendar",
      ],
    },
    // 2027: Christmas (Sat) is observed on Fri Dec 24; Juneteenth (Sat) on Fri Jun 18; Independence Day (Sun) on Mon Jul 5.
    // Jan 1 2028 is a Saturday: NYSE is open Fri Dec 31 2027.
    2027: {
      closed: ["2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"],
      early: { "2027-11-26": "13:00" },
      src: [
        "https://www.nyse.com/trade/hours-calendars",
        "https://ir.theice.com/press/news-details/2025/NYSE-Group-Announces-2026-2027-and-2028-Holiday-and-Early-Closings-Calendar/default.aspx",
      ],
    },
  },

  HOSE: {
    // The exchanges announce each holiday block about a month ahead; dates before 2027 are as the
    // press reported HOSE's notices (hsx.vn / hnx.vn news pages: "Thong bao lich nghi giao dich").
    // Tet Binh Ngo: Mon Feb 16 - Fri Feb 20. Hung Kings (Sun Apr 26) observed Mon Apr 27. Apr 30 + May 1.
    // National Day: Aug 31 - Sep 2 (a make-up Saturday Aug 22 is not a trading day).
    2026: {
      closed: ["2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-04-27", "2026-04-30", "2026-05-01", "2026-08-31", "2026-09-01", "2026-09-02"],
      early: {},
      src: [
        "https://thuvienphapluat.vn/hoi-dap-phap-luat/san-hose-khi-nao-nghi-gio-to-hung-vuong-2026-138084516.html",
        "https://doanhnhan.baophapluat.vn/hose-thong-bao-lich-nghi-le-quoc-khanh-2-9-khong-giao-dich-bu-vao-thu-bay-22-08.html",
        "https://thitruongtaichinhtiente.vn/lich-nghi-giao-dich-chung-khoan-tet-nguyen-dan-binh-ngo-2026-77799.html",
      ],
    },
    // 2027, all PROVISIONAL except Jan 1: HOSE/HNX had not published 2027 notices on Nov 20 2026. These
    // follow the public-sector holidays the government reported:
    //  - Tet Dinh Mui (Feb 6 = day 1): public holiday Thu Feb 4 - Wed Feb 10, so weekdays Feb 4, 5, 8, 9, 10
    //    (Interior Ministry proposal reported as adopted; some sites still list a longer variant to Feb 14).
    //  - Hung Kings (10th of the 3rd lunar month) Fri Apr 16; Apr 30 (Fri) and May 1 (Sat, observed Mon May 3);
    //  - National Day Sep 2 (Thu) plus Fri Sep 3 (reported 4-day break Sep 2-5).
    // When the exchange notices appear, confirm each and remove it from `provisional`.
    2027: {
      closed: ["2027-01-01", "2027-02-04", "2027-02-05", "2027-02-08", "2027-02-09", "2027-02-10", "2027-04-16", "2027-04-30", "2027-05-03", "2027-09-02", "2027-09-03"],
      early: {},
      provisional: ["2027-02-04", "2027-02-05", "2027-02-08", "2027-02-09", "2027-02-10", "2027-04-16", "2027-04-30", "2027-05-03", "2027-09-02", "2027-09-03"],
      src: [
        "https://nguoiquansat.vn/chinh-thuc-chinh-phu-chot-lich-nghi-7-ngay-tet-dinh-mui-2027-319864.html",
        "https://cafef.vn/bo-noi-vu-thong-bao-lich-nghi-tet-nguyen-dan-dinh-mui-2027-188261010092338947.chn",
        "https://cafef.vn/lich-nghi-tet-nghi-le-2027-188261117070446187.chn",
        "https://www.hsx.vn (check for the 2027 holiday notices)",
        "https://www.hnx.vn (check for the 2027 holiday notices)",
      ],
    },
  },

  JPX: {
    // JPX's market-holiday page: https://www.jpx.co.jp/english/corporate/about-jpx/calendar/
    // (Act on National Holidays days + Jan 1-3 and Dec 31). No early closes (the afternoon session has run to 15:30 since Nov 2024).
    // 2026: Sep 22 is a citizens' holiday (between Respect for the Aged Day and the equinox); May 6 is the substitute for May 3.
    2026: {
      closed: [
        "2026-01-01", "2026-01-02", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20", "2026-04-29", "2026-05-04", "2026-05-05", "2026-05-06",
        "2026-07-20", "2026-08-11", "2026-09-21", "2026-09-22", "2026-09-23", "2026-10-12", "2026-11-03", "2026-11-23", "2026-12-31",
      ],
      early: {},
      src: ["https://www.jpx.co.jp/english/corporate/about-jpx/calendar/"],
    },
    // 2027: Mar 21 (Sun) -> Mar 22 substitute; Sep 20 is also a JPX group-wide disaster-recovery test day
    // (https://www.jpx.co.jp/english/derivatives/rules/holidaytrading/). The JPX page showed only part of
    // the 2027 list to the search used; the rest follow the Act on National Holidays (equinox days are
    // fixed by the Cabinet Office a year ahead), so Sep 23 is marked provisional until JPX's page is read.
    2027: {
      closed: [
        "2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-22", "2027-04-29", "2027-05-03", "2027-05-04", "2027-05-05",
        "2027-07-19", "2027-08-11", "2027-09-20", "2027-09-23", "2027-10-11", "2027-11-03", "2027-11-23", "2027-12-31",
      ],
      early: {},
      provisional: ["2027-09-23"],
      src: ["https://www.jpx.co.jp/english/corporate/about-jpx/calendar/", "https://www.jpx.co.jp/english/derivatives/rules/holidaytrading/"],
    },
  },

  HKEX: {
    // HKEX circulars SEHK CT/075/25 (2026) and SEHK CT/077/2026 (2027), plus the HK Government's general
    // holidays: https://www.gov.hk/en/about/abouthk/holiday/2026.htm and .../2027.htm. Half days close at 12:00.
    // 2026: Lunar New Year Feb 17-19, Ching Ming Apr 5 (Sun) -> Tue Apr 7, Easter Monday Apr 6, Buddha's Birthday
    // (Sun May 24) -> Mon May 25, Chung Yeung (Sun Oct 18) -> Mon Oct 19. Dec 26 is a Saturday (no weekday substitute).
    // The official circular text seen listed Apr 3, 6, 7, May 1, May 25, Dec 25; the other closures come from the
    // Government's gazette. The half days (Feb 16, Dec 24, Dec 31 2026) are the usual HKEX pattern, seen only on
    // third-party calendars: provisional.
    2026: {
      closed: [
        "2026-01-01", "2026-02-17", "2026-02-18", "2026-02-19", "2026-04-03", "2026-04-06", "2026-04-07", "2026-05-01", "2026-05-25",
        "2026-06-19", "2026-07-01", "2026-10-01", "2026-10-19", "2026-12-25",
      ],
      early: { "2026-02-16": "12:00", "2026-12-24": "12:00", "2026-12-31": "12:00" },
      provisional: ["2026-02-16", "2026-12-24", "2026-12-31"],
      src: [
        "https://www.hkex.com.hk/Services/Circulars-and-Notices/Participant-and-Members-Circulars/SEHK/2025/SEHK_CT_075_2025?sc_lang=en",
        "https://www.gov.hk/en/about/abouthk/holiday/2026.htm",
        "https://www.hkex.com.hk/News/HKEX-Calendar",
      ],
    },
    // 2027: official circular lists the half days Feb 5, Dec 24 and Dec 31 and the closures Jan 1 and Feb 8; the remaining
    // closures are the Government's 2027 general holidays (Lunar New Year's 4th day Feb 9 substitutes for Sunday Feb 7;
    // Buddha's Birthday May 13; Tuen Ng Jun 9; Day after Mid-Autumn Sep 16; Chung Yeung Oct 8; Dec 27 for Christmas on Saturday).
    2027: {
      closed: [
        "2027-01-01", "2027-02-08", "2027-02-09", "2027-03-26", "2027-03-29", "2027-04-05", "2027-05-13", "2027-06-09", "2027-07-01",
        "2027-09-16", "2027-10-01", "2027-10-08", "2027-12-27",
      ],
      early: { "2027-02-05": "12:00", "2027-12-24": "12:00", "2027-12-31": "12:00" },
      src: [
        "https://www.hkex.com.hk/Services/Circulars-and-Notices/Participant-and-Members-Circulars/SEHK/2026/SEHK_CT_077_2026Jun01162846?sc_lang=en",
        "https://www.gov.hk/en/about/abouthk/holiday/2027.htm",
        "https://www.hkex.com.hk/News/HKEX-Calendar",
      ],
    },
  },

  LSE: {
    // London Stock Exchange business days: https://www.londonstockexchange.com/en/resources/markets-products/business-days
    // The LSE page was not readable (it showed 2028 only); these dates are the UK bank holidays plus the usual
    // Christmas Eve and New Year's Eve 12:30 early closes, which two calendar sites and Cboe Europe's schedule agree on.
    // All early closes are provisional until the LSE notice is read.
    2026: {
      closed: ["2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25", "2026-08-31", "2026-12-25", "2026-12-28"],
      early: { "2026-12-24": "12:30", "2026-12-31": "12:30" },
      provisional: ["2026-12-24", "2026-12-31"],
      src: ["https://www.londonstockexchange.com/en/resources/markets-products/business-days", "https://www.cboe.com/newsroom/hours/europe/", "https://www.gov.uk/bank-holidays"],
    },
    2027: {
      closed: ["2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31", "2027-08-30", "2027-12-27", "2027-12-28"],
      early: { "2027-12-24": "12:30", "2027-12-31": "12:30" },
      provisional: ["2027-12-24", "2027-12-31"],
      src: ["https://www.londonstockexchange.com/en/resources/markets-products/business-days", "https://www.gov.uk/bank-holidays"],
    },
  },

  XETRA: {
    // Deutsche Boerse trading calendar: https://www.cashmarket.deutsche-boerse.com/cash-en/trading/trading-calendar-and-trading-hours
    // 2026 (the exchange's own calendar): no trading on Jan 1, Apr 3, Apr 6, May 1, Dec 24, 25, 31 (Ascension, Whit Monday and
    // Corpus Christi trade). 2027 follows the same standing rule (Jan 1, Good Friday, Easter Monday, May 1, Dec 24, 25, 26, 31);
    // May 1 and Dec 25-26 fall on weekends. The 2027 PDF was not seen: provisional.
    2026: {
      closed: ["2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-12-24", "2026-12-25", "2026-12-31"],
      early: {},
      src: ["https://www.cashmarket.deutsche-boerse.com/resource/blob/4481272/0b9e7b9077d51d574b42224af5f425c9/data/deutsche-Boerse-Handelskalender-2026.pdf"],
    },
    2027: {
      closed: ["2027-01-01", "2027-03-26", "2027-03-29", "2027-12-24", "2027-12-31"],
      early: {},
      provisional: ["2027-01-01", "2027-03-26", "2027-03-29", "2027-12-24", "2027-12-31"],
      src: ["https://www.cashmarket.deutsche-boerse.com/cash-en/trading/trading-calendar-and-trading-hours"],
    },
  },

  EURONEXT: {
    // Euronext Paris: https://live.euronext.com/en/resources/trading-hours-holidays (2026 and 2027 holiday calendars).
    // Closed Jan 1, Good Friday, Easter Monday, May 1, Dec 25 (Dec 26 2026 is a Saturday; May 1 and Dec 25 2027 are weekends).
    // Christmas Eve is a half trading day on most venues; the closing time (14:05 Paris) is the usual one, not read from the
    // calendar: provisional. Dec 31 is also a half day (same time, provisional; source: the Euronext page above).
    2026: {
      closed: ["2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-12-25"],
      early: { "2026-12-24": "14:05", "2026-12-31": "14:05" },
      provisional: ["2026-12-24", "2026-12-31"],
      src: ["https://live.euronext.com/en/resources/trading-hours-holidays"],
    },
    2027: {
      closed: ["2027-01-01", "2027-03-26", "2027-03-29"],
      early: { "2027-12-24": "14:05", "2027-12-31": "14:05" },
      provisional: ["2027-12-24", "2027-12-31"],
      src: ["https://live.euronext.com/en/resources/trading-hours-holidays"],
    },
  },
};

const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const tableOf = (key: string, date: string): YearTable | undefined => {
  const cal = key === "CME" ? "CME" : CALENDAR_OF_TZ[key];
  return cal ? HOLIDAYS[cal][Number(date.slice(0, 4))] : undefined;
};

/** A weekday the exchange on `tz` is closed all day (false for weekends: ask `isTradingDay`). */
export const isHoliday = (tz: string, date: string): boolean => !!tableOf(tz, date)?.closed.includes(date);

/** Local early-close time in minutes after midnight, or undefined on a normal day. */
export function earlyCloseMins(tz: string, date: string): number | undefined {
  const e = tableOf(tz, date)?.early[date];
  return e ? mins(e) : undefined;
}

/** A holiday or early close that still needs checking against the exchange's own notice. */
export const isProvisional = (tz: string, date: string): boolean => !!tableOf(tz, date)?.provisional?.includes(date);

/**
 * Calendar-year coverage guard: from Dec 1 of year Y the tables must also have year Y+1 for every
 * exchange (before that, year Y). Returns what is missing, e.g. ["NYSE 2028"].
 */
export function holidayGaps(now: Date | number, tables: Record<string, Record<number, unknown>> = HOLIDAYS): string[] {
  const d = new Date(now);
  const need = d.getUTCMonth() === 11 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
  const out: string[] = [];
  for (const [cal, years] of Object.entries(tables)) if (!years[need]) out.push(`${cal} ${need}`);
  return out;
}
