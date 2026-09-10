// Homepage composition.
//
// Turns a list of SpotlightRail documents into the payload the homepage
// renders. Everything hard about this file is one of four things:
//
//   1. NO N+1. A rail holding a novel, two spaces and three posts is three
//      queries, not six — items are grouped by type and each type loads its
//      whole batch at once. The same rule feedService is built around, for the
//      same reason: this is the most-requested page on the site.
//
//   2. WHAT IS PINNED IS NOT WHAT IS PUBLISHABLE. An admin pins a space on
//      Monday; on Thursday it is quarantined. Nothing rewrites the rail, so the
//      rail still points at it. Every hydrated item is re-checked through its
//      type's `isPublishable` before it can reach the response — see
//      config/spotlightTypes.js. Validating only at pin time would leave banned
//      content on the front page until a human noticed.
//
//   3. VIEWER STATE IS NOT CACHEABLE. Rail CONTENT is identical for everyone,
//      so it is cached per rail. Vote state and poll responses are per person
//      and are attached after the cache, in one batched pass over the whole
//      payload. Caching them would show one visitor another visitor's votes,
//      which is the worst bug this file could have.
//
//   4. A DEAD ITEM IS DROPPED, NOT AN ERROR. A deleted novel, a removed post, a
//      space that went private — the rail renders without it. One stale pin
//      must never 500 the homepage. This mirrors linkTypes.resolveMany.

const SpotlightRail = require('../models/SpotlightRail');
const Novel = require('../models/Novel');
const Space = require('../models/Space');
const Post = require('../models/Post');
const PollVote = require('../models/PollVote');
const SpaceMember = require('../models/SpaceMember');
const ViewEvent = require('../models/ViewEvent');
const spotlightTypes = require('../config/spotlightTypes');
const cacheService = require('./cacheService');
const feedService = require('./community/feedService');
const voteService = require('./community/voteService');
const pollService = require('./community/pollService');
const {
  SPACE_STATUS,
  SPACE_VISIBILITY,
  SPACE_MEMBER_STATUS,
  POST_STATUS,
  VOTE_TARGET_TYPES,
  VIEW_TARGET_TYPES,
} = require('../config/constants');

// ------------------------------------------------------- community gating

// Which rails draw on the community system.
const COMMUNITY_KINDS = new Set(['posts', 'spaces', 'linked_posts']);
const COMMUNITY_TYPES = new Set(['space', 'post']);

/**
 * May this rail's community content be shown to this viewer?
 *
 * THE COMMUNITY SHIPS SWITCHED OFF. `spaces.enabled` is false by default and
 * every community ROUTE 404s while it is — which is what lets the whole
 * subsystem ship to production long before launch. But this service reads the
 * models directly rather than going through those routes, so without this check
 * a community rail would put unlaunched content on the front page: the one
 * surface where it would be seen by everyone, including search engines.
 *
 * `spaces.publicBrowsing` is the second gate. When it is off the community is
 * for signed-in members, and a rail of posts shown to a logged-out visitor
 * would be a preview of something they cannot open.
 *
 * A gated rail resolves to nothing and is then dropped as empty, so it simply
 * is not on the page — no placeholder, no "sign in to see this".
 */
const communityVisible = (viewer, settings) => {
  if (!settings.get('spaces.enabled')) return false;
  if (!viewer && settings.get('spaces.publicBrowsing') === false) return false;
  return true;
};

/** Does this rail need the community to be on? */
const needsCommunity = (rail) => {
  if (rail.source === 'auto') return COMMUNITY_KINDS.has((rail.query && rail.query.kind) || 'novels');
  return (rail.items || []).some((item) => COMMUNITY_TYPES.has(item.type));
};

// --------------------------------------------------------------- audience

/**
 * Everything about the viewer that a rail can be targeted on.
 *
 * Resolved once per request. `isMember` costs one indexed count and is only
 * paid when some rail actually targets on it — on a site with no
 * membership-targeted rails this stays false without a query.
 */
const viewerContext = async (viewer, { needsMembership = false } = {}) => {
  if (!viewer) return { authed: false, isMember: false };
  if (!needsMembership) return { authed: true, isMember: false };
  const count = await SpaceMember.countDocuments({
    user: viewer._id,
    status: SPACE_MEMBER_STATUS.ACTIVE,
  }).limit(1);
  return { authed: true, isMember: count > 0 };
};

const audienceMatches = (rail, ctx) => {
  switch (rail.audience) {
    case 'anon': return !ctx.authed;
    case 'authed': return ctx.authed;
    case 'members': return ctx.authed && ctx.isMember;
    // The rail that earns this whole mechanism: "pick your first space" is the
    // most useful thing to show someone who has an account and has joined
    // nothing, and noise for everyone else.
    case 'non_members': return ctx.authed && !ctx.isMember;
    default: return true;
  }
};

// ----------------------------------------------------------- manual rails

/**
 * Hydrate an admin's pinned items.
 *
 * Grouped by type so each type is one query. Order is the admin's, not the
 * database's — the whole point of pinning is deciding what comes first, and a
 * `$in` returns whatever order the index feels like.
 */
const resolveManual = async (rail, { community = true } = {}) => {
  const items = [...(rail.items || [])]
    .filter((item) => community || !COMMUNITY_TYPES.has(item.type))
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .slice(0, rail.maxItems);
  if (!items.length) return [];

  const byType = new Map();
  for (const item of items) {
    const type = spotlightTypes.get(item.type);
    if (!type || type.standalone || !item.refId) continue;
    if (!byType.has(item.type)) byType.set(item.type, []);
    byType.get(item.type).push(item.refId);
  }

  const loaded = new Map(); // "type:id" -> document
  await Promise.all(
    [...byType.entries()].map(async ([key, ids]) => {
      const type = spotlightTypes.get(key);
      let docs = [];
      try {
        docs = await type.loadMany(ids);
      } catch (error) {
        // One broken type must not take the homepage down with it.
        console.error(`spotlight: loadMany failed for type ${key}:`, error.message);
        return;
      }
      for (const doc of docs) loaded.set(`${key}:${doc._id}`, doc);
    })
  );

  const cards = [];
  for (const item of items) {
    const type = spotlightTypes.get(item.type);
    if (!type) continue;

    if (type.standalone) {
      cards.push(toCard(type, null, item));
      continue;
    }

    const doc = loaded.get(`${item.type}:${item.refId}`);
    // Rule 2 and rule 4 together: gone, or no longer fit to show, so it is
    // simply not in the rail today. If it becomes publishable again it comes
    // back on its own, which is why the pin is left alone rather than deleted.
    if (!doc || !type.isPublishable(doc)) continue;
    cards.push(toCard(type, doc, item));
  }
  return cards;
};

/**
 * One card.
 *
 * The admin's overlay wins over the entity's own text: a pinned novel keeps its
 * real title, but a curator's badge and note are the reason it is on the front
 * page and must not be overwritten by whatever the entity happens to say.
 */
const toCard = (type, doc, item = {}) => {
  const base = doc ? type.card(doc, item) : type.card(null, item);
  return {
    type: type.key,
    id: doc ? String(doc._id) : `${type.key}:${item.order || 0}`,
    title: base.title || item.label || '',
    subtitle: base.subtitle || '',
    image: base.image || item.thumb || '',
    href: base.href || item.url || '',
    note: item.note || '',
    badge: item.badge || '',
    entity: base.entity,
  };
};

// ------------------------------------------------------------- auto rails

const NOVEL_SORTS = {
  featured: { featured: -1, updatedAt: -1 },
  trending: { weeklyViews: -1 },
  popular: { views: -1 },
  rating: { ratingAvg: -1, ratingCount: -1 },
  newest: { createdAt: -1 },
  updated: { lastChapterAt: -1 },
};

const SPACE_SORTS = {
  members: { memberCount: -1 },
  active: { activeCount7d: -1, lastPostAt: -1 },
  newest: { createdAt: -1 },
};

const autoNovels = async (rail) => {
  const q = rail.query || {};
  const filter = { published: true };
  if (q.novelStatus) filter.status = q.novelStatus;
  if (q.genre) filter.genres = q.genre;
  if (q.novelSort === 'featured') filter.featured = true;

  const docs = await Novel.find(filter)
    .select('title slug coverUrl author status ratingAvg ratingCount chapterCount synopsis published')
    .sort(NOVEL_SORTS[q.novelSort] || NOVEL_SORTS.trending)
    .limit(rail.maxItems)
    .lean()
    .read('secondaryPreferred');

  const type = spotlightTypes.get('novel');
  return docs.map((doc) => toCard(type, doc));
};

const autoSpaces = async (rail) => {
  const q = rail.query || {};
  const filter = {
    status: SPACE_STATUS.ACTIVE,
    visibility: { $ne: SPACE_VISIBILITY.PRIVATE },
    excludeFromAll: { $ne: true },
  };
  if (q.featuredOnly) filter.featured = true;
  if (q.topics && q.topics.length) filter.topics = { $in: q.topics };

  const docs = await Space.find(filter)
    .select(
      'name slug tagline descriptionText iconUrl bannerUrl memberCount postCount activeCount7d '
      + 'nsfw theme status visibility excludeFromAll verified'
    )
    .sort(SPACE_SORTS[q.spaceSort] || SPACE_SORTS.active)
    .limit(rail.maxItems)
    .lean()
    .read('secondaryPreferred');

  const type = spotlightTypes.get('space');
  return docs.map((doc) => toCard(type, doc));
};

/**
 * Community posts, through the feed.
 *
 * Deliberately NOT a fresh Post query. feedService owns the rules about which
 * spaces are visible, which scores are hidden and which indexes get used;
 * re-implementing a slice of that here is how the homepage ends up showing
 * something the feed would not.
 */
const autoPosts = async (rail, settings) => {
  const q = rail.query || {};
  const result = await feedService.fetch({
    type: 'all',
    sort: q.feedSort || 'hot',
    timeframe: q.timeframe || 'week',
    limit: rail.maxItems,
    viewer: null, // viewer state is attached later, uncached
    settings,
    spaceIds: (q.spaces || []).map(String),
    postType: q.postType || null,
    minScore: q.minScore || null,
  });

  // No isPublishable pass here, deliberately. feedService already restricted
  // the query to discoverable spaces and published posts, and its hydration
  // projects `space` down to display fields — re-running the check against a
  // projection that no longer carries `status` or `visibility` would reject
  // every row. Manual pins DO get the check, because nothing else vouches for
  // them.
  const type = spotlightTypes.get('post');
  return result.posts.map((post) => toCard(type, post));
};

/**
 * The reader-to-community bridge.
 *
 * Posts that point at a novel or chapter through `linkedRefs`. This is the rail
 * that turns a reader into a member: not a generic "we have a forum" banner,
 * but "forty people are arguing about the chapter you just read", attached to
 * the thing they already care about.
 *
 * With `followTrending` the rail is not pinned to one novel — it finds whatever
 * is trending right now and shows the discussion around that, so it stays
 * interesting on a week when nobody edits it.
 */
const autoLinkedPosts = async (rail, settings) => {
  const q = rail.query || {};
  let linkedId = q.linkedId;
  let subject = null;

  if (q.followTrending || !linkedId) {
    // The most-read novel that actually has discussion attached. Checking for
    // posts matters: a trending novel nobody has posted about produces an empty
    // rail, which is worse than showing the second-place novel that has ten.
    const candidates = await Novel.find({ published: true })
      .select('title slug coverUrl')
      .sort({ weeklyViews: -1 })
      .limit(5)
      .lean()
      .read('secondaryPreferred');

    for (const novel of candidates) {
      const has = await Post.countDocuments({
        'linkedRefs.type': 'novel',
        'linkedRefs.id': novel._id,
        status: POST_STATUS.PUBLISHED,
      }).limit(1);
      if (has) { linkedId = novel._id; subject = novel; break; }
    }
  }
  if (!linkedId) return { cards: [], subject: null };

  const result = await feedService.fetch({
    type: 'linked',
    sort: q.feedSort || 'hot',
    limit: rail.maxItems,
    viewer: null,
    settings,
    linkedRef: { type: q.linkedType || 'novel', id: linkedId },
  });

  if (!subject && (q.linkedType || 'novel') === 'novel') {
    // `published: true`, like every other read in this file. Without it, a rail
    // pinned to a novel keeps showing its title, cover and link after an editor
    // takes the novel off the site — featuring as a back door around
    // unpublishing, which is exactly what the guard exists to stop.
    subject = await Novel.findOne({ _id: linkedId, published: true })
      .select('title slug coverUrl')
      .lean();
  }

  const type = spotlightTypes.get('post');
  return {
    cards: result.posts.map((post) => toCard(type, post)),
    subject: subject
      ? { type: q.linkedType || 'novel', id: String(subject._id), title: subject.title,
          slug: subject.slug, image: subject.coverUrl || '', href: `/novel/${subject.slug}` }
      : null,
  };
};

/**
 * Structural copy: plain objects and arrays are rebuilt, everything else is
 * shared by reference.
 *
 * Deliberately not `structuredClone` or a JSON round trip. The former turns an
 * ObjectId into `{ buffer }`, the latter turns every Date into a string — and
 * `pollService` does date arithmetic on the poll it is handed. Only plain
 * containers need copying, because viewer state is only ever attached as new
 * properties on them; no leaf value is mutated anywhere in this file.
 */
const copyShape = (value) => {
  if (Array.isArray(value)) return value.map(copyShape);
  if (value === null || typeof value !== 'object') return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const copy = {};
  for (const key of Object.keys(value)) copy[key] = copyShape(value[key]);
  return copy;
};

// -------------------------------------------------------------- one rail

/**
 * A rail's content, with no viewer in it.
 *
 * Cached on the rail's own `updatedAt`, so an admin edit invalidates it without
 * anyone remembering to call invalidate() — the key for the old content is
 * simply never asked for again. The TTL still matters for `auto` rails, whose
 * answer changes without the rail changing at all.
 */
const railContent = async (rail, settings, { community = true } = {}) => {
  const ttl = settings.get('homepage.cacheSeconds');
  const key = `spotlight:rail:${rail._id}:${new Date(rail.updatedAt).getTime()}:${rail.maxItems}`;

  // Gated rails are decided before the cache, never inside it. A rail cached
  // while the community was public must not be served after it was switched
  // off, and the cache key deliberately does not vary by viewer.
  if (!community && needsCommunity(rail)) return { cards: [] };

  const produce = async () => {
    // The pulse rail's content is the aggregate, fetched once for the whole
    // page rather than per rail. Running its query would fetch cards nothing
    // renders.
    if (rail.layout === 'pulse') return { cards: [] };
    if (rail.source === 'manual') return { cards: await resolveManual(rail, { community }) };
    switch ((rail.query && rail.query.kind) || 'novels') {
      case 'posts': return { cards: await autoPosts(rail, settings) };
      case 'spaces': return { cards: await autoSpaces(rail) };
      case 'linked_posts': return autoLinkedPosts(rail, settings);
      default: return { cards: await autoNovels(rail) };
    }
  };

  // cacheService stores the object itself, not a copy, and hands the same
  // reference to every caller. attachViewerState() then writes each visitor's
  // own vote and poll answer onto these cards — so returning the cached object
  // directly writes one person's ballot into the entry everybody else reads,
  // and its `delete rawPoll` destroys the entry's only poll source so nobody
  // gets one re-serialised for the rest of the TTL. Copying on the way out is
  // what makes the "gating and viewer state live outside the cache" rule in
  // the header actually true.
  const content = ttl > 0 ? await cacheService.wrap(key, ttl, produce) : await produce();
  return copyShape(content);
};

// ------------------------------------------------------------ viewer state

/**
 * Attach per-person state to every post card in the payload, in two queries
 * total — not two per rail and certainly not two per card.
 *
 * Vote state is read from the primary. A vote that visually bounces back
 * because it was read from a stale secondary is the most-reported bug on every
 * voting site, and feedService makes the same call for the same reason.
 */
const attachViewerState = async (rails, viewer) => {
  if (!viewer) {
    // Poll tallies still need shaping for a logged-out visitor: hideResultsUntilEnd
    // must strip the numbers from the RESPONSE, not merely hide them in the UI.
    for (const rail of rails) {
      for (const card of rail.cards) {
        if (card.entity && card.entity.rawPoll) {
          card.entity.poll = pollService.serializePoll({ poll: card.entity.rawPoll }, null);
          delete card.entity.rawPoll;
        }
      }
    }
    return rails;
  }

  const postIds = [];
  for (const rail of rails) {
    for (const card of rail.cards) {
      if (card.type === 'post' && card.entity) postIds.push(card.entity.id);
    }
  }
  if (!postIds.length) return rails;

  const [votes, pollRows] = await Promise.all([
    voteService.forTargets(viewer, VOTE_TARGET_TYPES.POST, postIds),
    PollVote.find({ post: { $in: postIds }, user: viewer._id }).lean().read('primary'),
  ]);
  const pollByPost = new Map(pollRows.map((row) => [String(row.post), row]));

  for (const rail of rails) {
    for (const card of rail.cards) {
      if (card.type !== 'post' || !card.entity) continue;
      const id = String(card.entity.id);
      card.entity.viewerVote = votes[id] || 0;
      if (card.entity.rawPoll) {
        card.entity.poll = pollService.serializePoll(
          { poll: card.entity.rawPoll },
          pollByPost.get(id) || null
        );
        delete card.entity.rawPoll;
      }
    }
  }
  return rails;
};

// --------------------------------------------------------------- the pulse

/**
 * The live activity strip.
 *
 * Social proof for a first-time visitor: the difference between a catalogue and
 * a place with people in it. Every number is real — a fabricated "247 readers
 * online" is a lie that a returning visitor eventually catches.
 *
 * Cached hard, because it is identical for every viewer and nobody needs it to
 * the second. `chaptersOpen` reads ViewEvent, whose TTL index already expires
 * rows after the dedup window, so a plain count over that collection IS
 * "distinct viewers in the last half hour" without a date filter or an
 * aggregation.
 */
const pulse = async (settings, { community = true } = {}) => {
  if (!settings.get('homepage.pulseEnabled')) return null;
  const ttl = settings.get('homepage.pulseCacheSeconds');

  // Two cache keys, not one. With the community gated the strip counts only
  // reading activity, and serving that variant to someone who should see the
  // full one — or the reverse — is exactly what a single key would do.
  return cacheService.wrap(`spotlight:pulse:${community ? 'all' : 'reading'}`, ttl, async () => {
    const hourAgo = new Date(Date.now() - 3600_000);
    const dayAgo = new Date(Date.now() - 86400_000);

    const [chaptersOpen, postsToday, newestPost, novelsUpdated] = await Promise.all([
      ViewEvent.countDocuments({ targetType: VIEW_TARGET_TYPES.CHAPTER }).read('secondaryPreferred'),
      community
        ? Post.countDocuments({ status: POST_STATUS.PUBLISHED, createdAt: { $gte: dayAgo } })
          .read('secondaryPreferred')
        : 0,
      community
        ? Post.findOne({ status: POST_STATUS.PUBLISHED, createdAt: { $gte: hourAgo } })
          .select('title space createdAt')
          .populate('space', 'name slug status visibility excludeFromAll')
          .sort({ createdAt: -1 })
          .lean()
          .read('secondaryPreferred')
        : null,
      Novel.countDocuments({ published: true, lastChapterAt: { $gte: dayAgo } })
        .read('secondaryPreferred'),
    ]);

    // Same publishability rule as anywhere else — the newest post is not worth
    // naming if its space is quarantined.
    const postType = spotlightTypes.get('post');
    const latest = newestPost
      && postType.isPublishable({ ...newestPost, status: POST_STATUS.PUBLISHED })
      ? {
          title: newestPost.title,
          space: newestPost.space.name,
          href: `/c/${newestPost.space.slug}`,
          at: newestPost.createdAt,
        }
      : null;

    const total = chaptersOpen + postsToday + novelsUpdated;
    if (total < settings.get('homepage.pulseMinActivity')) return null;

    return { chaptersOpen, postsToday, novelsUpdated, latestPost: latest, generatedAt: new Date() };
  });
};

// ------------------------------------------------------------- the payload

/**
 * The whole homepage, for one viewer.
 *
 * Rails resolve in parallel; one that throws is dropped rather than taking the
 * page with it. A misconfigured rail should cost its own row and nothing else.
 */
const resolve = async ({ viewer = null, settings }) => {
  const now = new Date();
  const rails = await SpotlightRail.find({ isActive: true })
    .sort({ order: 1, createdAt: 1 })
    .lean()
    .read('secondaryPreferred');

  const scheduled = rails.filter((rail) => {
    if (rail.startAt && new Date(rail.startAt) > now) return false;
    if (rail.endAt && new Date(rail.endAt) < now) return false;
    return true;
  });

  const needsMembership = scheduled.some(
    (rail) => rail.audience === 'members' || rail.audience === 'non_members'
  );
  const ctx = await viewerContext(viewer, { needsMembership });
  const visible = scheduled
    .filter((rail) => audienceMatches(rail, ctx))
    .slice(0, settings.get('homepage.maxRails'));

  const community = communityVisible(viewer, settings);

  const resolved = await Promise.all(
    visible.map(async (rail) => {
      try {
        const content = await railContent(rail, settings, { community });
        return {
          key: rail.key,
          title: rail.title,
          subtitle: rail.subtitle,
          icon: rail.icon,
          accent: rail.accent,
          layout: rail.layout,
          viewAllUrl: rail.viewAllUrl,
          viewAllLabel: rail.viewAllLabel,
          subject: content.subject || null,
          cards: content.cards || [],
        };
      } catch (error) {
        // A stale pin or a bad query costs its own row — that is the point of
        // this catch. A misconfigured settings key is not per-rail: it fails
        // every rail identically, and swallowing it renders the front page as
        // an empty 200 that no uptime check notices. That is how
        // `platform.homepage.maxRails` reached production. Let it out.
        if (error.code === 'UNKNOWN_SETTING') throw error;
        console.error(`spotlight: rail "${rail.key}" failed to resolve:`, error.message);
        return null;
      }
    })
  );

  // An empty rail renders as a title over nothing, which looks broken. The
  // exception is `pulse`, which carries no cards by design, and `banner`, whose
  // content is the rail itself.
  const populated = resolved.filter(
    (rail) => rail && (rail.cards.length > 0 || rail.layout === 'pulse' || rail.layout === 'banner')
  );

  await attachViewerState(populated, viewer);

  return { rails: populated, pulse: await pulse(settings, { community }) };
};

module.exports = {
  resolve,
  pulse,
  railContent,
  resolveManual,
  audienceMatches,
  communityVisible,
  needsCommunity,
  viewerContext,
  attachViewerState,
  toCard,
  NOVEL_SORTS,
  SPACE_SORTS,
};
