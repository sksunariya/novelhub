import { useState, useEffect, useCallback } from 'react';
import { ShieldAlert } from 'lucide-react';
import * as api from '../api/community';
import Spinner from '../components/Spinner';
import Pagination from '../components/Pagination';

// Every moderation action across every space.
//
// The `actorRole` filter is the point of this page: it is how an admin finds a
// moderator abusing their own space. No other view answers that question.

const ROLE_STYLE = {
  admin: 'bg-crimson/15 text-crimson-soft',
  owner: 'bg-amber-500/15 text-amber-300',
  moderator: 'bg-sky-500/15 text-sky-300',
  system: 'bg-zinc-500/15 text-zinc-300',
};

const CommunityModlogAdmin = () => {
  const [entries, setEntries] = useState(null);
  const [meta, setMeta] = useState({ pages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [actorRole, setActorRole] = useState('');

  const load = useCallback(() => {
    api.listModActions({ page, actorRole: actorRole || undefined })
      .then((data) => { setEntries(data.entries); setMeta({ pages: data.pages, total: data.total }); })
      .catch(() => setEntries([]));
  }, [page, actorRole]);

  useEffect(() => { load(); }, [load]);

  if (!entries) return <Spinner full />;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto font-display text-2xl font-bold text-silver">Moderation log</h1>
        <div className="flex gap-2">
          {[['', 'Everyone'], ['moderator', 'Moderators'], ['owner', 'Owners'], ['admin', 'Admins'], ['system', 'Automatic']].map(
            ([value, label]) => (
              <button
                key={value || 'all'}
                type="button"
                onClick={() => { setPage(1); setActorRole(value); }}
                className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  actorRole === value ? 'bg-crimson text-white' : 'border border-line text-silver-muted hover:text-silver'
                }`}
              >
                {label}
              </button>
            )
          )}
        </div>
      </div>

      <p className="mb-3 flex items-center gap-1.5 text-xs text-silver-muted">
        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
        Entries are immutable. Filtering by Moderators is how you spot someone acting against their own community.
      </p>

      {!entries.length ? (
        <p className="rounded-xl border border-line bg-night-surface p-8 text-center text-sm text-silver-muted">
          Nothing logged yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-night-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-silver-muted">
              <tr>
                <th className="p-3 font-medium">When</th>
                <th className="p-3 font-medium">Actor</th>
                <th className="p-3 font-medium">Action</th>
                <th className="p-3 font-medium">Space</th>
                <th className="p-3 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry._id} className="border-b border-line/60 last:border-0">
                  <td className="whitespace-nowrap p-3 text-xs text-silver-muted">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="p-3">
                    <span className="text-silver">{entry.actor?.username || entry.actorLabel || 'system'}</span>
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${ROLE_STYLE[entry.actorRole] || ROLE_STYLE.system}`}>
                      {entry.actorRole}
                    </span>
                  </td>
                  <td className="p-3 font-mono text-xs text-silver">{entry.action}</td>
                  <td className="p-3 text-silver-muted">{entry.space?.slug ? `/c/${entry.space.slug}` : '—'}</td>
                  <td className="max-w-xs p-3 text-xs text-silver-muted">{entry.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pages={meta.pages} total={meta.total} onChange={setPage} />
    </div>
  );
};

export default CommunityModlogAdmin;
