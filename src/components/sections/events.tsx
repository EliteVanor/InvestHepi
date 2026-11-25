"use client";

import type { KeyEvent, NewsItem } from "@/lib/types";
import { IconAlert, IconHistory, IconSparkles } from "../Icons";
import { usePrefs } from "../prefs";
import { arrow } from "../primitives";
import { groupName } from "../labels";
import { safeHttpUrl } from "@/lib/safe-url";


/* ---------------------------------------------------------------- Events */

export function Events({ events, news }: { events: KeyEvent[]; news: NewsItem[] }) {
  const { t } = usePrefs();
  return (
    <section className="card" aria-labelledby="events-h">
      <h2 className="card-title" id="events-h">
        <IconSparkles /> {t("events.title")}
      </h2>
      {events.length === 0 && <p className="muted">{t("events.none")}</p>}
      {events.map((e, i) => (
        <article className="event" key={i}>
          <h3>
            <span className="imp" aria-label={`${e.importance}/5`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <i key={n} className={n <= e.importance ? "on" : ""} />
              ))}
            </span>
            <span>{e.title}</span>
          </h3>
          <p className="kv">
            <b>{t("events.what")}:</b> {e.whatHappened}
          </p>
          <p className="kv">
            <b>{t("events.why")}:</b> {e.whyItMatters}
          </p>
          <div className="impacts">
            {e.impacts.map((im, j) => (
              <span key={j} className={`chip ${im.direction}`} title={im.reasoning}>
                {arrow(im.direction)} {groupName(t, im.interest)} · {im.confidence}%
              </span>
            ))}
          </div>
          {e.analog && (
            <div className="analog">
              <div className="analog-label">
                <IconHistory /> {t("events.past")} · {e.analog.date}
              </div>
              {!/^[a-z]+(_[a-z]+)+$/.test(e.analog.event) && <b style={{ fontWeight: 600 }}>{e.analog.event}. </b>}{e.analog.whatHappenedNext}
            </div>
          )}
          <div className="wrong">
            <IconAlert />
            <span>
              <b style={{ fontWeight: 600 }}>{t("events.wrong")}:</b> {e.whatCouldGoWrong}
            </span>
          </div>
          {e.sourceIds.length > 0 && (
            <div className="sources">
              <span>{t("events.sources")}:</span>
              {e.sourceIds
                .map((id) => news[id])
                .filter(Boolean)
                .slice(0, 4)
                .map((n) => (
                  <a key={n.id} href={safeHttpUrl(n.link) || undefined} target="_blank" rel="noreferrer">
                    {n.source}
                  </a>
                ))}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
