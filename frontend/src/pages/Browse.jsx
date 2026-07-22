import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SlidersHorizontal } from 'lucide-react';
import client from '../api/client';
import NovelCard from '../components/NovelCard';
import PageTransition from '../components/PageTransition';
import Spinner from '../components/Spinner';

const SORTS = [
  { value: 'latest', label: 'Recently Updated' },
  { value: 'newest', label: 'Newest' },
  { value: 'popular', label: 'Most Popular' },
  { value: 'trending', label: 'Trending' },
  { value: 'rating', label: 'Top Rated' },
  { value: 'title', label: 'A–Z' },
];

const STATUSES = ['ongoing', 'completed', 'hiatus'];

const Browse = () => {
  const [params, setParams] = useSearchParams();
  const [genres, setGenres] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);

  const search = params.get('search') || '';
  const genre = params.get('genre') || '';
  const status = params.get('status') || '';
  const sort = params.get('sort') || 'latest';
  const page = parseInt(params.get('page'), 10) || 1;

  useEffect(() => {
    client.get('/novels/genres').then(({ data }) => setGenres(data.genres)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const query = new URLSearchParams({ sort, page: String(page), limit: '24' });
    if (search) query.set('search', search);
    if (genre) query.set('genre', genre);
    if (status) query.set('status', status);
    client
      .get(`/novels?${query.toString()}`)
      .then(({ data }) => setResult(data))
      .catch(() => setResult({ novels: [], total: 0, pages: 0 }))
      .finally(() => setLoading(false));
  }, [search, genre, status, sort, page]);

  const updateParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    next.delete('page');
    setParams(next);
  };

  const selectClass =
    'rounded-lg border border-line bg-night-surface px-3 py-2 text-sm text-silver focus:border-crimson focus:outline-none cursor-pointer';

  return (
    <PageTransition>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto flex items-center gap-2 font-display text-2xl font-bold text-silver">
          <SlidersHorizontal className="h-5 w-5 text-crimson" aria-hidden="true" />
          Browse{search ? `: “${search}”` : ''}
        </h1>
        <label className="sr-only" htmlFor="genre-filter">Genre</label>
        <select id="genre-filter" value={genre} onChange={(e) => updateParam('genre', e.target.value)} className={selectClass}>
          <option value="">All genres</option>
          {genres.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="status-filter">Status</label>
        <select id="status-filter" value={status} onChange={(e) => updateParam('status', e.target.value)} className={selectClass}>
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s} className="capitalize">{s}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="sort-filter">Sort</label>
        <select id="sort-filter" value={sort} onChange={(e) => updateParam('sort', e.target.value)} className={selectClass}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <Spinner full />
      ) : result.novels.length === 0 ? (
        <div className="rounded-xl border border-line bg-night-surface py-16 text-center text-silver-muted">
          <p className="font-display text-lg">No novels found</p>
          <p className="mt-1 text-sm">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {result.novels.map((novel, index) => (
              <NovelCard key={novel._id} novel={novel} index={index} />
            ))}
          </div>
          {result.pages > 1 && (
            <nav className="mt-8 flex items-center justify-center gap-2" aria-label="Pagination">
              {Array.from({ length: result.pages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.set('page', String(p));
                    setParams(next);
                  }}
                  aria-current={p === page ? 'page' : undefined}
                  className={`h-9 min-w-9 cursor-pointer rounded-md px-2 text-sm font-medium transition-colors ${
                    p === page ? 'bg-crimson text-white' : 'border border-line text-silver-muted hover:text-silver'
                  }`}
                >
                  {p}
                </button>
              ))}
            </nav>
          )}
        </>
      )}
    </PageTransition>
  );
};

export default Browse;
