import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Plus, Compass } from 'lucide-react';
import * as api from '../../api/spaces';
import { useAuth } from '../../context/AuthContext';
import { useCommunity } from '../../context/CommunityContext';
import PostCard from '../../components/community/PostCard';
import SortBar from '../../components/community/SortBar';
import FeedSkeleton from '../../components/community/FeedSkeleton';

// The feed hub: Home, Popular, All.
//
// Pagination is cursor-based, matching the server. Pages accumulate rather than
// replacing, and the cursor is the only thing that advances — which is why
// posts arriving between requests never cause a duplicate or a skip.
//
// INFINITE SCROLL HAS AN ACCESSIBLE ALTERNATIVE. The IntersectionObserver loads
// the next page for people scrolling, and a real "Load more" button does the
// same thing for everyone else. Without the button, a keyboard or screen-reader
// user simply cannot reach page two.

const TABS = [
  { key: 'home', label: 'Home', authOnly: true },
  { key: 'popular', label: 'Popular' },
  { key: 'all', label: 'All' },
];

const CommunityHub = () => {
  const { type } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { enabled, publicBrowsing, sort, showNsfw, defaultFeed, joined } = useCommunity();

  const active = type || defaultFeed;
  const [posts, setPosts] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [timeframe, setTimeframe] = useState('week');
  const sentinel = useRef(null);

  // A sort or tab change is a new list, not more of the old one.
  const reset = useCallback(() => {
    setPosts(null);
    setCursor(null);
    setHasMore(false);
  }, []);

  useEffect(() => { reset(); }, [active, sort, timeframe, showNsfw, reset]);

  const loadPage = useCallback(async (nextCursor = null) => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getFeed(active, {
        sort,
        t: sort === 'top' ? timeframe : undefined,
        cursor: nextCursor || undefined,
        nsfw: showNsfw ? 'true' : undefined,
      });
      setPosts((prev) => (nextCursor && prev ? [...prev, ...data.posts] : data.posts));
      setCursor(data.cursor);
      setHasMore(data.hasMore);
    } catch (err) {
      if (err?.response?.status === 401) setError('signin');
      else if (err?.response?.status === 404) setError('unavailable');
      else setError('generic');
      setPosts((prev) => prev || []);
    } finally {
      setLoading(false);
    }
  }, [active, sort, timeframe, showNsfw, loading]);

  useEffect(() => {
    if (posts === null) loadPage(null);
  }, [posts, loadPage]);

  // Auto-load for people who scroll. The button below does the same thing for
  // everyone else — this is an enhancement, not the only way through.
  useEffect(() => {
    if (!hasMore || !sentinel.current) return undefined;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting && !loading) loadPage(cursor); },
      { rootMargin: '400px' }
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasMore, cursor, loading, loadPage]);

  if (!enabled) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-silver">Not available yet</h1>
        <p className="mt-2 text-sm text-silver-muted">The community is not open at the moment.</p>
      </main>
    );
  }

  if (!user && !publicBrowsing) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-silver">Sign in to browse</h1>
        <Link to="/login" className="mt-4 inline-block rounded-full bg-crimson px-5 py-2 text-sm font-medium text-white">
          Sign in
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="sr-only">Community</h1>
        <nav aria-label="Feeds" className="flex gap-1">
          {TABS.filter((tab) => !tab.authOnly || user).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => navigate(`/community/${tab.key}`)}
              aria-current={active === tab.key ? 'page' : undefined}
              className={`cursor-pointer rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                active === tab.key ? 'bg-crimson text-white' : 'text-silver-muted hover:bg-night-raised hover:text-silver'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex gap-2">
          <Link
            to="/community/spaces"
            className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm text-silver-muted transition-colors hover:text-silver"
          >
            <Compass className="h-4 w-4" aria-hidden="true" /> Browse
          </Link>
          {user && (
            <Link
              to="/community/submit"
              className="flex items-center gap-1.5 rounded-full bg-crimson px-3 py-1.5 text-sm font-medium text-white"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Post
            </Link>
          )}
        </div>
      </div>

      {/* Your spaces. `joined` was populated by nobody until now, so this
          strip could not have existed. */}
      {user && joined?.length > 0 && (
        <nav aria-label="Your spaces" className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {joined.map((space) => (
            <Link
              key={space.id || space._id}
              to={`/c/${space.slug}`}
              className="shrink-0 rounded-full border border-line bg-night-surface px-3 py-1 text-xs text-silver-muted transition-colors hover:border-crimson hover:text-silver"
            >
              c/{space.slug}
            </Link>
          ))}
        </nav>
      )}

      <SortBar timeframe={timeframe} onTimeframe={setTimeframe} />

      {posts === null ? (
        <FeedSkeleton />
      ) : error === 'signin' ? (
        <p className="rounded-xl border border-line bg-night-surface p-8 text-center text-sm text-silver-muted">
          <Link to="/login" className="text-crimson-soft underline">Sign in</Link> to see this feed.
        </p>
      ) : !posts.length ? (
        <div className="rounded-xl border border-line bg-night-surface p-10 text-center">
          <p className="text-sm text-silver-muted">
            {active === 'home'
              ? 'Your feed is empty. Join a few spaces and posts will show up here.'
              : 'Nothing here yet.'}
          </p>
          <Link
            to="/community/spaces"
            className="mt-4 inline-block rounded-full border border-line px-4 py-2 text-sm text-silver transition-colors hover:border-crimson"
          >
            Find spaces to join
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>

          <div ref={sentinel} aria-hidden="true" className="h-px" />

          {hasMore && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => loadPage(cursor)}
                disabled={loading}
                className="cursor-pointer rounded-full border border-line px-5 py-2 text-sm text-silver-muted transition-colors hover:border-crimson hover:text-silver disabled:opacity-40"
              >
                {loading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}

          {!hasMore && posts.length > 0 && (
            <p className="mt-6 text-center text-xs text-silver-muted">That&rsquo;s everything.</p>
          )}
        </>
      )}
    </main>
  );
};

export default CommunityHub;
