// Post lifecycle.
//
// Two things here are load-bearing beyond the obvious CRUD:
//
//   1. Explicit field allowlists on create and update. A handler that spreads
//      req.body lets a user set their own `score`, `hotScore`, `pinnedGlobally`
//      or `status` — the classic mass-assignment bug, and on a ranked feed it
//      is a total compromise of the ordering.
//   2. `move` is delete-and-recreate, not an update. `space` is the future
//      shard key prefix, and a shard key value cannot be updated in place — so
//      the obvious `updateOne({ space })` stops working the day sharding
//      arrives, in a way that is very hard to notice.

const Post = require('../../models/Post');
const Vote = require('../../models/Vote');
const Flair = require('../../models/Flair');
const counterService = require('../counterService');
const cacheService = require('../cacheService');
const linkTypes = require('../../config/linkTypes');
const sanitizeHtml = require('../../utils/sanitizeHtml');
const { slugify } = require('../../utils/slugify');
const ranking = require('./rankingService');
const voteService = require('./voteService');
const { POST_TYPES, POST_STATUS, VOTE_TARGET_TYPES } = require('../../config/constants');

const fail = (message, status = 400, details = null) =>
  Object.assign(new Error(message), { status, details });

// The only fields a client may set at creation. Anything else is derived or
// privileged.
const CREATE_FIELDS = [
  'type', 'title', 'body', 'url', 'flair', 'nsfw', 'spoiler', 'linkedRefs',
  'media', 'pollOptions', 'pollDurationDays', 'pollAllowMultiple', 'pollHideResults',
];

// The only fields an AUTHOR may change. Moderator actions go through their own
// functions so each can be audited individually.
const AUTHOR_EDITABLE = ['body', 'nsfw', 'spoiler', 'flair', 'linkedRefs'];

const domainOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (error) {
    return '';
  }
};

/**
 * Validate and normalize the input for one post type.
 *
 * Type-specific rules live together rather than scattered through the handler,
 * so adding a fifth post type later is one branch here.
 */
const buildTypedFields = async (type, input, settings) => {
  const out = {};

  if (type === POST_TYPES.TEXT) {
    const { html, text } = sanitizeHtml.process(input.body || '', 'post');
    const max = settings.get('spaces.posting.maxBodyLength');
    if (ranking.graphemeLength(text) > max) {
      throw fail(`Body must be ${max} characters or fewer`, 400, { field: 'body' });
    }
    out.body = html;
    out.bodyText = text;
    return out;
  }

  if (type === POST_TYPES.LINK) {
    const url = String(input.url || '').trim();
    if (!sanitizeHtml.isSafeUrl(url) || !/^https?:/i.test(url)) {
      throw fail('Enter a valid http or https link', 400, { field: 'url' });
    }
    const domain = domainOf(url);
    if (!domain) throw fail('Enter a valid link', 400, { field: 'url' });

    const blocklist = settings.get('spaces.posting.linkDomainBlocklist');
    if (blocklist.length && blocklist.some((d) => domain === d || domain.endsWith(`.${d}`))) {
      throw fail('Links to that site are not allowed', 400, { field: 'url' });
    }
    const allowlist = settings.get('spaces.posting.linkDomainAllowlist');
    if (allowlist.length && !allowlist.some((d) => domain === d || domain.endsWith(`.${d}`))) {
      throw fail('Links to that site are not allowed here', 400, { field: 'url' });
    }

    // Preview metadata is fetched asynchronously in Phase 4 — never inline,
    // because it is a slow call to a third party inside a user's write.
    out.link = { url, domain, fetchStatus: 'pending' };
    return out;
  }

  if (type === POST_TYPES.POLL) {
    const options = (Array.isArray(input.pollOptions) ? input.pollOptions : [])
      .map((text) => String(text || '').trim())
      .filter(Boolean);
    const max = settings.get('spaces.posting.maxPollOptions');
    if (options.length < 2) throw fail('A poll needs at least two options', 400, { field: 'pollOptions' });
    if (options.length > max) throw fail(`A poll can have at most ${max} options`, 400, { field: 'pollOptions' });

    const maxDays = settings.get('spaces.posting.maxPollDurationDays');
    const days = Math.min(Math.max(Number(input.pollDurationDays) || 3, 1), maxDays);

    out.poll = {
      options: options.map((text) => ({ text: text.slice(0, 200), votes: 0 })),
      allowMultiple: Boolean(input.pollAllowMultiple),
      endsAt: new Date(Date.now() + days * 86400_000),
      hideResultsUntilEnd: Boolean(input.pollHideResults),
      totalVoters: 0,
    };
    if (input.body) {
      const { html, text } = sanitizeHtml.process(input.body, 'post');
      out.body = html;
      out.bodyText = text;
    }
    return out;
  }

  if (type === POST_TYPES.IMAGE) {
    // Media is attached by the upload endpoint in Phase 4, which validates
    // bytes, dimensions and content. Nothing client-supplied is trusted here.
    out.media = [];
    if (input.body) {
      const { html, text } = sanitizeHtml.process(input.body, 'post');
      out.body = html;
      out.bodyText = text;
    }
    return out;
  }

  throw fail('Unknown post type', 400, { field: 'type' });
};

/**
 * Create a post.
 *
 * The caller has already resolved permissions — this enforces content rules,
 * which are per-space and therefore need the resolved settings reader.
 */
const create = async ({ user, space, input, settings, perms }) => {
  if (!perms.can.post) {
    throw fail(perms.reason === 'banned' ? 'You are banned from this space' : 'You cannot post here', 403);
  }

  const type = input.type;
  const allowedTypes = space.allowedPostTypes && space.allowedPostTypes.length
    ? space.allowedPostTypes
    : settings.get('spaces.posting.allowedTypes');
  if (!allowedTypes.includes(type)) {
    throw fail('That post type is not allowed in this space', 400, { field: 'type' });
  }

  // Karma and age gates, resolved per space so a space can be stricter.
  const karma = (user.karma && user.karma.total) || 0;
  const minKarma = settings.get('spaces.posting.minKarmaToPost');
  if (minKarma > 0 && karma < minKarma) {
    throw fail(`You need ${minKarma} karma to post here`, 403);
  }
  const minAgeHours = settings.get('spaces.posting.minAccountAgeHours');
  if (minAgeHours > 0) {
    const eligibleAt = new Date(new Date(user.createdAt).getTime() + minAgeHours * 3600_000);
    if (eligibleAt > new Date()) throw fail(`Your account must be ${minAgeHours} hours old to post here`, 403);
  }

  // Grapheme count, not string length. `'👨‍👩‍👧‍👦'.length` is 11 but a person sees
  // one character, and a limit nobody can predict is a bad limit.
  const title = sanitizeHtml.sanitize(String(input.title || '').trim(), 'plain');
  const titleLength = ranking.graphemeLength(title);
  const minTitle = settings.get('spaces.posting.minTitleLength');
  const maxTitle = settings.get('spaces.posting.maxTitleLength');
  if (titleLength < minTitle) throw fail(`Title must be at least ${minTitle} characters`, 400, { field: 'title' });
  if (titleLength > maxTitle) throw fail(`Title must be ${maxTitle} characters or fewer`, 400, { field: 'title' });

  if (input.nsfw && !space.nsfw && !settings.get('spaces.creation.allowNsfw')) {
    throw fail('NSFW posts are not allowed', 400, { field: 'nsfw' });
  }

  let flairText = '';
  if (input.flair) {
    const flair = await Flair.findOne({ _id: input.flair, space: space._id, kind: 'post', active: true });
    if (!flair) throw fail('That flair is not available here', 400, { field: 'flair' });
    // A mod-only flair is meaningless if anyone can self-apply it.
    if (flair.modOnly && !perms.can.managePosts) {
      throw fail('That flair can only be set by a moderator', 403, { field: 'flair' });
    }
    flairText = flair.text;
  } else if (settings.get('spaces.posting.requireFlair')) {
    throw fail('This space requires a flair', 400, { field: 'flair' });
  }

  const typed = await buildTypedFields(type, input, settings);

  const linkedRefs = await linkTypes.resolveMany(input.linkedRefs, {
    enabledTypes: settings.get('spaces.links.enabledTypes'),
    max: settings.get('spaces.links.maxPerPost'),
  });

  const post = await Post.create({
    space: space._id,
    author: user._id,
    type,
    title,
    titleSlug: slugify(title).slice(0, 80),
    flair: input.flair || null,
    flairText,
    nsfw: Boolean(input.nsfw) || space.nsfw,
    spoiler: Boolean(input.spoiler),
    linkedRefs,
    status: POST_STATUS.PUBLISHED,
    lastActivityAt: new Date(),
    ...typed,
  });

  // The author's automatic upvote — a real ledger row, not a synthetic counter
  // bump, so the rebuild job produces the same number. See voteService.
  await voteService.autoUpvote({
    user,
    targetType: VOTE_TARGET_TYPES.POST,
    targetId: post._id,
    spaceId: space._id,
  });

  const scores = ranking.scoresFor(
    { upvotes: 1, downvotes: 0, createdAt: post.createdAt },
    {
      gravitySeconds: settings.get('spaces.ranking.hotGravitySeconds'),
      confidenceZ: settings.get('spaces.ranking.confidenceZ'),
    }
  );
  Object.assign(post, { upvotes: 1, ...scores });
  await post.save();

  await counterService.increment('space', space._id, { postCount: 1 }, { lastPostAt: new Date() });
  if (input.flair) await counterService.incrementSilent('space', input.flair, { useCount: 1 });
  cacheService.invalidate(cacheService.keys.feedAll());

  return post;
};

/** Author edit, within the configured window. */
const update = async ({ post, user, input, settings, perms }) => {
  const isAuthor = String(post.author) === String(user._id);
  if (!isAuthor && !perms.can.managePosts) throw fail('You cannot edit this post', 403);

  if (isAuthor && !perms.isAdmin) {
    const window = settings.get('spaces.posting.editWindowMinutes');
    if (window > 0) {
      const closesAt = new Date(new Date(post.createdAt).getTime() + window * 60000);
      if (closesAt < new Date()) throw fail('The edit window for this post has closed', 403);
    }
  }

  const patch = {};
  for (const field of AUTHOR_EDITABLE) {
    if (input[field] === undefined) continue;

    if (field === 'body') {
      const { html, text } = sanitizeHtml.process(input.body, 'post');
      const max = settings.get('spaces.posting.maxBodyLength');
      if (ranking.graphemeLength(text) > max) {
        throw fail(`Body must be ${max} characters or fewer`, 400, { field: 'body' });
      }
      patch.body = html;
      patch.bodyText = text;
    } else if (field === 'linkedRefs') {
      patch.linkedRefs = await linkTypes.resolveMany(input.linkedRefs, {
        enabledTypes: settings.get('spaces.links.enabledTypes'),
        max: settings.get('spaces.links.maxPerPost'),
      });
    } else {
      patch[field] = input[field];
    }
  }

  // The title locks shortly after posting. Without this, a post can collect
  // votes as one thing and be rewritten into another — the bait-and-switch that
  // edit history alone does not prevent.
  if (input.title !== undefined) {
    const lock = settings.get('spaces.posting.titleLockMinutes');
    const locked = lock > 0 && new Date(post.createdAt).getTime() + lock * 60000 < Date.now();
    if (locked && !perms.can.managePosts) {
      throw fail('The title can no longer be changed', 403, { field: 'title' });
    }
    const title = sanitizeHtml.sanitize(String(input.title).trim(), 'plain');
    const length = ranking.graphemeLength(title);
    if (length < settings.get('spaces.posting.minTitleLength')) throw fail('Title is too short', 400);
    if (length > settings.get('spaces.posting.maxTitleLength')) throw fail('Title is too long', 400);
    patch.title = title;
    patch.titleSlug = slugify(title).slice(0, 80);
  }

  if (!Object.keys(patch).length) return post;

  patch.editedAt = new Date();
  Object.assign(post, patch);
  await post.save();
  cacheService.invalidate(cacheService.keys.post(post._id));
  return post;
};

/** Author delete. Soft — recoverable, and distinct from a moderator removal. */
const remove = async ({ post, user, settings, perms }) => {
  const isAuthor = String(post.author) === String(user._id);
  if (!isAuthor && !perms.can.managePosts) throw fail('You cannot delete this post', 403);

  if (isAuthor && !perms.isAdmin) {
    const window = settings.get('spaces.posting.deleteWindowMinutes');
    if (window > 0) {
      const closesAt = new Date(new Date(post.createdAt).getTime() + window * 60000);
      if (closesAt < new Date()) throw fail('This post can no longer be deleted', 403);
    }
  }

  await post.softDelete();
  await counterService.increment('space', post.space, { postCount: -1 });
  cacheService.invalidate(cacheService.keys.feedAll());
  return { deleted: true };
};

/**
 * Move a post to another space.
 *
 * Delete-and-recreate, deliberately. `space` is the future shard key prefix and
 * a shard key value cannot be updated in place — writing this as
 * `updateOne({ space })` today would work and then silently stop working the
 * day the collection is sharded, which is close to the worst failure mode
 * available. Votes are re-pointed to the new id and their `space` corrected.
 */
const move = async ({ post, targetSpace, actor }) => {
  const source = post.toObject();
  delete source._id;
  delete source.createdAt;
  delete source.updatedAt;

  const moved = await Post.create({
    ...source,
    space: targetSpace._id,
    // Flair belongs to the old space and means nothing in the new one.
    flair: null,
    flairText: '',
    movedFrom: post.space,
    movedBy: actor ? actor._id : null,
    movedAt: new Date(),
  });

  await Vote.updateMany(
    { targetType: VOTE_TARGET_TYPES.POST, target: post._id },
    { $set: { target: moved._id, space: targetSpace._id } }
  );

  await post.softDelete();
  await Promise.all([
    counterService.increment('space', post.space, { postCount: -1 }),
    counterService.increment('space', targetSpace._id, { postCount: 1 }),
  ]);
  cacheService.invalidate(cacheService.keys.feedAll());

  return moved;
};

module.exports = {
  create,
  update,
  remove,
  move,
  buildTypedFields,
  domainOf,
  CREATE_FIELDS,
  AUTHOR_EDITABLE,
};
