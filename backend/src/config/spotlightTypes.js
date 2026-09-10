// Featurable entity registry.
//
// The homepage is curated: an admin pins things to it. "Things" must not be a
// hardcoded list, or every new featurable entity means a schema change, a new
// admin screen and a new branch in the renderer.
//
// This is deliberately the same shape as config/linkTypes.js, for the same
// reason. Each entry declares how to SEARCH for its entity (backing the admin
// picker), how to LOAD a batch of them (backing the public payload), and how to
// turn one into a CARD. Adding a featurable entity later — an author page, an
// event, a bundle — is one entry here. No schema change, no migration.
//
// THREE RULES that are easy to get wrong:
//
//   1. `loadMany` takes an array of ids and issues ONE query. A per-item load
//      is an N+1 on the busiest page of the site. The resolver groups pinned
//      items by type precisely so this can hold — see spotlightService.
//
//   2. `isPublishable` is re-checked at READ time, not only when an item is
//      pinned. A space gets quarantined, a post gets removed, a novel gets
//      unpublished — all of these happen AFTER an admin featured the thing, and
//      the homepage must then drop it rather than keep advertising it.
//      Write-time validation alone leaves banned content on the front page
//      until a human notices, which is the failure that matters here.
//
//   3. `card()` is a whitelist, never the raw document. This payload is served
//      to logged-out visitors, so anything it carries is public by definition.

const { SPACE_STATUS, SPACE_VISIBILITY, POST_STATUS } = require('./constants');

/** Strip HTML and clamp, for card blurbs built from rich-text bodies. */
const excerpt = (html, max = 180) => {
  const text = String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const TYPES = [
  {
    key: 'novel',
    label: 'Novel',
    icon: 'BookOpen',
    model: 'Novel',
    search: async (query, limit = 10) => {
      const Novel = require('../models/Novel');
      const filter = { published: true };
      if (query) filter.title = new RegExp(escapeRegex(query), 'i');
      return Novel.find(filter)
        .select('title slug coverUrl author status ratingAvg chapterCount')
        .sort({ featured: -1, weeklyViews: -1 })
        .limit(limit)
        .lean();
    },
    loadMany: async (ids) => {
      const Novel = require('../models/Novel');
      return Novel.find({ _id: { $in: ids } })
        .select('title slug coverUrl author status ratingAvg ratingCount chapterCount synopsis published')
        .lean()
        .read('secondaryPreferred');
    },
    // `published: false` is an editorial decision to take a novel off the site.
    // Featuring must not be a back door around it.
    isPublishable: (doc) => Boolean(doc && doc.published && !doc.deletedAt),
    card: (doc) => ({
      title: doc.title,
      subtitle: doc.author ? `by ${doc.author}` : '',
      image: doc.coverUrl || '',
      href: `/novel/${doc.slug}`,
      entity: {
        _id: doc._id,
        title: doc.title,
        slug: doc.slug,
        coverUrl: doc.coverUrl,
        author: doc.author,
        status: doc.status,
        ratingAvg: doc.ratingAvg,
        ratingCount: doc.ratingCount,
        chapterCount: doc.chapterCount,
      },
    }),
  },

  {
    key: 'chapter',
    label: 'Chapter',
    icon: 'FileText',
    model: 'Chapter',
    search: async (query, limit = 10) => {
      const Chapter = require('../models/Chapter');
      const filter = query ? { title: new RegExp(escapeRegex(query), 'i') } : {};
      return Chapter.find(filter)
        .select('title number novel')
        .populate('novel', 'title slug coverUrl published')
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
    },
    loadMany: async (ids) => {
      const Chapter = require('../models/Chapter');
      return Chapter.find({ _id: { $in: ids } })
        .select('title number novel')
        .populate('novel', 'title slug coverUrl published')
        .lean()
        .read('secondaryPreferred');
    },
    // A chapter is only as public as its novel.
    isPublishable: (doc) => Boolean(doc && doc.novel && doc.novel.published && !doc.deletedAt),
    card: (doc) => ({
      title: `Ch. ${doc.number}: ${doc.title}`,
      subtitle: doc.novel ? doc.novel.title : '',
      image: doc.novel ? doc.novel.coverUrl || '' : '',
      href: doc.novel ? `/novel/${doc.novel.slug}/chapter/${doc.number}` : '',
      entity: {
        _id: doc._id,
        number: doc.number,
        title: doc.title,
        novel: doc.novel
          ? { _id: doc.novel._id, title: doc.novel.title, slug: doc.novel.slug, coverUrl: doc.novel.coverUrl }
          : null,
      },
    }),
  },

  {
    key: 'space',
    label: 'Space',
    icon: 'MessagesSquare',
    model: 'Space',
    search: async (query, limit = 10) => {
      const Space = require('../models/Space');
      const filter = { status: SPACE_STATUS.ACTIVE, visibility: { $ne: SPACE_VISIBILITY.PRIVATE } };
      if (query) filter.name = new RegExp(escapeRegex(query), 'i');
      return Space.find(filter)
        .select('name slug tagline iconUrl bannerUrl memberCount postCount nsfw theme status visibility')
        .sort({ memberCount: -1 })
        .limit(limit)
        .lean();
    },
    loadMany: async (ids) => {
      const Space = require('../models/Space');
      return Space.find({ _id: { $in: ids } })
        .select(
          'name slug tagline descriptionText iconUrl bannerUrl memberCount postCount activeCount7d '
          + 'nsfw theme status visibility excludeFromAll verified'
        )
        .lean()
        .read('secondaryPreferred');
    },
    // The read-time guard that matters most. A quarantined or banned space
    // stays pinned in the database; it must not stay on the homepage. Private
    // spaces are excluded outright — featuring one would advertise a door that
    // the visitor cannot open and leak its name and description besides.
    isPublishable: (doc) =>
      Boolean(
        doc
          && doc.status === SPACE_STATUS.ACTIVE
          && doc.visibility !== SPACE_VISIBILITY.PRIVATE
          && !doc.excludeFromAll
          && !doc.deletedAt
      ),
    card: (doc) => ({
      title: doc.name,
      subtitle: doc.tagline || excerpt(doc.descriptionText, 110),
      image: doc.bannerUrl || doc.iconUrl || '',
      href: `/c/${doc.slug}`,
      entity: {
        _id: doc._id,
        id: doc._id,
        name: doc.name,
        slug: doc.slug,
        tagline: doc.tagline,
        iconUrl: doc.iconUrl,
        bannerUrl: doc.bannerUrl,
        memberCount: doc.memberCount,
        postCount: doc.postCount,
        activeCount7d: doc.activeCount7d,
        nsfw: doc.nsfw,
        verified: doc.verified,
        theme: doc.theme,
      },
    }),
  },

  {
    key: 'post',
    label: 'Post',
    icon: 'FileText',
    model: 'Post',
    search: async (query, limit = 10) => {
      const Post = require('../models/Post');
      const filter = { status: POST_STATUS.PUBLISHED };
      if (query) filter.title = new RegExp(escapeRegex(query), 'i');
      return Post.find(filter)
        .select('title type space score commentCount createdAt nsfw')
        .populate('space', 'name slug iconUrl status visibility')
        .sort({ hotScore: -1 })
        .limit(limit)
        .lean();
    },
    loadMany: async (ids) => {
      const Post = require('../models/Post');
      return Post.find({ _id: { $in: ids } })
        .populate('space', 'name slug iconUrl nsfw status visibility excludeFromAll')
        .populate('author', 'username avatarUrl')
        .lean()
        .read('secondaryPreferred');
    },
    // Both halves matter. A published post inside a quarantined space is not
    // publishable, and neither is a removed post inside a healthy one.
    isPublishable: (doc) =>
      Boolean(
        doc
          && doc.status === POST_STATUS.PUBLISHED
          && !doc.deletedAt
          && doc.space
          && doc.space.status === SPACE_STATUS.ACTIVE
          && doc.space.visibility !== SPACE_VISIBILITY.PRIVATE
          && !doc.space.excludeFromAll
      ),
    card: (doc) => ({
      title: doc.title,
      subtitle: doc.space ? doc.space.name : '',
      image: (doc.media && doc.media[0] && (doc.media[0].thumbUrl || doc.media[0].url))
        || (doc.link && doc.link.imageUrl)
        || '',
      href: doc.space ? `/c/${doc.space.slug}/p/${doc._id}${doc.titleSlug ? `/${doc.titleSlug}` : ''}` : '',
      entity: {
        id: doc._id,
        _id: doc._id,
        type: doc.type,
        title: doc.title,
        blurb: excerpt(doc.body || doc.bodyText, 200),
        media: doc.media,
        link: doc.link && doc.link.url ? doc.link : undefined,
        flairText: doc.flairText,
        nsfw: doc.nsfw,
        spoiler: doc.spoiler,
        score: doc.score,
        commentCount: doc.commentCount,
        createdAt: doc.createdAt,
        // Shaped by pollService in the resolver, which is the only layer that
        // knows the viewer — `hideResultsUntilEnd` has to strip the tallies
        // from the RESPONSE, so they cannot be serialized here and hidden later.
        rawPoll: doc.poll && doc.poll.options && doc.poll.options.length ? doc.poll : undefined,
        space: doc.space
          ? { id: doc.space._id, slug: doc.space.slug, name: doc.space.name, iconUrl: doc.space.iconUrl }
          : null,
        author: doc.author
          ? { id: doc.author._id, username: doc.author.username, avatarUrl: doc.author.avatarUrl }
          : null,
        // `poll` and `viewerVote` are attached by the resolver, which is the
        // only layer that knows who is looking.
      },
    }),
  },

  {
    key: 'custom',
    label: 'Custom card',
    icon: 'Sparkles',
    // No model. An admin-authored card — an announcement, a campaign, a link
    // off-site — that points at nothing in the database. Kept in the registry
    // rather than special-cased in the renderer so every card in a rail has
    // one shape.
    standalone: true,
    search: async () => [],
    loadMany: async () => [],
    isPublishable: () => true,
    card: (doc, item) => ({
      title: item.label || '',
      subtitle: item.note || '',
      image: item.thumb || '',
      href: item.url || '',
      entity: null,
    }),
  },
];

const byKey = new Map();
for (const type of TYPES) {
  if (byKey.has(type.key)) throw new Error(`Duplicate spotlight type: ${type.key}`);
  byKey.set(type.key, type);
}

const get = (key) => byKey.get(key) || null;
const has = (key) => byKey.has(key);
const all = () => TYPES;
const keys = () => [...byKey.keys()];

/** Metadata the admin picker renders from. No functions cross the wire. */
const describe = (type) => ({
  key: type.key,
  label: type.label,
  icon: type.icon,
  standalone: Boolean(type.standalone),
});

/**
 * Search one type for the admin picker.
 *
 * Returns picker rows, not cards: the admin is choosing an entity, and needs
 * enough to tell two similarly-named things apart.
 */
const searchType = async (key, query, limit = 10) => {
  const type = get(key);
  if (!type || type.standalone) return [];
  const docs = await type.search(query, limit);
  return docs.map((doc) => {
    const card = type.card(doc, {});
    return {
      type: type.key,
      refId: doc._id,
      label: card.title,
      subtitle: card.subtitle,
      thumb: card.image,
      url: card.href,
    };
  });
};

module.exports = { get, has, all, keys, describe, searchType, excerpt, TYPES };
