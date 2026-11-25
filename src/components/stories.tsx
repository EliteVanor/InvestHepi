"use client";

/**
 * v19 story cards (owner decision 5): title and outlet count, what happened and why it matters up
 * front; the effect on markets and on the world, a similar past event, what to watch, concepts and
 * sources behind one "More" button. Concept chips open a small sheet (fetched on tap from
 * /api/concepts). Pure logic lives in lib/stories/view.ts.
 */
import { useEffect, useState } from "react";
import { safeHttpUrl } from "@/lib/safe-url";
import { cardMembers, conceptSlug, pastView, storyDomId } from "@/lib/stories/view";
import type { StoryCard } from "@/lib/stories/types";
import type { Digest, Quote } from "@/lib/types";
import { IconArrow, IconEye, IconGlobe, IconHistory, IconNews } from "./Icons";
import { symName } from "./labels";
import { usePrefs } from "./prefs";
import { Sheet, arrow, fmtPct } from "./primitives";

/** Scroll to a story card and flash it (prediction rows' "Related stories" links). */
export function focusStory(id: string) {
  const el = document.getElementById(storyDomId(id));
  if (!el) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  el.classList.remove("flash");
  void el.offsetWidth; // restart the animation when the same card is picked twice
  el.classList.add("flash");
  window.setTimeout(() => el.classList.remove("flash"), 2200);
  el.focus({ preventScroll: true });
}

export function StoryList({ digest, quotes, onTicker }: { digest: Digest; quotes: Quote[]; onTicker: (s: string) => void }) {
  const { t } = usePrefs();
  const [concept, setConcept] = useState<{ term: string; slug: string } | null>(null);
  const cards = digest.stories ?? [];
  if (!cards.length) return null;
  return (
    <section className="stories" aria-labelledby="stories-h">
      <h2 className="section-label" id="stories-h">
        <IconNews /> {t("story.heading")}
      </h2>
      {cards.map((c) => (
        <Story key={c.id} card={c} digest={digest} quotes={quotes} onTicker={onTicker} onConcept={(term) => setConcept({ term, slug: conceptSlug(term) })} />
      ))}
      {concept && <ConceptSheet term={concept.term} slug={concept.slug} onClose={() => setConcept(null)} />}
    </section>
  );
}

function Story({ card, digest, quotes, onTicker, onConcept }: { card: StoryCard; digest: Digest; quotes: Quote[]; onTicker: (s: string) => void; onConcept: (term: string) => void }) {
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  const n = card.outlets.length;
  const bodyId = `${storyDomId(card.id)}-more`;
  return (
    <article className="card story" id={storyDomId(card.id)} tabIndex={-1} aria-labelledby={`${storyDomId(card.id)}-h`}>
      <div className="story-tags">
        {card.kind === "interesting" && <span className="chip accent">{t("story.interesting")}</span>}
        <span className="chip" title={card.outlets.join(", ")}>
          {n === 1 ? t("story.outlet1") : t("story.outlets", { n })}
        </span>
      </div>
      <h3 className="story-title" id={`${storyDomId(card.id)}-h`}>
        {card.title}
      </h3>
      <p className="story-what">{card.what}</p>
      <p className="kv">
        <b>{t("story.why")}:</b> {card.why}
      </p>
      <button className="story-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
        {open ? t("story.less") : t("story.more")}
        <IconArrow className={open ? "turned" : undefined} />
      </button>
      {open && (
        <div className="story-more" id={bodyId}>
          {card.markets.length > 0 && (
            <div className="story-part">
              <h4>{t("story.markets")}</h4>
              <ul className="story-mkts">
                {card.markets.map((m) => (
                  <MarketLine key={m.symbol} m={m} quote={quotes.find((q) => q.symbol === m.symbol)} onTicker={onTicker} />
                ))}
              </ul>
            </div>
          )}
          {card.world && (
            <div className="story-part">
              <h4>
                <IconGlobe /> {t("story.world")}
              </h4>
              <p>{card.world}</p>
            </div>
          )}
          <Past past={card.past} />
          {card.watch && (
            <div className="story-part story-watch">
              <h4>
                <IconEye /> {t("story.watch")}
              </h4>
              <p>{card.watch}</p>
            </div>
          )}
          {card.concepts.length > 0 && (
            <div className="story-part">
              <h4>{t("story.concepts")}</h4>
              <div className="story-concepts">
                {card.concepts.map((c) => (
                  <button key={c} className="concept-chip" onClick={() => onConcept(c)} disabled={!conceptSlug(c)}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Sources card={card} digest={digest} />
        </div>
      )}
    </article>
  );
}

/** One market the story moves: its day change from the price snapshot (never the model), colored like the strip. */
function MarketLine({ m, quote, onTicker }: { m: StoryCard["markets"][number]; quote?: Quote; onTicker: (s: string) => void }) {
  const { t } = usePrefs();
  const chg = m.changePct;
  return (
    <li className="story-mkt">
      <button className="story-mkt-name" onClick={() => onTicker(m.symbol)}>
        {symName(t, m.symbol)}
      </button>
      {typeof chg === "number" && Number.isFinite(chg) ? (
        <span className={`chip num ${chg >= 0 ? "up" : "down"}`}>{fmtPct(chg)}</span>
      ) : (
        <span className={`chip ${m.direction}`}>{arrow(m.direction)}</span>
      )}
      {/* An ETF stand-in is never a level: its % with "via <ETF>" (levelLabel's rule). */}
      {quote?.proxy && <span className="via" title={t("strip.via", { etf: quote.proxy })}>{t("strip.viaShort", { etf: quote.proxy })}</span>}
      <span className="story-mkt-text">{m.text}</span>
    </li>
  );
}

function Past({ past }: { past: StoryCard["past"] }) {
  const { t } = usePrefs();
  const v = pastView(past);
  return (
    <div className="analog story-past">
      <div className="analog-label">
        <IconHistory /> {t("story.past")}
        {v.kind === "event" && <> · {v.date}</>}
      </div>
      {v.kind === "none" ? (
        <span className="muted">{t("story.noPast")}</span>
      ) : (
        <>
          <b>{v.event}.</b> {v.move}
          {v.source && (
            <>
              {" "}
              <a href={v.source} target="_blank" rel="noreferrer">
                {t("story.source")}
              </a>
            </>
          )}
          {v.different && (
            <p className="story-diff">
              <b>{t("story.different")}:</b> {v.different}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Sources({ card, digest }: { card: StoryCard; digest: Digest }) {
  const { t } = usePrefs();
  const members = cardMembers(card, digest.news);
  return (
    <div className="story-part">
      <h4>{t("story.sources")}</h4>
      {members.length ? (
        <ul className="story-sources">
          {members.map((n) => {
            const href = safeHttpUrl(n.link);
            return (
              <li key={n.id}>
                <span className="story-outlet">{n.source}</span>
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer" title={n.titleOrig}>
                    {n.title}
                  </a>
                ) : (
                  <span>{n.title}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">{card.outlets.join(" · ")}</p>
      )}
    </div>
  );
}

interface ConceptView {
  slug: string;
  term: string;
  plain: string;
  example?: string;
}
/** Concepts fetched this page view, per language and slug (they never change once written). */
const conceptCache = new Map<string, ConceptView | null>();

function ConceptSheet({ term, slug, onClose }: { term: string; slug: string; onClose: () => void }) {
  const { t, api, lang } = usePrefs();
  const key = `${lang}:${slug}`;
  const [state, setState] = useState<{ c?: ConceptView | null; failed?: boolean }>(() => (conceptCache.has(key) ? { c: conceptCache.get(key) } : {}));
  useEffect(() => {
    if (conceptCache.has(key)) return setState({ c: conceptCache.get(key) });
    let live = true;
    setState({});
    api<{ concepts: ConceptView[] }>(`/api/concepts?slugs=${encodeURIComponent(slug)}&lang=${lang}`)
      .then((j) => {
        const c = j.concepts.find((x) => x.slug === slug) ?? null;
        conceptCache.set(key, c);
        if (live) setState({ c });
      })
      .catch(() => live && setState({ failed: true }));
    return () => {
      live = false;
    };
  }, [api, key, slug, lang]);
  const c = state.c;
  return (
    <Sheet title={c?.term ?? term} onClose={onClose}>
      <div className="concept-body" aria-live="polite">
        {state.failed ? (
          <p className="muted">{t("concept.failed")}</p>
        ) : c === undefined ? (
          <p className="muted">{t("concept.loading")}</p>
        ) : c === null ? (
          <p className="muted">{t("concept.missing")}</p>
        ) : (
          <>
            <p className="concept-plain">{c.plain}</p>
            {c.example && (
              <div className="concept-example">
                <b>{t("concept.example")}</b>
                <p>{c.example}</p>
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
