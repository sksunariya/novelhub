import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Lock, LogIn } from 'lucide-react';
import client from '../api/client';
import StarRating from './StarRating';
import {
  GATE_REASONS,
  GATE_REQUIREMENTS,
  REDIRECT_PARAM,
  needsAny,
  requirementLabel,
  unmetRequirements,
} from '../utils/readingGate';

const RequirementRow = ({ requirement }) => (
  <li className="flex items-center gap-2 text-sm">
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
        requirement.satisfied ? 'border-green-500/50 bg-green-500/20 text-green-400' : 'border-line text-silver-muted'
      }`}
    >
      {requirement.satisfied ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
    </span>
    <span className={requirement.satisfied ? 'text-silver-muted line-through' : 'text-silver'}>
      {requirementLabel(requirement.key)}
    </span>
  </li>
);

const RatingForm = ({ title, submitLabel, onSubmit }) => {
  const [rating, setRating] = useState(0);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async (event) => {
    event.preventDefault();
    if (!rating || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit({ rating, content });
    } catch (submitError) {
      setError(submitError.response?.data?.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={send} className="space-y-2 rounded-xl border border-line bg-night p-4">
      <p className="text-sm font-semibold text-silver">{title}</p>
      {error && <p className="text-xs text-crimson-soft">{error}</p>}
      <div className="flex items-center gap-2">
        <span className="text-xs text-silver-muted">Your rating</span>
        <StarRating value={rating} onChange={setRating} size="h-5 w-5" />
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={2}
        placeholder="Add a few words (optional)"
        aria-label={title}
        className="w-full resize-none rounded-lg border border-line bg-night-surface px-3 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none"
      />
      <button
        type="submit"
        disabled={!rating || busy}
        className="w-full cursor-pointer rounded-full bg-crimson px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-crimson-soft disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Saving...' : submitLabel}
      </button>
    </form>
  );
};

const CommentForm = ({ title, onSubmit }) => {
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async (event) => {
    event.preventDefault();
    if (!content.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit(content);
    } catch (submitError) {
      setError(submitError.response?.data?.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={send} className="space-y-2 rounded-xl border border-line bg-night p-4">
      <p className="text-sm font-semibold text-silver">{title}</p>
      {error && <p className="text-xs text-crimson-soft">{error}</p>}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
        placeholder="Share what you thought so far..."
        aria-label={title}
        className="w-full resize-none rounded-lg border border-line bg-night-surface px-3 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none"
      />
      <button
        type="submit"
        disabled={!content.trim() || busy}
        className="w-full cursor-pointer rounded-full bg-crimson px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-crimson-soft disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Posting...' : 'Post comment'}
      </button>
    </form>
  );
};

const ChapterGate = ({ payload, user, onSatisfied }) => {
  const { gate, novel, chapter, prev, message } = payload;
  const unmet = unmetRequirements(gate.requirements);
  const checkpoint = gate.checkpoint;
  const needsLogin = gate.reason === GATE_REASONS.LOGIN || !user;
  const redirect = `${REDIRECT_PARAM}=${encodeURIComponent(`/novel/${novel.slug}/chapter/${chapter.number}`)}`;

  // A novel-scoped comment counts wherever it is posted, so when there is no
  // reachable checkpoint chapter it lands on the one the reader is trying to open.
  const commentTargetId = checkpoint?.id || chapter.id;

  const postComment = async (content) => {
    await client.post(`/community/chapters/${commentTargetId}/comments`, { content });
    await onSatisfied();
  };

  const postNovelReview = async ({ rating, content }) => {
    await client.post(`/novels/id/${novel.id}/reviews`, { rating, content });
    await onSatisfied();
  };

  const postChapterReview = async ({ rating, content }) => {
    await client.post(`/community/chapters/${checkpoint.id}/reviews`, { rating, content });
    await onSatisfied();
  };

  const checkpointIsElsewhere = checkpoint && checkpoint.number !== chapter.number;

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <div className="rounded-2xl border border-line bg-night-surface p-6 shadow-card">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-crimson/15 text-crimson-soft">
            <Lock className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-lg font-bold text-silver">
              Chapter {chapter.number} is locked
            </h1>
            <p className="truncate text-xs text-silver-muted">{novel.title}</p>
          </div>
        </div>

        <p className="mt-4 text-sm text-silver-muted">{message}</p>

        {needsLogin ? (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-silver">Log in to keep reading — you will come straight back to this chapter.</p>
            <div className="flex flex-wrap gap-2">
              <Link
                to={`/login?${redirect}`}
                className="flex items-center gap-2 rounded-full bg-crimson px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-crimson-soft"
              >
                <LogIn className="h-4 w-4" aria-hidden="true" /> Log in
              </Link>
              <Link
                to={`/signup?${redirect}`}
                className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-silver transition-colors hover:border-crimson/60 hover:text-crimson-soft"
              >
                Create an account
              </Link>
            </div>
            {unmet.length > 0 && (
              <div className="rounded-xl border border-line bg-night p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-silver-muted">
                  Then you will be asked to
                </p>
                <ul className="space-y-1.5">
                  {gate.requirements.map((requirement) => (
                    <RequirementRow key={requirement.key} requirement={requirement} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-silver-muted">
                To unlock, finish these
              </p>
              <ul className="space-y-1.5">
                {gate.requirements.map((requirement) => (
                  <RequirementRow key={requirement.key} requirement={requirement} />
                ))}
              </ul>
              {checkpointIsElsewhere && (
                <p className="mt-2 text-xs text-silver-muted">
                  These apply to chapter {checkpoint.number}
                  {checkpoint.title ? ` · ${checkpoint.title}` : ''}.
                </p>
              )}
            </div>

            {needsAny(unmet, GATE_REQUIREMENTS.NOVEL_COMMENT, GATE_REQUIREMENTS.CHAPTER_COMMENT) && commentTargetId && (
              <CommentForm title="Leave a comment" onSubmit={postComment} />
            )}

            {unmet.includes(GATE_REQUIREMENTS.NOVEL_REVIEW) && (
              <RatingForm
                title={`Rate ${novel.title}`}
                submitLabel="Post novel review"
                onSubmit={postNovelReview}
              />
            )}

            {unmet.includes(GATE_REQUIREMENTS.CHAPTER_REVIEW) && checkpoint && (
              <RatingForm
                title={`Rate chapter ${checkpoint.number}`}
                submitLabel="Post chapter review"
                onSubmit={postChapterReview}
              />
            )}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3 border-t border-line pt-4 text-sm">
          <Link to={`/novel/${novel.slug}`} className="flex items-center gap-1.5 text-silver-muted hover:text-silver">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to novel
          </Link>
          {prev && (
            <Link
              to={`/novel/${novel.slug}/chapter/${prev.number}`}
              className="text-crimson-soft hover:underline"
            >
              Re-read chapter {prev.number}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChapterGate;
