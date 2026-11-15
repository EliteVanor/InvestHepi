/**
 * Alerts: rules, evaluation, de-duplication, bundling and email rendering.
 *
 * Two entry points:
 *  - checkPriceAlerts(): cheap, no AI. Run by the scheduler every ~15 min during US hours.
 *  - afterRefresh(): runs after briefings refresh. Handles AI call changes, high-confidence calls,
 *    catalyst reminders, the morning briefing email and the Sunday weekly recap.
 * Every alert has a de-dupe key per ET day, all alerts from one check go out as one email,
 * and there's a daily cap so a bad day can't flood the inbox.
 */
import { getLiveQuotes, type LiveQuote } from "./chart";
import { appUrl, emailProvider, sendEmail } from "./email";
import { makeT, type MsgKey, type T } from "./i18n";
import { isLang, langInfo, type LangCode } from "./languages";
import { ukey } from "./context";
import { getJSON, setJSON } from "./store";
import type { CalendarEvent, Digest, Interest, Outlook } from "./types";

export type PriceOp = "above" | "below" | "pct_up" | "pct_down";

export interface PriceAlert {
  id: string;
  symbol: string;
  op: PriceOp;
  value: number;
  repeat: boolean; // false = once, then disarm
  active: boolean;
  note?: string;
  createdAt: string;
  lastFiredAt?: string;
}

export interface AlertSettings {
  email: string;
  enabled: boolean;
  morningBriefing: boolean;
  weeklyRecap: boolean;
  bigMove: { enabled: boolean; pct: number };
  callChanges: boolean;
  highConfidence: { enabled: boolean; min: number };
  catalysts: boolean;
  priceAlerts: PriceAlert[];
}

export type AlertKind = "price" | "move" | "call" | "confidence" | "catalyst" | "morning" | "weekly" | "test";

export interface AlertEvent {
  key: string; // de-dupe key
  kind: AlertKind;
  title: string;
  detail?: string;
  symbol?: string;
  tone?: "up" | "down" | "neutral";
}

export interface AlertLogEntry {
  at: string;
  kind: AlertKind;
  title: string;
  ok: boolean;
  error?: string;
}

const DAILY_CAP = 20;
const LOG_SIZE = 100;

export const DEFAULT_ALERTS: AlertSettings = {
  email: "",
  enabled: false,
  morningBriefing: true,
  weeklyRecap: true,
  bigMove: { enabled: true, pct: 3 },
  callChanges: true,
  highConfidence: { enabled: true, min: 75 },
  catalysts: true,
  priceAlerts: [],
};

/* ------------------------------------------------------------------ store */

export async function loadAlertSettings(): Promise<AlertSettings> {
  const s = (await getJSON<Partial<AlertSettings>>(ukey("alerts:settings"))) ?? {};
  return {
    ...DEFAULT_ALERTS,
    ...s,
    email: s.email ?? process.env.ALERT_EMAIL ?? "",
    bigMove: { ...DEFAULT_ALERTS.bigMove, ...s.bigMove },
    highConfidence: { ...DEFAULT_ALERTS.highConfidence, ...s.highConfidence },
    priceAlerts: s.priceAlerts ?? [],
  };
}

export async function saveAlertSettings(s: AlertSettings): Promise<void> {
  await setJSON(ukey("alerts:settings"), s);
}

export async function loadAlertLog(): Promise<AlertLogEntry[]> {
  return (await getJSON<AlertLogEntry[]>(ukey("alerts:log"))) ?? [];
}

async function appendLog(entries: AlertLogEntry[]) {
  const log = [...entries, ...(await loadAlertLog())].slice(0, LOG_SIZE);
  await setJSON(ukey("alerts:log"), log);
}

interface Ledger {
  date: string;
  keys: string[];
  count: number;
}

export function etDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function etClock(now = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hour12: false })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return { weekday: p.weekday as string, mins: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

async function loadLedger(now: Date): Promise<Ledger> {
  const today = etDate(now);
  const l = await getJSON<Ledger>(ukey("alerts:ledger"));
  return l && l.date === today ? l : { date: today, keys: [], count: 0 };
}

/* -------------------------------------------------------------- language */

async function mailLang(): Promise<LangCode> {
  const s = await getJSON<{ briefingLanguage?: string }>(ukey("settings"));
  return isLang(s?.briefingLanguage) ? s!.briefingLanguage! : "en";
}

const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const fmtPx = (n: number) => (n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : n.toFixed(2));

/* --------------------------------------------------------- price checks */

/** Pure evaluation of price rules against quotes. Exported for tests. */
export function evaluatePriceRules(
  settings: AlertSettings,
  quotes: LiveQuote[],
  followed: string[],
  date: string,
  t: T,
): { events: AlertEvent[]; fired: string[] } {
  const events: AlertEvent[] = [];
  const fired: string[] = [];
  const q = new Map(quotes.map((x) => [x.symbol, x]));

  for (const a of settings.priceAlerts) {
    if (!a.active) continue;
    const quote = q.get(a.symbol);
    if (!quote) continue;
    let hit = false;
    let title = "";
    if (a.op === "above" && quote.price >= a.value) {
      hit = true;
      title = t("alert.above", { symbol: a.symbol, value: fmtPx(a.value) });
    } else if (a.op === "below" && quote.price <= a.value) {
      hit = true;
      title = t("alert.below", { symbol: a.symbol, value: fmtPx(a.value) });
    } else if (a.op === "pct_up" && quote.changePct >= a.value) {
      hit = true;
      title = t("alert.pctUp", { symbol: a.symbol, chg: fmtPct(quote.changePct) });
    } else if (a.op === "pct_down" && quote.changePct <= -Math.abs(a.value)) {
      hit = true;
      title = t("alert.pctDown", { symbol: a.symbol, chg: fmtPct(quote.changePct) });
    }
    if (!hit) continue;
    events.push({
      key: `price:${a.id}:${a.repeat ? date : "once"}`,
      kind: "price",
      symbol: a.symbol,
      title,
      detail: `${fmtPx(quote.price)} (${fmtPct(quote.changePct)})${a.note ? ` · ${a.note}` : ""}`,
      tone: quote.changePct >= 0 ? "up" : "down",
    });
    fired.push(a.id);
  }

  if (settings.bigMove.enabled && settings.bigMove.pct > 0) {
    for (const sym of followed) {
      const quote = q.get(sym);
      if (!quote) continue;
      const level = Math.floor(Math.abs(quote.changePct) / settings.bigMove.pct);
      if (level < 1) continue;
      // Re-alert if the move doubles (e.g. 3% then 6%), never twice at the same level.
      events.push({
        key: `move:${sym}:${date}:${quote.changePct >= 0 ? "u" : "d"}${level}`,
        kind: "move",
        symbol: sym,
        title: t("alert.move", { symbol: sym, chg: fmtPct(quote.changePct) }),
        detail: fmtPx(quote.price),
        tone: quote.changePct >= 0 ? "up" : "down",
      });
    }
  }
  return { events, fired };
}

export async function checkPriceAlerts(interests: Interest[], now = new Date()) {
  const settings = await loadAlertSettings();
  if (!settings.enabled) return { skipped: "alerts disabled", sent: 0 };
  const lang = await mailLang();
  const t = makeT(lang);
  const followed = [...new Set(interests.flatMap((i) => i.tickers))];
  const symbols = [...new Set([...followed, ...settings.priceAlerts.filter((a) => a.active).map((a) => a.symbol)])];
  const quotes = await getLiveQuotes(symbols);
  const { events, fired } = evaluatePriceRules(settings, quotes, followed, etDate(now), t);

  const result = await dispatch(events, settings, lang, now);
  // Disarm once-only alerts that actually went out; stamp repeating ones.
  if (result.sentKeys.length) {
    const sentIds = new Set(fired.filter((id) => result.sentKeys.some((k) => k.startsWith(`price:${id}:`))));
    settings.priceAlerts = settings.priceAlerts.map((a) =>
      sentIds.has(a.id) ? { ...a, active: a.repeat ? a.active : false, lastFiredAt: now.toISOString() } : a,
    );
    await saveAlertSettings(settings);
  }
  return { sent: result.sentKeys.length, checked: quotes.length, error: result.error };
}

/* ------------------------------------------------------- after refresh */

/** Pure evaluation of AI-driven alerts. Exported for tests. */
export function evaluateBriefingRules(
  settings: AlertSettings,
  next: Outlook[],
  prev: Outlook[] | undefined,
  calendar: CalendarEvent[],
  followed: string[],
  date: string,
  tomorrow: string,
  t: T,
): AlertEvent[] {
  const events: AlertEvent[] = [];
  const prevBy = new Map((prev ?? []).map((o) => [o.ticker, o]));
  for (const o of next) {
    const p = prevBy.get(o.ticker);
    if (settings.callChanges && p && p.action !== o.action) {
      events.push({
        key: `call:${date}:${o.ticker}:${o.action}`,
        kind: "call",
        symbol: o.ticker,
        title: t("alert.call", { symbol: o.ticker, from: t(`act.${p.action}` as MsgKey), to: t(`act.${o.action}` as MsgKey) }),
        detail: o.actionTrigger,
        tone: ["BUY", "ADD"].includes(o.action) ? "up" : ["SELL", "TRIM", "AVOID"].includes(o.action) ? "down" : "neutral",
      });
    }
    if (settings.highConfidence.enabled && o.confidence >= settings.highConfidence.min && o.direction !== "flat") {
      events.push({
        key: `conf:${date}:${o.ticker}:${o.direction}`,
        kind: "confidence",
        symbol: o.ticker,
        title: t("alert.conf", { symbol: o.ticker, action: t(`act.${o.action}` as MsgKey), conf: o.confidence }),
        detail: o.actionTrigger,
        tone: o.direction === "up" ? "up" : "down",
      });
    }
  }
  if (settings.catalysts) {
    for (const e of calendar) {
      if (e.date !== tomorrow) continue;
      const relevant = e.kind === "macro" ? e.importance >= 2 : !!e.ticker && followed.includes(e.ticker);
      if (!relevant) continue;
      events.push({
        key: `cat:${e.date}:${e.title}`,
        kind: "catalyst",
        symbol: e.ticker,
        title: t("alert.catalyst", { title: e.title }),
        detail: e.time,
        tone: "neutral",
      });
    }
  }
  return events;
}

function nextWeekday(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  do d.setUTCDate(d.getUTCDate() + 1);
  while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}

export interface RefreshContext {
  interests: Interest[];
  digests: Partial<Record<"interests" | "world" | "us", Digest | null>>;
  prevInterests?: Digest | null;
  calendar: CalendarEvent[];
  trackSummary?: { graded: number; hitRate: number | null; weekGraded: number; weekHits: number };
}

export async function afterRefresh(ctx: RefreshContext, now = new Date()) {
  const settings = await loadAlertSettings();
  if (!settings.enabled) return { skipped: "alerts disabled" };
  const lang = await mailLang();
  const t = makeT(lang);
  const date = etDate(now);
  const { weekday, mins } = etClock(now);
  const followed = [...new Set(ctx.interests.flatMap((i) => i.tickers))];
  const out: Record<string, unknown> = {};

  const interests = ctx.digests.interests;
  if (interests && interests.provider !== "rules") {
    // Catalyst reminders go out in the evening for the next session.
    const cal = mins >= 16 * 60 ? ctx.calendar : [];
    const events = evaluateBriefingRules(settings, interests.analysis.outlook, ctx.prevInterests?.analysis.outlook, cal, followed, date, nextWeekday(date), t);
    out.alerts = (await dispatch(events, settings, lang, now)).sentKeys.length;
  }

  // Morning briefing: first refresh between 7:30 and 9:30 ET on a weekday, once per day.
  const weekdayOk = !["Sat", "Sun"].includes(weekday);
  if (settings.morningBriefing && weekdayOk && mins >= 7 * 60 + 30 && mins < 9 * 60 + 30 && interests) {
    const key = `morning:${date}`;
    const ledger = await loadLedger(now);
    if (!ledger.keys.includes(key)) {
      const mail = renderMorning(ctx, t, lang, now);
      out.morning = await sendTracked(settings, key, "morning", mail.subject, mail, now);
    }
  }

  // Weekly recap: Sunday evening ET.
  if (settings.weeklyRecap && weekday === "Sun" && mins >= 17 * 60) {
    const key = `weekly:${date}`;
    const ledger = await loadLedger(now);
    if (!ledger.keys.includes(key)) {
      const mail = renderWeekly(ctx, t, lang, now);
      out.weekly = await sendTracked(settings, key, "weekly", mail.subject, mail, now);
    }
  }
  return out;
}

/* -------------------------------------------------------------- dispatch */

async function dispatch(events: AlertEvent[], settings: AlertSettings, lang: LangCode, now: Date) {
  const ledger = await loadLedger(now);
  const fresh = events.filter((e, i) => !ledger.keys.includes(e.key) && events.findIndex((x) => x.key === e.key) === i);
  const room = Math.max(0, DAILY_CAP - ledger.count);
  const batch = fresh.slice(0, room);
  if (!batch.length) return { sentKeys: [] as string[] };

  const t = makeT(lang);
  const mail = renderAlerts(batch, t, lang, now);
  const res = await sendEmail({ to: settings.email, ...mail });
  await appendLog(batch.map((e) => ({ at: now.toISOString(), kind: e.kind, title: e.title, ok: res.ok, error: res.error })));
  if (!res.ok) return { sentKeys: [] as string[], error: res.error };
  ledger.keys.push(...batch.map((e) => e.key));
  ledger.count += 1;
  await setJSON(ukey("alerts:ledger"), ledger);
  return { sentKeys: batch.map((e) => e.key) };
}

async function sendTracked(settings: AlertSettings, key: string, kind: AlertKind, title: string, mail: { subject: string; html: string; text: string }, now: Date) {
  const res = await sendEmail({ to: settings.email, ...mail });
  await appendLog([{ at: now.toISOString(), kind, title, ok: res.ok, error: res.error }]);
  if (res.ok) {
    const ledger = await loadLedger(now);
    ledger.keys.push(key);
    ledger.count += 1;
    await setJSON(ukey("alerts:ledger"), ledger);
  }
  return res.ok ? "sent" : res.error;
}

export async function sendTestEmail(to: string) {
  const lang = await mailLang();
  const t = makeT(lang);
  const html = shell({
    lang,
    preheader: t("mail.testBody"),
    title: t("mail.testTitle"),
    body: `<p style="margin:0 0 12px;font-size:16px;line-height:1.5">${esc(t("mail.testBody"))}</p>
      <p style="margin:0;font-size:14px;color:#6e6e73">${esc(t("mail.provider", { p: emailProvider() }))}</p>`,
    t,
  });
  const res = await sendEmail({ to, subject: t("mail.testTitle"), html, text: t("mail.testBody") });
  await appendLog([{ at: new Date().toISOString(), kind: "test", title: t("mail.testTitle"), ok: res.ok, error: res.error }]);
  return res;
}

/* ------------------------------------------------------------- templates */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TONE = { up: "#248a3d", down: "#d70015", neutral: "#c93400" } as const;
const ACTION_TONE: Record<string, keyof typeof TONE> = { BUY: "up", ADD: "up", HOLD: "neutral", WAIT: "neutral", TRIM: "down", SELL: "down", AVOID: "down" };

function shell({ lang, preheader, title, body, t }: { lang: LangCode; preheader: string; title: string; body: string; t: T }): string {
  const url = appUrl();
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(title)}</title>
<style>@media (prefers-color-scheme: dark){.bg{background:#000!important}.card{background:#1c1c1e!important}.tx{color:#f5f5f7!important}.mu{color:#a1a1a6!important}.hr{border-color:#38383a!important}}</style></head>
<body class="bg" style="margin:0;padding:0;background:#f5f5f7;-webkit-font-smoothing:antialiased">
<span style="display:none!important;opacity:0;max-height:0;overflow:hidden">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:#f5f5f7"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="padding:0 6px 14px;font:600 15px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" class="tx">
<span style="display:inline-block;width:18px;height:18px;border-radius:5px;background:linear-gradient(135deg,#0a84ff,#5e5ce6,#bf5af2);vertical-align:-3px;margin-right:8px"></span>Invest Helper</td></tr>
<tr><td class="card" style="background:#ffffff;border-radius:20px;padding:28px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f">
<div class="tx" style="font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;margin:0 0 16px">${esc(title)}</div>
${body}
${url ? `<div style="margin-top:24px"><a href="${esc(url)}" style="display:inline-block;background:#0071e3;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:11px 20px;border-radius:999px">${esc(t("mail.open"))}</a></div>` : ""}
</td></tr>
<tr><td class="mu" style="padding:16px 8px;font:12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#86868b;text-align:center">${esc(t("mail.footer"))}<br>${esc(t("foot.disclaimer"))}</td></tr>
</table></td></tr></table></body></html>`;
}

const row = (left: string, right = "", tone?: keyof typeof TONE) =>
  `<tr><td class="tx hr" style="padding:11px 0;border-top:1px solid #e5e5ea;font-size:15px;line-height:1.4">${left}</td><td class="hr" style="padding:11px 0 11px 12px;border-top:1px solid #e5e5ea;text-align:right;white-space:nowrap;font-weight:600;font-size:14px;color:${tone ? TONE[tone] : "#6e6e73"}">${right}</td></tr>`;

const section = (label: string, inner: string) =>
  `<div class="mu" style="margin:22px 0 6px;font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#6e6e73">${esc(label)}</div>${inner}`;

const fmtDay = (iso: string, lang: LangCode) =>
  new Intl.DateTimeFormat(langInfo(lang).locale, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(iso + "T12:00:00Z"));
const calWhen = (e: CalendarEvent, lang: LangCode) => `${fmtDay(e.date, lang)}${e.time ? ` · ${e.time}` : ""}`;

const table = (rows: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>`;

export function renderAlerts(events: AlertEvent[], t: T, lang: LangCode, now: Date) {
  const subject = events.length === 1 ? events[0].title : t("mail.alertsSubject", { n: events.length, first: events[0].title });
  const rows = events
    .map((e) => row(`<b style="font-weight:600">${esc(e.title)}</b>${e.detail ? `<br><span class="mu" style="color:#6e6e73;font-size:14px">${esc(e.detail)}</span>` : ""}`, "", e.tone))
    .join("");
  const time = new Intl.DateTimeFormat(langInfo(lang).locale, { hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(now);
  const html = shell({ lang, preheader: events.map((e) => e.title).join(" · "), title: t("mail.alertsTitle"), t, body: `<div class="mu" style="color:#6e6e73;font-size:14px;margin:-8px 0 8px">${esc(time)}</div>${table(rows)}` });
  const text = events.map((e) => `• ${e.title}${e.detail ? ` (${e.detail})` : ""}`).join("\n");
  return { subject, html, text };
}

export function renderMorning(ctx: RefreshContext, t: T, lang: LangCode, now: Date) {
  const d = ctx.digests.interests!;
  const a = d.analysis;
  const dateStr = new Intl.DateTimeFormat(langInfo(lang).locale, { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" }).format(now);
  const summary = `<ul style="margin:0;padding:0 0 0 18px">${a.summary.map((s) => `<li class="tx" style="margin:0 0 8px;font-size:15px;line-height:1.5">${esc(s)}</li>`).join("")}</ul>`;
  const calls = table(
    a.outlook
      .map((o) =>
        row(
          `<b style="font-weight:600">${esc(o.interest)}</b> <span class="mu" style="color:#6e6e73">${esc(o.ticker)} · ${o.confidence}%</span><br><span style="font-size:14px">${esc(o.actionTrigger)}</span>`,
          esc(t(`act.${o.action}` as MsgKey)),
          ACTION_TONE[o.action],
        ),
      )
      .join(""),
  );
  const movers = a.movers?.length ? section(t("movers.title"), table(a.movers.map((m) => row(`<b style="font-weight:600">${esc(m.ticker)}</b> <span class="mu" style="color:#6e6e73;font-size:14px">${esc(m.why)}</span>`, fmtPct(m.changePct), m.changePct >= 0 ? "up" : "down")).join(""))) : "";
  const events = section(t("events.title"), table(a.events.slice(0, 3).map((e) => row(`<b style="font-weight:600">${esc(e.title)}</b><br><span class="mu" style="color:#6e6e73;font-size:14px">${esc(e.whyItMatters)}</span>`)).join("")));
  const others = (["world", "us"] as const)
    .map((s) => ctx.digests[s])
    .filter((x): x is Digest => !!x)
    .map((x) => row(`<span class="mu" style="color:#6e6e73;font-size:13px">${esc(t(`sec.${x.section}` as MsgKey))}</span><br>${esc(x.analysis.headline)}`))
    .join("");
  const sc = a.scenarios?.[0];
  const scenarios = sc
    ? section(`${t("scen.title")}: ${sc.catalyst} · ${sc.when}`, table(sc.cases.map((c) => row(`<b style="font-weight:600">${esc(c.label)}</b> <span class="mu" style="color:#6e6e73;font-size:14px">${esc(c.reaction)}</span><br><span style="font-size:14px">${esc(c.action)}</span>`, `${c.probability}%`)).join("")))
    : "";
  const mood = d.gauge ? ` · ${esc(t("mood.title"))} ${d.gauge.score}/100 (${esc(t(`mood.${d.gauge.label}` as MsgKey))})` : "";
  const cal = ctx.calendar.slice(0, 5).map((e) => row(esc(e.title), esc(calWhen(e, lang)))).join("");
  const body = `<div class="mu" style="color:#6e6e73;font-size:14px;margin:-8px 0 14px">${esc(dateStr)} · ${esc(t(`mood.${a.mood}` as MsgKey))}${mood}</div>
<div class="tx" style="font-size:18px;line-height:1.4;font-weight:600;margin:0 0 14px">${esc(a.headline)}</div>
${summary}${section(t("calls.title"), calls)}${scenarios}${movers}${events}${others ? section(t("mail.worldUs"), table(others)) : ""}${cal ? section(t("cal.title"), table(cal)) : ""}`;
  const subject = t("mail.morningSubject", { headline: a.headline.length > 90 ? a.headline.slice(0, 88) + "…" : a.headline });
  const text = [a.headline, "", ...a.summary.map((s) => `• ${s}`), "", ...a.outlook.map((o) => `${o.interest} (${o.ticker}): ${t(`act.${o.action}` as MsgKey)} ${o.confidence}%: ${o.actionTrigger}`)].join("\n");
  return { subject, html: shell({ lang, preheader: a.summary[0] ?? a.headline, title: t("mail.morningTitle"), body, t }), text };
}

export function renderWeekly(ctx: RefreshContext, t: T, lang: LangCode, _now: Date) {
  const ts = ctx.trackSummary;
  const hit = ts?.weekGraded ? Math.round((ts.weekHits / ts.weekGraded) * 100) : null;
  const stat = (big: string, label: string) =>
    `<td style="width:48%;padding:14px;background:#f5f5f7;border-radius:14px" class="bg"><div class="tx" style="font-size:28px;font-weight:700;letter-spacing:-0.02em">${esc(big)}</div><div class="mu" style="font-size:13px;color:#6e6e73">${esc(label)}</div></td>`;
  const stats = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${stat(hit == null ? "–" : `${hit}%`, t("mail.weekHit", { n: ts?.weekGraded ?? 0 }))}<td style="width:4%;font-size:0">&nbsp;</td>${stat(ts?.hitRate == null ? "–" : `${Math.round(ts.hitRate * 100)}%`, t("mail.allTimeHit", { n: ts?.graded ?? 0 }))}</tr></table>`;
  const headlines = (["interests", "world", "us"] as const)
    .map((s) => ctx.digests[s])
    .filter((x): x is Digest => !!x)
    .map((x) => row(`<span class="mu" style="color:#6e6e73;font-size:13px">${esc(t(`sec.${x.section}` as MsgKey))}</span><br>${esc(x.analysis.headline)}`))
    .join("");
  const cal = ctx.calendar.slice(0, 8).map((e) => row(esc(e.title), esc(calWhen(e, lang)), e.importance === 3 ? "down" : undefined)).join("");
  const body = `${stats}${headlines ? section(t("mail.whereWeStand"), table(headlines)) : ""}${cal ? section(t("mail.weekAhead"), table(cal)) : ""}`;
  return {
    subject: t("mail.weeklySubject", { p: hit == null ? "–" : `${hit}%` }),
    html: shell({ lang, preheader: t("mail.weeklyTitle"), title: t("mail.weeklyTitle"), body, t }),
    text: `${t("mail.weeklyTitle")}\n${t("mail.weekHit", { n: ts?.weekGraded ?? 0 })}: ${hit ?? "–"}%\n\n${ctx.calendar.slice(0, 8).map((e) => `${e.date} ${e.title}`).join("\n")}`,
  };
}
