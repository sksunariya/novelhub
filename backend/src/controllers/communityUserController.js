const User = require('../models/User');
const Post = require('../models/Post');
const PostComment = require('../models/PostComment');
const SpaceMember = require('../models/SpaceMember');
const Space = require('../models/Space');
const settingsService = require('../services/settingsService');
const feedService = require('../services/community/feedService');
const { asyncHandler } = require('../middlewares/errorHandler');
const {
  POST_STATUS,
  SPACE_STATUS,
  SPACE_VISIBILITY,
  SPACE_MEMBER_STATUS,
} = require('../config/constants');

// Public community profiles.
//
// TWO LEAKS THIS ENDPOINT HAS TO AVOID:
//
//   1. PRIVATE SPACES. A profile listing "member of /c/private-thing" tells the
//      world that space exists and who is in it. Only public spaces appear.
//   2. REMOVED CONTENT. A profile is a convenient index of everything someone
//      wrote; if it showed removed posts it would be a way to read around
//      moderation entirely.

const requireCommunityEnabled = async () => {
  const snapshot = await settingsService.snapshot();
  if (!snapshot.get('spaces.enabled')) throw Object.assign(new Error('Not found'), { status: 404 });
  return snapshot;
};

const getProfile = asyncHandler(async (req, res) => {
  const snapshot = await requireCommunityEnabled();

  const user = await User.findOne({ username: req.params.username })
    .select('username avatarUrl fullName karma createdAt communityBannedUntil')
    .lean();
  if (!user) return res.status(404).json({ message: 'Not found' });

  const isSelf = req.user && String(req.user._id) === String(user._id);

  const [postCount, commentCount, publicSpaces] = await Promise.all([
    Post.countDocuments({ author: user._id, status: POST_STATUS.PUBLISHED }),
    PostComment.countDocuments({ author: user._id, status: POST_STATUS.PUBLISHED }),
    // Only PUBLIC, ACTIVE spaces. Listing a private membership exposes both the
    // space and the person.
    SpaceMember.aggregate([
      { $match: { user: user._id, status: SPACE_MEMBER_STATUS.ACTIVE } },
      { $lookup: { from: 'spaces', localField: 'space', foreignField: '_id', as: 'space' } },
      { $unwind: '$space' },
      {
        $match: {
          'space.visibility': SPACE_VISIBILITY.PUBLIC,
          'space.status': SPACE_STATUS.ACTIVE,
          'space.deletedAt': null,
        },
      },
      { $sort: { 'space.memberCount': -1 } },
      { $limit: 12 },
      {
        $project: {
          _id: 0, slug: '$space.slug', name: '$space.name',
          iconUrl: '$space.iconUrl', role: 1,
        },
      },
    ]),
  ]);

  const showKarma = snapshot.get('spaces.karma.showOnProfile');

  return res.json({
    profile: {
      username: user.username,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      // Admin-toggleable. Public karma drives engagement and also drives
      // farming, so it is a setting rather than a decision baked into the UI.
      karma: showKarma
        ? { post: user.karma?.post || 0, comment: user.karma?.comment || 0, total: user.karma?.total || 0 }
        : null,
      postCount,
      commentCount,
      spaces: publicSpaces,
      // Only the person themselves sees their own suspension here. Announcing
      // it publicly is a punishment nobody decided to impose.
      ...(isSelf && user.communityBannedUntil && user.communityBannedUntil > new Date()
        ? { suspendedUntil: user.communityBannedUntil }
        : {}),
    },
  });
});

/** Their posts. Uses the same feed pipeline, so permissions apply identically. */
const getUserPosts = asyncHandler(async (req, res) => {
  const snapshot = await requireCommunityEnabled();
  const user = await User.findOne({ username: req.params.username }).select('_id').lean();
  if (!user) return res.status(404).json({ message: 'Not found' });

  const result = await feedService.fetch({
    type: 'user',
    authorId: user._id,
    sort: req.query.sort || 'new',
    cursor: req.query.cursor,
    viewer: req.user,
    settings: snapshot,
  });

  // eslint-disable-next-line global-require
  const { serializePost } = require('./postController');
  return res.json({ ...result, posts: result.posts.map((p) => serializePost(p)) });
});

/** Their comments, with enough context to be readable out of the thread. */
const getUserComments = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const user = await User.findOne({ username: req.params.username }).select('_id').lean();
  if (!user) return res.status(404).json({ message: 'Not found' });

  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const filter = { author: user._id, status: POST_STATUS.PUBLISHED };
  if (req.query.cursor) filter.createdAt = { $lt: new Date(req.query.cursor) };

  const rows = await PostComment.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .populate('post', 'title titleSlug space')
    .lean();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // Spaces are resolved in one batched query rather than a populate per row.
  const spaceIds = [...new Set(page.map((c) => String(c.space)))];
  const spaces = await Space.find({ _id: { $in: spaceIds } }).select('slug name').lean();
  const spaceById = new Map(spaces.map((s) => [String(s._id), s]));

  return res.json({
    comments: page.map((comment) => ({
      id: comment._id,
      body: comment.body,
      score: comment.score,
      createdAt: comment.createdAt,
      post: comment.post
        ? { id: comment.post._id, title: comment.post.title, titleSlug: comment.post.titleSlug }
        : null,
      space: spaceById.get(String(comment.space)) || null,
    })),
    hasMore,
    cursor: hasMore && page.length ? page[page.length - 1].createdAt.toISOString() : null,
  });
});

module.exports = { getProfile, getUserPosts, getUserComments };
