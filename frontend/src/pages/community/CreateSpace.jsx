import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AlertTriangle, Clock, Lock } from 'lucide-react';
import * as api from '../../api/spaces';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import Spinner from '../../components/Spinner';

// Creating a space.
//
// THE ELIGIBILITY CHECK RUNS FIRST AND EXPLAINS ITSELF. The server returns
// { allowed, requiresApproval, reason, message } — so someone who cannot create
// a space is told exactly why and what would change it, rather than finding a
// disabled button with no explanation. That `message` is written server-side
// precisely so the two never drift.

const slugify = (value) =>
  value.toLowerCase().trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const BLOCKED_ICONS = {
  karma: AlertTriangle,
  cooldown: Clock,
  account_too_new: Clock,
  admin_only: Lock,
  revoked: Lock,
  community_banned: Lock,
};

const CreateSpace = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { settings } = useSettings();

  const [gate, setGate] = useState(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [tagline, setTagline] = useState('');
  const [purpose, setPurpose] = useState('');
  const [topic, setTopic] = useState('');
  const [nsfw, setNsfw] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const topics = settings?.['spaces.core.topics'] || [];
  const requirePurpose = settings?.['spaces.creation.requirePurpose'] !== false;

  useEffect(() => {
    if (!user) return;
    api.creationEligibility().then(setGate).catch(() => setGate({ allowed: false, reason: 'error' }));
  }, [user]);

  // The slug follows the name until someone edits it directly, then it stops —
  // otherwise typing the name overwrites a deliberate choice.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name));
  }, [name, slugTouched]);

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.createSpace({ name, slug, tagline, purpose, topics: topic ? [topic] : [], nsfw });
      if (result.requiresApproval) {
        navigate('/community/spaces', { replace: true });
      } else {
        navigate(`/c/${result.space.slug}`, { replace: true });
      }
    } catch (err) {
      setError(err?.response?.data?.message || 'That could not be created');
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-silver">Sign in first</h1>
        <Link to="/login" className="mt-4 inline-block rounded-full bg-crimson px-5 py-2 text-sm font-medium text-white">
          Sign in
        </Link>
      </main>
    );
  }

  if (!gate) return <Spinner full />;

  if (!gate.allowed) {
    const Icon = BLOCKED_ICONS[gate.reason] || AlertTriangle;
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <Icon className="mx-auto mb-3 h-8 w-8 text-silver-muted" aria-hidden="true" />
        <h1 className="font-display text-2xl font-bold text-silver">Not yet</h1>
        {/* The server writes this message, so the explanation and the rule can
            never disagree. */}
        <p className="mx-auto mt-2 max-w-sm text-sm text-silver-muted">{gate.message}</p>
        <Link to="/community/spaces" className="mt-6 inline-block text-sm text-crimson-soft underline">
          Browse existing spaces
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-6">
      <h1 className="mb-1 font-display text-2xl font-bold text-silver">Create a space</h1>
      <p className="mb-5 text-sm text-silver-muted">
        A space can be about anything — a hobby, a place, a game, a book.
      </p>

      {gate.requiresApproval && (
        <div role="status" className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-200">
          New spaces are reviewed before they go live. Yours will be visible only to you until then.
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="space-name" className="mb-1 block text-sm font-medium text-silver">Name</label>
          <input
            id="space-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={60}
            className="w-full rounded-lg border border-line bg-night-surface px-3 py-2 text-sm text-silver focus:border-crimson focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="space-slug" className="mb-1 block text-sm font-medium text-silver">Address</label>
          <div className="flex items-center gap-1 rounded-lg border border-line bg-night-surface px-3 focus-within:border-crimson">
            <span className="text-sm text-silver-muted">/c/</span>
            <input
              id="space-slug"
              type="text"
              value={slug}
              onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }}
              required
              className="flex-1 bg-transparent py-2 text-sm text-silver focus:outline-none"
            />
          </div>
          <p className="mt-1 text-xs text-silver-muted">
            Letters, numbers and hyphens. This cannot be changed later, because it appears in every
            link anyone shares.
          </p>
        </div>

        <div>
          <label htmlFor="space-tagline" className="mb-1 block text-sm font-medium text-silver">
            Tagline <span className="font-normal text-silver-muted">(optional)</span>
          </label>
          <input
            id="space-tagline"
            type="text"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            maxLength={120}
            placeholder="One line about what this is"
            className="w-full rounded-lg border border-line bg-night-surface px-3 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none"
          />
        </div>

        {topics.length > 0 && (
          <div>
            <label htmlFor="space-topic" className="mb-1 block text-sm font-medium text-silver">Topic</label>
            <select
              id="space-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="w-full rounded-lg border border-line bg-night-surface px-3 py-2 text-sm text-silver focus:border-crimson focus:outline-none"
            >
              <option value="">Choose one…</option>
              {topics.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>
        )}

        {requirePurpose && (
          <div>
            <label htmlFor="space-purpose" className="mb-1 block text-sm font-medium text-silver">
              What is this space for?
            </label>
            <textarea
              id="space-purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              rows={3}
              required
              className="w-full rounded-lg border border-line bg-night-surface px-3 py-2 text-sm text-silver focus:border-crimson focus:outline-none"
            />
            <p className="mt-1 text-xs text-silver-muted">
              {gate.requiresApproval
                ? 'This is what a reviewer reads when deciding.'
                : 'Helps people decide whether to join.'}
            </p>
          </div>
        )}

        {settings?.['spaces.creation.allowNsfw'] && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-silver-muted">
            <input
              type="checkbox"
              checked={nsfw}
              onChange={(e) => setNsfw(e.target.checked)}
              className="cursor-pointer accent-crimson"
            />
            This space is for adult content
          </label>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-crimson/40 bg-crimson/5 p-3 text-sm text-crimson-soft">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !name.trim() || !slug.trim()}
          className="w-full cursor-pointer rounded-full bg-crimson px-6 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? 'Creating…' : gate.requiresApproval ? 'Submit for review' : 'Create'}
        </button>
      </form>
    </main>
  );
};

export default CreateSpace;
