import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BookOpen, BookmarkPlus, BookmarkCheck, Eye, List, Star, Play, Search, ArrowUpDown, Clock, Heart, CornerDownRight, Trash2 } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import PageTransition from '../components/PageTransition';
import Spinner from '../components/Spinner';
import StarRating from '../components/StarRating';
import CommentCard from '../components/CommentCard';
import { formatRelativeTime, formatExactDateTime } from '../utils/dateUtils';

const SYNOPSIS_LIMIT = 300;

// Trim to at most `max` chars, preferring the last word boundary, and append an ellipsis.
const truncateAtWord = (text, max) => {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
};

const NovelDetail = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user, updateUser, isAdmin } = useAuth();
  const [novel, setNovel] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [userReview, setUserReview] = useState(null);
  const [progress, setProgress] = useState(null);
  const [reviewForm, setReviewForm] = useState({ rating: 0, content: '' });
  const [submitting, setSubmitting] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [showFullSynopsis, setShowFullSynopsis] = useState(false);
  const [chapterQuery, setChapterQuery] = useState('');
  const [sortAsc, setSortAsc] = useState(true);
  const [replyTarget, setReplyTarget] = useState(null);
  const [replyContent, setReplyContent] = useState('');

  const likeReview = async (reviewId) => {
    if (!user) return navigate('/login');
    const { data } = await client.post(`/community/reviews/${reviewId}/like`);
    setReviews((prev) =>
      prev.map((r) =>
        r._id === reviewId
          ? {
              ...r,
              likes: data.liked
                ? [...(r.likes || []), user.id]
                : (r.likes || []).filter((id) => id !== user.id),
            }
          : r
      )
    );
  };

  const postReviewReply = async (reviewId) => {
    if (!replyContent.trim()) return;
    const { data } = await client.post(`/community/reviews/${reviewId}/replies`, { content: replyContent });
    setReviews((prev) => prev.map((r) => (r._id === reviewId ? data.review : r)));
    setReplyTarget(null);
    setReplyContent('');
  };

  const deleteReview = async (reviewId) => {
    if (!window.confirm('Delete this review?')) return;
    await client.delete(`/community/reviews/${reviewId}`);
    setReviews((prev) => prev.filter((r) => r._id !== reviewId));
    if (userReview?._id === reviewId) setUserReview(null);
  };

  const deleteReviewReply = async (reviewId, replyId) => {
    const { data } = await client.delete(`/community/reviews/${reviewId}/replies/${replyId}`);
    setReviews((prev) => prev.map((r) => (r._id === reviewId ? data.review : r)));
  };

  const likeReviewReply = async (reviewId, replyId) => {
    if (!user) return navigate('/login');
    const { data } = await client.post(`/community/reviews/${reviewId}/replies/${replyId}/like`);
    setReviews((prev) => prev.map((r) => (r._id === reviewId ? data.review : r)));
  };

  const inLibrary = user?.library?.some((id) => id === novel?._id);

  const load = useCallback(async () => {
    try {
      const { data } = await client.get(`/novels/${slug}`);
      setNovel(data.novel);
      setUserReview(data.userReview);
      if (data.userReview) {
        setReviewForm({ rating: data.userReview.rating, content: data.userReview.content });
      }
      const [chaptersRes, reviewsRes] = await Promise.all([
        client.get(`/novels/${slug}/chapters`),
        client.get(`/novels/id/${data.novel._id}/reviews`),
      ]);
      setChapters(chaptersRes.data.chapters);
      setReviews(reviewsRes.data.reviews);
    } catch (error) {
      setNotFound(true);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

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
    if (!reviewForm.rating) return;
    setSubmitting(true);
    try {
      await client.post(`/novels/id/${novel._id}/reviews`, reviewForm);
      const { data } = await client.get(`/novels/id/${novel._id}/reviews`);
      setReviews(data.reviews);
      setUserReview(data.reviews.find((r) => r.user._id === user.id) || null);
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
              <p className="text-xs text-silver-muted">{chapters.length} chapter{chapters.length === 1 ? '' : 's'} available</p>
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
                    key={chapter._id}
                    to={`/novel/${slug}/chapter/${chapter.number}`}
                    className="group flex flex-col justify-center gap-1.5 min-w-0 overflow-hidden rounded-lg border border-line bg-night px-4 py-3 text-sm transition-colors duration-150 hover:border-crimson/50 hover:bg-night-raised"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="shrink-0 font-semibold text-crimson-soft">#{chapter.number}</span>
                      <span className="truncate font-medium text-silver group-hover:text-white transition-colors">{chapter.title}</span>
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
          <form onSubmit={submitReview} className="mb-6 rounded-xl border border-line bg-night-surface p-4">
            <div className="mb-3 flex items-center gap-3">
              <span className="text-sm font-medium text-silver">Your rating</span>
              <StarRating value={reviewForm.rating} onChange={(rating) => setReviewForm((f) => ({ ...f, rating }))} />
            </div>
            <label htmlFor="review-content" className="sr-only">Review text</label>
            <textarea
              id="review-content"
              value={reviewForm.content}
              onChange={(e) => setReviewForm((f) => ({ ...f, content: e.target.value }))}
              placeholder="Share your thoughts (optional)"
              rows={3}
              className="w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none"
            />
            <button
              type="submit"
              disabled={submitting || !reviewForm.rating}
              className="mt-3 cursor-pointer rounded-full bg-crimson px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-crimson-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Saving...' : userReview ? 'Update Review' : 'Post Review'}
            </button>
          </form>
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
                onLike={likeReview}
                onDelete={deleteReview}
                onReplySubmit={(reviewId, text) => {
                  setReplyContent(text);
                  return postReviewReply(reviewId);
                }}
                onLikeReply={likeReviewReply}
                onDeleteReply={deleteReviewReply}
              />
            ))}
          </div>
        )}
      </section>
    </PageTransition>
  );
};

export default NovelDetail;
