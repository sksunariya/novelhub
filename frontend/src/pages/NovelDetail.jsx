import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BookOpen, BookmarkPlus, BookmarkCheck, Eye, List, Star, Play, Search, ArrowUpDown, Lock, Check, ChevronRight } from 'lucide-react';
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

const STATUS_DOT = {
  ongoing: 'bg-sky-400',
  completed: 'bg-emerald-400',
  hiatus: 'bg-amber-400',
};

const compactNumber = (value) =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);

/** One figure in the header's stat row: value on top, label beneath. */
const Stat = ({ icon: Icon, label, value, tone = 'text-silver-muted' }) => (
  <div className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2 backdrop-blur-md">
    <Icon className={`h-4 w-4 shrink-0 ${tone}`} aria-hidden="true" />
    <div className="flex flex-col-reverse text-left leading-tight">
      <dt className="text-[11px] text-silver-muted">{label}</dt>
      <dd className="text-sm font-bold text-silver">{value}</dd>
    </div>
  </div>
);

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
      <div className="mx-auto max-w-7xl px-4 py-24 text-center sm:px-6 lg:px-8">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-crimson/15 text-crimson-soft">
          <BookOpen className="h-7 w-7" aria-hidden="true" />
        </span>
        <p className="mt-4 font-display text-2xl font-bold text-silver">Novel not found</p>
        <p className="mt-1 text-sm text-silver-muted">It may have been removed, or the link is mistyped.</p>
        <Link to="/browse" className="btn btn-primary btn-md mt-6">Browse novels</Link>
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
  const chapterTotal = chapterMeta.total || chapters.length;

  return (
    <PageTransition>
      {/* Header: the cover, blurred into the page as a backdrop. */}
      <section className="relative isolate overflow-hidden border-b border-white/[0.06]">
        <div className="absolute inset-0 -z-10" aria-hidden="true">
          {novel.coverUrl && (
            <img src={novel.coverUrl} alt="" className="h-full w-full scale-125 object-cover opacity-35 blur-3xl saturate-150" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-night/40 via-night/80 to-night" />
          <div className="absolute inset-0 bg-[radial-gradient(55%_70%_at_15%_0%,rgb(var(--rgb-primary)/0.2),transparent_70%)]" />
        </div>

        <div className="mx-auto max-w-7xl px-4 pb-10 pt-5 sm:px-6 sm:pt-7 lg:px-8 lg:pb-14">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-xs text-silver-muted">
            <Link to="/" className="shrink-0 transition-colors hover:text-silver">Home</Link>
            <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <Link to="/browse" className="shrink-0 transition-colors hover:text-silver">Browse</Link>
            <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate text-silver/80" aria-current="page">{novel.title}</span>
          </nav>

          <div className="mt-6 flex flex-col gap-8 sm:flex-row sm:items-end lg:mt-8 lg:gap-12">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="mx-auto w-44 shrink-0 sm:mx-0 sm:w-48 lg:w-60"
            >
              <div className="relative">
                <div className="absolute -inset-3 rounded-[1.75rem] bg-crimson/30 blur-2xl" aria-hidden="true" />
                <div className="relative aspect-[2/3] overflow-hidden rounded-2xl bg-night-surface shadow-2xl ring-1 ring-white/15">
                  {novel.coverUrl ? (
                    <img src={novel.coverUrl} alt={`Cover of ${novel.title}`} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-night-raised via-night-surface to-crimson/25 p-4 text-center">
                      <BookOpen className="h-10 w-10 text-silver-muted/70" aria-hidden="true" />
                      <span className="line-clamp-3 font-display text-sm font-bold text-silver/80">{novel.title}</span>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>

            <div className="min-w-0 flex-1 text-center sm:text-left">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                {novel.status && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1 text-xs font-semibold capitalize text-silver ring-1 ring-inset ring-white/10 backdrop-blur-md">
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[novel.status] || 'bg-white/70'}`} aria-hidden="true" />
                    {novel.status}
                  </span>
                )}
                {novel.genres.map((genre) => (
                  <Link
                    key={genre}
                    to={`/browse?genre=${encodeURIComponent(genre)}`}
                    className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs font-medium text-silver/90 backdrop-blur-md transition-colors hover:border-crimson-soft/40 hover:text-crimson-soft"
                  >
                    {genre}
                  </Link>
                ))}
              </div>

              <h1 className="mt-4 font-display text-3xl font-extrabold leading-[1.1] text-silver sm:text-4xl lg:text-5xl">
                {novel.title}
              </h1>
              <p className="mt-2 text-silver-muted">
                by <span className="font-semibold text-silver">{novel.author}</span>
              </p>

              <dl className="mt-5 flex flex-wrap items-center justify-center gap-2.5 sm:justify-start">
                <Stat
                  icon={Star}
                  tone="fill-amber-400 text-amber-400"
                  label={novel.ratingCount ? `${novel.ratingCount.toLocaleString()} ratings` : 'No ratings yet'}
                  value={novel.ratingAvg ? novel.ratingAvg.toFixed(1) : '—'}
                />
                <Stat icon={Eye} label="Views" value={compactNumber(novel.views)} />
                <Stat icon={List} label="Chapters" value={(novel.chapterCount || 0).toLocaleString()} />
              </dl>

              <div className="mt-7 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
                {chapters.length > 0 && (
                  <Link to={`/novel/${slug}/chapter/${continueChapter}`} className="btn btn-primary btn-lg">
                    <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                    {progress ? `Continue Ch. ${progress.chapterNumber}` : 'Start Reading'}
                  </Link>
                )}
                <button
                  type="button"
                  onClick={toggleLibrary}
                  aria-pressed={Boolean(inLibrary)}
                  className={`btn btn-lg ${
                    inLibrary
                      ? 'border border-crimson-soft/40 bg-crimson/15 text-crimson-soft hover:bg-crimson/25'
                      : 'btn-secondary backdrop-blur-md'
                  }`}
                >
                  {inLibrary ? <BookmarkCheck className="h-4 w-4" aria-hidden="true" /> : <BookmarkPlus className="h-4 w-4" aria-hidden="true" />}
                  {inLibrary ? 'In Library' : 'Add to Library'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
        {/* DOM order is About, Chapters, Reviews — the order a phone should
            show them. From lg the chapters move into a sticky right column. */}
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr] lg:gap-x-12 xl:grid-cols-[minmax(0,1fr)_24rem]">
          {novel.synopsis && (
            <section aria-labelledby="about-title" className="min-w-0 lg:col-start-1 lg:row-start-1">
              <h2 id="about-title" className="section-title">About this novel</h2>
              <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed text-silver/85">
                {showFullSynopsis ? novel.synopsis : truncateAtWord(novel.synopsis, SYNOPSIS_LIMIT)}
                {novel.synopsis.length > SYNOPSIS_LIMIT && (
                  <button
                    type="button"
                    onClick={() => setShowFullSynopsis((v) => !v)}
                    className="ml-1.5 cursor-pointer font-semibold text-crimson-soft hover:underline"
                    aria-expanded={showFullSynopsis}
                  >
                    {showFullSynopsis ? 'Read less' : 'Read more'}
                  </button>
                )}
              </p>
            </section>
          )}

          <section
            aria-labelledby="chapters-title"
            className="panel min-w-0 overflow-hidden lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start"
          >
            <div className="border-b border-line p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="chapters-title" className="font-display text-lg font-bold text-silver">Chapters</h2>
                  <p className="text-xs text-silver-muted">
                    {chapterTotal} chapter{chapterTotal === 1 ? '' : 's'} available
                    {chapters.length < chapterMeta.total && ` · showing ${chapters.length}`}
                  </p>
                </div>
                {chapters.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSortAsc((v) => !v)}
                    className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-night/60 px-3 py-1.5 text-xs font-medium text-silver-muted transition-colors hover:border-crimson-soft/40 hover:text-silver"
                    aria-label={`Sort ${sortAsc ? 'descending' : 'ascending'}`}
                  >
                    <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{sortAsc ? '1 → N' : 'N → 1'}</span>
                  </button>
                )}
              </div>
              {chapters.length > 0 && (
                <div className="relative mt-3">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-silver-muted" aria-hidden="true" />
                  <input
                    type="text"
                    placeholder="Search by number or title…"
                    aria-label="Search chapters"
                    value={chapterQuery}
                    onChange={(e) => setChapterQuery(e.target.value)}
                    className="field h-10 rounded-full py-0 pl-9 text-xs"
                  />
                </div>
              )}
            </div>

            {chapters.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-silver-muted">No chapters yet.</p>
            ) : filteredChapters.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-silver-muted">No chapters match "{chapterQuery}".</p>
            ) : (
              <ul className="max-h-[26rem] space-y-0.5 overflow-y-auto overflow-x-hidden p-2 lg:max-h-[calc(100dvh-16rem)]">
                {filteredChapters.map((chapter) => {
                  const lastRead = progress?.chapterNumber === chapter.number;
                  return (
                    <li key={chapter.id}>
                      <Link
                        to={`/novel/${slug}/chapter/${chapter.number}`}
                        className={`group flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                          lastRead ? 'bg-crimson/10 ring-1 ring-inset ring-crimson-soft/30' : 'hover:bg-white/[0.04]'
                        }`}
                      >
                        <span className="w-11 shrink-0 text-xs font-bold tabular-nums text-crimson-soft">#{chapter.number}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-silver transition-colors group-hover:text-white">
                            {chapter.title}
                          </span>
                          <span className="block truncate text-[11px] text-silver-muted" title={formatExactDateTime(chapter.createdAt)}>
                            {lastRead ? 'Last read · ' : ''}{formatRelativeTime(chapter.createdAt)}
                          </span>
                        </span>
                        <ChapterAccessTag chapter={chapter} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section
            aria-labelledby="reviews-title"
            className={`min-w-0 lg:col-start-1 ${novel.synopsis ? 'lg:row-start-2' : 'lg:row-start-1'}`}
          >
            <div className="mb-5 flex items-baseline justify-between gap-3">
              <h2 id="reviews-title" className="section-title">Reviews</h2>
              {reviews.length > 0 && (
                <span className="text-sm text-silver-muted">{reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}</span>
              )}
            </div>
            {user ? (
              <div className="panel mb-6 flex items-start gap-3.5 p-4 sm:p-5">
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.username}
                    className="h-10 w-10 shrink-0 rounded-full border border-line object-cover"
                  />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-crimson to-crimson-alt text-sm font-bold uppercase text-white">
                    {(user.fullName || user.username)?.slice(0, 2) || '??'}
                  </span>
                )}

                <form onSubmit={submitReview} className="flex-1 space-y-3">
                  <label htmlFor="review-content" className="sr-only">Your review</label>
                  <textarea
                    id="review-content"
                    value={reviewForm.content}
                    onChange={(e) => setReviewForm((f) => ({ ...f, content: e.target.value }))}
                    onFocus={() => setIsReviewFocused(true)}
                    placeholder="Share your thoughts or review this novel..."
                    rows={3}
                    className="field resize-none py-3"
                  />

                  {(isReviewFocused || reviewForm.content.trim() !== '' || reviewForm.rating > 0) && (
                    <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-silver">Your rating:</span>
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
                          className="btn btn-ghost btn-sm"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={submitting || (!reviewForm.content.trim() && !reviewForm.rating)}
                          className="btn btn-primary btn-sm"
                        >
                          {submitting ? 'Posting...' : 'Post Review'}
                        </button>
                      </div>
                    </div>
                  )}
                </form>
              </div>
            ) : (
              <div className="panel mb-6 p-4 text-sm text-silver-muted sm:p-5">
                <Link to="/login" className="font-semibold text-crimson-soft hover:underline">Log in</Link> to leave a review or share your thoughts.
              </div>
            )}
            {reviews.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-sm text-silver-muted">
                No reviews yet. Be the first!
              </p>
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
        </div>
      </div>
      <DeletedItemModal
        isOpen={showDeletedModal}
        onClose={() => setShowDeletedModal(false)}
        message="The review or reply you clicked has been deleted."
      />
    </PageTransition>
  );
};

export default NovelDetail;
