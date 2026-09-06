import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ChevronLeft, ChevronRight, Home, Menu, X } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import StarRating from '../components/StarRating';
import CommentCard from '../components/CommentCard';
import ChapterGate from '../components/ChapterGate';
import { stripTextColor } from '../utils/sanitizeContent';
import { formatRelativeTime, formatExactDateTime } from '../utils/dateUtils';
import DeletedItemModal from '../components/DeletedItemModal';
import { ANCHORS, readHashTarget, isTargetInItems } from '../utils/hashTarget';
import ReaderToolbar from '../components/reader/ReaderToolbar';
import ReaderSettingsPopover from '../components/reader/ReaderSettingsPopover';
import useTextToSpeech from '../components/reader/useTextToSpeech';
import useFullscreen from '../components/reader/useFullscreen';

const SETTINGS_KEY = 'novelhub_reader_settings';

const withUser = (reactions, userId, active) => {
  const others = (reactions || []).filter((id) => (id._id || id)?.toString() !== userId);
  return active ? [...others, userId] : others;
};

const applyReaction = (item, reaction, userId) => ({
  ...item,
  likes: withUser(item.likes, userId, reaction.liked),
  dislikes: withUser(item.dislikes, userId, reaction.disliked),
});

// `surface` is the raised colour behind the chapter card and the two bars;
// `border` is the hairline between them. Both are spelled out per theme rather
// than layered as one translucent white: an overlay that reads as "lifted" on
// the dark themes reads as grubby on sepia and disappears entirely on light.
// Light's page colour is a shade darker than it used to be for the same reason
// — a white card needs something to sit on.
const READER_THEMES = {
  dark: { background: '#0a0507', surface: '#150c10', border: 'rgba(255,255,255,0.08)', text: '#d6d3d1', name: 'Dark' },
  black: { background: '#000000', surface: '#111111', border: 'rgba(255,255,255,0.09)', text: '#c7c7c7', name: 'Black' },
  sepia: { background: '#f4ecd8', surface: '#fbf5e6', border: 'rgba(67,52,34,0.16)', text: '#433422', name: 'Sepia' },
  light: { background: '#f1f1f0', surface: '#ffffff', border: 'rgba(28,25,23,0.12)', text: '#1c1917', name: 'Light' },
};

const FONTS = {
  serif: { css: "'Lora', Georgia, serif", name: 'Serif' },
  sans: { css: "'Inter', system-ui, sans-serif", name: 'Sans' },
};

const DEFAULT_SETTINGS = { fontSize: 19, lineHeight: 1.8, theme: 'dark', font: 'serif' };

const loadSettings = () => {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch (error) {
    return DEFAULT_SETTINGS;
  }
};

const Reader = () => {
  const { slug, number } = useParams();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const { user, isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [gatePayload, setGatePayload] = useState(null);
  const [settings, setSettings] = useState(loadSettings);
  const [panel, setPanel] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chapters, setChapters] = useState([]);
  const [comments, setComments] = useState(null);
  const [commentError, setCommentError] = useState('');
  const [bottomCommentText, setBottomCommentText] = useState('');
  const [isBottomCommentFocused, setIsBottomCommentFocused] = useState(false);
  const [activeTab, setActiveTab] = useState('comments');
  const [userReview, setUserReview] = useState(null);
  const [reviewForm, setReviewForm] = useState({ rating: 0, content: '' });
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewMsg, setReviewMsg] = useState('');
  const [chapterReview, setChapterReview] = useState(null);
  const [chapterReviewForm, setChapterReviewForm] = useState({ rating: 0, content: '' });
  const [savingChapterReview, setSavingChapterReview] = useState(false);
  const [chapterReviewMsg, setChapterReviewMsg] = useState('');

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  // A gated chapter answers 403 with the requirements instead of its content.
  const loadChapter = useCallback(
    () =>
      client
        .get(`/novels/${slug}/chapters/${number}`)
        .then((res) => {
          setData(res.data);
          setGatePayload(null);
        })
        .catch((err) => {
          if (err.response?.status === 403 && err.response.data?.gate) {
            setGatePayload(err.response.data);
            setData(null);
            return;
          }
          setError(err.response?.data?.message || 'Failed to load chapter');
        }),
    [slug, number]
  );

  // Novel-scoped state only needs clearing when the novel itself changes.
  useEffect(() => {
    setUserReview(null);
    setReviewForm({ rating: 0, content: '' });
    setReviewMsg('');
  }, [slug]);

  useEffect(() => {
    setData(null);
    setError('');
    setGatePayload(null);
    setComments(null);
    setCommentError('');
    setBottomCommentText('');
    setChapterReview(null);
    setChapterReviews(null);
    setChapterReviewForm({ rating: 0, content: '' });
    setChapterReviewMsg('');
    window.scrollTo(0, 0);
    loadChapter();
  }, [slug, number, loadChapter]);

  useEffect(() => {
    if (panel === 'chapters' && chapters.length === 0) {
      client.get(`/novels/${slug}/chapters?limit=5000`).then(({ data: res }) => setChapters(res.chapters)).catch(() => {});
    }
  }, [panel, slug, chapters.length]);

  const loadComments = useCallback(() => {
    if (!data) return;
    client
      .get(`/community/chapters/${data.chapter.id}/comments`)
      .then(({ data: res }) => setComments(res.comments))
      .catch(() => setComments([]));
  }, [data]);

  const loadUserReview = useCallback(() => {
    if (!data || !user) return;
    client
      .get(`/novels/id/${data.novel.id}/reviews`)
      .then(({ data: res }) => {
        const found = res.reviews?.find((r) => r.user?._id === user.id || r.user === user.id);
        setUserReview(found || null);
        if (found) {
          setReviewForm({ rating: found.rating || 0, content: found.content || '' });
        }
      })
      .catch(() => {});
  }, [data, user]);

  const [chapterReviews, setChapterReviews] = useState(null);

  const loadChapterReview = useCallback(() => {
    if (!data) return;
    client
      .get(`/community/chapters/${data.chapter.id}/reviews`)
      .then(({ data: res }) => {
        setChapterReviews(res.reviews || []);
        if (user) {
          const found = res.reviews?.find((r) => r.user?._id === user.id || r.user === user.id);
          setChapterReview(found || null);
          if (found) {
            setChapterReviewForm({ rating: found.rating || 0, content: found.content || '' });
          }
        }
      })
      .catch(() => setChapterReviews([]));
  }, [data, user]);

  useEffect(() => {
    if (data) {
      loadComments();
      loadUserReview();
      loadChapterReview();
    }
  }, [data, loadComments, loadUserReview, loadChapterReview]);

  // Comment actions surface their own failures; a silently dead button reads as a
  // broken UI, and an expired or banned session is the common cause.
  const runCommentAction = async (action) => {
    setCommentError('');
    try {
      await action();
      loadComments();
    } catch (err) {
      setCommentError(err.response?.data?.message || 'Something went wrong. Please try again.');
    }
  };

  const postComment = (text, reset) => async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    await runCommentAction(async () => {
      await client.post(`/community/chapters/${data.chapter.id}/comments`, { content: text });
      reset();
    });
  };

  // Reply errors are rendered by CommentCard, so this one rethrows.
  const postReply = async (parentId, text) => {
    await client.post(`/community/chapters/${data.chapter.id}/comments`, {
      content: text,
      parentComment: parentId,
    });
    loadComments();
  };

  const editComment = (id, payload) =>
    runCommentAction(() => client.put(`/community/comments/${id}`, payload));

  const deleteComment = (id) => runCommentAction(() => client.delete(`/community/comments/${id}`));

  const pinComment = (id) => runCommentAction(() => client.post(`/community/comments/${id}/pin`));

  const reactToComment = (action) => (id) => {
    if (!user) return navigate('/login');
    return runCommentAction(() => client.post(`/community/comments/${id}/${action}`));
  };

  const likeComment = reactToComment('like');

  const dislikeComment = reactToComment('dislike');

  const submitReview = async (e) => {
    e.preventDefault();
    if (!reviewForm.rating || !data) return;
    setSubmittingReview(true);
    setReviewMsg('');
    try {
      await client.post(`/novels/id/${data.novel.id}/reviews`, reviewForm);
      setReviewMsg('Thank you! Your review has been saved.');
      setReviewForm({ rating: 0, content: '' });
      loadUserReview();
    } catch (err) {
      setReviewMsg(err.response?.data?.message || 'Failed to submit review');
    } finally {
      setSubmittingReview(false);
    }
  };

  const submitChapterReview = async (e) => {
    e.preventDefault();
    if (!chapterReviewForm.rating || !data) return;
    setSavingChapterReview(true);
    setChapterReviewMsg('');
    try {
      await client.post(`/community/chapters/${data.chapter.id}/reviews`, chapterReviewForm);
      setChapterReviewMsg('Chapter rating saved.');
      setChapterReviewForm({ rating: 0, content: '' });
      await loadChapter();
      loadChapterReview();
    } catch (err) {
      setChapterReviewMsg(err.response?.data?.message || 'Failed to save chapter rating');
    } finally {
      setSavingChapterReview(false);
    }
  };

  const reactToChapterReview = (action) => async (reviewId) => {
    if (!user) return navigate('/login');
    const { data: res } = await client.post(`/community/reviews/${reviewId}/${action}`);
    return setChapterReviews((prev) => (prev || []).map((r) => (r._id === reviewId ? applyReaction(r, res, user.id) : r)));
  };

  const likeChapterReview = reactToChapterReview('like');
  const dislikeChapterReview = reactToChapterReview('dislike');

  const postChapterReviewReply = async (reviewId, text) => {
    if (!text.trim()) return;
    const { data: res } = await client.post(`/community/reviews/${reviewId}/replies`, { content: text });
    setChapterReviews((prev) => (prev || []).map((r) => (r._id === reviewId ? res.review : r)));
  };

  const editChapterReview = async (reviewId, payload) => {
    const { data: res } = await client.put(`/community/reviews/${reviewId}`, payload);
    setChapterReviews((prev) => (prev || []).map((r) => (r._id === reviewId ? res.review : r)));
    await loadChapter();
  };

  const deleteChapterReview = async (reviewId) => {
    if (!window.confirm('Delete this review?')) return;
    await client.delete(`/community/reviews/${reviewId}`);
    setChapterReviews((prev) => (prev || []).filter((r) => r._id !== reviewId));
    await loadChapter();
  };

  const pinChapterReview = async (reviewId) => {
    const { data: res } = await client.post(`/community/reviews/${reviewId}/pin`);
    setChapterReviews((prev) => {
      const updated = (prev || []).map((r) => (r._id === reviewId ? res.review : r));
      return [...updated].sort((a, b) => {
        if (Boolean(a.isPinned) !== Boolean(b.isPinned)) return a.isPinned ? -1 : 1;
        if (a.isPinned && b.isPinned) return new Date(b.pinnedAt || 0) - new Date(a.pinnedAt || 0);
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
    });
  };

  const editChapterReviewReply = async (reviewId, replyId, text) => {
    const { data: res } = await client.put(`/community/reviews/${reviewId}/replies/${replyId}`, { content: text });
    setChapterReviews((prev) => (prev || []).map((r) => (r._id === reviewId ? res.review : r)));
  };

  const deleteChapterReviewReply = async (reviewId, replyId) => {
    const { data: res } = await client.delete(`/community/reviews/${reviewId}/replies/${replyId}`);
    setChapterReviews((prev) => (prev || []).map((r) => (r._id === reviewId ? res.review : r)));
  };

  const reactToChapterReviewReply = (action) => async (reviewId, replyId) => {
    if (!user) return navigate('/login');
    const { data: res } = await client.post(`/community/reviews/${reviewId}/replies/${replyId}/${action}`);
    setChapterReviews((prev) => (prev || []).map((r) => (r._id === reviewId ? res.review : r)));
  };

  const likeChapterReviewReply = reactToChapterReviewReply('like');
  const dislikeChapterReviewReply = reactToChapterReviewReply('dislike');

  const commentCount = (comments || []).reduce((count, comment) => count + 1 + (comment.replies?.length || 0), 0);

  const [showDeletedModal, setShowDeletedModal] = useState(false);

  const commentTarget = readHashTarget(hash, ANCHORS.COMMENT);
  const reviewTarget = readHashTarget(hash, ANCHORS.REVIEW);

  useEffect(() => {
    if (reviewTarget) {
      setActiveTab('review');
    } else if (commentTarget) {
      setActiveTab('comments');
    }
  }, [reviewTarget, commentTarget]);

  useEffect(() => {
    if (commentTarget && Array.isArray(comments)) {
      const exists = isTargetInItems(commentTarget, comments);
      if (!exists) {
        setShowDeletedModal(true);
      }
    } else if (reviewTarget && Array.isArray(chapterReviews)) {
      const exists = isTargetInItems(reviewTarget, chapterReviews);
      if (!exists) {
        setShowDeletedModal(true);
      }
    }
  }, [commentTarget, reviewTarget, comments, chapterReviews]);

  const theme = READER_THEMES[settings.theme] || READER_THEMES.dark;

  // Strip hardcoded text colors from stored HTML so prose follows the reader theme.
  const contentHtml = useMemo(
    () => stripTextColor(data?.chapter?.content || ''),
    [data?.chapter?.content]
  );

  // Both of these have to be called before the error and gate returns below —
  // a hook skipped on a gated chapter changes the hook order between renders.
  const fullscreen = useFullscreen();
  const speech = useTextToSpeech(contentHtml);

  if (error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-night text-silver-muted">
        <p>{error}</p>
        <Link to={`/novel/${slug}`} className="text-crimson-soft hover:underline">Back to novel</Link>
      </div>
    );
  }

  if (gatePayload) {
    return (
      <div className="min-h-dvh bg-night">
        <ChapterGate payload={gatePayload} user={user} onSatisfied={loadChapter} />
      </div>
    );
  }

  return (
    <div className="min-h-dvh transition-colors duration-300" style={{ backgroundColor: theme.background, color: theme.text }}>
      <header
        className="sticky top-0 z-30 border-b backdrop-blur"
        style={{ backgroundColor: `${theme.surface}f2`, borderColor: theme.border }}
      >
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-2 px-3">
          <div className="flex shrink-0 items-center gap-1">
            <Link
              to="/"
              className="flex h-10 w-10 items-center justify-center rounded-lg border opacity-70 transition-opacity hover:opacity-100"
              style={{ borderColor: theme.border }}
              aria-label="Home"
            >
              <Home className="h-[18px] w-[18px]" aria-hidden="true" />
            </Link>
            <Link
              to={`/novel/${slug}`}
              className="flex h-10 w-10 items-center justify-center rounded-lg border opacity-70 transition-opacity hover:opacity-100"
              style={{ borderColor: theme.border }}
              aria-label="Back to novel"
            >
              <ArrowLeft className="h-[18px] w-[18px]" aria-hidden="true" />
            </Link>
          </div>

          {/* Chapter number on top, novel title beneath. Side by side, a long
              title pushes the chapter number — the one thing a reader checks
              mid-scroll — off the end of the bar. */}
          <div className="min-w-0 flex-1 text-center">
            {data && (
              <>
                <p className="truncate text-sm font-semibold">Chapter {data.chapter.number}</p>
                <p className="truncate text-[11px] opacity-55">{data.novel.title}</p>
              </>
            )}
          </div>

          <div className="relative flex shrink-0 items-center gap-1">
            <button
              type="button"
              data-reader-settings-toggle=""
              onClick={() => setSettingsOpen((open) => !open)}
              aria-expanded={settingsOpen}
              aria-label="Text and background"
              title="Text and background"
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border text-sm font-semibold opacity-70 transition-opacity hover:opacity-100"
              style={{ borderColor: theme.border }}
            >
              Aa
            </button>
            <button
              type="button"
              onClick={() => setPanel(panel === 'chapters' ? '' : 'chapters')}
              aria-label="Chapter list"
              title="Chapter list"
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border opacity-70 transition-opacity hover:opacity-100"
              style={{ borderColor: theme.border }}
            >
              <Menu className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>

            {settingsOpen && (
              <ReaderSettingsPopover
                settings={settings}
                onChange={setSettings}
                themes={READER_THEMES}
                fonts={FONTS}
                onClose={() => setSettingsOpen(false)}
              />
            )}
          </div>
        </div>
      </header>

      <AnimatePresence>
        {panel && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPanel('')}
              className="fixed inset-0 z-40 bg-black/50"
              aria-hidden="true"
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
              className="fixed right-0 top-0 z-50 flex h-dvh w-full max-w-sm flex-col overflow-hidden border-l shadow-card"
              style={{ backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }}
              role="dialog"
              aria-label="Chapter list"
            >
              <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: theme.border }}>
                <h2 className="font-display text-lg font-bold">Chapters</h2>
                <button type="button" onClick={() => setPanel('')} className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md opacity-60 transition-opacity hover:opacity-100" aria-label="Close panel">
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {panel === 'chapters' && (
                  <div className="space-y-1">
                    {chapters.map((chapter) => (
                      <button
                        key={chapter.id}
                        type="button"
                        onClick={() => {
                          setPanel('');
                          navigate(`/novel/${slug}/chapter/${chapter.number}`);
                        }}
                        className={`block w-full cursor-pointer rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                          chapter.number === Number(number)
                            ? 'bg-crimson/20 text-crimson-soft'
                            : 'hover:bg-crimson/10'
                        }`}
                      >
                        <span className="mr-2 font-semibold">#{chapter.number}</span>
                        {chapter.title}
                      </button>
                    ))}
                  </div>
                )}

              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {!data ? (
        <div className="flex min-h-[60vh] items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <motion.main
          key={number}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mx-auto max-w-4xl px-3 pb-28 pt-8 sm:px-4 sm:pt-10"
        >
          <h1 className="mb-6 text-center font-display text-2xl font-bold">
            Chapter {data.chapter.number}: {data.chapter.title}
          </h1>
          {/* The prose sits on its own raised card, so the floating control bar
              overlaps a surface instead of hovering on bare background. The
              bottom padding above is what keeps the bar off the last line. */}
          <div
            className="rounded-2xl border px-5 py-8 sm:px-10 sm:py-12"
            style={{ backgroundColor: theme.surface, borderColor: theme.border }}
          >
            <div
              className="reading-content"
              style={{
                fontSize: `${settings.fontSize}px`,
                lineHeight: settings.lineHeight,
                fontFamily: FONTS[settings.font]?.css || FONTS.serif.css,
              }}
              dangerouslySetInnerHTML={{ __html: contentHtml }}
            />
          </div>

          <nav className="mt-12 flex items-center justify-between gap-3 border-t pt-6" style={{ borderColor: theme.border }} aria-label="Chapter navigation">
            {data.prev ? (
              <Link
                to={`/novel/${slug}/chapter/${data.prev.number}`}
                className="flex items-center gap-1.5 rounded-full border px-5 py-2.5 text-sm font-medium opacity-80 transition-opacity hover:opacity-100"
                style={{ borderColor: theme.border }}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
              </Link>
            ) : (
              <span />
            )}
            {data.next ? (
              <Link
                to={`/novel/${slug}/chapter/${data.next.number}`}
                className="flex items-center gap-1.5 rounded-full bg-crimson px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition-transform hover:scale-[1.03]"
              >
                Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : (
              <Link to={`/novel/${slug}`} className="text-sm opacity-70 transition-opacity hover:opacity-100">
                End of published chapters — back to novel
              </Link>
            )}
          </nav>

          {/* End of Chapter Comments and Review Section */}
          <section className="mt-14 border-t pt-8" style={{ borderColor: theme.border }} aria-label="End of chapter feedback">
            <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-xl font-bold">Chapter Feedback & Review</h2>
                <p className="text-xs opacity-75">Share your thoughts on Chapter {data.chapter.number} or review the novel.</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('comments')}
                  className={`cursor-pointer rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                    activeTab === 'comments' ? 'bg-crimson text-white shadow-glow' : 'border border-line opacity-75 hover:opacity-100'
                  }`}
                >
                  Comments ({commentCount})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('review')}
                  className={`cursor-pointer rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                    activeTab === 'review' ? 'bg-crimson text-white shadow-glow' : 'border border-line opacity-75 hover:opacity-100'
                  }`}
                >
                  Reviews ({chapterReviews?.length ?? 0})
                </button>
              </div>
            </div>

            {activeTab === 'comments' && (
              <div className="space-y-4 rounded-2xl border border-line bg-night-surface p-5 shadow-card">
                <h3 className="font-display text-base font-semibold">Comments for Chapter {data.chapter.number}</h3>
                {user ? (
                  <div className="flex gap-3.5 items-start">
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
                    <form
                      onSubmit={postComment(bottomCommentText, () => {
                        setBottomCommentText('');
                        setIsBottomCommentFocused(false);
                      })}
                      className="flex-1 space-y-3"
                    >
                      <div className="relative group">
                        <textarea
                          id="end-comment-input"
                          value={bottomCommentText}
                          onChange={(e) => setBottomCommentText(e.target.value)}
                          onFocus={() => setIsBottomCommentFocused(true)}
                          placeholder={`What did you think of Chapter ${data.chapter.number}? Add a public comment...`}
                          rows={3}
                          className="w-full rounded-xl border border-line bg-night px-4 py-3 text-sm text-silver placeholder:text-silver-muted/80 focus:border-crimson focus:outline-none focus:ring-1 focus:ring-crimson/40 transition-all duration-200 resize-none shadow-inner"
                        />
                      </div>
                      {(isBottomCommentFocused || bottomCommentText.trim() !== '') && (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setIsBottomCommentFocused(false);
                              setBottomCommentText('');
                            }}
                            className="rounded-full px-4 py-1.5 text-xs font-semibold text-silver hover:bg-white/10 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={!bottomCommentText.trim()}
                            className="rounded-full bg-crimson px-5 py-2 text-xs font-semibold text-white transition-all hover:bg-crimson-soft disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                          >
                            Comment
                          </button>
                        </div>
                      )}
                    </form>
                  </div>
                ) : (
                  <div className="rounded-xl border border-line bg-night-surface p-4 text-sm text-silver">
                    <Link to="/login" className="font-semibold text-crimson-soft hover:underline">Log in</Link> to post a comment on this chapter.
                  </div>
                )}

                {commentError && <p className="text-sm text-crimson-soft" role="alert">{commentError}</p>}

                {comments === null ? (
                  <Spinner />
                ) : comments.length === 0 ? (
                  <p className="py-6 text-center text-sm text-silver-muted">No comments yet. Be the first to share your thoughts!</p>
                ) : (
                  <div className="space-y-4 pt-2">
                    {comments.map((comment) => (
                      <CommentCard
                        key={comment._id}
                        item={comment}
                        currentUser={user}
                        isAdmin={isAdmin}
                        anchorPrefix={ANCHORS.COMMENT}
                        targetId={commentTarget}
                        onLike={likeComment}
                        onDislike={dislikeComment}
                        onEdit={editComment}
                        onDelete={deleteComment}
                        onPin={pinComment}
                        onReplySubmit={postReply}
                        onLikeReply={(_parentId, replyId) => likeComment(replyId)}
                        onDislikeReply={(_parentId, replyId) => dislikeComment(replyId)}
                        onEditReply={(_parentId, replyId, text) => editComment(replyId, { content: text })}
                        onDeleteReply={(_parentId, replyId) => deleteComment(replyId)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'review' && (
              <div className="rounded-2xl border border-line bg-night-surface p-5 shadow-card">
                <h3 className="mb-2 font-display text-base font-semibold">Rate & Review "{data.novel.title}"</h3>
                {user ? (
                  <form onSubmit={submitReview} className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-silver">Your Rating:</span>
                      <StarRating value={reviewForm.rating} onChange={(rating) => setReviewForm((f) => ({ ...f, rating }))} />
                    </div>
                    <label htmlFor="end-review-input" className="sr-only">Review text</label>
                    <textarea
                      id="end-review-input"
                      value={reviewForm.content}
                      onChange={(e) => setReviewForm((f) => ({ ...f, content: e.target.value }))}
                      placeholder="Write your review for this novel..."
                      rows={3}
                      className="w-full rounded-xl border border-line bg-night px-4 py-3 text-sm text-silver placeholder:text-silver-muted/80 focus:border-crimson focus:outline-none focus:ring-1 focus:ring-crimson/40 transition-all duration-200 resize-none shadow-inner"
                    />
                    {reviewMsg && (
                      <p className="text-xs font-medium text-crimson-soft">{reviewMsg}</p>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-silver-muted">Rate this novel out of 5 stars.</span>
                      <button
                        type="submit"
                        disabled={submittingReview || !reviewForm.rating}
                        className="cursor-pointer rounded-full bg-crimson px-5 py-2 text-xs font-semibold text-white transition-opacity hover:bg-crimson-soft disabled:cursor-not-allowed disabled:opacity-50 shadow-md"
                      >
                        {submittingReview ? 'Submitting...' : userReview ? 'Update Novel Review' : 'Submit Review'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="rounded-xl border border-line bg-night p-4 text-sm text-silver">
                    <Link to="/login" className="font-semibold text-crimson-soft hover:underline">Log in</Link> to rate and review this novel.
                  </div>
                )}

                <div className="mt-5 border-t border-line pt-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-display text-base font-semibold">Rate Chapter {data.chapter.number}</h3>
                    {data.chapter.ratingCount > 0 && (
                      <span className="text-xs text-silver-muted">
                        {data.chapter.ratingAvg}★ from {data.chapter.ratingCount}
                        {data.chapter.ratingCount === 1 ? ' reader' : ' readers'}
                      </span>
                    )}
                  </div>
                  {user ? (
                    <form onSubmit={submitChapterReview} className="space-y-3">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-medium opacity-80">Your Rating:</span>
                        <StarRating
                          value={chapterReviewForm.rating}
                          onChange={(rating) => setChapterReviewForm((f) => ({ ...f, rating }))}
                        />
                      </div>
                      <label htmlFor="end-chapter-review-input" className="sr-only">Chapter review text</label>
                      <textarea
                        id="end-chapter-review-input"
                        value={chapterReviewForm.content}
                        onChange={(e) => setChapterReviewForm((f) => ({ ...f, content: e.target.value }))
                        }
                        placeholder="What worked in this chapter?"
                        rows={2}
                        className="w-full rounded-xl border border-line bg-night px-4 py-3 text-sm placeholder:text-silver-muted focus:border-crimson focus:outline-none"
                      />
                      {chapterReviewMsg && <p className="text-xs font-medium text-crimson-soft">{chapterReviewMsg}</p>}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-silver-muted">Rate this chapter out of 5 stars.</span>
                        <button
                          type="submit"
                          disabled={savingChapterReview || !chapterReviewForm.rating}
                          className="cursor-pointer rounded-full border border-crimson px-5 py-2 text-xs font-semibold text-crimson-soft transition-colors hover:bg-crimson hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {savingChapterReview ? 'Saving...' : chapterReview ? 'Update Chapter Rating' : 'Submit Chapter Rating'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <p className="text-sm text-silver-muted">
                      <Link to="/login" className="text-crimson-soft hover:underline font-medium">Log in</Link> to rate this chapter.
                    </p>
                  )}
                </div>

                <div className="mt-6 border-t border-line pt-5">
                  <h4 className="mb-3 font-display text-sm font-semibold text-silver">
                    Chapter {data.chapter.number} Reviews ({chapterReviews?.length || 0})
                  </h4>
                  {chapterReviews === null ? (
                    <Spinner />
                  ) : chapterReviews.length === 0 ? (
                    <p className="py-6 text-center text-sm text-silver-muted">
                      No reviews for this chapter yet. Be the first to leave a review!
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {chapterReviews.map((review) => (
                        <CommentCard
                          key={review._id}
                          item={review}
                          currentUser={user}
                          isAdmin={isAdmin}
                          anchorPrefix={ANCHORS.REVIEW}
                          targetId={reviewTarget}
                          onLike={likeChapterReview}
                          onDislike={dislikeChapterReview}
                          onEdit={editChapterReview}
                          onDelete={deleteChapterReview}
                          onPin={pinChapterReview}
                          onReplySubmit={postChapterReviewReply}
                          onLikeReply={likeChapterReviewReply}
                          onDislikeReply={dislikeChapterReviewReply}
                          onEditReply={editChapterReviewReply}
                          onDeleteReply={deleteChapterReviewReply}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </motion.main>
      )}
      {data && (
        <ReaderToolbar
          theme={theme}
          fullscreen={fullscreen}
          speech={speech}
          prevTo={data.prev ? `/novel/${slug}/chapter/${data.prev.number}` : null}
          nextTo={data.next ? `/novel/${slug}/chapter/${data.next.number}` : null}
        />
      )}
      <DeletedItemModal
        isOpen={showDeletedModal}
        onClose={() => setShowDeletedModal(false)}
        message="The comment or reply you clicked has been deleted."
      />
    </div>
  );
};

export default Reader;
