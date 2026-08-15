import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Lock, AlertTriangle, ExternalLink, Eye, Flag } from 'lucide-react';
import * as api from '../../api/spaces';
import { useAuth } from '../../context/AuthContext';
import { useCommunity } from '../../context/CommunityContext';
import { useSettings } from '../../context/SettingsContext';
import VoteControl from '../../components/community/VoteControl';
import CommentTree from '../../components/community/CommentTree';
import ReportModal from '../../components/community/ReportModal';
import Spinner from '../../components/Spinner';

// A post and its comments.
//
// This is the canonical URL for a post — /c/:slug/p/:id/:titleSlug — and every
// sort and filter variant canonicalises to it. The <link rel="canonical"> is set
// below rather than left to the SPA shell, so the one page that matters for
// indexing declares itself correctly even without SSR.

const relative = (date) => {
  const minutes = Math.floor((Date.now() - new Date(date)) / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return new Date(date).toLocaleDateString();
};

/**
 * Set the document title and canonical link.
 *
 * Not SEO theatre: the title is what a browser tab, a bookmark and the history
 * menu show, and those matter regardless of whether a crawler ever sees them.
 */
const usePostMeta = (post) => {
  useEffect(() => {
    if (!post) return undefined;
    const previous = document.title;
    document.title = `${post.title} · /c/${post.space?.slug}`;

    const canonical = document.createElement('link');
    canonical.rel = 'canonical';
    canonical.href = `${window.location.origin}/c/${post.space?.slug}/p/${post.id}/${post.titleSlug || ''}`;
    document.head.appendChild(canonical);

    // DiscussionForumPosting. Google has explicit forum markup support and it
    // drives rich results — worth emitting even without SSR, because the
    // rendered DOM is what a JS-executing crawler reads.
    const jsonLd = document.createElement('script');
    jsonLd.type = 'application/ld+json';
    jsonLd.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'DiscussionForumPosting',
      headline: post.title,
      datePublished: post.createdAt,
      dateModified: post.editedAt || post.createdAt,
      author: post.author?.username
        ? { '@type': 'Person', name: post.author.username }
        : undefined,
      interactionStatistic: [
        { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction',
          userInteractionCount: post.score ?? 0 },
        { '@type': 'InteractionCounter', interactionType: 'https://schema.org/CommentAction',
          userInteractionCount: post.commentCount ?? 0 },
      ],
      url: canonical.href,
    });
    document.head.appendChild(jsonLd);

    // Thin content should not be indexed: a post with no discussion and no
    // score is exactly what suppresses a domain's overall performance when it
    // accumulates. Removed and hidden posts never belong in an index at all.
    const thin = (post.commentCount || 0) === 0 && (post.score ?? 0) <= 1;
    const suppressed = post.status && post.status !== 'published';
    let robots = null;
    if (thin || suppressed) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      robots.content = 'noindex, follow';
      document.head.appendChild(robots);
    }

    return () => {
      document.title = previous;
      canonical.remove();
      jsonLd.remove();
      if (robots) robots.remove();
    };
  }, [post]);
};

const PostDetail = () => {
  const { slug, postId } = useParams();
  const { user } = useAuth();
  const { settings } = useSettings();

  const [post, setPost] = useState(null);
  const [viewer, setViewer] = useState({});
  const [notFound, setNotFound] = useState(false);
  const [comments, setComments] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [commentError, setCommentError] = useState(null);
  const [commentSort, setCommentSort] = useState(
    () => settings?.['spaces.ranking.defaultCommentSort'] || 'best'
  );
  const [revealed, setRevealed] = useState(false);
  const [reporting, setReporting] = useState(null);
  const composerRef = useRef(null);

  usePostMeta(post);

  useEffect(() => {
    api.getPost(postId)
      .then((d) => { setPost(d.post); setViewer(d.viewer || {}); })
      .catch(() => setNotFound(true));
  }, [postId]);

  // COMMENT SORT IS ITS OWN AXIS. This used to send a hardcoded 'best' while
  // depending on the FEED sort, so changing hot/top/new refetched the comments
  // for no reason — throwing away every lazily loaded reply — and the comment
  // sort itself could not be changed at all, even though the backend has read
  // req.query.sort since Phase 3.
  useEffect(() => {
    setComments(null);
    api.getComments(postId, { sort: commentSort })
      .then((d) => setComments(d.comments))
      .catch(() => setComments([]));
  }, [postId, commentSort]);

  /** Merge lazily loaded replies without disturbing what is already rendered. */
  const mergeComments = useCallback((incoming) => {
    setComments((prev) => {
      const seen = new Set(prev.map((c) => c.id));
      return [...prev, ...incoming.filter((c) => !seen.has(c.id))];
    });
  }, []);

  const startReply = useCallback((node) => {
    setReplyTo(node);
    // Prefill the @mention. The backend already RESOLVES mentions to real
    // account ids (commentService.resolveMentions), so this is not decorative
    // text — it is a real reference that survives the author renaming
    // themselves, and it is what makes a reply readable when quoted out of
    // its thread.
    const username = node.author?.username;
    const mention = username && !node.tombstone ? `@${username} ` : '';
    setDraft((prev) => (prev.trim() ? prev : mention));

    // Focus, caret at the end — landing before the mention means typing
    // in front of it, which is never what anyone wants.
    requestAnimationFrame(() => {
      const el = composerRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, []);

  const cancelReply = useCallback(() => {
    // Drop the draft only if it is still just the prefilled mention. Anything
    // the person actually typed is theirs to keep.
    setDraft((prev) => (prev.trim().startsWith('@') && !prev.trim().includes(' ') ? '' : prev));
    setReplyTo(null);
  }, []);

  const reportComment = useCallback(
    (node) => setReporting({ type: 'comment', id: node.id }),
    []
  );

  const submitComment = async (event) => {
    event.preventDefault();
    if (!draft.trim()) return;
    setPosting(true);
    setCommentError(null);
    try {
      const { comment } = await api.createComment(postId, {
        body: draft,
        parent: replyTo?.id || null,
      });
      setComments((prev) => [...(prev || []), comment]);
      // C3: the heading reads this. Without it you comment, your comment
      // appears, and the count above it still says what it said before.
      setPost((prev) => (prev ? { ...prev, commentCount: (prev.commentCount || 0) + 1 } : prev));
      setDraft('');
      setReplyTo(null);
    } catch (err) {
      // THERE WAS NO CATCH HERE AT ALL. Automod rejection, rate limit, space
      // ban, locked post, over-length body — every one of them stopped the
      // spinner and said nothing, leaving the draft sitting there looking
      // like the button was broken. Automod rejection is not an edge case for
      // a new account; it is the common case.
      setCommentError(
        err?.response?.data?.message || 'That comment could not be posted. Try again.'
      );
    } finally {
      setPosting(false);
    }
  };

  /**
   * One composer, rendered in one of two places: at the top of the thread for
   * a new top-level comment, or inline beneath a comment when replying.
   *
   * Only ever ONE instance is mounted, so the duplicate-id and duplicate-ref
   * problems that usually come with this pattern do not arise.
   */
  const commentForm = () => (
    <form
      onSubmit={submitComment}
      className={`rounded-xl border bg-night-surface p-3 ${
        replyTo ? 'my-2 border-crimson/40' : 'mb-5 border-line'
      }`}
    >
      {replyTo && (
        <p className="mb-2 flex items-center gap-2 text-xs text-silver-muted">
          <span>
            Replying to{' '}
            <span className="font-medium text-crimson-soft">
              @{replyTo.author?.username || '[deleted]'}
            </span>
          </span>
          <button
            type="button"
            onClick={cancelReply}
            className="cursor-pointer underline hover:text-silver"
          >
            cancel
          </button>
        </p>
      )}
      <label htmlFor="comment-body" className="sr-only">
        {replyTo ? `Reply to ${replyTo.author?.username || 'this comment'}` : 'Your comment'}
      </label>
      <textarea
        id="comment-body"
        ref={composerRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        placeholder={replyTo ? 'Write a reply…' : 'What are your thoughts?'}
        className="w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none"
      />
      {commentError && (
        <p role="alert" className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-200">
          {commentError}
        </p>
      )}
      <div className="mt-2 flex justify-end gap-2">
        {replyTo && (
          <button
            type="button"
            onClick={cancelReply}
            className="cursor-pointer rounded-full border border-line px-4 py-1.5 text-sm text-silver-muted hover:text-silver"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={posting || !draft.trim()}
          className="cursor-pointer rounded-full bg-crimson px-4 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {posting ? 'Posting…' : replyTo ? 'Reply' : 'Comment'}
        </button>
      </div>
    </form>
  );

  if (notFound) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-silver">Post not found</h1>
        <Link to={`/c/${slug}`} className="mt-4 inline-block text-sm text-crimson-soft underline">
          Back to /c/{slug}
        </Link>
      </main>
    );
  }

  if (!post) return <Spinner full />;

  const obscured = (post.nsfw || post.spoiler) && !revealed;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Link
        to={`/c/${slug}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-silver-muted transition-colors hover:text-silver"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> /c/{slug}
      </Link>

      <article className="rounded-xl border border-line bg-night-surface p-4">
        {post.moderation && (
          <div
            role="status"
            className={`mb-3 flex gap-2 rounded-lg border p-3 text-sm ${
              post.moderation.state === 'hidden'
                ? 'border-amber-500/40 bg-amber-500/5 text-amber-200'
                : 'border-crimson/40 bg-crimson/5 text-crimson-soft'
            }`}
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p>{post.moderation.message}</p>
              {post.moderation.state === 'removed' && (
                <Link to="/community/appeals" className="mt-1 inline-block underline">
                  Appeal this decision
                </Link>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <div className="shrink-0">
            <VoteControl post={post} />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-xs text-silver-muted">
              {post.author?.username ? (
                <Link to={`/u/${post.author.username}`} className="hover:text-silver">
                  {post.author.username}
                </Link>
              ) : '[deleted]'}
              {' · '}
              <time dateTime={post.createdAt}>{relative(post.createdAt)}</time>
              {post.editedAt && <span className="ml-1 italic">edited</span>}
            </p>

            <h1 className="mt-1 font-display text-xl font-bold text-silver">{post.title}</h1>

            {post.link?.url && (
              <a
                href={post.link.url}
                target="_blank"
                rel="noopener noreferrer nofollow ugc"
                className="mt-2 inline-flex items-center gap-1 text-sm text-sky-400 hover:underline"
              >
                {post.link.domain} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            )}

            {/* Blur-until-click. The flag exists so it is not seen by accident,
                which a CSS blur alone does not achieve — the content is still
                there to be screenshotted. A click is an explicit choice. */}
            {obscured ? (
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className="mt-3 flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border border-line bg-night p-8 text-sm text-silver-muted transition-colors hover:border-crimson"
              >
                <Eye className="h-5 w-5" aria-hidden="true" />
                {post.spoiler ? 'Spoiler — click to reveal' : 'Marked NSFW — click to reveal'}
              </button>
            ) : (
              <>
                {post.body && (
                  <div
                    className="mt-3 text-sm text-silver [&_a]:text-sky-400 [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-night [&_pre]:p-2"
                    dangerouslySetInnerHTML={{ __html: post.body }}
                  />
                )}
                {post.media?.length > 0 && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {post.media.map((item, i) => (
                      <img
                        key={item.url || i}
                        src={item.url}
                        // Author-written where present. Empty rather than a
                        // filename otherwise.
                        alt={item.alt || ''}
                        loading="lazy"
                        className="w-full rounded-lg"
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {post.locked && (
              <p className="mt-3 flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-200">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                Comments are locked on this post.
              </p>
            )}

            {user && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setReporting({ type: 'post', id: postId })}
                  className="flex cursor-pointer items-center gap-1.5 text-xs text-silver-muted hover:text-silver"
                >
                  <Flag className="h-3.5 w-3.5" aria-hidden="true" /> Report
                </button>
              </div>
            )}
          </div>
        </div>
      </article>

      <section aria-labelledby="comments-heading" className="mt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="comments-heading" className="font-display text-lg font-bold text-silver">
            {post.commentCount || 0} comment{post.commentCount === 1 ? '' : 's'}
          </h2>
          {comments?.length > 1 && (
            <label className="flex items-center gap-1.5 text-xs text-silver-muted">
              Sort
              <select
                value={commentSort}
                onChange={(e) => setCommentSort(e.target.value)}
                className="cursor-pointer rounded-lg border border-line bg-night px-2 py-1 text-xs text-silver focus:border-crimson focus:outline-none"
              >
                <option value="best">Best</option>
                <option value="top">Top</option>
                <option value="new">New</option>
                <option value="old">Old</option>
                <option value="controversial">Controversial</option>
              </select>
            </label>
          )}
        </div>

        {/* TOP-LEVEL composer only. While replying, the box moves down to
            sit under the comment being answered — see renderReplyForm. */}
        {viewer.comment && !post.locked && !replyTo && commentForm()}

        {!user && (
          <p className="mb-5 rounded-xl border border-line bg-night-surface p-3 text-sm text-silver-muted">
            <Link to="/login" className="text-crimson-soft underline">Sign in</Link> to join the conversation.
          </p>
        )}

        {comments === null ? (
          <Spinner />
        ) : (
          <CommentTree
            comments={comments}
            canComment={Boolean(viewer.comment) && !post.locked}
            onReply={startReply}
            onReport={reportComment}
            postId={postId}
            onMerge={mergeComments}
            replyingToId={viewer.comment && !post.locked ? replyTo?.id : null}
            renderReplyForm={commentForm}
          />
        )}
      </section>

      {reporting && (
        <ReportModal
          targetType={reporting.type}
          targetId={reporting.id}
          onClose={() => setReporting(null)}
        />
      )}
    </main>
  );
};

export default PostDetail;
