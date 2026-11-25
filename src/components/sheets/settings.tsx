"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { type MsgKey } from "@/lib/i18n";
import { LANGUAGES, langInfo, type LangCode } from "@/lib/languages";
import { type Holding, type Interest } from "@/lib/types";
import { IconArrow, IconBolt, IconChart, IconCheck, IconGear, IconMoon, IconPlus, IconStar, IconX } from "../Icons";
import { usePrefs, type Theme } from "../prefs";
import { Sheet } from "../primitives";
import { AlertsTab } from "../alerts-tab";
import { useAccount } from "../account";
import { VN_PRESET } from "@/lib/config";
import { QUICK_ZONES, allZones, deviceZone, zoneOffset } from "@/lib/zones";
import { HoldingsEditor, TickerSearch } from "../portfolio";
import { StatusTab } from "./status";

/* -------------------------------------------------------------- Settings */

export type Tab = "general" | "interests" | "holdings" | "alerts" | "status" | "shortcuts";

/** iOS-style settings: a root list that drills into pages. */
export function SettingsSheet({
  onClose, initialTab, onInterestsSaved, onHoldingsSaved, prefillSymbol, readOnly,
}: {
  readOnly?: boolean;
  onClose: () => void;
  initialTab?: Tab;
  onInterestsSaved: () => void;
  onHoldingsSaved: (h: Holding[]) => void;
  prefillSymbol?: string;
}) {
  const { t, theme, lang, tz, zoneName } = usePrefs();
  const [page, setPage] = useState<Tab | null>(initialTab ?? null);
  const allPages: { id: Tab; label: MsgKey; icon: ReactNode; tint: string; value?: string; desktopOnly?: boolean }[] = [
    { id: "general", label: "set.root.appearance", icon: <IconMoon />, tint: "#5e5ce6", value: `${t(`set.${theme}` as MsgKey)} · ${langInfo(lang).native} · ${zoneName(tz)}` },
    { id: "interests", label: "set.interests", icon: <IconStar />, tint: "#ff9f0a" },
    { id: "holdings", label: "pf.title", icon: <IconChart />, tint: "#30b0c7" },
    { id: "alerts", label: "set.alerts", icon: <IconBolt />, tint: "#ff453a" },
    { id: "status", label: "set.status", icon: <IconCheck />, tint: "#34c759" },
    { id: "shortcuts", label: "set.shortcuts", icon: <IconGear />, tint: "#8e8e93", desktopOnly: true },
  ];
  const pages = allPages.filter((p) => !readOnly || p.id === "general" || p.id === "status" || p.id === "shortcuts");
  const current = pages.find((p) => p.id === page);
  return (
    <Sheet
      title={
        current ? (
          <span className="set-title">
            <button className="set-back" onClick={() => setPage(null)} aria-label={t("set.back")}>
              <IconArrow style={{ transform: "rotate(180deg)" }} /> {t("set.title")}
            </button>
            <span>{t(current.label)}</span>
          </span>
        ) : (
          t("set.title")
        )
      }
      onClose={onClose}
    >
      {!page && (
        <div className="group set-root" role="list">
          {pages.map((p) => (
            <button key={p.id} role="listitem" className={`row set-row ${p.desktopOnly ? "desktop-only" : ""}`} onClick={() => setPage(p.id)}>
              <span className="set-icon" style={{ background: p.tint }}>{p.icon}</span>
              <span className="label">{t(p.label)}</span>
              {p.value && <span className="value">{p.value}</span>}
              <IconArrow className="set-chev" />
            </button>
          ))}
        </div>
      )}
      {page === "general" && <GeneralTab />}
      {page === "interests" && <InterestsTab onSaved={onInterestsSaved} />}
      {page === "holdings" && <HoldingsEditor onSaved={onHoldingsSaved} />}
      {page === "alerts" && <AlertsTab prefillSymbol={prefillSymbol} />}
      {page === "status" && <StatusTab />}
      {page === "shortcuts" && <ShortcutsTab />}
    </Sheet>
  );
}

function GeneralTab() {
  const { t, theme, setTheme, lang, setLang, api, forgetPassword, tzSetting, tz, setTz, zoneName, timeAt } = usePrefs();
  const zones = useMemo(() => allZones().filter((z) => !(QUICK_ZONES as readonly string[]).includes(z)), []);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  // Saved per account (like the language) and on this device; "auto" follows the device.
  const pickZone = (z: string) => {
    setTz(z);
    const canSave = acc.mode === "multi" ? !!acc.user : true;
    if (canSave) api("/api/settings", { method: "PUT", body: JSON.stringify({ timeZone: z }) }).catch(() => {});
  };
  const zoneOption = (z: string) => `${zoneName(z)} (${zoneOffset(z, now)})`;
  const acc = useAccount();
  // One language for everything: the interface, briefing translations and alert emails. Briefings are
  // always written in English and translated, so changing it never re-runs an analysis.
  const pickLang = (l: LangCode) => {
    setLang(l);
    const canSave = acc.mode === "multi" ? !!acc.user : true;
    if (canSave) api("/api/settings", { method: "PUT", body: JSON.stringify({ briefingLanguage: l }) }).catch(() => {});
  };

  const themes: [Theme, MsgKey][] = [
    ["system", "set.system"],
    ["light", "set.light"],
    ["dark", "set.dark"],
  ];

  return (
    <>
      <div className="sheet-section">
        <h3>{t("set.appearance")}</h3>
        <div className="segmented" style={{ display: "flex" }}>
          {themes.map(([id, key]) => (
            <button key={id} aria-pressed={theme === id} onClick={() => setTheme(id)} style={{ flex: 1 }}>
              {t(key)}
            </button>
          ))}
        </div>
      </div>
      <div className="sheet-section">
        <div className="group">
          <label className="row">
            <span className="label">{t("set.uiLang")}</span>
            <select value={lang} onChange={(e) => pickLang(e.target.value as LangCode)}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.native}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="hint">{t("set.briefLangHint")}</p>
      </div>
      <div className="sheet-section">
        <h3>{t("set.tz")}</h3>
        <div className="group">
          <label className="row">
            <span className="label">{t("set.tzShow")}</span>
            <select value={tzSetting} onChange={(e) => pickZone(e.target.value)} aria-label={t("set.tz")}>
              <option value="auto">{t("set.tzAuto", { zone: zoneName(deviceZone()) })}</option>
              <optgroup label={t("set.tzCommon")}>
                {QUICK_ZONES.map((z) => (
                  <option key={z} value={z}>
                    {zoneOption(z)}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t("set.tzAll")}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, " ")} ({zoneOffset(z, now)})
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <div className="row">
            <span className="label">{t("set.tzNow")}</span>
            <span className="value num">{timeAt(now, { tz })}</span>
          </div>
        </div>
        <p className="hint">{t("set.tzHint")}</p>
      </div>
      {acc.mode !== "multi" && (
        <div className="sheet-section">
          <button
            className="btn-plain"
            onClick={() => {
              forgetPassword();
              location.reload();
            }}
          >
            {t("set.signOut")}
          </button>
        </div>
      )}
    </>
  );
}

function InterestsTab({ onSaved }: { onSaved: () => void }) {
  const { t, api } = usePrefs();
  type Row = Interest & { tickerText: string };
  const [list, setList] = useState<Row[]>([]);
  const [defaults, setDefaults] = useState<Interest[]>([]);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const withText = (l: Interest[]): Row[] => l.map((i) => ({ ...i, tickerText: i.tickers.join(", ") }));

  useEffect(() => {
    api<{ interests: Interest[]; defaults: Interest[] }>("/api/interests")
      .then((j) => {
        setList(withText(j.interests));
        setDefaults(j.defaults);
      })
      .catch((e) => setErr((e as Error).message));
  }, [api]);

  const update = (i: number, patch: Partial<Row>) => setList((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      const body = list
        .filter((x) => x.name.trim())
        .map((x, i) => ({
          id: x.id || `${x.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30) || "interest"}-${i}`,
          name: x.name.trim(),
          query: x.query.trim() || x.name.trim(),
          tickers: x.tickerText.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean),
        }));
      await api("/api/interests", { method: "PUT", body: JSON.stringify(body) });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sheet-section">
      <p className="hint" style={{ marginTop: 0 }}>{t("int.intro")}</p>
      {list.map((x, i) => (
        <div className="int-card" key={i}>
          <div className="field">
            <label>{t("int.name")}</label>
            <input className="input" value={x.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Energy" />
          </div>
          <div className="field">
            <label>
              {t("int.query")} <span>· {t("int.queryHint")}</span>
            </label>
            <input className="input" value={x.query} onChange={(e) => update(i, { query: e.target.value })} placeholder='oil prices OR "energy stocks"' />
          </div>
          <div className="field">
            <label>
              {t("int.tickers")} <span>· {t("int.tickersHint")}</span>
            </label>
            <input className="input num" value={x.tickerText} onChange={(e) => update(i, { tickerText: e.target.value })} placeholder="XLE, XOM, CVX" />
          </div>
          <div className="int-search">
            <TickerSearch onPick={(sym) => update(i, { tickerText: [...new Set([...x.tickerText.split(/[\s,]+/).filter(Boolean), sym])].join(", ") })} />
          </div>
          <button className="icon-btn" onClick={() => setList((l) => l.filter((_, j) => j !== i))} aria-label={t("int.remove")}>
            <IconX />
          </button>
        </div>
      ))}
      {err && <p className="hint bad">{err}</p>}
      <div className="sheet-actions">
        <button className="btn-plain" onClick={() => setList(withText(defaults))}>
          {t("int.reset")}
        </button>
        {!list.some((x) => x.id === VN_PRESET.id) && (
          <button className="btn-plain" onClick={() => setList((l) => [...l, ...withText([VN_PRESET])])}>
            🇻🇳 {t("int.vnPreset")}
          </button>
        )}
        <button className="btn-plain" onClick={() => setList((l) => [...l, { id: "", name: "", query: "", tickers: [], tickerText: "" }])}>
          <IconPlus width={15} height={15} style={{ verticalAlign: -2 }} /> {t("int.add")}
        </button>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? t("set.saving") : t("int.save")}
        </button>
      </div>
    </div>
  );
}



function ShortcutsTab() {
  const { t } = usePrefs();
  const rows: [string[], MsgKey][] = [
    [["1", "2", "3", "4"], "sc.sections"],
    [["N"], "sc.news"],
    [["["], "sc.sidebar"],
    [["]"], "sc.chat"],
    [["R"], "sc.refresh"],
    [["/"], "sc.search"],
    [["⌘", "K"], "sc.palette"],
    [["A"], "sc.ask"],
    [["C"], "sc.catchup"],
    [["L"], "sc.listen"],
    [["T"], "sc.track"],
    [["D"], "sc.theme"],
    [["?"], "sc.help"],
    [["Esc"], "sc.close"],
  ];
  return (
    <div className="sheet-section">
      <div className="group">
        {rows.map(([keys, label]) => (
          <div className="row" key={label}>
            <span className="label">{t(label)}</span>
            <span style={{ display: "flex", gap: 4 }}>
              {keys.map((k) => (
                <span className="kbd" key={k}>{k}</span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
