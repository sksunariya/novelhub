import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Search, Plus, Users, BadgeCheck } from 'lucide-react';
import * as api from '../../api/spaces';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import Spinner from '../../components/Spinner';
import Pagination from '../../components/Pagination';

// Browse and search spaces.
//
// The topic list comes from `spaces.core.topics` in the public settings
// projection, so an admin reshapes the taxonomy without a deploy and without
// this file knowing anything about what the categories are.

const SpaceDirectory = () => {
  const { user } = useAuth();
  const { settings } = useSettings();

  const [spaces, setSpaces] = useState(null);
  const [meta, setMeta] = useState({ pages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [topic, setTopic] = useState('');
  const [sort, setSort] = useState('popular');

  const topics = settings?.['spaces.core.topics'] || [];

  const load = useCallback(() => {
    api.listSpaces({ page, search: search || undefined, topic: topic || undefined, sort })
      .then((data) => {
        setSpaces(data.spaces);
        setMeta({ pages: data.pages, total: data.total });
      })
      .catch(() => setSpaces([]));
  }, [page, search, topic, sort]);

  useEffect(() => { load(); }, [load]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto font-display text-2xl font-bold text-silver">Spaces</h1>
        {user && (
          <Link
            to="/community/create"
            className="flex items-center gap-1.5 rounded-full bg-crimson px-4 py-2 text-sm font-medium text-white"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Create
          </Link>
        )}
      </div>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-silver-muted" aria-hidden="true" />
        <label htmlFor="space-search" className="sr-only">Search spaces</label>
        <input
          id="space-search"
          type="search"
          value={search}
          onChange={(e) => { setPage(1); setSearch(e.target.value); }}
          placeholder="Search spaces…"
          className="w-full rounded-full border border-line bg-night-surface py-2.5 pl-10 pr-4 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { setPage(1); setTopic(''); }}
          aria-pressed={topic === ''}
          className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            topic === '' ? 'bg-crimson text-white' : 'border border-line text-silver-muted hover:text-silver'
          }`}
        >
          All topics
        </button>
        {topics.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => { setPage(1); setTopic(t.key); }}
            aria-pressed={topic === t.key}
            className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              topic === t.key ? 'bg-crimson text-white' : 'border border-line text-silver-muted hover:text-silver'
            }`}
          >
            {t.label}
          </button>
        ))}
        <select
          value={sort}
          onChange={(e) => { setPage(1); setSort(e.target.value); }}
          aria-label="Sort spaces"
          className="ml-auto cursor-pointer rounded-full border border-line bg-night-surface px-3 py-1.5 text-xs text-silver focus:border-crimson focus:outline-none"
        >
          <option value="popular">Most members</option>
          <option value="active">Recently active</option>
          <option value="new">Newest</option>
        </select>
      </div>

      {!spaces ? (
        <Spinner />
      ) : !spaces.length ? (
        <p className="rounded-xl border border-line bg-night-surface p-10 text-center text-sm text-silver-muted">
          No spaces match that.
          {user && (
            <>
              {' '}
              <Link to="/community/create" className="text-crimson-soft underline">Create one</Link>.
            </>
          )}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {spaces.map((space) => (
            <li key={space.id}>
              <Link
                to={`/c/${space.slug}`}
                className="flex h-full gap-3 rounded-xl border border-line bg-night-surface p-4 transition-colors hover:border-crimson/40"
              >
                {space.iconUrl ? (
                  <img src={space.iconUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-night-raised font-display text-sm font-bold text-crimson-soft">
                    {space.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-medium text-silver">
                    {space.name}
                    {space.verified && (
                      <BadgeCheck className="h-3.5 w-3.5 text-sky-300" aria-label="Verified" />
                    )}
                    {space.nsfw && (
                      <span className="rounded bg-crimson/15 px-1 text-[10px] text-crimson-soft">NSFW</span>
                    )}
                  </p>
                  <p className="text-xs text-silver-muted">/c/{space.slug}</p>
                  {space.tagline && (
                    <p className="mt-1 line-clamp-2 text-sm text-silver-muted">{space.tagline}</p>
                  )}
                  <p className="mt-2 flex items-center gap-1 text-xs text-silver-muted">
                    <Users className="h-3 w-3" aria-hidden="true" />
                    {space.memberCount.toLocaleString()}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Pagination page={page} pages={meta.pages} total={meta.total} onChange={setPage} />
    </main>
  );
};

export default SpaceDirectory;
