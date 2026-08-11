import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BookOpen, BookmarkPlus, BookmarkCheck, Eye, List, Star, Play, Search, ArrowUpDown, Clock, Lock, Check } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import PageTransition from '../components/PageTransition';
import Spinner from '../components/Spinner';
import StarRating from '../components/StarRating';
import CommentCard from '../components/CommentCard';
import CreditAmount from '../components/credits/CreditAmount';
import { formatRelativeTime, formatExactDateTime } from '../utils/dateUtils';
import DeletedItemModal from '../components/DeletedItemModal';
import { ANCHORS, readHashTarget, isTargetInItems } from '../utils/hashTarget';

const SYNOPSIS_LIMIT = 300;

/**
 * Whether a chapter costs anything, shown before the reader clicks in.
 *
 * The list has always known this — the API sends `locked`, `owned` and
 * `priceCredits` — it just never showed it, so a reader met the paywall only
 * after committing to a chapter. Nothing renders for an ordinary free chapter;
 * a badge on every row would be noise.
 */
const ChapterAccessTag = ({ chapter }) => {
  if (chapter.owned) {
    return (
      <span className="shrink-0 text-xs text-emerald-400" title="You own this chapter">
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only">Unlocked</span>
      </span>
    );
  }

  if (!chapter.locked) return null;

  if (chapter.availableAt) {
    return (
      <span
        className="shrink-0 rounded-full bg-night-raised px-2 py-0.5 text-[11px] text-silver-muted"
        title={`Available ${formatExactDateTime(chapter.availableAt)}`}
      >
        Coming soon
      </span>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-crimson/15 px-2 py-0.5 text-[11px] text-crimson-soft">
      <Lock className="h-3 w-3" aria-hidden="true" />
      <CreditAmount value={chapter.priceCredits} showIcon={false} showLabel={false} />
    </span>
  );
};

// Trim to at most `max` chars, preferring the last word boundary, and append an ellipsis.
const truncateAtWord = (text, max) => {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
};

const withUser = (reactions, userId, active) => {
  const others = (reactions || []).filter((id) => (id._id || id)?.toString() !== userId);
  return active ? [...others, userId] : others;
};

// Likes and dislikes are mutually exclusive server side, so both lists are
// rebuilt from the toggle response.
const applyReaction = (review, reaction, userId) => ({
  ...review,
  likes: withUser(review.likes, userId, reaction.liked),
  dislikes: withUser(review.dislikes, userId, reaction.disliked),
});

const NovelDetail = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const { user, updateUser, isAdmin } = useAuth();
  const [novel, setNovel] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [chapterMeta, setChapterMeta] = useState({ total: 0, pages: 1 });
  const [loadingMore, setLoadingMore] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [progress, setProgress] = useState(null);
  const [reviewForm, setReviewForm] = useState({ rating: 0, content: '' });
  const [submitting, setSubmitting] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [showFullSynopsis, setShowFullSynopsis] = useState(false);
  const [chapterQuery, setChapterQuery] = useState('');
  const [sortAsc, setSortAsc] = useState(true);
  const [isReviewFocused, setIsReviewFocused] = useState(false);
  const [showDeletedModal, setShowDeletedModal] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const reactToReview = (action) => async (reviewId) => {
    if (!user) return navigate('/login');
    const { data } = await client.post(`/community/reviews/${reviewId}/${action}`);
    return setReviews((prev) => prev.map((r) => (r._id === reviewId ? applyReaction(r, data, user.id) : r)));
  };

  const likeReview = reactToReview('like');

  const dislikeReview = reactToReview('dislike');

  const postReviewReply = async (reviewId, text) => {
    if (!text.trim()) return;
    const { data } = await client.post(`/community/reviews/${reviewId}/replies`, { content: text });
    setReviews((prev) => prev.map((r) => (r._id === reviewId ? data.review : r)));
  };

  const editReview = async (reviewId, payload) => {
    const { data } = await client.put(`/community/reviews/${reviewId}`, payload);
    setReviews((prev) => prev.map((r) => (r._id === reviewId ? data.review : r)));
    client.get(`/novels/${slug}`).then(({ data: res }) => setNovel(res.novel)).catch(() => {});
  };

  const deleteReview = async (reviewId) => {
    if (!window.confirm('Delete this review?')) return;
    await client.delete(`/community/reviews/${reviewId}`);
    setReviews((prev) => prev.filter((r) => r._id !== reviewId));
  };

  const pinReview = async (reviewId) => {
    const { data } = await client.post(`/community/reviews/${reviewId}/pin`);
    setReviews((prev) => {
      const updated = prev.map((r) => (r._id === reviewId ? data.review : r));
      return [...updated].sort((a, b) => {
        if (Boolean(a.isPinned) !== Boolean(b.isPinned)) return a.isPinned ? -1 : 1;
        if (a.isPinned && b.isPinned) return new Date(b.pinnedAt || 0) - new Date(a.pinnedAt || 0);
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
    });
  };

  const editReviewReply = async (reviewId, replyId, text) => {
    const { data } = await client.put(`/community/reviews/${reviewId}/replies/${replyId}`, { content: text });
    setReviews((prev) => prev.map((r) => (r._id === reviewId ? data.review : r)));
  };

  const deleteReviewReply = async (reviewId, replyId) => {
    const { data } = await client.delete(`/community/reviews/${reviewId}/replies/${replyId}`);
    setReviews((prev) => prev.map((r) => (r._id === reviewId ? data.review : r)));
  };

  const reactToReviewReply = (action) => async (reviewId, replyId) => {
    if (!user) return navigate('/login');
    const { data } = await client.post(`/community/reviews/${reviewId}/replies/${replyId}/${action}`);
    return setReviews((prev) => prev.map((r) => (r._id === reviewId ? data.review : r)));
  };

  const likeReviewReply = reactToReviewReply('like');

  const dislikeReviewReply = reactToReviewReply('dislike');

  const inLibrary = user?.library?.some((id) => id === novel?._id);

  const load = useCallback(async () => {
    try {
      const { data } = await client.get(`/novels/${slug}`);
      setNovel(data.novel);
      const [chaptersRes, reviewsRes] = await Promise.all([
        client.get(`/novels/${slug}/chapters?limit=5000`),
        client.get(`/novels/id/${data.novel._id}/reviews`),
      ]);
      setChapters(chaptersRes.data.chapters);
      // The endpoint is paginated now. Without this, a long novel silently
      // stops at the first page and looks like it just ends.
      setChapterMeta({
        total: chaptersRes.data.total ?? chaptersRes.data.chapters.length,
        pages: chaptersRes.data.pages ?? 1,
      });
      setReviews(reviewsRes.data.reviews);
      setLoaded(true);
    } catch (error) {
      setNotFound(true);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  const reviewTarget = readHashTarget(hash, ANCHORS.REVIEW);

  useEffect(() => {
    if (!loaded || !reviewTarget) return;
    const exists = isTargetInItems(reviewTarget, reviews);
    if (!exists) {
      setShowDeletedModal(true);
    }
  }, [loaded, reviewTarget, reviews]);

  useEffect(() => {
    if (!user || !novel) return;
    client
      .get('/library/history/list')
      .then(({ data }) => {
        const entry = data.history.find((h) => h.novel._id === novel._id);
        if (entry) setProgress(entry);
      })
      .catch(() => {});
  }, [user, novel]);

  const toggleLibrary = async () => {
    if (!user) {
      navigate('/login');
      return;
    }
    const { data } = await client.post(`/library/${novel._id}`);
    updateUser({ ...user, library: data.library });
  };

  const submitReview = async (e) => {
    e.preventDefault();
    if (!reviewForm.content.trim() && !reviewForm.rating) return;
    setSubmitting(true);
    try {
      await client.post(`/novels/id/${novel._id}/reviews`, reviewForm);
      const [reviewsRes, novelRes] = await Promise.all([
        client.get(`/novels/id/${novel._id}/reviews`),
        client.get(`/novels/${slug}`),
      ]);
      setReviews(reviewsRes.data.reviews);
      setNovel(novelRes.data.novel);
      setReviewForm({ rating: 0, content: '' });
      setIsReviewFocused(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (notFound) {
    return (
      <div className="py-24 text-center text-silver-muted">
        <p className="font-display text-xl">Novel not found</p>
        <Link to="/browse" className="mt-2 inline-block text-crimson-soft hover:underline">Browse novels</Link>
      </div>
    );
  }

  if (!novel) return <Spinner full />;

  const filteredChapters = chapters
    .filter((c) => {
      if (!chapterQuery.trim()) return true;
      const q = chapterQuery.toLowerCase().trim();
      return (c.number != null ? String(c.number) : '').includes(q) || (c.title || '').toLowerCase().includes(q);
    })
    .sort((a, b) => (sortAsc ? a.number - b.number : b.number - a.number));

  const continueChapter = progress ? progress.chapterNumber : chapters[0]?.number;

  return (
    <PageTransition>
      <div className="flex flex-col gap-8 md:flex-row">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35 }}
          className="mx-auto w-48 shrink-0 md:mx-0 md:w-56"
        >
          <div className="aspect-[2/3] overflow-hidden rounded-xl border border-line bg-night-surface shadow-card">
            {novel.coverUrl ? (
              <img src={novel.coverUrl} alt={`Cover of ${novel.title}`} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center">
                <BookOpen className="h-12 w-12 text-silver-muted" aria-hidden="true" />
              </div>
            )}
          </div>
        </motion.div>

        <div className="flex-1">
          <h1 className="font-display text-3xl font-bold text-silver">{novel.title}</h1>
          <p className="mt-1 text-silver-muted">by {novel.author}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-silver-muted">
            <span className="flex items-center gap-1">
              <Star className="h-4 w-4 fill-crimson text-crimson" aria-hidden="true" />
              {novel.ratingAvg ? `${novel.ratingAvg.toFixed(1)} (${novel.ratingCount})` : 'No ratings yet'}
            </span>
            <span className="flex items-center gap-1">
              <Eye className="h-4 w-4" aria-hidden="true" /> {(novel.views || 0).toLocaleString()}
            </span>
            <span className="flex items-center gap-1">
              <List className="h-4 w-4" aria-hidden="true" /> {novel.chapterCount} chapters
            </span>
            <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-medium capitalize">{novel.status}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {novel.genres.map((genre) => (
              <Link
                key={genre}
                to={`/browse?genre=${encodeURIComponent(genre)}`}
                className="rounded-full bg-crimson/15 px-3 py-1 text-xs font-medium text-crimson-soft transition-colors hover:bg-crimson/25"
              >
                {genre}
              </Link>
            ))}
          </div>
          {novel.synopsis && (
            <p className="mt-4 whitespace-pre-line leading-relaxed text-silver-muted">
              {showFullSynopsis ? novel.synopsis : truncateAtWord(novel.synopsis, SYNOPSIS_LIMIT)}
              {novel.synopsis.length > SYNOPSIS_LIMIT && (
                <button
                  type="button"
                  onClick={() => setShowFullSynopsis((v) => !v)}
                  className="ml-1.5 font-medium text-crimson-soft hover:underline"
                  aria-expanded={showFullSynopsis}
                >
                  {showFullSynopsis ? 'Read less' : 'Read more'}
                </button>
              )}
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            {chapters.length > 0 && (
              <Link
                to={`/novel/${slug}/chapter/${continueChapter}`}
                className="flex items-center gap-2 rounded-full bg-crimson px-6 py-3 font-semibold text-white shadow-glow transition-transform duration-200 hover:scale-[1.03]"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                {progress ? `Continue Ch. ${progress.chapterNumber}` : 'Start Reading'}
              </Link>
            )}
            <button
              type="button"
              onClick={toggleLibrary}
              className={`flex cursor-pointer items-center gap-2 rounded-full border px-6 py-3 font-semibold transition-colors duration-200 ${
                inLibrary
                  ? 'border-crimson/60 text-crimson-soft'
                  : 'border-line text-silver hover:border-crimson/60 hover:text-crimson-soft'
              }`}
            >
              {inLibrary ? <BookmarkCheck className="h-4 w-4" aria-hidden="true" /> : <BookmarkPlus className="h-4 w-4" aria-hidden="true" />}
              {inLibrary ? 'In Library' : 'Add to Library'}
            </button>
          </div>
        </div>
      </div>

      <section className="mt-12" aria-label="Chapters">
        <div className="rounded-2xl border border-line bg-night-surface p-4 sm:p-6 shadow-card overflow-hidden">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-4">
            <div>
              <h2 className="font-display text-xl font-bold text-silver">Chapters</h2>
              <p className="text-xs text-silver-muted">
                {chapterMeta.total || chapters.length} chapter
                {(chapterMeta.total || chapters.length) === 1 ? '' : 's'} available
                {chapters.length < chapterMeta.total && ` · showing ${chapters.length}`}
              </p>
            </div>
            {chapters.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[140px] flex-1 sm:w-48 sm:flex-none">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-silver-muted" aria-hidden="true" />
                  <input
                    type="text"
                    placeholder="Search chapter..."
                    value={chapterQuery}
                    onChange={(e) => setChapterQuery(e.target.value)}
                    className="w-full rounded-full border border-line bg-night pl-8 pr-3 py-1.5 text-xs text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setSortAsc((v) => !v)}
                  className="flex items-center gap-1.5 rounded-full border border-line bg-night px-3 py-1.5 text-xs font-medium text-silver-muted transition-colors hover:text-silver hover:border-crimson/50"
                  aria-label={`Sort ${sortAsc ? 'descending' : 'ascending'}`}
                >
                  <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{sortAsc ? '1 → N' : 'N → 1'}</span>
                </button>
              </div>
            )}
          </div>

          {chapters.length === 0 ? (
            <p className="py-8 text-center text-silver-muted text-sm">No chapters yet.</p>
          ) : filteredChapters.length === 0 ? (
            <p className="py-8 text-center text-silver-muted text-sm">No chapters match "{chapterQuery}".</p>
          ) : (
            <div className="max-h-80 overflow-y-auto overflow-x-hidden pr-1">
              <div className="grid gap-2 sm:grid-cols-2">
                {filteredChapters.map((chapter) => (
                  <Link
                    key={chapter.id}
                    to={`/novel/${slug}/chapter/${chapter.number}`}
                    className="group flex flex-col justify-center gap-1.5 min-w-0 overflow-hidden rounded-lg border border-line bg-night px-4 py-3 text-sm transition-colors duration-150 hover:border-crimson/50 hover:bg-night-raised"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="shrink-0 font-semibold text-crimson-soft">#{chapter.number}</span>
                      <span className="truncate font-medium text-silver group-hover:text-white transition-colors">{chapter.title}</span>
                      <ChapterAccessTag chapter={chapter} />
                    </div>
                    <div
                      className="flex items-center gap-1.5 min-w-0 text-xs text-silver-muted"
                      title={formatExactDateTime(chapter.createdAt)}
                    >
                      <Clock className="h-3 w-3 shrink-0 text-silver-muted/80" aria-hidden="true" />
                      <span className="truncate">{formatRelativeTime(chapter.createdAt)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="mt-12" aria-label="Reviews">
        <h2 className="mb-4 font-display text-xl font-bold text-silver">Reviews</h2>
        {user ? (
          <div className="mb-6 flex gap-3.5 items-start">
            {/* User Avatar */}
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.username}
                className="h-10 w-10 shrink-0 rounded-full object-cover border border-line shadow-sm"
              />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-crimson/20 text-sm font-bold uppercase text-crimson-soft border border-crimson/30 shadow-sm">
                {(user.fullName || user.username)?.slice(0, 2) || '??'}
              </span>
            )}

            <form onSubmit={submitReview} className="flex-1 space-y-3">
              <div className="relative group">
                <textarea
                  id="review-content"
                  value={reviewForm.content}
                  onChange={(e) => setReviewForm((f) => ({ ...f, content: e.target.value }))}
                  onFocus={() => setIsReviewFocused(true)}
                  placeholder="Share your thoughts or review this novel..."
                  rows={isReviewFocused || reviewForm.content ? 3 : 1}
                  className="w-full bg-transparent border-b border-line py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none transition-all duration-200 resize-none"
                />
                {/* Smooth border expand animation */}
                <div className="absolute bottom-0 left-1/2 h-[2px] w-0 bg-crimson transition-all duration-300 group-focus-within:left-0 group-focus-within:w-full" />
              </div>

              {(isReviewFocused || reviewForm.content.trim() !== '' || reviewForm.rating > 0) && (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-silver-muted">Your rating:</span>
                    <StarRating
                      value={reviewForm.rating}
                      onChange={(rating) => setReviewForm((f) => ({ ...f, rating }))}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsReviewFocused(false);
                        setReviewForm({ rating: 0, content: '' });
                      }}
                      className="rounded-full px-4 py-1.5 text-xs font-semibold text-silver hover:bg-white/10 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting || (!reviewForm.content.trim() && !reviewForm.rating)}
                      className="rounded-full bg-crimson px-5 py-2 text-xs font-semibold text-white transition-all hover:bg-crimson-soft disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {submitting ? 'Posting...' : 'Post Comment'}
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>
        ) : (
          <p className="mb-6 text-sm text-silver-muted">
            <Link to="/login" className="text-crimson-soft hover:underline">Log in</Link> to leave a review.
          </p>
        )}
        {reviews.length === 0 ? (
          <p className="text-sm text-silver-muted">No reviews yet. Be the first!</p>
        ) : (
          <div className="space-y-4">
            {reviews.map((review) => (
              <CommentCard
                key={review._id}
                item={review}
                currentUser={user}
                isAdmin={isAdmin}
                anchorPrefix={ANCHORS.REVIEW}
                targetId={reviewTarget}
                onLike={likeReview}
                onDislike={dislikeReview}
                onEdit={editReview}
                onDelete={deleteReview}
                onPin={pinReview}
                onReplySubmit={postReviewReply}
                onLikeReply={likeReviewReply}
                onDislikeReply={dislikeReviewReply}
                onEditReply={editReviewReply}
                onDeleteReply={deleteReviewReply}
              />
            ))}
          </div>
        )}
      </section>
      <DeletedItemModal
        isOpen={showDeletedModal}
        onClose={() => setShowDeletedModal(false)}
        message="The review or reply you clicked has been deleted."
      />
    </PageTransition>
  );
};

export default NovelDetail;
