import { useState, useEffect, useCallback } from 'react';
import { Search, Trash2, RotateCcw, Lock, Unlock, EyeOff, Eye } from 'lucide-react';
import * as api from '../api/community';
import Spinner from '../components/Spinner';
import Pagination from '../components/Pagination';

// Every post on the site, with bulk actions.
//
// The bulk endpoint is capped at 200 server-side. An unbounded bulk action is
// one mis-click from actioning the whole site, and the audit entry would be
// useless — so the cap is enforced here too, visibly, rather than surfacing as
// a 400 after someone has selected a thousand rows.

const BULK_LIMIT = 200;

const STATUS_STYLE = {
  published: 'bg-emerald-500/15 text-emerald-300',
  hidden: 'bg-amber-500/15 text-amber-300',
  removed: 'bg-crimson/15 text-crimson-soft',
  pending: 'bg-sky-500/15 text-sky-300',
};

const BULK_ACTIONS = [
  { key: 'remove', label: 'Remove', icon: Trash2, punitive: true },
  { key: 'restore', label: 'Restore', icon: RotateCcw },
  { key: 'lock', label: 'Lock', icon: Lock },
  { key: 'unlock', label: 'Unlock', icon: Unlock },
  { key: 'nsfw', label: 'Mark NSFW', icon: EyeOff },
  { key: 'sfw', label: 'Clear NSFW', icon: Eye },
];

const CommunityPostsAdmin = () => {
  const [posts, setPosts] = useState(null);
  const [meta, setMeta] = useState({ pages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ search: '', status: '', type: '', minReports: '' });
  const [selected, setSelected] = useState(new Set());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const params = { page };
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params[key] = value;
    });
    api.listPosts(params)
      .then((data) => {
        setPosts(data.posts);
        setMeta({ pages: data.pages, total: data.total });
        setSelected(new Set());
      })
      .catch(() => setPosts([]));
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < BULK_LIMIT) next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === posts.length ? new Set() : new Set(posts.slice(0, BULK_LIMIT).map((p) => p._id))
    );
  };

  const runBulk = async (action) => {
    if (!selected.size) return;
    if (action.punitive && !reason.trim()) return;
    if (!window.confirm(`${action.label} ${selected.size} post${selected.size === 1 ? '' : 's'}?`)) return;
    setBusy(true);
    try {
      await api.bulkPosts([...selected], action.key, reason);
      setReason('');
      load();
    } finally {
      setBusy(false);
    }
  };

  const setFilter = (key, value) => {
    setPage(1);
    setFilters((f) => ({ ...f, [key]: value }));
  };

  if (!posts) return <Spinner full />;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto font-display text-2xl font-bold text-silver">Posts</h1>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-silver-muted" aria-hidden="true" />
          <input
            type="search"
            value={filters.search}
            onChange={(e) => setFilter('search', e.target.value)}
            placeholder="Search title and body…"
            aria-label="Search posts"
            className="w-full rounded-full border border-line bg-night-surface py-2 pl-9 pr-4 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none sm:w-72"
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <select
          value={filters.status}
          onChange={(e) => setFilter('status', e.target.value)}
          aria-label="Filter by status"
          className="cursor-pointer rounded-full border border-line bg-night-surface px-3 py-1.5 text-xs text-silver focus:border-crimson focus:outline-none"
        >
          <option value="">Any status</option>
          <option value="published">Published</option>
          <option value="hidden">Hidden pending review</option>
          <option value="removed">Removed</option>
          <option value="pending">Awaiting approval</option>
        </select>
        <select
          value={filters.type}
          onChange={(e) => setFilter('type', e.target.value)}
          aria-label="Filter by type"
          className="cursor-pointer rounded-full border border-line bg-night-surface px-3 py-1.5 text-xs text-silver focus:border-crimson focus:outline-none"
        >
          <option value="">Any type</option>
          <option value="text">Text</option>
          <option value="image">Image</option>
          <option value="link">Link</option>
          <option value="poll">Poll</option>
        </select>
        <select
          value={filters.minReports}
          onChange={(e) => setFilter('minReports', e.target.value)}
          aria-label="Filter by report count"
          className="cursor-pointer rounded-full border border-line bg-night-surface px-3 py-1.5 text-xs text-silver focus:border-crimson focus:outline-none"
        >
          <option value="">Any report count</option>
          <option value="1">Reported at least once</option>
          <option value="5">5 or more reports</option>
          <option value="10">10 or more reports</option>
        </select>
      </div>

      {/* The bulk bar only appears with a selection, so it never sits there
          inviting an accidental click. */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-crimson/40 bg-crimson/5 p-3">
          <p className="text-sm text-silver">
            {selected.size} selected
            {selected.size >= BULK_LIMIT && (
              <span className="ml-2 text-xs text-amber-300">maximum {BULK_LIMIT} at a time</span>
            )}
          </p>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required to remove)"
            aria-label="Bulk action reason"
            className="min-w-[16rem] flex-1 rounded-lg border border-line bg-night px-3 py-1.5 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none"
          />
          {BULK_ACTIONS.map((action) => (
            <button
              key={action.key}
              type="button"
              disabled={busy || (action.punitive && !reason.trim())}
              onClick={() => runBulk(action)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                action.punitive
                  ? 'bg-crimson text-white'
                  : 'border border-line text-silver-muted hover:text-silver'
              }`}
            >
              <action.icon className="h-3.5 w-3.5" aria-hidden="true" /> {action.label}
            </button>
          ))}
        </div>
      )}

      {!posts.length ? (
        <p className="rounded-xl border border-line bg-night-surface p-8 text-center text-sm text-silver-muted">
          No posts match those filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-night-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-silver-muted">
              <tr>
                <th className="p-3">
                  <input
                    type="checkbox"
                    checked={selected.size > 0 && selected.size === posts.length}
                    onChange={toggleAll}
                    aria-label="Select all on this page"
                    className="cursor-pointer accent-crimson"
                  />
                </th>
                <th className="p-3 font-medium">Post</th>
                <th className="p-3 font-medium">Space</th>
                <th className="p-3 font-medium">Author</th>
                <th className="p-3 font-medium text-right">Score</th>
                <th className="p-3 font-medium text-right">Reports</th>
                <th className="p-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post._id} className="border-b border-line/60 last:border-0">
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selected.has(post._id)}
                      onChange={() => toggle(post._id)}
                      aria-label={`Select ${post.title}`}
                      className="cursor-pointer accent-crimson"
                    />
                  </td>
                  <td className="max-w-md p-3">
                    <p className="truncate font-medium text-silver" title={post.title}>{post.title}</p>
                    <p className="text-xs text-silver-muted">
                      {post.type} · {new Date(post.createdAt).toLocaleDateString()}
                      {post.nsfw && <span className="ml-2 text-crimson-soft">NSFW</span>}
                      {post.locked && <span className="ml-2 text-amber-300">locked</span>}
                    </p>
                  </td>
                  <td className="p-3 text-xs text-silver-muted">
                    {post.space?.slug ? `/c/${post.space.slug}` : '—'}
                  </td>
                  <td className="p-3 text-xs text-silver-muted">{post.author?.username || '—'}</td>
                  <td className="p-3 text-right tabular-nums text-silver">{post.score}</td>
                  <td className={`p-3 text-right tabular-nums ${post.reportCount > 0 ? 'text-amber-300' : 'text-silver-muted'}`}>
                    {post.reportCount || 0}
                  </td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[post.status] || ''}`}>
                      {post.status}
                    </span>
                  </td>
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

export default CommunityPostsAdmin;
