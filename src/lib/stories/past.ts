/**
 * The past-event library (v19b design section 3). The model sees at most 3 candidates per story and
 * answers with an id or null; code fills date, move and source from `resolve`, so the model never writes
 * a past figure. Until the owner approves the list, `candidates` returns nothing ("no close precedent").
 */
import type { SectionId } from "../types";
import { fold } from "../mentions";
import type { Story } from "./cluster";
import { PAST_EVENT_DATA } from "./past-events";

export interface PastEvent {
  id: string;
  type: string;
  date: string;
  region: string;
  event: string;
  move: string;
  source: string;
  lesson: string;
  keywords: string[];
}

/** Re-verified by opened pages (past-events.ts); cited only once the owner approves (below). */
export const PAST_EVENTS: PastEvent[] = PAST_EVENT_DATA;
/** Owner approved the whole list on Nov 25 2026. */
export const LIBRARY_APPROVED: boolean = true;

const REGION: Partial<Record<SectionId, string>> = { vn: "vn", us: "us" };

/**
 * Events whose keywords appear in the story's member titles (case- and accent-insensitive, whole words),
 * the section's own region first, then by how many keywords matched, then newest. `opts` is for tests.
 */
export function candidates(story: Story, section: SectionId, n = 3, opts: { approved?: boolean; events?: PastEvent[] } = {}): PastEvent[] {
  if (!(opts.approved ?? LIBRARY_APPROVED)) return [];
  const text = ` ${story.members.map((m) => fold(m.title)).join(" ")} `;
  const region = REGION[section];
  return (opts.events ?? PAST_EVENTS)
    .map((e) => ({ e, hits: new Set(e.keywords.map(fold).filter((k) => k && text.includes(` ${k} `))).size }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => Number(b.e.region === region) - Number(a.e.region === region) || b.hits - a.hits || b.e.date.localeCompare(a.e.date))
    .slice(0, n)
    .map((x) => x.e);
}

export function resolve(id: string, events: PastEvent[] = PAST_EVENTS): PastEvent | undefined {
  return events.find((e) => e.id === id);
}
