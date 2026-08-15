import { useState, useEffect, useCallback } from 'react';
import { Check, X, Clock, TrendingUp, AlertTriangle } from 'lucide-react';
import * as api from '../api/community';
import Spinner from '../components/Spinner';

// The approval queue.
//
// Only meaningful when spaces.creation.mode is `approval`. The point of the
// layout is that the decision needs context about the PERSON, not just the
// name they picked — karma, account age and prior moderation history are what
// separate a real request from a squatter.

const daysOld = (date) => Math.floor((Date.now() - new Date(date)) / 86400000);

const SpaceRequestsAdmin = () => {
  const [requests, setRequests] = useState(null);
  const [busy, setBusy] = useState(null);
  const [reasons, setReasons] = useState({});

  const load = useCallback(() => {
    api.listSpaces({ status: 'pending', sort: 'new', limit: 50 })
      .then((data) => setRequests(data.spaces))
      .catch(() => setRequests([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  const decide = async (space, action, grant = false) => {
    const reason = reasons[space._id] || '';
    if (action === 'reject' && !reason.trim()) return;
    setBusy(space._id);
    try {
      await api.spaceLifecycle(space._id, action, { reason });
      // "Approve and trust" also lifts this person past the queue in future —
      // the queue should shrink as trust is established, not stay constant.
      if (grant && space.owner?._id) {
        await api.setSpaceCreationPolicy(
          space.owner._id,
          'always',
          'Approved a space request; trusted to create directly'
        );
      }
      load();
    } finally {
      setBusy(null);
    }
  };

  if (!requests) return <Spinner full />;

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <h1 className="mr-auto font-display text-2xl font-bold text-silver">Space requests</h1>
        <p className="text-sm text-silver-muted">{requests.length} waiting</p>
      </div>

      {!requests.length ? (
        <p className="rounded-xl border border-line bg-night-surface p-8 text-center text-sm text-silver-muted">
          Nothing waiting. Requests expire automatically if they are not reviewed, so an
          unattended queue degrades gracefully rather than leaving people waiting indefinitely.
        </p>
      ) : (
        <ul className="space-y-3">
          {requests.map((space) => {
            const owner = space.owner || {};
            const accountDays = owner.createdAt ? daysOld(owner.createdAt) : null;
            const waiting = daysOld(space.createdAt);
            return (
              <li key={space._id} className="rounded-xl border border-line bg-night-surface p-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h2 className="font-display text-lg font-bold text-silver">{space.name}</h2>
                  <code className="rounded bg-night-raised px-1.5 py-0.5 text-xs text-silver-muted">
                    /c/{space.slug}
                  </code>
                  {waiting >= 7 && (
                    <span className="flex items-center gap-1 text-xs text-amber-300">
                      <Clock className="h-3 w-3" aria-hidden="true" /> waiting {waiting} days
                    </span>
                  )}
                </div>

                {space.tagline && <p className="mt-1 text-sm text-silver-muted">{space.tagline}</p>}

                {/* The stated purpose. Nothing filters low-effort requests better. */}
                {space.purpose && (
                  <div className="mt-3 rounded-lg border border-line bg-night p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-silver-muted">
                      What it is for
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-silver">{space.purpose}</p>
                  </div>
                )}

                {/* Who is asking. This is what the decision actually turns on. */}
                <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg border border-line bg-night p-3 text-xs">
                  <span className="text-silver-muted">
                    Requested by <span className="text-silver">{owner.username || '—'}</span>
                  </span>
                  {accountDays !== null && (
                    <span className={`flex items-center gap-1 ${accountDays < 7 ? 'text-amber-300' : 'text-silver-muted'}`}>
                      {accountDays < 7 && <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
                      Account {accountDays} day{accountDays === 1 ? '' : 's'} old
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-silver-muted">
                    <TrendingUp className="h-3 w-3" aria-hidden="true" />
                    {owner.karma?.total ?? 0} karma
                  </span>
                  {space.nsfw && (
                    <span className="rounded bg-crimson/15 px-1.5 py-0.5 text-crimson-soft">NSFW</span>
                  )}
                  <span className="rounded bg-night-raised px-1.5 py-0.5 text-silver-muted">
                    {space.visibility}
                  </span>
                </div>

                <input
                  type="text"
                  value={reasons[space._id] || ''}
                  onChange={(e) => setReasons((r) => ({ ...r, [space._id]: e.target.value }))}
                  placeholder="Reason (required to reject — the requester is told this)"
                  aria-label={`Reason for ${space.name}`}
                  className="mt-3 w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none"
                />

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy === space._id}
                    onClick={() => decide(space, 'approve')}
                    className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-crimson px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                  >
                    <Check className="h-4 w-4" aria-hidden="true" /> Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy === space._id}
                    onClick={() => decide(space, 'approve', true)}
                    title="Approve, and let this person create spaces directly in future"
                    className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-sm text-silver-muted transition-colors hover:border-crimson hover:text-silver disabled:opacity-40"
                  >
                    Approve &amp; trust
                  </button>
                  <button
                    type="button"
                    disabled={busy === space._id || !(reasons[space._id] || '').trim()}
                    onClick={() => decide(space, 'reject')}
                    className="ml-auto flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-silver-muted transition-colors hover:border-crimson hover:text-crimson-soft disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <X className="h-4 w-4" aria-hidden="true" /> Reject
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default SpaceRequestsAdmin;
