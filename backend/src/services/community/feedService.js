// Feed composition.
//
// THE ONE RULE: a feed page is a bounded index scan. No aggregation, no
// $lookup, no skip. Everything below exists to keep that true.
//
//   - Sorting is on a persisted, indexed field (hotScore, createdAt, score).
//   - Pagination is keyset, not offset. `skip(n)` is O(n) and is also incorrect
//     on a live feed — new posts arriving between requests make it show
//     duplicates and miss items.
//   - Author and space data are hydrated with two batched find({_id: {$in}})
//     calls on lean projections. `populate` per row is an N+1.
//   - Viewer vote state is one query for the whole page.
//
// Read preference is annotated at every call site. Feeds tolerate seconds of
// staleness; vote state does not. Because that judgement is recorded here now,
// adding read replicas later is a configuration change rather than a survey of
// every query in the codebase.

const Post = require('../../models/Post');
const Space = require('../../models/Space');
const SpaceMember = require('../../models/SpaceMember');
const User = require('../../models/User');
const voteService = require('./voteService');
const cacheService = require('../cacheService');
const ranking = require('./rankingService');
const {
  POST_STATUS,
  POST_SORTS,
  TOP_TIMEFRAMES,
  SPACE_STATUS,
  SPACE_VISIBILITY,
  SPACE_MEMBER_STATUS,
  VOTE_TARGET_TYPES,
  PUBLIC_USER_FIELDS,
} = require('../../config/constants');

// Which stored field each sort reads, and therefore which index it uses.
const SORT_FIELD = {
  [POST_SORTS.HOT]: 'hotScore',
  [POST_SORTS.NEW]: 'createdAt',
  [POST_SORTS.TOP]: 'score',
  [POST_SORTS.CONTROVERSIAL]: 'controversyScore',
  [POST_SORTS.RISING]: 'createdAt', // filtered by window, re-sorted in memory
};

const TIMEFRAME_MS = {
  [TOP_TIMEFRAMES.HOUR]: 3600_000,
  [TOP_TIMEFRAMES.DAY]: 86400_000,
  [TOP_TIMEFRAMES.WEEK]: 604800_000,
  [TOP_TIMEFRAMES.MONTH]: 2592000_000,
  [TOP_TIMEFRAMES.YEAR]: 31536000_000,
};

/**
 * Cursors are opaque base64 of { v, id }.
 *
 * Opaque so the shape can change without breaking clients, and validated on the
 * way back in because it arrives from the URL. A malformed cursor returns the
 * first page rather than an error — a stale bookmark should not be a 400.
 */
const encodeCursor = (value, id) =>
  Buffer.from(JSON.stringify({ v: value, id: String(id) })).toString('base64url');

const decodeCursor = (cursor) => {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed.v === undefined || !parsed.id) return null;
    return parsed;
  } catch (error) {
    return null;
  }
};

/**
 * The keyset clause.
 *
 * `{ field: { $lt: v } }` alone loses every row that ties on the sort value.
 * The $or with the _id tiebreak is what makes the page boundary exact — and it
 * matches the compound index, so it is still a single range scan.
 */
const cursorClause = (field, cursor) => {
  if (!cursor) return {};
  const value = field === 'createdAt' ? new Date(cursor.v) : cursor.v;
  return {
    $or: [{ [field]: { $lt: value } }, { [field]: value, _id: { $lt: cursor.id } }],
  };
};

/**
 * Which spaces feed this user's home.
 *
 * Bounded by spaces.scale.homeFeedMaxSpaces. A $in of several hundred space ids
 * stops being one index scan and becomes many scans merged, so past the cap the
 * most recently active spaces win — the ones the user actually reads.
 */
const homeSpaceIds = async (user, settings) => {
  if (!user) return [];
  const cap = settings.get('spaces.scale.homeFeedMaxSpaces');
  const rows = await SpaceMember.find(
    { user: user._id, status: SPACE_MEMBER_STATUS.ACTIVE },
    { space: 1, _id: 0 }
  )
    .sort({ lastSeenAt: -1, joinedAt: -1 })
    .limit(cap)
    .lean()
    .read('secondaryPreferred');
  return rows.map((row) => row.space);
};

/** Public, listable spaces. Cached — identical for every anonymous visitor. */
const discoverableSpaceIds = async (settings, { minMembers = 0 } = {}) => {
  const ttl = settings.get('spaces.feed.cacheSeconds');
  const key = `feed:spaceset:${minMembers}`;
  const produce = async () => {
    const rows = await Space.find(
      {
        status: SPACE_STATUS.ACTIVE,
        visibility: SPACE_VISIBILITY.PUBLIC,
        excludeFromAll: { $ne: true },
        ...(minMembers > 0 ? { memberCount: { $gte: minMembers } } : {}),
      },
      { _id: 1 }
    )
      .lean()
      .read('secondaryPreferred');
    return rows.map((row) => row._id);
  };
  return ttl > 0 ? cacheService.wrap(key, ttl, produce) : produce();
};

/**
 * Hydrate a page of lean post documents.
 *
 * Two batched queries plus one vote lookup, regardless of page size. That
 * constant is asserted by a test — the day it starts scaling with the page, an
 * N+1 has been introduced.
 */
const hydrate = async (posts, viewer) => {
  if (!posts.length) return [];

  const authorIds = [...new Set(posts.map((p) => String(p.author)))];
  const spaceIds = [...new Set(posts.map((p) => String(p.space)))];
  const postIds = posts.map((p) => p._id);

  const [authors, spaces, votes] = await Promise.all([
    User.find({ _id: { $in: authorIds } }, PUBLIC_USER_FIELDS.split(' ').join(' '))
      .lean()
      .read('secondaryPreferred'),
    Space.find({ _id: { $in: spaceIds } }, { slug: 1, name: 1, iconUrl: 1, nsfw: 1, theme: 1 })
      .lean()
      .read('secondaryPreferred'),
    // Always primary. A vote that visually bounces back because it was read
    // from a stale secondary is the most-reported bug on every voting site.
    voteService.forTargets(viewer, VOTE_TARGET_TYPES.POST, postIds),
  ]);

  const authorById = new Map(authors.map((a) => [String(a._id), a]));
  const spaceById = new Map(spaces.map((s) => [String(s._id), s]));

  return posts.map((post) => ({
    ...post,
    author: authorById.get(String(post.author)) || null,
    space: spaceById.get(String(post.space)) || null,
    viewerVote: votes[String(post._id)] || 0,
  }));
};

/**
 * Should the score be hidden on this post?
 *
 * Enforced server-side, not just in the UI — hiding a number the response still
 * contains is not hiding it.
 */
const applyScoreVisibility = (posts, settings) => {
  const hideHours = settings.get('spaces.voting.showScoreBeforeHours');
  const hideDownvotes = settings.get('spaces.voting.hideDownvoteCount');
  if (!hideHours && !hideDownvotes) return posts;

  const cutoff = hideHours ? Date.now() - hideHours * 3600_000 : null;

  return posts.map((post) => {
    const next = { ...post };
    if (hideDownvotes) {
      delete next.downvotes;
      delete next.upvotes;
    }
    if (cutoff && new Date(post.createdAt).getTime() > cutoff) {
      next.score = null;
      next.scoreHidden = true;
      next.scoreVisibleAt = new Date(new Date(post.createdAt).getTime() + hideHours * 3600_000);
    }
    return next;
  });
};

/**
 * Fetch a page.
 *
 * @param {object} options
 * @param {string} options.type      'home' | 'popular' | 'all' | 'space' | 'user' | 'linked'
 * @param {string} options.sort
 * @param {string} options.timeframe for the top sort
 * @param {string} options.cursor
 * @param {number} options.limit
 * @param {object} options.viewer
 * @param {object} options.settings
 * @param {object} [options.space]   for a space feed
 */
const fetch = async ({
  type = 'popular',
  sort = null,
  timeframe = TOP_TIMEFRAMES.ALL,
  cursor = null,
  limit = null,
  viewer = null,
  settings,
  space = null,
  authorId = null,
  linkedRef = null,
  includeNsfw = null,
}) => {
  const pageSize = Math.min(
    limit || settings.get('spaces.feed.pageSize'),
    settings.get('spaces.feed.maxPageSize')
  );
  const sortKey = SORT_FIELD[sort] ? sort : settings.get('spaces.ranking.defaultSort');
  const field = SORT_FIELD[sortKey];

  const filter = { status: POST_STATUS.PUBLISHED };

  // --- source set ---------------------------------------------------------
  if (type === 'space' && space) {
    filter.space = space._id;
  } else if (type === 'user' && authorId) {
    filter.author = authorId;
  } else if (type === 'linked' && linkedRef) {
    filter['linkedRefs.type'] = linkedRef.type;
    filter['linkedRefs.id'] = linkedRef.id;
  } else if (type === 'home') {
    const ids = await homeSpaceIds(viewer, settings);
    // A home feed built from one or two spaces is worse than Popular.
    if (ids.length < settings.get('spaces.feed.homeMinSpaces')) {
      return fetch({
        type: 'popular', sort, timeframe, cursor, limit, viewer, settings, includeNsfw,
      });
    }
    filter.space = { $in: ids };
  } else if (type === 'popular') {
    filter.space = {
      $in: await discoverableSpaceIds(settings, {
        minMembers: settings.get('spaces.feed.popularMinMembers'),
      }),
    };
  } else {
    filter.space = { $in: await discoverableSpaceIds(settings) };
  }

  // --- filters ------------------------------------------------------------
  const showNsfw = includeNsfw === null ? settings.get('spaces.feed.showNsfwByDefault') : includeNsfw;
  if (!showNsfw) filter.nsfw = { $ne: true };

  if (sortKey === POST_SORTS.TOP && TIMEFRAME_MS[timeframe]) {
    filter.createdAt = { $gte: new Date(Date.now() - TIMEFRAME_MS[timeframe]) };
  }

  if (sortKey === POST_SORTS.RISING) {
    const windowHours = settings.get('spaces.ranking.risingWindowHours');
    filter.createdAt = { $gte: new Date(Date.now() - windowHours * 3600_000) };
    filter.score = { $gte: settings.get('spaces.ranking.risingMinScore') };
  }

  const parsedCursor = decodeCursor(cursor);
  Object.assign(filter, cursorClause(field, parsedCursor));

  // --- the query ----------------------------------------------------------
  // One index scan. limit + 1 detects "there is more" without a count, which on
  // a large collection is far more expensive than the page itself.
  const rows = await Post.find(filter)
    .sort({ [field]: -1, _id: -1 })
    .limit(pageSize + 1)
    .lean()
    .read(settings.get('spaces.scale.readPreference'));

  const hasMore = rows.length > pageSize;
  let page = hasMore ? rows.slice(0, pageSize) : rows;

  // Rising re-sorts in memory. The candidate set is bounded by the window, so
  // it is small by construction — this is not a full-collection sort.
  if (sortKey === POST_SORTS.RISING) {
    page = page
      .map((post) => ({ ...post, _rising: ranking.risingScore(post.score, post.createdAt) }))
      .sort((a, b) => b._rising - a._rising);
  }

  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last[field], last._id) : null;

  const hydrated = await hydrate(page, viewer);

  return {
    posts: applyScoreVisibility(hydrated, settings),
    cursor: nextCursor,
    hasMore,
    sort: sortKey,
  };
};

/**
 * Pinned posts for a space.
 *
 * Fetched separately and prepended OUTSIDE the cursor — a pinned post must
 * appear on page one and must not consume a slot in the paginated set, or
 * paging past it would show it twice.
 */
const pinnedFor = async (space, settings, viewer) => {
  const slots = settings.get('spaces.ranking.pinnedSlots');
  if (!slots) return [];
  const rows = await Post.find({
    space: space._id,
    status: POST_STATUS.PUBLISHED,
    pinnedInSpace: true,
  })
    .sort({ hotScore: -1 })
    .limit(slots)
    .lean()
    .read(settings.get('spaces.scale.readPreference'));
  return hydrate(rows, viewer);
};

module.exports = {
  fetch,
  pinnedFor,
  hydrate,
  homeSpaceIds,
  discoverableSpaceIds,
  encodeCursor,
  decodeCursor,
  cursorClause,
  applyScoreVisibility,
  SORT_FIELD,
  TIMEFRAME_MS,
};
