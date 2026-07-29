import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Home, List, Settings2, X, MessageSquare, Trash2, Heart } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import { stripTextColor } from '../utils/sanitizeContent';

const SETTINGS_KEY = 'novelhub_reader_settings';

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
  const { user, isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(loadSettings);
  const [panel, setPanel] = useState('');
  const [chapters, setChapters] = useState([]);
  const [comments, setComments] = useState(null);
  const [commentText, setCommentText] = useState('');

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    setData(null);
    setError('');
    setComments(null);
    window.scrollTo(0, 0);
    client
      .get(`/novels/${slug}/chapters/${number}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.message || 'Failed to load chapter'));
  }, [slug, number]);

  useEffect(() => {
    if (panel === 'chapters' && chapters.length === 0) {
      client.get(`/novels/${slug}/chapters`).then(({ data: res }) => setChapters(res.chapters)).catch(() => {});
    }
  }, [panel, slug, chapters.length]);

  const loadComments = useCallback(() => {
    if (!data) return;
    client
      .get(`/community/chapters/${data.chapter._id}/comments`)
      .then(({ data: res }) => setComments(res.comments))
      .catch(() => setComments([]));
  }, [data]);

  useEffect(() => {
    if (panel === 'comments' && comments === null) {
      loadComments();
    }
  }, [panel, comments, loadComments]);

  const postComment = async (e) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    await client.post(`/community/chapters/${data.chapter._id}/comments`, { content: commentText });
    setCommentText('');
    loadComments();
  };

  const deleteComment = async (id) => {
    await client.delete(`/community/comments/${id}`);
    loadComments();
  };

  const likeComment = async (id) => {
    await client.post(`/community/comments/${id}/like`);
    loadComments();
  };

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
                        key={chapter._id}
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
                      <form onSubmit={postComment}>
                        <label htmlFor="comment-input" className="sr-only">Add a comment</label>
                        <textarea
                          id="comment-input"
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          placeholder="Share your thoughts on this chapter..."
                          rows={3}
                          className="w-full rounded-lg border border-line bg-night px-3 py-2 text-sm placeholder:text-silver-muted focus:border-crimson focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={!commentText.trim()}
                          className="mt-2 cursor-pointer rounded-full bg-crimson px-4 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Post
                        </button>
                      </form>
                    ) : (
                      <p className="text-sm text-silver-muted">
                        <Link to="/login" className="text-crimson-soft hover:underline">Log in</Link> to comment.
                      </p>
                    )}
                    {comments === null ? (
                      <Spinner />
                    ) : comments.length === 0 ? (
                      <p className="text-sm text-silver-muted">No comments yet.</p>
                    ) : (
                      comments.map((comment) => (
                        <div key={comment._id} className="rounded-lg border border-line bg-night-surface p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold">{comment.user?.username || 'Deleted user'}</p>
                            <span className="text-xs text-silver-muted">{new Date(comment.createdAt).toLocaleDateString()}</span>
                          </div>
                          <p className="mt-1.5 text-sm text-silver-muted">{comment.content}</p>
                          <div className="mt-2 flex items-center gap-3">
                            {user && (
                              <button
                                type="button"
                                onClick={() => likeComment(comment._id)}
                                className="flex cursor-pointer items-center gap-1 text-xs text-silver-muted transition-colors hover:text-crimson-soft"
                                aria-label="Like comment"
                              >
                                <Heart
                                  className={`h-3.5 w-3.5 ${comment.likes?.includes(user.id) ? 'fill-crimson text-crimson' : ''}`}
                                  aria-hidden="true"
                                />
                                {comment.likes?.length || 0}
                              </button>
                            )}
                            {user && (comment.user?._id === user.id || isAdmin) && (
                              <button
                                type="button"
                                onClick={() => deleteComment(comment._id)}
                                className="flex cursor-pointer items-center gap-1 text-xs text-silver-muted transition-colors hover:text-crimson-soft"
                                aria-label="Delete comment"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
                              </button>
                            )}
                          </div>
                        </div>
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
        </motion.main>
      )}
    </div>
  );
};

export default Reader;
