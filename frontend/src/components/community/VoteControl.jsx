import { useId } from 'react';
import { ArrowBigUp, ArrowBigDown } from 'lucide-react';
import { useCommunity } from '../../context/CommunityContext';

// The most-used interactive element on the site, and the one most often built
// inaccessibly.
//
// WHAT MAKES IT ACCESSIBLE:
//
//   - Real <button> elements. A clickable <div> is invisible to keyboards and
//     to screen readers, and this is the primary action of the whole product.
//   - aria-pressed, so assistive tech announces the CURRENT state rather than
//     just "button".
//   - A polite live region announcing the new score. Without it, a screen
//     reader user presses upvote and hears nothing at all.
//   - aria-label carries the meaning; the arrow glyph is decorative and hidden.
//
// The score is rendered from the optimistic layer, so it moves on click and
// rolls back with an explanation if the server refuses.

const format = (n) => {
  if (n === null || n === undefined) return '–';
  if (Math.abs(n) < 1000) return String(n);
  return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
};

// `target` selects the endpoint: 'post' or 'comment'. It is not inferable
// from the object, so it is explicit rather than guessed.
const VoteControl = ({ post, orientation = 'vertical', size = 'md', target = 'post' }) => {
  const { vote, viewOf, votingEnabled, allowDownvotes } = useCommunity();
  const liveId = useId();

  const id = post.id || post._id;
  const { value, score } = viewOf(post);
  const hidden = post.scoreHidden;

  if (!votingEnabled) return null;

  const iconSize = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
  const layout = orientation === 'vertical'
    ? 'flex-col gap-0.5'
    : 'flex-row items-center gap-1';

  const button = (direction) => {
    const active = value === direction;
    const Icon = direction === 1 ? ArrowBigUp : ArrowBigDown;
    const action = direction === 1 ? 'Upvote' : 'Downvote';
    return (
      <button
        type="button"
        onClick={() => vote(id, direction, value, score, target)}
        aria-pressed={active}
        aria-label={active ? `Remove ${action.toLowerCase()}` : action}
        className={`cursor-pointer rounded p-1 transition-colors ${
          active
            ? direction === 1 ? 'text-crimson' : 'text-sky-400'
            : 'text-silver-muted hover:bg-night-raised hover:text-silver'
        }`}
      >
        <Icon className={iconSize} aria-hidden="true" fill={active ? 'currentColor' : 'none'} />
      </button>
    );
  };

  return (
    <div className={`flex ${layout}`}>
      {button(1)}

      <span
        className={`min-w-[2ch] text-center text-xs font-semibold tabular-nums ${
          value === 1 ? 'text-crimson' : value === -1 ? 'text-sky-400' : 'text-silver'
        }`}
        // The number is decorative for assistive tech — the live region below
        // announces it, and announcing it twice is worse than once.
        aria-hidden="true"
      >
        {hidden ? '–' : format(score)}
      </span>

      {/* Politely announced on change. Visually hidden, never display:none —
          a hidden live region is not announced at all. */}
      <span id={liveId} role="status" aria-live="polite" className="sr-only">
        {hidden
          ? 'Score hidden while this post is new'
          : `Score ${score}${value === 1 ? ', you upvoted' : value === -1 ? ', you downvoted' : ''}`}
      </span>

      {allowDownvotes && button(-1)}
    </div>
  );
};

export default VoteControl;
