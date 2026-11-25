"use client";

import { useMemo } from "react";
import { langInfo } from "@/lib/languages";
import type { CalendarEvent } from "@/lib/types";
import { IconArrow, IconCalendar, IconEye } from "../Icons";
import { usePrefs } from "../prefs";
import { calNotes, calTitle, calWhen } from "../labels";
import { dayIn } from "@/lib/dates";


export function UpNext({ events, notes, timeZone = "America/New_York" }: { events: CalendarEvent[]; notes: string[]; timeZone?: string }) {
  const { t, lang } = usePrefs();
  // "Today" in the tab's market (Hanoi for Vietnam), not always New York.
  const today = dayIn(timeZone);
  const tomorrow = new Date(new Date(today + "T12:00:00Z").getTime() + 86400_000).toISOString().slice(0, 10);
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events.slice(0, 24)) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return [...m.entries()];
  }, [events]);
  const fmt = new Intl.DateTimeFormat(langInfo(lang).locale, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <section className="card" aria-labelledby="cal-h">
      <h2 className="card-title" id="cal-h">
        <IconCalendar /> {t("cal.title")}
      </h2>
      {byDay.length === 0 && <p className="muted">{t("cal.empty")}</p>}
      {byDay.map(([date, evs]) => (
        <div className="cal-day" key={date}>
          <div className={`cal-date ${date === today ? "today" : ""}`}>
            {date === today ? t("cal.today") : date === tomorrow ? t("cal.tomorrow") : fmt.format(new Date(date + "T12:00:00Z"))}
          </div>
          {evs.map((e, i) => (
            <div className="cal-ev" key={i}>
              <span className={`bar i${e.importance}`} />
              <span>{calTitle(t, e)}</span>
              <span className="when">{calWhen(t, e.time)}</span>
            </div>
          ))}
        </div>
      ))}
      {calNotes(t, notes).length > 0 && <div className="note">{calNotes(t, notes).join(" ")}</div>}
    </section>
  );
}

export function WatchNext({ items }: { items: string[] }) {
  const { t } = usePrefs();
  if (!items.length) return null;
  return (
    <section className="card" aria-labelledby="watch-h">
      <h2 className="card-title" id="watch-h">
        <IconEye /> {t("watch.title")}
      </h2>
      <ul className="watch">
        {items.map((w, i) => (
          <li key={i}>
            <IconArrow />
            <span>{w}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
