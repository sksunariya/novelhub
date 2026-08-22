import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Home, List, Settings2, X, MessageSquare } from 'lucide-react';
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

const READER_THEMES = {
  dark: { background: '#0a0507', text: '#d6d3d1', name: 'Dark' },
  black: { background: '#000000', text: '#c7c7c7', name: 'Black' },
  sepia: { background: '#f4ecd8', text: '#433422', name: 'Sepia' },
  light: { background: '#fafafa', text: '#1c1917', name: 'Light' },
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
  const [chapters, setChapters] = useState([]);
  const [comments, setComments] = useState(null);
  const [commentError, setCommentError] = useState('');
  const [panelCommentText, setPanelCommentText] = useState('');
  const [bottomCommentText, setBottomCommentText] = useState('');
  const [isPanelCommentFocused, setIsPanelCommentFocused] = useState(false);
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
    setPanelCommentText('');
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
        style={{ backgroundColor: `${theme.background}ee`, borderColor: 'rgba(128,128,128,0.2)' }}
      >
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-2 px-4">
          <div className="flex min-w-0 items-center gap-1">
            <Link to={`/novel/${slug}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100" aria-label="Back to novel">
              <Home className="h-5 w-5" aria-hidden="true" />
            </Link>
            {data && (
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{data.novel.title}</p>
                <p className="truncate text-xs opacity-60">
                  Ch. {data.chapter.number}: {data.chapter.title}
                </p>
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center">
            <button type="button" onClick={() => setPanel(panel === 'chapters' ? '' : 'chapters')} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100" aria-label="Chapter list">
              <List className="h-5 w-5" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setPanel(panel === 'comments' ? '' : 'comments')} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100" aria-label="Comments">
              <MessageSquare className="h-5 w-5" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setPanel(panel === 'settings' ? '' : 'settings')} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100" aria-label="Reading settings">
              <Settings2 className="h-5 w-5" aria-hidden="true" />
            </button>
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
              className="fixed right-0 top-0 z-50 flex h-dvh w-full max-w-sm flex-col overflow-hidden border-l border-line bg-night-raised text-silver shadow-card"
              role="dialog"
              aria-label={panel}
            >
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="font-display text-lg font-bold capitalize">{panel}</h2>
                <button type="button" onClick={() => setPanel('')} className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-silver-muted hover:text-silver" aria-label="Close panel">
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {panel === 'settings' && (
                  <div className="space-y-6">
                    <div>
                      <p className="mb-2 text-sm font-medium">Theme</p>
                      <div className="grid grid-cols-4 gap-2">
                        {Object.entries(READER_THEMES).map(([key, t]) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setSettings((s) => ({ ...s, theme: key }))}
                            className={`cursor-pointer rounded-lg border-2 p-2 text-center text-xs font-medium transition-colors ${
                              settings.theme === key ? 'border-crimson' : 'border-line'
                            }`}
                            style={{ backgroundColor: t.background, color: t.text }}
                          >
                            {t.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-sm font-medium">Font</p>
                      <div className="grid grid-cols-2 gap-2">
                        {Object.entries(FONTS).map(([key, f]) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setSettings((s) => ({ ...s, font: key }))}
                            className={`cursor-pointer rounded-lg border-2 py-2 text-sm transition-colors ${
                              settings.font === key ? 'border-crimson text-crimson-soft' : 'border-line text-silver-muted'
                            }`}
                            style={{ fontFamily: f.css }}
                          >
                            {f.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label htmlFor="font-size" className="mb-2 block text-sm font-medium">
                        Font size: {settings.fontSize}px
                      </label>
                      <input
                        id="font-size"
                        type="range"
                        min="14"
                        max="28"
                        value={settings.fontSize}
                        onChange={(e) => setSettings((s) => ({ ...s, fontSize: Number(e.target.value) }))}
                        className="w-full accent-[var(--color-primary)]"
                      />
                    </div>
                    <div>
                      <label htmlFor="line-height" className="mb-2 block text-sm font-medium">
                        Line height: {settings.lineHeight}
                      </label>
                      <input
                        id="line-height"
                        type="range"
                        min="1.4"
                        max="2.4"
                        step="0.1"
                        value={settings.lineHeight}
                        onChange={(e) => setSettings((s) => ({ ...s, lineHeight: Number(e.target.value) }))}
                        className="w-full accent-[var(--color-primary)]"
                      />
                    </div>
                  </div>
                )}

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
                          chapter.number === Number(number) ? 'bg-crimson/20 text-crimson-soft' : 'hover:bg-night-surface'
                        }`}
                      >
                        <span className="mr-2 font-semibold">#{chapter.number}</span>
                        {chapter.title}
                      </button>
                    ))}
                  </div>
                )}

                {panel === 'comments' && (
                  <div className="space-y-4">
                    {user ? (
                      <div className="flex gap-2.5 items-start">
                        {user.avatarUrl ? (
                          <img
                            src={user.avatarUrl}
                            alt={user.username}
                            className="h-8 w-8 shrink-0 rounded-full object-cover border border-line shadow-sm"
                          />
                        ) : (
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-crimson/20 text-xs font-bold uppercase text-crimson-soft border border-crimson/30 shadow-sm">
                            {(user.fullName || user.username)?.slice(0, 2) || '??'}
                          </span>
                        )}
                        <form
                          onSubmit={postComment(panelCommentText, () => {
                            setPanelCommentText('');
                            setIsPanelCommentFocused(false);
                          })}
                          className="flex-1 space-y-2"
                        >
                          <div className="relative group">
                            <textarea
                              id="comment-input"
                              value={panelCommentText}
                              onChange={(e) => setPanelCommentText(e.target.value)}
                              onFocus={() => setIsPanelCommentFocused(true)}
                              placeholder="Add a comment..."
                              rows={2}
                              className="w-full rounded-xl border border-line bg-night px-3 py-2.5 text-xs text-silver placeholder:text-silver-muted/80 focus:border-crimson focus:outline-none focus:ring-1 focus:ring-crimson/40 transition-all duration-200 resize-none shadow-inner"
                            />
                          </div>
                          {(isPanelCommentFocused || panelCommentText.trim() !== '') && (
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setIsPanelCommentFocused(false);
                                  setPanelCommentText('');
                                }}
                                className="rounded-full px-3 py-1 text-[11px] font-semibold text-silver hover:bg-white/10 transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                type="submit"
                                disabled={!panelCommentText.trim()}
                                className="rounded-full bg-crimson px-3 py-1 text-[11px] font-semibold text-white transition-all hover:bg-crimson-soft disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                              >
                                Comment
                              </button>
                            </div>
                          )}
                        </form>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-line bg-night p-3 text-xs text-silver">
                        <Link to="/login" className="font-semibold text-crimson-soft hover:underline">Log in</Link> to comment.
                      </div>
                    )}
                    {commentError && <p className="text-xs text-crimson-soft" role="alert">{commentError}</p>}
                    {comments === null ? (
                      <Spinner />
                    ) : comments.length === 0 ? (
                      <p className="text-sm text-silver-muted">No comments yet.</p>
                    ) : (
                      comments.map((comment) => (
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
                      ))
                    )}
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
          className="mx-auto max-w-3xl px-4 py-10"
        >
          <h1 className="mb-8 text-center font-display text-2xl font-bold">
            Chapter {data.chapter.number}: {data.chapter.title}
          </h1>
          <div
            className="reading-content"
            style={{
              fontSize: `${settings.fontSize}px`,
              lineHeight: settings.lineHeight,
              fontFamily: FONTS[settings.font]?.css || FONTS.serif.css,
            }}
            dangerouslySetInnerHTML={{ __html: contentHtml }}
          />

          <nav className="mt-12 flex items-center justify-between gap-3 border-t pt-6" style={{ borderColor: 'rgba(128,128,128,0.2)' }} aria-label="Chapter navigation">
            {data.prev ? (
              <Link
                to={`/novel/${slug}/chapter/${data.prev.number}`}
                className="flex items-center gap-1.5 rounded-full border px-5 py-2.5 text-sm font-medium opacity-80 transition-opacity hover:opacity-100"
                style={{ borderColor: 'rgba(128,128,128,0.35)' }}
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
          <section className="mt-14 border-t pt-8" style={{ borderColor: 'rgba(128,128,128,0.2)' }} aria-label="End of chapter feedback">
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
      <DeletedItemModal
        isOpen={showDeletedModal}
        onClose={() => setShowDeletedModal(false)}
        message="The comment or reply you clicked has been deleted."
      />
    </div>
  );
};

export default Reader;
