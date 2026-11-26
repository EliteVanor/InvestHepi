/** Story pipeline types (v19b design, docs/dev-notes/DESIGN-v19b.md sections 1 and 4). */
import type { Direction } from "../types";

export type { Story, StoryIndex } from "./cluster";

/** Where a story run belongs: a shared section, or one interest set (`ib:<hash>`). */
export type StoryScope = "world" | "us" | "vn" | `ib:${string}`;

/** One explained story, as the page shows it. Numbers in `markets` come from the price snapshot, never the model. */
export interface StoryCard {
  id: string;
  scope: string;
  kind: "important" | "interesting";
  lang: string;
  explainedAt: string;
  outletsAtExplain: number;
  title: string;
  outlets: string[];
  what: string;
  why: string;
  markets: { symbol: string; direction: Direction; changePct?: number; text: string }[];
  world: string;
  past: { id: string; different: string } | null;
  watch?: string;
  concepts: string[];
  memberIds: string[];
  /** The model's importance, 1-5 (5 = matters to most readers today); cards written before it count as 3. */
  importance?: number;
}
