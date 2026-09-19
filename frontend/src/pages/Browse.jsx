import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronLeft, ChevronRight, SearchX, X } from 'lucide-react';
import client from '../api/client';
import NovelCard from '../components/NovelCard';
import PageTransition from '../components/PageTransition';

const SORTS = [
  { value: 'latest', label: 'Recently Updated' },
  { value: 'newest', label: 'Newest' },
  { value: 'popular', label: 'Most Popular' },
  { value: 'trending', label: 'Trending' },
  { value: 'rating', label: 'Top Rated' },
  { value: 'title', label: 'A–Z' },
];

const STATUSES = [
  { value: '', label: 'Any status' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'completed', label: 'Completed' },
  { value: 'hiatus', label: 'Hiatus' },
];

const PAGE_SIZE = 24;

/** 1 … 4 5 6 … 20 — the first, last and neighbouring pages, with gaps marked. */
const pageWindow = (page, pages) => {
  const wanted = [...new Set([1, pages, page - 1, page, page + 1])]
    .filter((p) => p >= 1 && p <= pages)
    .sort((a, b) => a - b);
  const out = [];
  wanted.forEach((p, i) => {
    if (i > 0 && p - wanted[i - 1] > 1) out.push(`gap-${p}`);
    out.push(p);
  });
  return out;
};

const GridSkeleton = () => (
  <div className="grid grid-cols-2 gap-x-4 gap-y-8 min-[480px]:grid-cols-3 sm:gap-x-5 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" aria-hidden="true">
    {Array.from({ length: 12 }, (_, i) => (
      <div key={i}>
        <div className="skeleton aspect-[2/3]" />
        <div className="skeleton mt-3 h-4 w-4/5" />
        <div className="skeleton mt-2 h-3 w-1/2" />
      </div>
    ))}
  </div>
);

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
    const query = new URLSearchParams({ sort, page: String(page), limit: String(PAGE_SIZE) });
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

  const goToPage = (p) => {
    const next = new URLSearchParams(params);
    next.set('page', String(p));
    setParams(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const clearFilters = () => setParams(new URLSearchParams(sort !== 'latest' ? { sort } : {}));

  const hasFilters = Boolean(search || genre || status);
  const total = result?.total ?? 0;

  return (
    <PageTransition>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">Library of stories</p>
          <h1 className="mt-3 font-display text-3xl font-extrabold text-silver sm:text-4xl">
            {search ? (
              <>
                Results for <span className="text-gradient">“{search}”</span>
              </>
            ) : genre ? (
              <>
                <span className="text-gradient">{genre}</span> novels
              </>
            ) : (
              'Browse novels'
            )}
          </h1>
          <p className="mt-2 text-sm text-silver-muted" aria-live="polite">
            {loading && !result ? 'Loading…' : `${total.toLocaleString()} ${total === 1 ? 'novel' : 'novels'}`}
          </p>
        </div>
        <div className="relative">
          <label className="sr-only" htmlFor="sort-filter">Sort</label>
          <select
            id="sort-filter"
            value={sort}
            onChange={(e) => updateParam('sort', e.target.value)}
            className="h-10 cursor-pointer appearance-none rounded-full border border-line bg-night-surface/80 pl-4 pr-10 text-sm font-medium text-silver transition hover:border-crimson-soft/40 focus:border-crimson-soft/50 focus:outline-none focus:ring-2 focus:ring-crimson/25"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-silver-muted" aria-hidden="true" />
        </div>
      </header>

      <div className="panel mb-8 space-y-4 p-3 sm:p-4">
        <div className="relative">
          <div className="no-scrollbar flex gap-2 overflow-x-auto" role="group" aria-label="Genre">
            <button
              type="button"
              onClick={() => updateParam('genre', '')}
              aria-pressed={!genre}
              className={`chip ${!genre ? 'chip-active' : ''}`}
            >
              All genres
            </button>
            {genres.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => updateParam('genre', g === genre ? '' : g)}
                aria-pressed={g === genre}
                className={`chip ${g === genre ? 'chip-active' : ''}`}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-night-surface to-transparent" aria-hidden="true" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 sm:pt-4">
          <div className="segmented no-scrollbar max-w-full overflow-x-auto" role="group" aria-label="Status">
            {STATUSES.map((s) => (
              <button
                key={s.value || 'any'}
                type="button"
                onClick={() => updateParam('status', s.value)}
                aria-pressed={status === s.value}
                className={`segment ${status === s.value ? 'segment-active' : ''}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {hasFilters && (
            <div className="flex flex-wrap items-center gap-2">
              {search && (
                <button type="button" onClick={() => updateParam('search', '')} className="chip h-8 px-3 text-xs">
                  “{search}” <X className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="sr-only">Clear search</span>
                </button>
              )}
              <button type="button" onClick={clearFilters} className="btn btn-ghost btn-sm">
                Clear all
              </button>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <GridSkeleton />
      ) : result.novels.length === 0 ? (
        <div className="panel flex flex-col items-center px-6 py-16 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-crimson/15 text-crimson-soft">
            <SearchX className="h-7 w-7" aria-hidden="true" />
          </span>
          <p className="mt-4 font-display text-lg font-bold text-silver">No novels found</p>
          <p className="mt-1 text-sm text-silver-muted">Try a different search, or loosen the filters.</p>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="btn btn-secondary btn-md mt-6">
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 min-[480px]:grid-cols-3 sm:gap-x-5 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {result.novels.map((novel, index) => (
              <NovelCard key={novel._id} novel={novel} index={index} />
            ))}
          </div>
          {result.pages > 1 && (
            <nav className="mt-12 flex items-center justify-center gap-1.5 sm:gap-2" aria-label="Pagination">
              <button
                type="button"
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1}
                className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-line text-silver-muted transition-colors hover:border-crimson-soft/40 hover:text-silver disabled:cursor-not-allowed disabled:opacity-30"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              {pageWindow(page, result.pages).map((p) =>
                typeof p === 'string' ? (
                  <span key={p} className="px-1 text-silver-muted" aria-hidden="true">…</span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    onClick={() => goToPage(p)}
                    aria-current={p === page ? 'page' : undefined}
                    className={`h-10 min-w-10 cursor-pointer rounded-full px-3 text-sm font-semibold transition-colors ${
                      p === page
                        ? 'bg-gradient-to-r from-crimson to-crimson-alt text-white shadow-glow'
                        : 'border border-line text-silver-muted hover:border-crimson-soft/40 hover:text-silver'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
              <button
                type="button"
                onClick={() => goToPage(page + 1)}
                disabled={page >= result.pages}
                className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-line text-silver-muted transition-colors hover:border-crimson-soft/40 hover:text-silver disabled:cursor-not-allowed disabled:opacity-30"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </nav>
          )}
        </>
      )}
    </PageTransition>
  );
};

export default Browse;
