"use client";

import { useEffect, useState } from "react";
import { type MsgKey } from "@/lib/i18n";
import { type SectionId } from "@/lib/types";
import { IconCheck } from "../Icons";
import { usePrefs } from "../prefs";
import { Sheet } from "../primitives";

/* --------------------------------------------------------------- History */

export interface HistoryEntry {
  key: string;
  generatedAt: string;
  provider: string;
  headline: string;
  mood: "risk-on" | "risk-off" | "mixed";
}

export function HistorySheet({ section, current, onPick, onClose }: { section: SectionId; current: string | null; onPick: (key: string | null) => void; onClose: () => void }) {
  const { t, api, timeAt } = usePrefs();
  const [items, setItems] = useState<HistoryEntry[] | null>(null);
  useEffect(() => {
    api<{ history: HistoryEntry[] }>(`/api/history?section=${section}`).then((j) => setItems(j.history)).catch(() => setItems([]));
  }, [api, section]);
  return (
    <Sheet title={t("brief.history")} onClose={onClose}>
      {!items ? (
        <div className="skeleton" style={{ height: 160 }} />
      ) : (
        <div className="group">
          {items.map((h, i) => {
            const active = current ? current === h.key : i === 0;
            return (
              <button key={h.key} className="row" style={{ width: "100%", textAlign: "left", alignItems: "flex-start" }} onClick={() => onPick(i === 0 ? null : h.key)}>
                <span className="label">
                  <span style={{ display: "block", fontSize: 13, color: "var(--label-2)" }}>
                    {timeAt(h.generatedAt, { date: true })} {i === 0 ? `· ${t("brief.latest")}` : ""} · <span className={`mood ${h.mood}`} style={{ background: "none", padding: 0 }}>{t(`mood.${h.mood}` as MsgKey)}</span>
                  </span>
                  <span style={{ fontWeight: 500 }}>{h.headline}</span>
                </span>
                {active && <IconCheck width={18} height={18} style={{ color: "var(--accent)", flex: "none", marginTop: 10 }} />}
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
