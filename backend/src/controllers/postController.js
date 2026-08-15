const Post = require('../models/Post');
const Space = require('../models/Space');
const spaceService = require('../services/community/spaceService');
const postService = require('../services/community/postService');
const voteService = require('../services/community/voteService');
const feedService = require('../services/community/feedService');
const permissions = require('../services/community/spacePermissionService');
const settingsService = require('../services/settingsService');
const linkTypes = require('../config/linkTypes');
const { registerView, getViewerKey } = require('../utils/viewTracking');
const counterService = require('../services/counterService');
const { asyncHandler } = require('../middlewares/errorHandler');
const {
  POST_STATUS,
  VOTE_TARGET_TYPES,
  VIEW_TARGET_TYPES,
  PUBLIC_USER_FIELDS,
} = require('../config/constants');

const requireCommunityEnabled = async () => {
  const snapshot = await settingsService.snapshot();
  if (!snapshot.get('spaces.enabled')) throw Object.assign(new Error('Not found'), { status: 404 });
  return snapshot;
};

// Whitelist, not the raw document. Never send `removal.note` (a moderator's
// private reasoning), and never send raw counters when the space hides them.
const serializePost = (post, { viewerVote = 0 } = {}) => ({
  id: post._id,
  space: post.space && post.space.slug
    ? { id: post.space._id, slug: post.space.slug, name: post.space.name,
        iconUrl: post.space.iconUrl, nsfw: post.space.nsfw }
    : post.space,
  author: post.author && post.author.username
    ? { id: post.author._id, username: post.author.username, avatarUrl: post.author.avatarUrl }
    : post.author,
  type: post.type,
  title: post.title,
  titleSlug: post.titleSlug,
  body: post.body,
  media: post.media,
  link: post.link && post.link.url ? post.link : undefined,
  poll: post.poll && post.poll.options ? post.poll : undefined,
  flairText: post.flairText,
  nsfw: post.nsfw,
  spoiler: post.spoiler,
  linkedRefs: post.linkedRefs,
  status: post.status,
  locked: post.locked,
  pinnedInSpace: post.pinnedInSpace,
  score: post.score,
  scoreHidden: post.scoreHidden,
  upvotes: post.upvotes,
  downvotes: post.downvotes,
  commentCount: post.commentCount,
  viewCount: post.viewCount,
  editedAt: post.editedAt,
  createdAt: post.createdAt,
  viewerVote: post.viewerVote !== undefined ? post.viewerVote : viewerVote,
  // Moderation state, described to the user rather than left as a silent
  // disappearance. `hidden` is automatic and reversible and says so; `removed`
  // is a human decision. The moderator's private note is never included.
  ...(post.status === POST_STATUS.HIDDEN
    ? {
        moderation: {
          state: 'hidden',
          automatic: true,
          reason: post.removal && post.removal.reason === 'auto_hidden_severity'
            ? 'reported_severe'
            : 'reported',
          message:
            'This is hidden while it is reviewed. It was reported by several people. '
            + 'A moderator will look at it shortly, and it will be restored if there is nothing wrong with it.',
          hiddenAt: post.removal ? post.removal.at : null,
        },
      }
    : {}),
  ...(post.status === POST_STATUS.REMOVED
    ? {
        moderation: {
          state: 'removed',
          automatic: false,
          reason: post.removal ? post.removal.reason : '',
          ruleId: post.removal ? post.removal.ruleId : '',
          message: 'This was removed by a moderator.',
          removedAt: post.removal ? post.removal.at : null,
        },
      }
    : {}),
});

// ------------------------------------------------------------------- feeds

const getFeed = asyncHandler(async (req, res) => {
  const snapshot = await requireCommunityEnabled();
  if (!req.user && !snapshot.get('spaces.publicBrowsing')) {
    return res.status(401).json({ message: 'Sign in to browse the community' });
  }

  const result = await feedService.fetch({
    type: req.params.type || snapshot.get('spaces.defaultLandingFeed'),
    sort: req.query.sort,
    timeframe: req.query.t,
    cursor: req.query.cursor,
    limit: req.query.limit ? Number(req.query.limit) : null,
    viewer: req.user,
    settings: snapshot,
    includeNsfw: req.query.nsfw === 'true' ? true : null,
  });

  return res.json({ ...result, posts: result.posts.map((p) => serializePost(p)) });
});

const getSpaceFeed = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { space, perms } = await spaceService.loadForActor(req.params.slug, req.user, req);
  const settings = await permissions.spaceSettings(space);

  const [result, pinned] = await Promise.all([
    feedService.fetch({
      type: 'space',
      space,
      sort: req.query.sort,
      timeframe: req.query.t,
      cursor: req.query.cursor,
      limit: req.query.limit ? Number(req.query.limit) : null,
      viewer: req.user,
      settings,
      includeNsfw: true, // an NSFW space's own feed is not a surprise
    }),
    req.query.cursor ? Promise.resolve([]) : feedService.pinnedFor(space, settings, req.user),
  ]);

  res.json({
    ...result,
    pinned: pinned.map((p) => serializePost(p)),
    posts: result.posts.map((p) => serializePost(p)),
    viewer: perms.can,
  });
});

/** Discussion tab on a linked entity — a novel, a chapter, anything registered. */
const getLinkedFeed = asyncHandler(async (req, res) => {
  const snapshot = await requireCommunityEnabled();
  if (!snapshot.get('spaces.links.showDiscussionTab')) {
    return res.status(404).json({ message: 'Not found' });
  }
  if (!linkTypes.has(req.params.type)) {
    return res.status(404).json({ message: 'Not found' });
  }

  const result = await feedService.fetch({
    type: 'linked',
    linkedRef: { type: req.params.type, id: req.params.id },
    sort: req.query.sort,
    cursor: req.query.cursor,
    viewer: req.user,
    settings: snapshot,
  });

  return res.json({ ...result, posts: result.posts.map((p) => serializePost(p)) });
});

// ------------------------------------------------------------------- posts

const createPost = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { space, perms } = await spaceService.loadForActor(req.body.space, req.user, req);
  const settings = await permissions.spaceSettings(space);

  const post = await postService.create({
    user: req.user,
    space,
    input: req.body,
    settings,
    perms,
  });

  res.status(201).json({ post: serializePost(post, { viewerVote: 1 }) });
});

const getPost = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const post = await Post.findById(req.params.id)
    .populate('space', 'slug name iconUrl nsfw status visibility locked theme publicModlog excludeFromAll deletedAt')
    .populate('author', PUBLIC_USER_FIELDS);
  if (!post) return res.status(404).json({ message: 'Post not found' });

  const membership = await spaceService.membershipFor(post.space, req.user);
  const perms = permissions.resolve(req.user, post.space, membership);
  if (!perms.can.view) return res.status(404).json({ message: 'Post not found' });

  // A removed post stays reachable by direct link for its author and for
  // moderators, with a banner. Matching Reddit, and avoiding the "my post
  // vanished with no explanation" failure mode that drives support load.
  const isAuthor = req.user && String(post.author._id) === String(req.user._id);
  if (post.status === POST_STATUS.REMOVED && !isAuthor && !perms.can.managePosts) {
    return res.status(404).json({ message: 'Post not found' });
  }

  const settings = await permissions.spaceSettings(post.space);
  if (settings.get('spaces.analytics.trackPostViews')) {
    const viewerKey = getViewerKey(req);
    const fresh = await registerView(VIEW_TARGET_TYPES.POST, post._id, viewerKey);
    if (fresh) counterService.incrementSilent('post', post._id, { viewCount: 1 });
  }

  const votes = await voteService.forTargets(req.user, VOTE_TARGET_TYPES.POST, [post._id]);
  const [visible] = feedService.applyScoreVisibility([post.toObject()], settings);

  return res.json({
    post: serializePost({ ...visible, space: post.space, author: post.author }, {
      viewerVote: votes[String(post._id)] || 0,
    }),
    viewer: perms.can,
  });
});

const updatePost = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const post = await Post.findById(req.params.id).populate('space');
  if (!post) return res.status(404).json({ message: 'Post not found' });

  const membership = await spaceService.membershipFor(post.space, req.user);
  const perms = permissions.resolve(req.user, post.space, membership);
  const settings = await permissions.spaceSettings(post.space);

  const updated = await postService.update({ post, user: req.user, input: req.body, settings, perms });
  return res.json({ post: serializePost(updated) });
});

const deletePost = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const post = await Post.findById(req.params.id).populate('space');
  if (!post) return res.status(404).json({ message: 'Post not found' });

  const membership = await spaceService.membershipFor(post.space, req.user);
  const perms = permissions.resolve(req.user, post.space, membership);
  const settings = await permissions.spaceSettings(post.space);

  return res.json(await postService.remove({ post, user: req.user, settings, perms }));
});

// ------------------------------------------------------------------- votes

const votePost = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const post = await Post.findById(req.params.id).populate('space').read('primary');
  if (!post) return res.status(404).json({ message: 'Post not found' });

  const membership = await spaceService.membershipFor(post.space, req.user);
  const perms = permissions.resolve(req.user, post.space, membership);
  if (!perms.can.vote) {
    return res.status(403).json({
      message: perms.reason === 'banned' ? 'You are banned from this space' : 'You cannot vote here',
    });
  }

  const settings = await permissions.spaceSettings(post.space);
  const result = await voteService.cast({
    user: req.user,
    targetType: VOTE_TARGET_TYPES.POST,
    targetId: post._id,
    spaceId: post.space._id,
    authorId: post.author,
    value: Number(req.body.value),
    settings,
    req,
  });

  return res.json(result);
});

// -------------------------------------------------------- moderator actions

const moderatePost = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const post = await Post.findById(req.params.id).populate('space');
  if (!post) return res.status(404).json({ message: 'Post not found' });

  const membership = await spaceService.membershipFor(post.space, req.user);
  const perms = permissions.resolve(req.user, post.space, membership);
  if (!perms.can.managePosts) {
    return res.status(403).json({ message: 'You do not have permission to do that' });
  }

  const settings = await permissions.spaceSettings(post.space);
  const { action } = req.body;

  // Full moderation — reasons, statements of reasons, appeals and the ModAction
  // trail — lands in Phase 5. These are the state toggles Phase 2 needs, and
  // they deliberately do not yet claim to be auditable.
  const toggles = {
    lock: () => { post.locked = true; },
    unlock: () => { post.locked = false; },
    pin: () => { post.pinnedInSpace = true; },
    unpin: () => { post.pinnedInSpace = false; },
    nsfw: () => { post.nsfw = true; },
    sfw: () => { post.nsfw = false; },
    spoiler: () => { post.spoiler = true; },
    unspoiler: () => { post.spoiler = false; },
  };

  if (toggles[action]) {
    if (action === 'pin') {
      const slots = settings.get('spaces.ranking.pinnedSlots');
      const pinned = await Post.countDocuments({ space: post.space._id, pinnedInSpace: true });
      if (pinned >= slots) {
        return res.status(409).json({ message: `This space can pin at most ${slots} posts` });
      }
    }
    toggles[action]();
    await post.save();
    return res.json({ post: serializePost(post) });
  }

  if (action === 'move') {
    if (!perms.isAdmin) return res.status(403).json({ message: 'Only an admin can move a post' });
    const target = await Space.findOne({ slug: req.body.targetSpace });
    if (!target) return res.status(404).json({ message: 'Target space not found' });
    const moved = await postService.move({ post, targetSpace: target, actor: req.user });
    return res.json({ post: serializePost(moved) });
  }

  return res.status(400).json({ message: 'Unknown action' });
});

module.exports = {
  getFeed,
  getSpaceFeed,
  getLinkedFeed,
  createPost,
  getPost,
  updatePost,
  deletePost,
  votePost,
  moderatePost,
  serializePost,
};
