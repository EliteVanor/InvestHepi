"use client";

/**
 * The Predictions card under the briefing: per market, the latest daily calls (labeled "Before market"
 * or "Mid-day" with the time on the market's clock and the reader's) and the weekly calls, each with
 * when it's graded. Links to the track record. Calls come from /api/predictions (predictions.ts).
 */
import { useMemo } from "react";
import type { MsgKey } from "@/lib/i18n";
import { localNow, type SlotMarket } from "@/lib/markets";
import type { PredictionSet, PredRun } from "@/lib/predictions-view";
import { nextPredictionRuns } from "@/lib/timetable";
import type { Outlook, SectionId } from "@/lib/types";
import { IconTarget } from "./Icons";
import { groupName, symName } from "./labels";
import { usePrefs } from "./prefs";
import { Ring, arrow } from "./primitives";

/** Markets a section's card covers, in order (interest sets: whichever parts exist). */
const SECTION_MARKETS: Record<SectionId, SlotMarket[]> = {
  vn: ["vn"],
  us: ["us"],
  world: ["jp", "cn", "eu", "wus", "oil", "gold"],
  interests: ["ius", "ivn"],
};

const MARKET_NAME: Partial<Record<SlotMarket, MsgKey>> = {
  jp: "grp.japan",
  cn: "grp.china",
  eu: "grp.europe",
  wus: "grp.us",
  oil: "grp.oil",
  gold: "grp.gold",
  ius: "pred.mktUs",
  ivn: "pred.mktVn",
};

const MARKET_TZ_OF: Record<SlotMarket, string> = {
  vn: "Asia/Ho_Chi_Minh", ivn: "Asia/Ho_Chi_Minh", us: "America/New_York", ius: "America/New_York", wus: "America/New_York",
  oil: "America/New_York", gold: "America/New_York", jp: "Asia/Tokyo", cn: "Asia/Hong_Kong", eu: "Europe/London",
};

export function PredictionsCard({ sets, section, onTicker, onTrack, translating }: { sets?: PredictionSet[]; section: SectionId; onTicker: (s: string) => void; onTrack: () => void; translating?: boolean }) {
  const { t, marketTime } = usePrefs();
  const now = Date.now();
  const markets = useMemo(() => {
    const have = new Map((sets ?? []).map((s) => [s.market, s]));
    // My Interests shows only the parts the set has; markets without a run yet say when the first one is.
    return SECTION_MARKETS[section].filter((m) => section !== "interests" || have.has(m)).map((m) => ({ market: m, set: have.get(m) }));
  }, [sets, section]);
  if (sets === undefined) return null;
  const multi = markets.length > 1;
  const next = (m: SlotMarket) => nextPredictionRuns(m, now, 1)[0];

  return (
    <section className="card preds" aria-labelledby="pred-h">
      <h2 className="card-title" id="pred-h">
        <IconTarget /> {t("pred.title")}
        <span className="spacer" />
        <button className="meta-link pred-track" onClick={onTrack}>
          {t("pred.track")} ›
        </button>
      </h2>
      {translating && <p className="hint pred-note">{t("pred.translating")}</p>}
      {!markets.length && (
        <p className="hint pred-note">{section === "interests" ? t("pred.noneYetSet", { when: nextLabel(next("ius") ?? next("ivn")) }) : t("pred.none")}</p>
      )}
      <div className={`pred-markets${multi ? " multi" : ""}`}>
      {markets.map(({ market, set }) => {
        const tz = set?.tz ?? MARKET_TZ_OF[market];
        const local = localNow(now, tz);
        const weekend = local.wd === 0 || local.wd === 6;
        const n = next(market);
        return (
          <div className="pred-market" key={market}>
            {/* World's calls already carry their market's name; interest sets show which clock each part runs on. */}
            {multi && section === "interests" && <h3 className="pred-mkt">{t(MARKET_NAME[market] ?? "pred.title")}</h3>}
            {!set ? (
              <p className="hint pred-note">{t("pred.first", { when: nextLabel(n) })}</p>
            ) : (
              <>
                {set.unavailable && (!set.daily || set.unavailable.at > set.daily.at) && <Unavailable u={set.unavailable} tz={tz} />}
                {set.daily && <Run run={set.daily} tz={tz} today={local.date} onTicker={onTicker} />}
                {set.weekly && <Run run={set.weekly} tz={tz} today={local.date} weekly onTicker={onTicker} />}
                {(weekend || (set.daily && set.daily.date < local.date)) && n && (
                  <p className="hint pred-note">{weekend ? t("pred.weekend", { when: nextLabel(n) }) : t("pred.next", { when: nextLabel(n) })}</p>
                )}
              </>
            )}
          </div>
        );
      })}
      </div>
    </section>
  );

  function nextLabel(n?: { at: number; phase: "pre" | "mid"; tz: string }) {
    if (!n) return "–";
    return `${t(n.phase === "pre" ? "pred.pre" : "pred.mid")} · ${marketTime(n.at, n.tz, { day: true })}`;
  }
}

/** The latest run had no up-to-date price for a benchmark, so no prediction was made: say which and why. */
function Unavailable({ u, tz }: { u: NonNullable<PredictionSet["unavailable"]>; tz: string }) {
  const { t, marketTime, lang } = usePrefs();
  const day = (iso: string) => new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso + "T12:00:00Z"));
  const why = u.gaps
    .map((g) => (g.kind === "live" ? t("pred.noLive", { sym: symName(t, g.symbol) }) : g.kind === "close" ? t("pred.noClose", { sym: symName(t, g.symbol), day: day(g.date!) }) : t("pred.noPrice", { sym: symName(t, g.symbol) })))
    .join(" · ");
  return (
    <div className="pred-unavail" role="status">
      <span className="chip">{t(u.phase === "pre" ? "pred.pre" : "pred.mid")}</span>
      <span>
        <b>{t("pred.unavailable", { when: marketTime(u.at, tz) })}</b> {why}
      </span>
    </div>
  );
}

function Run({ run, tz, today, weekly, onTicker }: { run: PredRun; tz: string; today: string; weekly?: boolean; onTicker: (s: string) => void }) {
  const { t, marketTime, lang } = usePrefs();
  const gradesAt = run.items[0]?.gradesAt;
  const past = gradesAt ? new Date(gradesAt).getTime() < Date.now() : false;
  const made = weekly ? t("pred.weekly") : t(run.phase === "pre" ? "pred.pre" : "pred.mid");
  const old = !weekly && run.date < today;
  const dayFmt = new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <div className={`pred-run${old ? " old" : ""}`}>
      <div className="pred-meta">
        <span className={`chip ${weekly ? "" : "accent"}`}>{made}</span>
        <span>{t("pred.made", { when: marketTime(run.at, tz, { day: weekly || old }) })}</span>
        {gradesAt && <span>{t(past ? "pred.graded" : "pred.gradesAt", { when: marketTime(gradesAt, tz, { day: true }) })}</span>}
        {old && <span className="muted">{t("pred.from", { day: dayFmt.format(new Date(run.date + "T12:00:00Z")) })}</span>}
      </div>
      <div className="pred-list">
        {run.items.map((o) => (
          <PredRow key={`${o.ticker}:${o.horizon}`} o={o} onTicker={onTicker} />
        ))}
      </div>
    </div>
  );
}

function PredRow({ o, onTicker }: { o: Outlook; onTicker: (s: string) => void }) {
  const { t } = usePrefs();
  return (
    <details className="pred-row">
      <summary>
        <Ring value={o.confidence} direction={o.direction} size={38} />
        <span className="pred-name">
          <b>{groupName(t, o.interest)}</b>
          <span className="call-sub">
            {symName(t, o.ticker)} · <span className={o.direction}>{arrow(o.direction)} {t(`dir.${o.direction}`)}</span>
          </span>
        </span>
        <span className={`action ${o.action}`}>{t(`act.${o.action}`)}</span>
      </summary>
      <div className="pred-body">
        <div className="trigger">{o.actionTrigger}</div>
        <div className="muted">{o.rationale}</div>
        <div className="muted">
          <b>{t("calls.risks")}:</b> {o.risks}
        </div>
        <div className="call-record">
          <button className="meta-link" onClick={() => onTicker(o.ticker)}>
            {symName(t, o.ticker)} ›
          </button>
          {o.record && (
            <>
              {" "}
              · {t("calls.record", { hits: o.record.hits, n: o.record.n })}
              {o.aiConfidence != null && o.aiConfidence !== o.confidence && <> · {t("calls.adjusted", { ai: o.aiConfidence })}</>}
            </>
          )}
        </div>
      </div>
    </details>
  );
}
