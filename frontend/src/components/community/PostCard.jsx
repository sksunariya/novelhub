import { Link } from 'react-router-dom';
import { MessageSquare, EyeOff, Lock, Pin, AlertTriangle, ExternalLink } from 'lucide-react';
import VoteControl from './VoteControl';
import { useCommunity } from '../../context/CommunityContext';

// One post in a feed, in three densities.
//
// Card is the default and the friendliest. Compact is what people switch to
// once they read a lot. Classic is the old-forum row. All three share one
// component because they differ in layout, not in what they show — three
// components would drift.

const relative = (date) => {
  const minutes = Math.floor((Date.now() - new Date(date)) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 43200) return `${Math.floor(minutes / 1440)}d`;
  return new Date(date).toLocaleDateString();
};

/**
 * Moderation banner.
 *
 * The critical property: a hidden post says it is PENDING REVIEW and
 * reversible. Silent disappearance is the biggest driver of "what happened to
 * my post" support load, and "removed" and "hidden pending review" are very
 * different messages to receive.
 */
const ModerationNotice = ({ moderation }) => {
  if (!moderation) return null;
  const pending = moderation.state === 'hidden';
  return (
    <div
      className={`mb-2 flex gap-2 rounded-lg border p-2 text-xs ${
        pending ? 'border-amber-500/40 bg-amber-500/5 text-amber-200' : 'border-crimson/40 bg-crimson/5 text-crimson-soft'
      }`}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <p>{moderation.message}</p>
    </div>
  );
};

const PostCard = ({ post, density: densityProp, showSpace = true }) => {
  const { density: preferred } = useCommunity();
  const density = densityProp || preferred;

  const href = `/c/${post.space?.slug}/p/${post.id}/${post.titleSlug || ''}`;
  const compact = density === 'compact';
  const classic = density === 'classic';

  const thumb = post.media?.[0]?.thumbUrl || post.media?.[0]?.url || post.link?.imageUrl;

  return (
    <article
      className={`flex gap-3 rounded-xl border border-line bg-night-surface transition-colors hover:border-crimson/30 ${
        compact ? 'p-2' : 'p-3'
      }`}
    >
      <div className="shrink-0 pt-0.5">
        <VoteControl post={post} size={compact ? 'sm' : 'md'} />
      </div>

      <div className="min-w-0 flex-1">
        <ModerationNotice moderation={post.moderation} />

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-silver-muted">
          {showSpace && post.space?.slug && (
            <Link
              to={`/c/${post.space.slug}`}
              className="font-medium text-silver transition-colors hover:text-crimson-soft"
            >
              /c/{post.space.slug}
            </Link>
          )}
          <span aria-hidden="true">·</span>
          <span>
            {post.author?.username ? (
              <Link to={`/u/${post.author.username}`} className="hover:text-silver">
                {post.author.username}
              </Link>
            ) : (
              '[deleted]'
            )}
          </span>
          <span aria-hidden="true">·</span>
          <time dateTime={post.createdAt}>{relative(post.createdAt)}</time>
          {post.editedAt && <span className="italic">edited</span>}
          {post.pinnedInSpace && (
            <span className="flex items-center gap-0.5 text-emerald-300">
              <Pin className="h-3 w-3" aria-hidden="true" /> pinned
            </span>
          )}
          {post.locked && (
            <span className="flex items-center gap-0.5 text-amber-300">
              <Lock className="h-3 w-3" aria-hidden="true" /> locked
            </span>
          )}
        </div>

        <h2 className={`mt-1 font-medium text-silver ${compact ? 'text-sm' : 'text-base'}`}>
          <Link to={href} className="transition-colors hover:text-crimson-soft">
            {post.title}
          </Link>
          {post.flairText && (
            <span className="ml-2 rounded bg-night-raised px-1.5 py-0.5 align-middle text-[11px] text-silver-muted">
              {post.flairText}
            </span>
          )}
          {post.nsfw && (
            <span className="ml-2 rounded bg-crimson/15 px-1.5 py-0.5 align-middle text-[11px] text-crimson-soft">
              NSFW
            </span>
          )}
        </h2>

        {post.link?.url && (
          <a
            href={post.link.url}
            target="_blank"
            // nofollow ugc is also forced server-side by the sanitizer; this is
            // the second half of the same decision.
            rel="noopener noreferrer nofollow ugc"
            className="mt-1 inline-flex items-center gap-1 text-xs text-sky-400 hover:underline"
          >
            {post.link.domain} <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        )}

        {/* Body preview only in card density, and never for a spoiler or an
            NSFW post — the point of those flags is not seeing it by accident. */}
        {!compact && !classic && post.body && !post.spoiler && !post.nsfw && (
          <div
            className="mt-2 line-clamp-3 text-sm text-silver-muted [&_a]:text-sky-400"
            // Sanitized server-side on write with a strict allowlist, and the
            // CSP is the backstop. See utils/sanitizeHtml.js.
            dangerouslySetInnerHTML={{ __html: post.body }}
          />
        )}

        {(post.spoiler || post.nsfw) && !compact && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-silver-muted">
            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
            {post.spoiler ? 'Spoiler — open the post to read it' : 'Marked NSFW'}
          </p>
        )}

        <div className="mt-2 flex items-center gap-3 text-xs text-silver-muted">
          <Link to={href} className="flex items-center gap-1 hover:text-silver">
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            {post.commentCount || 0}
            <span className="sr-only">comments</span>
          </Link>
        </div>
      </div>

      {thumb && !compact && !post.nsfw && !post.spoiler && (
        <Link to={href} className="hidden shrink-0 sm:block">
          <img
            src={thumb}
            // Author-provided alt where it exists. Empty alt rather than a
            // filename when it does not — a decorative image is better than a
            // screen reader reading "IMG_4821.jpg".
            alt={post.media?.[0]?.alt || ''}
            loading="lazy"
            className="h-20 w-28 rounded-lg object-cover"
          />
        </Link>
      )}
    </article>
  );
};

export default PostCard;
