import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { FileText, Image as ImageIcon, Link2, BarChart3, X, Save, AlertTriangle } from 'lucide-react';
import * as api from '../../api/spaces';
import { useAuth } from '../../context/AuthContext';
import Spinner from '../../components/Spinner';

// The composer.
//
// DRAFTS ARE THE POINT OF THIS FILE. Losing a long post to a stray navigation,
// a closed tab or a refresh is the most infuriating bug a forum can have, and
// it is entirely preventable. Everything typed here is written to localStorage
// on a debounce and restored on return.
//
// The draft is keyed by space, so a half-written post in one space is not
// clobbered by starting another somewhere else.

const DRAFT_PREFIX = 'novelhub_draft_';
const AUTOSAVE_MS = 800;

const TYPES = [
  { key: 'text', label: 'Text', icon: FileText },
  { key: 'image', label: 'Images', icon: ImageIcon },
  { key: 'link', label: 'Link', icon: Link2 },
  { key: 'poll', label: 'Poll', icon: BarChart3 },
];

const emptyDraft = () => ({
  type: 'text',
  title: '',
  body: '',
  url: '',
  pollOptions: ['', ''],
  pollDurationDays: 3,
  nsfw: false,
  spoiler: false,
  flair: '',
});

const readDraft = (key) => {
  try {
    const raw = window.localStorage.getItem(DRAFT_PREFIX + key);
    return raw ? { ...emptyDraft(), ...JSON.parse(raw) } : null;
  } catch (error) {
    return null;
  }
};

/**
 * Count what a person counts.
 *
 * Intl.Segmenter, matching the server. A limit measured in UTF-16 units is a
 * limit nobody can predict — a family emoji is 11 of those and one character
 * to the person typing it.
 */
const graphemes = (text) => {
  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let count = 0;
    // eslint-disable-next-line no-unused-vars
    for (const _ of segmenter.segment(text || '')) count += 1;
    return count;
  } catch (error) {
    return [...(text || '')].length;
  }
};

const PostComposer = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const draftKey = slug || 'global';
  const [draft, setDraft] = useState(() => readDraft(draftKey) || emptyDraft());
  const [restored, setRestored] = useState(() => Boolean(readDraft(draftKey)));
  const [space, setSpace] = useState(null);
  const [spaces, setSpaces] = useState([]);
  const [flairs, setFlairs] = useState([]);
  const [targetSlug, setTargetSlug] = useState(slug || '');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const timer = useRef(null);

  // Autosave on a debounce. Writing on every keystroke thrashes localStorage
  // for no benefit; 800ms is short enough that almost nothing is ever lost.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const meaningful = draft.title.trim() || draft.body.trim() || draft.url.trim();
      try {
        if (meaningful) {
          window.localStorage.setItem(DRAFT_PREFIX + draftKey, JSON.stringify(draft));
          setSavedAt(new Date());
        } else {
          window.localStorage.removeItem(DRAFT_PREFIX + draftKey);
        }
      } catch (storageError) {
        // A full or disabled localStorage must not break composing.
      }
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer.current);
  }, [draft, draftKey]);

  useEffect(() => {
    if (slug) {
      api.getSpace(slug).then((d) => setSpace(d.space)).catch(() => setSpace(null));
      api.listFlairs(slug, 'post').then((d) => setFlairs(d.flairs || [])).catch(() => setFlairs([]));
    } else {
      api.listSpaces({ limit: 100, sort: 'popular' })
        .then((d) => setSpaces(d.spaces || []))
        .catch(() => setSpaces([]));
    }
  }, [slug]);

  const set = useCallback((patch) => setDraft((d) => ({ ...d, ...patch })), []);

  const discard = () => {
    try { window.localStorage.removeItem(DRAFT_PREFIX + draftKey); } catch (e) { /* ignore */ }
    setDraft(emptyDraft());
    setRestored(false);
    setSavedAt(null);
  };

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    if (!targetSlug) { setError('Choose where to post'); return; }
    setSubmitting(true);
    try {
      const { post } = await api.createPost({ ...draft, space: targetSlug });
      // Only clear the draft AFTER the server has accepted it. Clearing on
      // submit means a failed request loses the post.
      try { window.localStorage.removeItem(DRAFT_PREFIX + draftKey); } catch (e) { /* ignore */ }
      navigate(`/c/${post.space?.slug || targetSlug}/p/${post.id}/${post.titleSlug || ''}`);
    } catch (err) {
      setError(err?.response?.data?.message || 'That could not be posted');
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-silver">Sign in to post</h1>
        <Link to="/login" className="mt-4 inline-block rounded-full bg-crimson px-5 py-2 text-sm font-medium text-white">
          Sign in
        </Link>
      </main>
    );
  }

  const titleLength = graphemes(draft.title);
  const canPost = !slug || space?.viewer?.post;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-4 font-display text-2xl font-bold text-silver">
        {space ? `Post to /c/${space.slug}` : 'Create a post'}
      </h1>

      {restored && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-night-surface p-3 text-sm text-silver-muted">
          <Save className="h-4 w-4 shrink-0" aria-hidden="true" />
          We kept what you were writing.
          <button type="button" onClick={discard} className="cursor-pointer underline hover:text-silver">
            Start over
          </button>
        </div>
      )}

      {slug && space && !canPost && (
        <div role="alert" className="mb-4 flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            {space.viewer?.isBanned
              ? 'You are banned from this space.'
              : space.viewer?.reason === 'space_locked'
                ? 'This space is locked and is not accepting new posts.'
                : 'You cannot post in this space.'}
          </p>
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        {!slug && (
          <div>
            <label htmlFor="target-space" className="mb-1 block text-sm font-medium text-silver">
              Where
            </label>
            <select
              id="target-space"
              value={targetSlug}
              onChange={(e) => setTargetSlug(e.target.value)}
              className="w-full rounded-lg border border-line bg-night-surface px-3 py-2 text-sm text-silver focus:border-crimson focus:outline-none"
            >
              <option value="">Choose a space…</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.slug}>/c/{s.slug} — {s.name}</option>
              ))}
            </select>
          </div>
        )}

        <div role="radiogroup" aria-label="Post type" className="flex flex-wrap gap-1 rounded-lg border border-line bg-night-surface p-1">
          {TYPES.filter((t) => !space?.allowedPostTypes?.length || space.allowedPostTypes.includes(t.key))
            .map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={draft.type === key}
                onClick={() => set({ type: key })}
                className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded px-3 py-2 text-sm font-medium transition-colors ${
                  draft.type === key ? 'bg-crimson text-white' : 'text-silver-muted hover:text-silver'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" /> {label}
              </button>
            ))}
        </div>

        <div>
          <label htmlFor="post-title" className="mb-1 flex items-center justify-between text-sm font-medium text-silver">
            Title
            <span className={`text-xs tabular-nums ${titleLength > 300 ? 'text-crimson-soft' : 'text-silver-muted'}`}>
              {titleLength}/300
            </span>
          </label>
          <input
            id="post-title"
            type="text"
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
            required
            className="w-full rounded-lg border border-line bg-night-surface px-3 py-2 text-sm text-silver focus:border-crimson focus:outline-none"
          />
        </div>

        {draft.type === 'link' && (
          <div>
            <label htmlFor="post-url" className="mb-1 block text-sm font-medium text-silver">Link</label>
            <input
              id="post-url"
              type="url"
              value={draft.url}
              onChange={(e) => set({ url: e.target.value })}
              placeholder="https://"
              required
              className="w-full rounded-lg border border-line bg-night-surface px-3 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none"
            />
          </div>
        )}

        {draft.type === 'poll' && (
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-silver">Options</legend>
            <div className="space-y-2">
              {draft.pollOptions.map((option, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    value={option}
                    onChange={(e) => {
                      const next = [...draft.pollOptions];
                      next[i] = e.target.value;
                      set({ pollOptions: next });
                    }}
                    aria-label={`Option ${i + 1}`}
                    placeholder={`Option ${i + 1}`}
                    className="flex-1 rounded-lg border border-line bg-night-surface px-3 py-2 text-sm text-silver focus:border-crimson focus:outline-none"
                  />
                  {draft.pollOptions.length > 2 && (
                    <button
                      type="button"
                      onClick={() => set({ pollOptions: draft.pollOptions.filter((_, j) => j !== i) })}
                      aria-label={`Remove option ${i + 1}`}
                      className="cursor-pointer rounded-lg border border-line px-2 text-silver-muted hover:text-crimson-soft"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {draft.pollOptions.length < 6 && (
              <button
                type="button"
                onClick={() => set({ pollOptions: [...draft.pollOptions, ''] })}
                className="mt-2 cursor-pointer text-xs text-crimson-soft hover:underline"
              >
                Add another option
              </button>
            )}
          </fieldset>
        )}

        <div>
          <label htmlFor="post-body" className="mb-1 block text-sm font-medium text-silver">
            {draft.type === 'text' ? 'Text' : 'Text (optional)'}
          </label>
          <textarea
            id="post-body"
            value={draft.body}
            onChange={(e) => set({ body: e.target.value })}
            rows={8}
            className="w-full rounded-lg border border-line bg-night-surface px-3 py-2 text-sm text-silver focus:border-crimson focus:outline-none"
          />
        </div>

        {flairs.length > 0 && (
          <div>
            <label htmlFor="post-flair" className="mb-1 block text-sm font-medium text-silver">Flair</label>
            <select
              id="post-flair"
              value={draft.flair}
              onChange={(e) => set({ flair: e.target.value })}
              className="rounded-lg border border-line bg-night-surface px-3 py-2 text-sm text-silver focus:border-crimson focus:outline-none"
            >
              <option value="">None</option>
              {/* Mod-only flairs are filtered out server-side too; hiding them
                  here avoids offering something that will be rejected. */}
              {flairs.filter((f) => !f.modOnly).map((f) => (
                <option key={f._id} value={f._id}>{f.text}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-wrap gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-silver-muted">
            <input
              type="checkbox"
              checked={draft.nsfw}
              onChange={(e) => set({ nsfw: e.target.checked })}
              className="cursor-pointer accent-crimson"
            />
            NSFW
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-silver-muted">
            <input
              type="checkbox"
              checked={draft.spoiler}
              onChange={(e) => set({ spoiler: e.target.checked })}
              className="cursor-pointer accent-crimson"
            />
            Spoiler
          </label>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-crimson/40 bg-crimson/5 p-3 text-sm text-crimson-soft">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={submitting || !draft.title.trim() || !canPost}
            className="cursor-pointer rounded-full bg-crimson px-6 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? 'Posting…' : 'Post'}
          </button>

          {/* Quiet reassurance, not a nag. It matters most the moment before
              someone accidentally closes the tab. */}
          {savedAt && (
            <span aria-live="polite" className="text-xs text-silver-muted">
              Draft saved
            </span>
          )}
        </div>
      </form>
    </main>
  );
};

export default PostComposer;
