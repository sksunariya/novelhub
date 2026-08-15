import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Calendar, TrendingUp, MessageSquare, FileText } from 'lucide-react';
import * as api from '../../api/spaces';
import PostCard from '../../components/community/PostCard';
import Spinner from '../../components/Spinner';

// A community profile.
//
// Karma visibility is a setting, not a decision baked in here — public karma
// drives engagement and also drives farming, so the server decides and sends
// null when it is off.

const TABS = ['Posts', 'Comments'];

const UserProfile = () => {
  const { username } = useParams();
  const [profile, setProfile] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState('Posts');
  const [posts, setPosts] = useState(null);
  const [comments, setComments] = useState(null);

  useEffect(() => {
    setProfile(null);
    setNotFound(false);
    api.getProfile(username).then((d) => setProfile(d.profile)).catch(() => setNotFound(true));
  }, [username]);

  const loadTab = useCallback(() => {
    if (tab === 'Posts' && posts === null) {
      api.getUserPosts(username).then((d) => setPosts(d.posts)).catch(() => setPosts([]));
    }
    if (tab === 'Comments' && comments === null) {
      api.getUserComments(username).then((d) => setComments(d.comments)).catch(() => setComments([]));
    }
  }, [tab, username, posts, comments]);

  useEffect(() => { loadTab(); }, [loadTab]);
  useEffect(() => { setPosts(null); setComments(null); }, [username]);

  if (notFound) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-silver">No such person</h1>
      </main>
    );
  }

  if (!profile) return <Spinner full />;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-center gap-4 rounded-xl border border-line bg-night-surface p-4">
        {profile.avatarUrl ? (
          <img src={profile.avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-night-raised font-display text-xl font-bold text-crimson-soft">
            {profile.username.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="font-display text-2xl font-bold text-silver">{profile.username}</h1>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-silver-muted">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" aria-hidden="true" />
              joined {new Date(profile.createdAt).toLocaleDateString()}
            </span>
            {profile.karma && (
              <span className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3" aria-hidden="true" />
                {profile.karma.total.toLocaleString()} karma
              </span>
            )}
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" aria-hidden="true" /> {profile.postCount}
            </span>
            <span className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3" aria-hidden="true" /> {profile.commentCount}
            </span>
          </div>
        </div>
      </header>

      {/* Only ever rendered for the person themselves — the server omits the
          field for anyone else. */}
      {profile.suspendedUntil && (
        <div role="status" className="mb-4 rounded-xl border border-crimson/40 bg-crimson/5 p-3 text-sm text-crimson-soft">
          Your spaces access is suspended until{' '}
          {new Date(profile.suspendedUntil).toLocaleDateString()}.{' '}
          <Link to="/community/appeals" className="underline">See why, or appeal</Link>.
        </div>
      )}

      {profile.spaces?.length > 0 && (
        <section aria-label="Spaces" className="mb-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-silver-muted">
            Active in
          </h2>
          <ul className="flex flex-wrap gap-2">
            {profile.spaces.map((space) => (
              <li key={space.slug}>
                <Link
                  to={`/c/${space.slug}`}
                  className="flex items-center gap-1.5 rounded-full border border-line bg-night-surface px-3 py-1.5 text-xs text-silver-muted transition-colors hover:border-crimson hover:text-silver"
                >
                  {space.iconUrl && <img src={space.iconUrl} alt="" className="h-4 w-4 rounded" />}
                  /c/{space.slug}
                  {space.role !== 'member' && (
                    <span className="text-[10px] text-crimson-soft">{space.role}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-4 flex gap-2 border-b border-line">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            aria-current={tab === name ? 'page' : undefined}
            className={`cursor-pointer border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === name ? 'border-crimson text-silver' : 'border-transparent text-silver-muted hover:text-silver'
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === 'Posts' && (
        posts === null ? <Spinner /> : !posts.length ? (
          <p className="rounded-xl border border-line bg-night-surface p-8 text-center text-sm text-silver-muted">
            No posts yet.
          </p>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => <PostCard key={post.id} post={post} />)}
          </div>
        )
      )}

      {tab === 'Comments' && (
        comments === null ? <Spinner /> : !comments.length ? (
          <p className="rounded-xl border border-line bg-night-surface p-8 text-center text-sm text-silver-muted">
            No comments yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {comments.map((comment) => (
              <li key={comment.id} className="rounded-xl border border-line bg-night-surface p-3">
                {/* Context first — a comment read outside its thread is
                    meaningless without knowing what it replied to. */}
                {comment.post && comment.space && (
                  <p className="mb-1 text-xs text-silver-muted">
                    on{' '}
                    <Link
                      to={`/c/${comment.space.slug}/p/${comment.post.id}/${comment.post.titleSlug || ''}`}
                      className="text-silver hover:text-crimson-soft"
                    >
                      {comment.post.title}
                    </Link>
                    {' in '}
                    <Link to={`/c/${comment.space.slug}`} className="hover:text-silver">
                      /c/{comment.space.slug}
                    </Link>
                  </p>
                )}
                <div
                  className="text-sm text-silver [&_a]:text-sky-400"
                  dangerouslySetInnerHTML={{ __html: comment.body }}
                />
                <p className="mt-1 text-xs text-silver-muted">
                  {comment.score} point{comment.score === 1 ? '' : 's'} ·{' '}
                  {new Date(comment.createdAt).toLocaleDateString()}
                </p>
              </li>
            ))}
          </ul>
        )
      )}
    </main>
  );
};

export default UserProfile;
