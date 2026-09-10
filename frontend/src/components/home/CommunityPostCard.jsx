import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MessageSquare, MessagesSquare, EyeOff } from 'lucide-react';
import VoteControl from '../community/VoteControl';
import { formatRelativeTime } from '../../utils/dateUtils';

// A community post, votable from the homepage.
//
// Same reasoning as the join button on SpaceCard: the vote is the cheapest
// possible first action, and someone who has acted once is a different visitor
// from someone who has only read. VoteControl is the real component the feed
// uses, so the optimistic layer, the rollback and the live region all come for
// free and behave identically wherever the post appears.
//
// NSFW posts render blurred with the title withheld rather than being dropped.
// Dropping them silently would make a curated rail quietly shorter than the
// admin built it, with no way to tell why.

const CommunityPostCard = ({ card, index = 0 }) => {
  const post = card.entity;
  if (!post) return null;

  const nsfw = post.nsfw || post.spoiler;

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.4), ease: 'easeOut' }}
      className="group relative flex h-full gap-3 rounded-xl border border-line bg-night-surface p-3 shadow-card transition-colors duration-200 hover:border-crimson/50"
    >
      {/* Above the card link in the stacking order so the arrows are clickable
          and separately focusable. */}
      <div className="relative z-10 shrink-0">
        <VoteControl post={post} orientation="vertical" size="sm" target="post" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs text-silver-muted">
          {post.space?.iconUrl ? (
            <img src={post.space.iconUrl} alt="" aria-hidden="true"
              className="h-4 w-4 shrink-0 rounded object-cover" />
          ) : (
            <MessagesSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate font-medium text-silver">{post.space?.name}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{formatRelativeTime(post.createdAt)}</span>
        </div>

        <h3 className="mt-1 line-clamp-2 font-semibold leading-snug text-silver group-hover:text-crimson-soft">
          {nsfw ? (
            <span className="inline-flex items-center gap-1.5 text-silver-muted">
              <EyeOff className="h-4 w-4" aria-hidden="true" />
              Hidden — open to view
            </span>
          ) : post.title}
        </h3>

        {!nsfw && post.blurb && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-silver-muted">{post.blurb}</p>
        )}

        {card.note && (
          <p className="mt-1.5 text-xs italic text-crimson-soft">{card.note}</p>
        )}

        <div className="mt-2 flex items-center gap-3 text-xs text-silver-muted">
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            {post.commentCount || 0}
            <span className="sr-only"> comments</span>
          </span>
          {post.flairText && (
            <span className="truncate rounded bg-night-raised px-1.5 py-0.5">{post.flairText}</span>
          )}
        </div>
      </div>

      <Link to={card.href} className="absolute inset-0 z-0 rounded-xl" aria-label={`Open post: ${post.title}`}>
        <span className="sr-only">{post.title}</span>
      </Link>
    </motion.article>
  );
};

export default CommunityPostCard;
