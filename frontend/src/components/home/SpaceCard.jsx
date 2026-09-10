import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Users, MessagesSquare, Check, BadgeCheck } from 'lucide-react';
import { useCommunity } from '../../context/CommunityContext';
import { compact } from './railStyle';

// A space, joinable from the homepage.
//
// THE JOIN BUTTON IS THE POINT. A visitor who has to open the space, read it,
// find the button and press it has had four chances to leave. Joining where
// they already are turns a browse into a membership, and membership is what
// brings someone back tomorrow.
//
// The button is a real <button> inside — but not nested inside — the card's
// <Link>. An interactive element inside an anchor is invalid HTML and behaves
// badly for keyboard and screen-reader users, so the anchor covers the card
// body via an overlay and the button sits above it in the stacking order with
// its own tab stop.

const SpaceCard = ({ card, index = 0 }) => {
  const space = card.entity;
  const { join, isJoined, joining, enabled } = useCommunity();
  if (!space) return null;

  const joined = isJoined(space.slug);
  const busy = Boolean(joining[space.slug]);

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.4), ease: 'easeOut' }}
      className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-line bg-night-surface shadow-card transition-colors duration-200 hover:border-crimson/50"
    >
      <div className="relative h-20 overflow-hidden bg-night-raised">
        {space.bannerUrl ? (
          <img src={space.bannerUrl} alt="" aria-hidden="true" loading="lazy"
            className="h-full w-full object-cover opacity-70 transition-transform duration-300 group-hover:scale-105" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-crimson/25 via-night-raised to-night-surface" />
        )}
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-night-surface to-transparent" />
      </div>

      <div className="-mt-7 flex flex-1 flex-col px-3 pb-3">
        <div className="flex items-start gap-2.5">
          <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-night-raised">
            {space.iconUrl
              ? <img src={space.iconUrl} alt="" aria-hidden="true" className="h-full w-full object-cover" />
              : <MessagesSquare className="h-5 w-5 text-silver-muted" aria-hidden="true" />}
          </span>
          <div className="min-w-0 pt-6">
            <h3 className="flex items-center gap-1 truncate font-semibold text-silver">
              <span className="truncate">{space.name}</span>
              {space.verified && (
                <BadgeCheck className="h-4 w-4 shrink-0 text-sky-400" aria-label="Verified space" />
              )}
            </h3>
          </div>
        </div>

        <p className="mt-1.5 line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-silver-muted">
          {card.note || space.tagline || card.subtitle}
        </p>

        <div className="mt-2 flex items-center gap-3 text-xs text-silver-muted">
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            {compact(space.memberCount)}
            <span className="sr-only"> members</span>
          </span>
          {space.activeCount7d > 0 && (
            <span className="flex items-center gap-1 text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
              {compact(space.activeCount7d)} active
            </span>
          )}
        </div>

        {/* The card-wide link. Positioned so it covers the card but sits BELOW
            the join button, which is why the button needs no click handling of
            its own to avoid navigating. */}
        <Link to={card.href} className="absolute inset-0 z-0" aria-label={`Open ${space.name}`}>
          <span className="sr-only">{space.name}</span>
        </Link>

        {enabled && (
          <button
            type="button"
            onClick={() => !joined && join(space)}
            disabled={busy || joined}
            aria-label={joined ? `You are a member of ${space.name}` : `Join ${space.name}`}
            className={`relative z-10 mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-default ${
              joined
                ? 'border border-line bg-transparent text-silver-muted'
                : 'bg-crimson text-white hover:bg-crimson-soft disabled:opacity-60'
            }`}
          >
            {joined ? (<><Check className="h-3.5 w-3.5" aria-hidden="true" />Joined</>) : busy ? 'Joining…' : 'Join'}
          </button>
        )}
      </div>
    </motion.article>
  );
};

export default SpaceCard;
