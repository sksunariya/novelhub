import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Star, BadgeCheck, Lock, ShieldAlert, Archive, Ban, RotateCcw, Check, X, RefreshCw,
} from 'lucide-react';
import * as api from '../api/community';
import Spinner from '../components/Spinner';
import Pagination from '../components/Pagination';

// The space registry. Shows what the public directory hides — private, pending,
// archived, quarantined and banned spaces all appear here.

const STATUS_STYLE = {
  active: 'bg-emerald-500/15 text-emerald-300',
  pending: 'bg-amber-500/15 text-amber-300',
  quarantined: 'bg-orange-500/15 text-orange-300',
  archived: 'bg-zinc-500/15 text-zinc-300',
  banned: 'bg-crimson/15 text-crimson-soft',
  rejected: 'bg-zinc-500/15 text-zinc-400',
};

// Anything punitive requires a reason. Approving does not — asking for one when
// the answer is "it's fine" just trains people to type "ok".
const NEEDS_REASON = new Set(['reject', 'quarantine', 'ban']);

const ACTIONS = [
  { key: 'approve', label: 'Approve', icon: Check, when: (s) => s.status === 'pending' },
  { key: 'reject', label: 'Reject', icon: X, when: (s) => s.status === 'pending' },
  { key: 'quarantine', label: 'Quarantine', icon: ShieldAlert, when: (s) => s.status === 'active' },
  { key: 'archive', label: 'Archive', icon: Archive, when: (s) => s.status === 'active' },
  { key: 'ban', label: 'Ban', icon: Ban, when: (s) => s.status !== 'banned' },
  { key: 'restore', label: 'Restore', icon: RotateCcw, when: (s) => s.status !== 'active' },
];

const Badge = ({ children, className = '' }) => (
  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}>{children}</span>
);

const ReasonDialog = ({ action, space, onConfirm, onCancel }) => {
  const [reason, setReason] = useState('');
  const required = NEEDS_REASON.has(action.key);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-line bg-night-surface p-5 shadow-card">
        <h2 className="font-display text-lg font-bold text-silver">
          {action.label} “{space.name}”?
        </h2>
        <p className="mt-1 text-sm text-silver-muted">
          {action.key === 'quarantine'
            ? 'Hidden from every feed and from search. Still reachable by direct link with a warning — the proportionate step before a ban.'
            : action.key === 'ban'
              ? 'Invisible to everyone but administrators. Its posts stay in the database.'
              : action.key === 'archive'
                ? 'Read-only. Existing content stays visible; nothing new can be posted.'
                : 'This will be recorded in the space’s moderation log and the admin audit trail.'}
        </p>

        <label className="mt-4 block text-xs font-medium text-silver-muted" htmlFor="reason">
          Reason {required ? '(required)' : '(optional)'}
        </label>
        <textarea
          id="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver focus:border-crimson focus:outline-none"
          placeholder={required ? 'The owner will be told this' : ''}
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-silver-muted hover:text-silver"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={required && !reason.trim()}
            onClick={() => onConfirm(reason)}
            className="cursor-pointer rounded-lg bg-crimson px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {action.label}
          </button>
        </div>
      </div>
    </div>
  );
};

const SpacesAdmin = () => {
  const [spaces, setSpaces] = useState(null);
  const [meta, setMeta] = useState({ pages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [flag, setFlag] = useState('');
  const [sort, setSort] = useState('members');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .listSpaces({ page, search: search || undefined, status: status || undefined,
                    flag: flag || undefined, sort })
      .then((data) => {
        setSpaces(data.spaces);
        setMeta({ pages: data.pages, total: data.total });
      })
      .catch(() => setSpaces([]));
  }, [page, search, status, flag, sort]);

  useEffect(() => { load(); }, [load]);

  const runAction = async (reason) => {
    setBusy(true);
    try {
      await api.spaceLifecycle(dialog.space._id, dialog.action.key, { reason });
      setDialog(null);
      load();
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (space, field) => {
    await api.updateSpace(space._id, { [field]: !space[field] });
    load();
  };

  const recount = async (space) => {
    await api.recountSpace(space._id);
    load();
  };

  if (!spaces) return <Spinner full />;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto font-display text-2xl font-bold text-silver">Spaces</h1>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-silver-muted" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => { setPage(1); setSearch(e.target.value); }}
            placeholder="Name or address…"
            aria-label="Search spaces"
            className="w-full rounded-full border border-line bg-night-surface py-2 pl-9 pr-4 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none sm:w-64"
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ['', 'All statuses'], ['pending', 'Pending review'], ['active', 'Active'],
          ['quarantined', 'Quarantined'], ['archived', 'Archived'], ['banned', 'Banned'],
        ].map(([value, label]) => (
          <button
            key={value || 'all'}
            type="button"
            onClick={() => { setPage(1); setStatus(value); }}
            className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              status === value ? 'bg-crimson text-white' : 'border border-line text-silver-muted hover:text-silver'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="mx-1 w-px bg-line" aria-hidden="true" />
        {[['', 'Any'], ['featured', 'Featured'], ['verified', 'Verified'], ['nsfw', 'NSFW'], ['locked', 'Locked']].map(
          ([value, label]) => (
            <button
              key={value || 'anyflag'}
              type="button"
              onClick={() => { setPage(1); setFlag(value); }}
              className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                flag === value ? 'bg-crimson/20 text-crimson-soft' : 'border border-line text-silver-muted hover:text-silver'
              }`}
            >
              {label}
            </button>
          )
        )}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Sort spaces"
          className="ml-auto cursor-pointer rounded-full border border-line bg-night-surface px-3 py-1.5 text-xs text-silver focus:border-crimson focus:outline-none"
        >
          <option value="members">Most members</option>
          <option value="posts">Most posts</option>
          <option value="new">Newest</option>
          <option value="active">Recently active</option>
        </select>
      </div>

      {!spaces.length ? (
        <p className="rounded-xl border border-line bg-night-surface p-8 text-center text-sm text-silver-muted">
          No spaces match those filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-night-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-silver-muted">
              <tr>
                <th className="p-3 font-medium">Space</th>
                <th className="p-3 font-medium">Owner</th>
                <th className="p-3 font-medium text-right">Members</th>
                <th className="p-3 font-medium text-right">Posts</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Flags</th>
                <th className="p-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {spaces.map((space) => (
                <tr key={space._id} className="border-b border-line/60 last:border-0">
                  <td className="p-3">
                    <Link
                      to={`/admin/spaces/${space._id}`}
                      className="font-medium text-silver transition-colors hover:text-crimson-soft"
                    >
                      {space.name}
                    </Link>
                    <p className="text-xs text-silver-muted">/c/{space.slug}</p>
                  </td>
                  <td className="p-3 text-silver-muted">{space.owner?.username || '—'}</td>
                  <td className="p-3 text-right tabular-nums text-silver">{space.memberCount}</td>
                  <td className="p-3 text-right tabular-nums text-silver">{space.postCount}</td>
                  <td className="p-3">
                    <Badge className={STATUS_STYLE[space.status] || STATUS_STYLE.archived}>
                      {space.status}
                    </Badge>
                    {space.statusReason && (
                      <p className="mt-1 max-w-[16rem] truncate text-[11px] text-silver-muted" title={space.statusReason}>
                        {space.statusReason}
                      </p>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => toggle(space, 'featured')}
                        aria-pressed={space.featured}
                        title="Featured"
                        className={`cursor-pointer rounded p-1 ${space.featured ? 'text-amber-300' : 'text-silver-muted hover:text-silver'}`}
                      >
                        <Star className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggle(space, 'verified')}
                        aria-pressed={space.verified}
                        title="Verified"
                        className={`cursor-pointer rounded p-1 ${space.verified ? 'text-sky-300' : 'text-silver-muted hover:text-silver'}`}
                      >
                        <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggle(space, 'locked')}
                        aria-pressed={space.locked}
                        title="Locked (read-only)"
                        className={`cursor-pointer rounded p-1 ${space.locked ? 'text-crimson-soft' : 'text-silver-muted hover:text-silver'}`}
                      >
                        <Lock className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap justify-end gap-1">
                      {ACTIONS.filter((a) => a.when(space)).map((action) => (
                        <button
                          key={action.key}
                          type="button"
                          onClick={() => setDialog({ space, action })}
                          className="cursor-pointer rounded-lg border border-line px-2 py-1 text-[11px] text-silver-muted transition-colors hover:border-crimson hover:text-silver"
                        >
                          {action.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => recount(space)}
                        title="Rebuild counters from source"
                        className="cursor-pointer rounded-lg border border-line p-1 text-silver-muted hover:text-silver"
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pages={meta.pages} total={meta.total} onChange={setPage} />

      {dialog && (
        <ReasonDialog
          action={dialog.action}
          space={dialog.space}
          onConfirm={busy ? () => {} : runAction}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
};

export default SpacesAdmin;
