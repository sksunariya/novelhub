import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { useSettings } from './SettingsContext';
import * as api from '../api/spaces';

// Community state.
//
// No store library — this follows the AuthContext / SettingsContext /
// MonetizationContext pattern already in the app.
//
// THE OPTIMISTIC VOTE LAYER is the interesting part. A vote must feel
// instantaneous, but the server is the authority, so votes live in a local
// delta map that is merged over server data at render time. On failure the
// delta is rolled back AND the reason is surfaced — a vote that silently
// reverts is worse than one that never appeared.

const CommunityContext = createContext(null);

const PREF_KEY = 'novelhub_community_prefs';

const loadPrefs = () => {
  try {
    return JSON.parse(window.localStorage.getItem(PREF_KEY)) || {};
  } catch (error) {
    return {};
  }
};

export const CommunityProvider = ({ children }) => {
  const { user } = useAuth();
  const { settings } = useSettings();

  // postId -> { value, score } pending or applied locally.
  const [voteDeltas, setVoteDeltas] = useState({});
  const [voteError, setVoteError] = useState(null);
  const [joined, setJoined] = useState(null);

  // Lazy initialisers. Called bare, loadPrefs() ran a localStorage read and a
  // JSON.parse on EVERY render of a provider that sits above the whole
  // community tree, to produce a value only the first render can use.
  const [density, setDensityState] = useState(() => loadPrefs().density || 'card');
  const [sort, setSortState] = useState(() => loadPrefs().sort || null);
  const [showNsfw, setShowNsfwState] = useState(() => Boolean(loadPrefs().showNsfw));

  const persist = useCallback((patch) => {
    try {
      window.localStorage.setItem(PREF_KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
    } catch (error) {
      // A full or disabled localStorage must not break the feed.
    }
  }, []);

  const setDensity = useCallback((value) => { setDensityState(value); persist({ density: value }); }, [persist]);
  const setSort = useCallback((value) => { setSortState(value); persist({ sort: value }); }, [persist]);
  const setShowNsfw = useCallback((value) => { setShowNsfwState(value); persist({ showNsfw: value }); }, [persist]);

  // Signing out must clear another person's votes and memberships from view.
  useEffect(() => {
    if (!user) {
      setVoteDeltas({});
      setJoined(null);
    }
  }, [user]);

  /**
   * Cast a vote optimistically.
   *
   * Clicking the same arrow twice removes the vote, which is what every voting
   * UI does and what the server already treats as idempotent.
   */
  // targetType decides WHICH endpoint. Previously this always called
  // votePost, so every comment vote POSTed to /posts/<commentId>/vote and
  // 404'd — the optimistic delta applied, the request failed, and the vote
  // silently rolled back. Comments have their own collection and their own
  // route; the id alone does not say which one it belongs to.
  const vote = useCallback(async (postId, next, currentValue, currentScore, targetType = 'post') => {
    if (!user) {
      setVoteError('Sign in to vote');
      return;
    }
    const value = currentValue === next ? 0 : next;
    const delta = value - currentValue;

    setVoteError(null);
    setVoteDeltas((prev) => ({
      ...prev,
      [postId]: { value, score: (currentScore ?? 0) + delta },
    }));

    try {
      const result = await (targetType === 'comment'
        ? api.voteComment(postId, value)
        : api.votePost(postId, value));

      // RECONCILE, do not just leave the guess in place. The optimistic score
      // is `whatever we last saw + our own delta`, which is wrong the moment
      // anyone else votes in between. The endpoint returns the authoritative
      // total, so the delta is corrected to it — otherwise the stale local
      // number keeps overriding fresh server data for the rest of the session.
      if (result && typeof result.score === 'number') {
        setVoteDeltas((prev) => (
          prev[postId] ? { ...prev, [postId]: { value: result.value ?? value, score: result.score } } : prev
        ));
      }
    } catch (error) {
      // Roll back, and say why. A vote that quietly reverts reads as a bug.
      setVoteDeltas((prev) => {
        const next$ = { ...prev };
        delete next$[postId];
        return next$;
      });
      setVoteError(error?.response?.data?.message || 'That vote could not be saved');
    }
  }, [user]);

  /** Merge the local delta over whatever the server last said. */
  const viewOf = useCallback((post) => {
    const delta = voteDeltas[post.id || post._id];
    if (!delta) return { value: post.viewerVote || 0, score: post.score };
    return { value: delta.value, score: delta.score };
  }, [voteDeltas]);

  const refreshJoined = useCallback(async () => {
    if (!user) { setJoined(null); return; }
    try {
      const data = await api.listSpaces({ joined: true, limit: 100 });
      setJoined(data.spaces || []);
    } catch (error) {
      setJoined([]);
    }
  }, [user]);

  // NOTHING CALLED THIS. `refreshJoined` and `joined` were both built and then
  // wired to nothing, so `joined` sat at null for the entire session and no
  // part of the UI could show which spaces you belong to. Loading it once the
  // user is known — and only when the community is switched on, so a disabled
  // feature does not fire a request on every page of the site.
  const communityOn = Boolean(settings?.['spaces.enabled']);
  useEffect(() => {
    if (user && communityOn) refreshJoined();
  }, [user, communityOn, refreshJoined]);

  const value = useMemo(() => ({
    // Reads the public settings projection, so the community can be switched
    // off without shipping frontend code.
    enabled: Boolean(settings?.['spaces.enabled']),
    publicBrowsing: settings?.['spaces.publicBrowsing'] !== false,
    terminology: settings?.['spaces.core.terminology'] || 'space',
    defaultSort: settings?.['spaces.ranking.defaultSort'] || 'hot',
    defaultFeed: settings?.['spaces.defaultLandingFeed'] || 'popular',
    votingEnabled: settings?.['spaces.voting.enabled'] !== false,
    allowDownvotes: settings?.['spaces.voting.allowDownvotes'] !== false,

    density, setDensity,
    sort: sort || settings?.['spaces.ranking.defaultSort'] || 'hot', setSort,
    showNsfw, setShowNsfw,

    vote, viewOf, voteError, clearVoteError: () => setVoteError(null),
    joined, refreshJoined,
  }), [settings, density, setDensity, sort, setSort, showNsfw, setShowNsfw,
       vote, viewOf, voteError, joined, refreshJoined]);

  return (
    <CommunityContext.Provider value={value}>
      {children}

      {/* THE VOTE ERROR LIVES HERE, not in a page.
          It used to be rendered by CommunityHub alone, so a rejected vote on a
          post page or a space page rolled back in total silence — the exact
          failure this context's header comment says it exists to prevent.
          Rendering it from the provider means every current and future consumer
          is covered by construction rather than by remembering. */}
      {voteError && (
        <div
          role="alert"
          className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit max-w-[90vw] items-center gap-3 rounded-lg border border-amber-500/40 bg-night-raised px-4 py-2 text-sm text-amber-200 shadow-card"
        >
          {voteError}
          <button
            type="button"
            onClick={() => setVoteError(null)}
            className="cursor-pointer text-xs underline hover:text-amber-100"
          >
            Dismiss
          </button>
        </div>
      )}
    </CommunityContext.Provider>
  );
};

export const useCommunity = () => {
  const context = useContext(CommunityContext);
  if (!context) throw new Error('useCommunity must be used inside a CommunityProvider');
  return context;
};

export default CommunityContext;
