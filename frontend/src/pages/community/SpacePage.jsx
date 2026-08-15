import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Plus, Users, Lock, ShieldAlert, Archive } from 'lucide-react';
import * as api from '../../api/spaces';
import { useAuth } from '../../context/AuthContext';
import { useCommunity } from '../../context/CommunityContext';
import PostCard from '../../components/community/PostCard';
import SortBar from '../../components/community/SortBar';
import FeedSkeleton from '../../components/community/FeedSkeleton';

// One space.
//
// The accent colour is applied by overriding --color-primary on THIS SUBTREE
// only, so a space feels distinct without leaking its branding into the rest of
// the site. The value is contrast-validated server-side at save time, so an
// owner cannot make their own space unreadable.

const StatusBanner = ({ status }) => {
  const banners = {
    quarantined: {
      icon: ShieldAlert,
      tone: 'border-orange-500/40 bg-orange-500/5 text-orange-200',
      text: 'This space has been quarantined. It is hidden from feeds and search while it is reviewed.',
    },
    archived: {
      icon: Archive,
      tone: 'border-zinc-500/40 bg-zinc-500/5 text-zinc-300',
      text: 'This space is archived. You can read it, but nothing new can be posted.',
    },
    pending: {
      icon: ShieldAlert,
      tone: 'border-amber-500/40 bg-amber-500/5 text-amber-200',
      text: 'This space is waiting for review. Only you can see it until it is approved.',
    },
  };
  const banner = banners[status];
  if (!banner) return null;
  return (
    <div role="status" className={`mb-4 flex gap-2 rounded-xl border p-3 text-sm ${banner.tone}`}>
      <banner.icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>{banner.text}</p>
    </div>
  );
};

const SpacePage = () => {
  const { slug } = useParams();
  const { user } = useAuth();
  const { sort, showNsfw, refreshJoined } = useCommunity();

  const [space, setSpace] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [posts, setPosts] = useState(null);
  const [pinned, setPinned] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [timeframe, setTimeframe] = useState('week');
  const [joining, setJoining] = useState(false);
  const sentinel = useRef(null);

  useEffect(() => {
    api.getSpace(slug).then((d) => setSpace(d.space)).catch(() => setNotFound(true));
  }, [slug]);

  useEffect(() => { setPosts(null); setCursor(null); }, [slug, sort, timeframe, showNsfw]);

  const loadPage = useCallback(async (nextCursor = null) => {
    if (loading) return;
    setLoading(true);
    try {
      const data = await api.getSpaceFeed(slug, {
        sort, t: sort === 'top' ? timeframe : undefined, cursor: nextCursor || undefined,
      });
      setPosts((prev) => (nextCursor && prev ? [...prev, ...data.posts] : data.posts));
      if (!nextCursor) setPinned(data.pinned || []);
      setCursor(data.cursor);
      setHasMore(data.hasMore);
    } catch (error) {
      setPosts((prev) => prev || []);
    } finally {
      setLoading(false);
    }
  }, [slug, sort, timeframe, loading]);

  useEffect(() => { if (posts === null) loadPage(null); }, [posts, loadPage]);

  useEffect(() => {
    if (!hasMore || !sentinel.current) return undefined;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting && !loading) loadPage(cursor); },
      { rootMargin: '400px' }
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasMore, cursor, loading, loadPage]);

  const toggleMembership = async () => {
    setJoining(true);
    try {
      if (space.viewer?.isMember) await api.leaveSpace(slug);
      else await api.joinSpace(slug);
      const fresh = await api.getSpace(slug);
      setSpace(fresh.space);
      // Keep the shared list in step, or the hub keeps showing a space you
      // just left and misses the one you just joined.
      refreshJoined();
    } finally {
      setJoining(false);
    }
  };

  if (notFound) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-silver">Not found</h1>
        <p className="mt-2 text-sm text-silver-muted">
          This space does not exist, or you do not have access to it.
        </p>
        <Link to="/community/spaces" className="mt-4 inline-block text-sm text-crimson-soft underline">
          Browse spaces
        </Link>
      </main>
    );
  }

  if (!space) return <main className="mx-auto max-w-3xl px-4 py-6"><FeedSkeleton /></main>;

  const isMember = space.viewer?.isMember;

  return (
    // Per-space accent, scoped to this subtree only.
    <main
      className="mx-auto max-w-5xl px-4 py-6"
      style={space.theme?.primary ? { '--color-primary': space.theme.primary } : undefined}
    >
      <header className="mb-5 overflow-hidden rounded-xl border border-line bg-night-surface">
        {space.bannerUrl ? (
          <img src={space.bannerUrl} alt="" className="h-28 w-full object-cover sm:h-40" />
        ) : (
          <div className="h-16 w-full bg-gradient-to-r from-crimson/25 to-transparent sm:h-24" />
        )}
        <div className="flex flex-wrap items-center gap-3 p-4">
          {space.iconUrl && (
            <img src={space.iconUrl} alt="" className="h-14 w-14 rounded-xl border border-line object-cover" />
          )}
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold text-silver">{space.name}</h1>
            <p className="text-sm text-silver-muted">
              /c/{space.slug} · {space.memberCount.toLocaleString()} member{space.memberCount === 1 ? '' : 's'}
            </p>
          </div>

          {user && space.status === 'active' && (
            <button
              type="button"
              onClick={toggleMembership}
              disabled={joining || space.viewer?.isBanned}
              aria-pressed={isMember}
              className={`ml-auto cursor-pointer rounded-full px-5 py-2 text-sm font-medium transition-colors disabled:opacity-40 ${
                isMember
                  ? 'border border-line text-silver-muted hover:border-crimson hover:text-silver'
                  : 'bg-crimson text-white'
              }`}
            >
              {space.viewer?.isBanned ? 'Banned' : isMember ? 'Joined' : 'Join'}
            </button>
          )}
        </div>
      </header>

      <StatusBanner status={space.status} />

      {space.viewer?.isBanned && (
        <div role="alert" className="mb-4 rounded-xl border border-crimson/40 bg-crimson/5 p-3 text-sm text-crimson-soft">
          You are banned from this space. You can still read it, but you cannot post, comment or vote.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <div>
          <SortBar timeframe={timeframe} onTimeframe={setTimeframe} />

          {/* Pinned posts sit OUTSIDE the cursor, so paging past them never
              shows one twice. */}
          {pinned.length > 0 && (
            <section aria-label="Pinned posts" className="mb-3 space-y-2">
              {pinned.map((post) => (
                <PostCard key={post.id} post={post} showSpace={false} />
              ))}
            </section>
          )}

          {posts === null ? (
            <FeedSkeleton />
          ) : !posts.length ? (
            <div className="rounded-xl border border-line bg-night-surface p-10 text-center">
              <p className="text-sm text-silver-muted">Nothing posted here yet.</p>
              {space.viewer?.post && (
                <Link
                  to={`/c/${slug}/submit`}
                  className="mt-4 inline-block rounded-full bg-crimson px-4 py-2 text-sm font-medium text-white"
                >
                  Write the first post
                </Link>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {posts.map((post) => (
                  <PostCard key={post.id} post={post} showSpace={false} />
                ))}
              </div>
              <div ref={sentinel} aria-hidden="true" className="h-px" />
              {hasMore && (
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    onClick={() => loadPage(cursor)}
                    disabled={loading}
                    className="cursor-pointer rounded-full border border-line px-5 py-2 text-sm text-silver-muted hover:border-crimson hover:text-silver disabled:opacity-40"
                  >
                    {loading ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <aside className="space-y-4">
          {space.viewer?.post && (
            <Link
              to={`/c/${slug}/submit`}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-crimson px-4 py-2.5 text-sm font-medium text-white"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> New post
            </Link>
          )}

          {space.description && (
            <section className="rounded-xl border border-line bg-night-surface p-4">
              <h2 className="mb-2 font-display text-sm font-bold text-silver">About</h2>
              <div
                className="text-sm text-silver-muted [&_a]:text-sky-400"
                dangerouslySetInnerHTML={{ __html: space.description }}
              />
              <p className="mt-3 flex items-center gap-1.5 text-xs text-silver-muted">
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                {space.memberCount.toLocaleString()} members · created{' '}
                {new Date(space.createdAt).toLocaleDateString()}
              </p>
            </section>
          )}

          {space.rules?.length > 0 && (
            <section className="rounded-xl border border-line bg-night-surface p-4">
              <h2 className="mb-2 font-display text-sm font-bold text-silver">Rules</h2>
              <ol className="space-y-2">
                {space.rules.map((rule, i) => (
                  <li key={rule.ruleId} className="text-sm">
                    <p className="font-medium text-silver">{i + 1}. {rule.title}</p>
                    {rule.description && (
                      <p className="mt-0.5 text-xs text-silver-muted">{rule.description}</p>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {space.publicModlog && (
            <Link
              to={`/c/${slug}/modlog`}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-night-surface p-3 text-sm text-silver-muted hover:text-silver"
            >
              <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Public moderation log
            </Link>
          )}
        </aside>
      </div>
    </main>
  );
};

export default SpacePage;
