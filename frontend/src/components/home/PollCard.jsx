import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Check, MessageSquare } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { votePoll } from '../../api/spotlight';
import { compact } from './railStyle';

// A community poll, answerable on the homepage.
//
// The single cheapest thing a stranger can do on this site: one tap, no
// navigation, no account needed to see the result afterwards. It is also the
// only rail that shows a visitor what other people here think, which is a
// different and more interesting signal than what other people here are
// reading.
//
// SERVER IS THE AUTHORITY. The tallies come back from the endpoint and replace
// what is on screen; the optimistic state is only there so the bar moves under
// the finger. A poll where the local guess sticks would drift further from the
// truth with every answer.
//
// `resultsHidden` is honoured by the server — a poll set to hide results until
// it closes sends no numbers at all — so there is nothing here to leak. This
// component renders "answered" without percentages in that case.

const PollCard = ({ card }) => {
  const post = card.entity;
  const { user } = useAuth();
  const [poll, setPoll] = useState(post?.poll || null);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);

  const answered = useMemo(
    () => Boolean(poll && poll.viewerResponse && poll.viewerResponse.length),
    [poll]
  );

  if (!post || !poll || !poll.options?.length) return null;

  const total = poll.options.reduce((sum, option) => sum + (option.votes || 0), 0);
  const closed = poll.closed;
  const showResults = (answered || closed) && !poll.resultsHidden;

  const choose = async (optionId) => {
    if (!user) { setError('Sign in to answer'); return; }
    if (closed || pending) return;
    setError(null);
    setPending(optionId);
    try {
      const result = await votePoll(post.id, [optionId]);
      // Replace wholesale rather than merging: the response carries the real
      // tallies including everyone else's answers since this page loaded.
      setPoll(result.poll);
    } catch (err) {
      setError(err?.response?.data?.message || 'That answer could not be saved');
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-night-surface p-4 shadow-card sm:p-5">
      <div className="flex items-center gap-2 text-xs text-silver-muted">
        <BarChart3 className="h-4 w-4 text-crimson" aria-hidden="true" />
        <Link to={`/c/${post.space?.slug}`} className="font-medium text-silver hover:text-crimson-soft">
          {post.space?.name}
        </Link>
        {closed && <span className="rounded bg-night-raised px-1.5 py-0.5">Closed</span>}
      </div>

      <h3 className="mt-2 font-display text-lg font-bold leading-snug text-silver">{post.title}</h3>
      {card.note && <p className="mt-1 text-sm italic text-crimson-soft">{card.note}</p>}

      <ul className="mt-4 space-y-2">
        {poll.options.map((option) => {
          const votes = option.votes || 0;
          const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
          const chosen = (poll.viewerResponse || []).map(String).includes(String(option.id));

          return (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => choose(option.id)}
                disabled={closed || Boolean(pending)}
                aria-pressed={chosen}
                className={`relative w-full cursor-pointer overflow-hidden rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default ${
                  chosen
                    ? 'border-crimson/60 bg-crimson/10 text-silver'
                    : 'border-line bg-night-raised text-silver hover:border-crimson/40'
                }`}
              >
                {/* The fill bar is decorative — the percentage is in the text,
                    so a screen reader is not left inferring a value from a
                    width it cannot see. */}
                {showResults && (
                  <span
                    aria-hidden="true"
                    className={`absolute inset-y-0 left-0 ${chosen ? 'bg-crimson/25' : 'bg-night-surface'}`}
                    style={{ width: `${pct}%`, transition: 'width 400ms ease-out' }}
                  />
                )}
                <span className="relative flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {chosen && <Check className="h-4 w-4 shrink-0 text-crimson" aria-hidden="true" />}
                    <span className="truncate">{option.text}</span>
                  </span>
                  {showResults && (
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-silver-muted">
                      {pct}%<span className="sr-only"> — {votes} votes</span>
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-silver-muted">
        <span>
          {poll.resultsHidden
            ? 'Results are revealed when this closes'
            : `${compact(poll.totalVoters || total)} ${(poll.totalVoters || total) === 1 ? 'answer' : 'answers'}`}
          {answered && !poll.resultsHidden ? ' · you answered' : ''}
        </span>
        <Link to={card.href} className="flex items-center gap-1 hover:text-crimson-soft">
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
          {post.commentCount || 0} comments
        </Link>
      </div>

      {/* Announced, not merely shown — the answer failing is exactly the moment
          a silent failure reads as a broken site. */}
      {error && <p role="alert" className="mt-2 text-xs text-amber-300">{error}</p>}
    </div>
  );
};

export default PollCard;
