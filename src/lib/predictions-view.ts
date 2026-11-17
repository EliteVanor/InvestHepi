/**
 * Prediction shapes and pure helpers, safe for the browser (predictions.ts holds the server side).
 */
import type { Phase, SlotMarket } from "./markets";
import type { Outlook, SectionId } from "./types";

export interface PredRun {
  phase: Phase;
  /** When the run happened (ISO). */
  at: string;
  provider: string;
  /** Local session date the daily calls are graded on (the weekly calls' first day). */
  date: string;
  /** Weekly run: the 5th weekday, whose close grades it. */
  endDate?: string;
  items: Outlook[];
}

export interface PredictionSet {
  scope: string;
  section: SectionId;
  market: SlotMarket;
  /** The market's clock (labels: "Before market · 08:15 Hanoi"). */
  tz: string;
  daily?: PredRun;
  weekly?: PredRun;
  /** The latest run couldn't work from the latest data (no AI call): when, and what was missing. */
  unavailable?: { phase: Phase; at: string; gaps: { symbol: string; kind: "close" | "live" | "price"; date?: string }[] };
  /** Set on translated copies. */
  language?: string;
  translatedFrom?: string;
}

/** Every current call of a section (daily first), for Ask AI, alerts, the stock page and catch-up. */
export function callsOf(sets: PredictionSet[]): Outlook[] {
  return [...sets.flatMap((s) => s.daily?.items ?? []), ...sets.flatMap((s) => s.weekly?.items ?? [])];
}
