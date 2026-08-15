import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ScrollText, ArrowLeft } from 'lucide-react';
import * as api from '../../api/spaces';
import Spinner from '../../components/Spinner';

// A space's public moderation log.
//
// Opt-in per space and 404 when it is off, so this page's empty and missing
// states are genuinely different things and are worded differently.
//
// The endpoint publishes the ACTION and the REASON, and withholds the
// moderator and the actioned user. That is deliberate: a mod log exists to
// show that rules are applied consistently, not to identify people on either
// side of a decision.

const ACTION_LABELS = {
  'post.remove': 'Post removed',
  'post.approve': 'Post approved',
  'post.lock': 'Post locked',
  'post.unlock': 'Post unlocked',
  'post.pin': 'Post pinned',
  'post.unpin': 'Post unpinned',
  'comment.remove': 'Comment removed',
  'comment.approve': 'Comment approved',
  'member.ban': 'Member banned',
  'member.unban': 'Member unbanned',
  'member.mute': 'Member muted',
  'member.role': 'Member role changed',
  'rule.create': 'Rule added',
  'rule.update': 'Rule changed',
  'rule.delete': 'Rule removed',
  'space.update': 'Space settings changed',
};

const ROLE_LABELS = {
  owner: 'Owner',
  moderator: 'Moderator',
  admin: 'Site admin',
  system: 'Automated',
};

const relative = (date) => {
  const minutes = Math.floor((Date.now() - new Date(date)) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
};

const SpaceModlog = () => {
  const { slug } = useParams();
  const [entries, setEntries] = useState(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    document.title = `Moderation log · c/${slug}`;
    api.spaceModlog(slug, { limit: 100 })
      .then((d) => setEntries(d.entries || []))
      .catch(() => setUnavailable(true));
  }, [slug]);

  if (unavailable) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-silver">No public log here</h1>
        <p className="mt-2 text-sm text-silver-muted">
          This space does not publish its moderation log.
        </p>
        <Link to={`/c/${slug}`} className="mt-4 inline-block text-sm text-crimson-soft underline">
          Back to c/{slug}
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Link
        to={`/c/${slug}`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-silver-muted hover:text-silver"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> c/{slug}
      </Link>

      <h1 className="font-display text-2xl font-bold text-silver">Moderation log</h1>
      <p className="mt-1 text-sm text-silver-muted">
        Every moderation action taken in this space. Moderators and affected members are not
        named — the record is here to show the rules are applied consistently, not to identify
        anyone.
      </p>

      {entries === null && <Spinner />}

      {entries?.length === 0 && (
        <div className="mt-8 rounded-xl border border-line bg-night-surface p-8 text-center">
          <ScrollText className="mx-auto h-8 w-8 text-silver-muted" aria-hidden="true" />
          <p className="mt-3 text-sm text-silver">No moderation actions yet.</p>
        </div>
      )}

      {entries?.length > 0 && (
        <ul className="mt-5 divide-y divide-line rounded-xl border border-line bg-night-surface">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 p-3">
              <span className="text-sm font-medium text-silver">
                {ACTION_LABELS[entry.action] || entry.action}
              </span>
              {entry.targetLabel && (
                <span className="min-w-0 truncate text-xs text-silver-muted">
                  {entry.targetLabel}
                </span>
              )}
              <span className="ml-auto shrink-0 text-xs text-silver-muted">
                {ROLE_LABELS[entry.actorRole] || entry.actorRole}
                {' · '}
                <time dateTime={entry.createdAt}>{relative(entry.createdAt)}</time>
              </span>
              {entry.reason && (
                <p className="w-full text-xs text-silver-muted">Reason: {entry.reason}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
};

export default SpaceModlog;
