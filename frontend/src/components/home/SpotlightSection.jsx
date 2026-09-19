import { useRef, useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react';
import NovelCard from '../NovelCard';
import SpaceCard from './SpaceCard';
import CommunityPostCard from './CommunityPostCard';
import PollCard from './PollCard';
import PulseStrip from './PulseStrip';
import { iconFor, accentFor } from './railStyle';

// One rail, drawn according to its layout.
//
// The renderer knows about LAYOUTS and CARD TYPES, and nothing about what the
// rail is for. A rail of novels and a rail of spaces are the same object with
// different cards in it, which is what lets an admin build a row of anything
// without a frontend change. Adding a card type is one entry in `CARD`; adding
// a layout is one branch below.

const SCROLL_STEP = 640;

const CARD = {
  novel: ({ card, index }) => <NovelCard novel={card.entity} index={index} />,
  space: ({ card, index }) => <SpaceCard card={card} index={index} />,
  post: ({ card, index }) => <CommunityPostCard card={card} index={index} />,
  chapter: ({ card, index }) => <NovelCard novel={card.entity?.novel} index={index} />,
};

/** A card whose type the frontend does not know renders as nothing, not as a crash. */
const Card = ({ card, index }) => {
  const Component = CARD[card.type];
  if (!Component) return null;
  return <Component card={card} index={index} />;
};

const RailHeader = ({ rail, actions = null }) => {
  const Icon = iconFor(rail.icon);
  const accent = accentFor(rail.accent);
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={`hidden h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset ring-white/[0.06] sm:grid ${accent.bg} ${accent.text}`}
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="section-title truncate">{rail.title}</h2>
          {rail.subtitle && (
            <p className="mt-0.5 truncate text-sm text-silver-muted">{rail.subtitle}</p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {rail.viewAllUrl && (
          <Link
            to={rail.viewAllUrl}
            className="group/va flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-sm font-semibold text-crimson-soft transition-colors hover:text-silver"
          >
            {rail.viewAllLabel || 'View all'}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/va:translate-x-0.5" aria-hidden="true" />
          </Link>
        )}
        {actions}
      </div>
    </div>
  );
};

/**
 * The horizontal scroller.
 *
 * Card WIDTH follows the card type: a book cover is a tall narrow thing and a
 * post is a wide short one, and forcing both into one width makes one of them
 * look broken. The arrows are hidden from assistive tech — the container is a
 * native scroll region, which keyboard and screen-reader users already drive
 * directly, so the buttons are a mouse affordance and nothing more.
 */
const WIDTHS = {
  novel: 'w-[8.75rem] sm:w-40 md:w-44 lg:w-[11.25rem]',
  chapter: 'w-[8.75rem] sm:w-40 md:w-44 lg:w-[11.25rem]',
  space: 'w-56 sm:w-60',
  post: 'w-72 sm:w-80',
};

const Carousel = ({ rail }) => {
  const scrollRef = useRef(null);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScroll({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);

  useEffect(() => {
    updateScrollState();
    window.addEventListener('resize', updateScrollState);
    return () => window.removeEventListener('resize', updateScrollState);
  }, [updateScrollState, rail.cards]);

  const scrollBy = (direction) =>
    scrollRef.current?.scrollBy({ left: direction * SCROLL_STEP, behavior: 'smooth' });

  const width = WIDTHS[rail.cards[0]?.type] || WIDTHS.novel;

  const arrows = (
    <div className="hidden items-center gap-2 sm:flex">
      <button
        type="button" onClick={() => scrollBy(-1)} disabled={!canScroll.left} aria-hidden="true" tabIndex={-1}
        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line bg-night-surface/70 text-silver-muted transition-colors hover:border-crimson-soft/40 hover:text-silver disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button" onClick={() => scrollBy(1)} disabled={!canScroll.right} aria-hidden="true" tabIndex={-1}
        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line bg-night-surface/70 text-silver-muted transition-colors hover:border-crimson-soft/40 hover:text-silver disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <>
      <RailHeader rail={rail} actions={arrows} />
      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-3 pt-1 sm:gap-5"
      >
        {rail.cards.map((card, index) => (
          <div key={`${card.type}:${card.id}`} className={`${width} shrink-0 snap-start`}>
            <Card card={card} index={index} />
          </div>
        ))}
      </div>
    </>
  );
};

const Grid = ({ rail }) => (
  <>
    <RailHeader rail={rail} />
    {/* Post cards are wide and read as a list; everything else tiles. */}
    <div className={rail.cards[0]?.type === 'post'
      ? 'grid gap-3 sm:grid-cols-2'
      : 'grid grid-cols-2 gap-x-4 gap-y-8 min-[480px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-6 sm:gap-x-5'}>
      {rail.cards.map((card, index) => (
        <Card key={`${card.type}:${card.id}`} card={card} index={index} />
      ))}
    </div>
  </>
);

/** One thing, given room. For the single item worth more than a row of six. */
const Spotlight = ({ rail }) => {
  const card = rail.cards[0];
  if (!card) return null;
  const accent = accentFor(rail.accent);

  return (
    <>
      <RailHeader rail={rail} />
      <div className={`relative isolate overflow-hidden rounded-3xl border bg-night-surface shadow-card ${accent.border}`}>
        {card.image && (
          <img
            src={card.image} alt="" aria-hidden="true" loading="lazy"
            className="absolute inset-0 -z-10 h-full w-full scale-125 object-cover opacity-25 blur-3xl saturate-150"
          />
        )}
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-night-surface via-night-surface/90 to-night-surface/50" aria-hidden="true" />
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:gap-8 sm:p-8">
          {card.image && (
            <img
              src={card.image} alt=""
              aria-hidden="true" loading="lazy"
              className="h-44 w-[7.5rem] shrink-0 rounded-xl object-cover shadow-card ring-1 ring-white/10 sm:h-52 sm:w-36"
            />
          )}
          <div className="min-w-0 flex-1">
            {card.badge && (
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${accent.bg} ${accent.text}`}>
                {card.badge}
              </span>
            )}
            <h3 className="mt-3 font-display text-2xl font-extrabold text-silver sm:text-3xl">{card.title}</h3>
            {card.subtitle && <p className="mt-1.5 text-sm text-silver-muted">{card.subtitle}</p>}
            {card.note && <p className="mt-3 max-w-2xl text-sm italic leading-relaxed text-silver/90">{card.note}</p>}
            {card.href && (
              <Link to={card.href} className="btn btn-primary btn-md mt-5">
                {rail.viewAllLabel || 'Read more'}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

/** A full-width admin-authored message. The only rail whose content is itself. */
const Banner = ({ rail }) => {
  const card = rail.cards[0];
  const accent = accentFor(rail.accent);
  const Icon = iconFor(rail.icon);
  return (
    <div className={`relative flex flex-col gap-4 overflow-hidden rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6 ${accent.border} ${accent.bg}`}>
      <div className="flex min-w-0 items-start gap-3.5">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-night/40 ring-1 ring-inset ring-white/10 ${accent.text}`} aria-hidden="true">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold text-silver">{rail.title}</h2>
          {rail.subtitle && <p className="mt-0.5 text-sm text-silver-muted">{rail.subtitle}</p>}
          {card?.note && <p className="mt-1 text-sm text-silver-muted">{card.note}</p>}
        </div>
      </div>
      {(card?.href || rail.viewAllUrl) && (
        <Link
          to={card?.href || rail.viewAllUrl}
          className="btn btn-primary btn-md shrink-0"
        >
          {card?.title || rail.viewAllLabel || 'Find out more'}
        </Link>
      )}
    </div>
  );
};

/**
 * The chapter-discussion bridge, when a rail resolved a subject.
 *
 * Shows WHAT the discussion is about above the posts. Without it the rail is
 * five opinions with no visible common subject, which is confusing rather than
 * inviting.
 */
const Subject = ({ subject }) => {
  if (!subject) return null;
  return (
    <Link
      to={subject.href}
      className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-night-surface/60 p-2.5 transition-colors hover:border-crimson-soft/40"
    >
      {subject.image && (
        <img src={subject.image} alt="" aria-hidden="true" loading="lazy"
          className="h-12 w-9 shrink-0 rounded object-cover" />
      )}
      <span className="min-w-0 text-sm">
        <span className="text-silver-muted">about </span>
        <span className="font-semibold text-silver">{subject.title}</span>
      </span>
    </Link>
  );
};

const SpotlightSection = ({ rail, pulse }) => {
  if (rail.layout === 'pulse') return <PulseStrip pulse={pulse} />;
  if (rail.layout === 'banner') return <Banner rail={rail} />;

  if (rail.layout === 'poll') {
    const card = rail.cards.find((c) => c.type === 'post' && c.entity?.poll);
    if (!card) return null;
    return (
      <section aria-label={rail.title}>
        <RailHeader rail={rail} />
        <PollCard card={card} />
      </section>
    );
  }

  if (!rail.cards.length) return null;

  return (
    <section aria-label={rail.title}>
      {rail.layout === 'grid' && <Subject subject={rail.subject} />}
      {rail.layout === 'spotlight' ? <Spotlight rail={rail} />
        : rail.layout === 'grid' ? <Grid rail={rail} />
        : <Carousel rail={rail} />}
    </section>
  );
};

export default SpotlightSection;
