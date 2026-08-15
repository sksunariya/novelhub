const Post = require('../models/Post');
const PostComment = require('../models/PostComment');
const PostRevision = require('../models/PostRevision');
const spaceService = require('../services/community/spaceService');
const commentService = require('../services/community/commentService');
const voteService = require('../services/community/voteService');
const permissions = require('../services/community/spacePermissionService');
const settingsService = require('../services/settingsService');
const { asyncHandler } = require('../middlewares/errorHandler');
const { POST_STATUS, VOTE_TARGET_TYPES } = require('../config/constants');

const requireCommunityEnabled = async () => {
  const snapshot = await settingsService.snapshot();
  if (!snapshot.get('spaces.enabled')) throw Object.assign(new Error('Not found'), { status: 404 });
  return snapshot;
};

/**
 * Load a post plus the viewer's permissions in its space.
 *
 * Every comment handler starts here, so the space's permission resolver is the
 * single choke point for comments too — not a second, parallel set of checks.
 */
const loadContext = async (postId, req) => {
  const post = await Post.findById(postId).populate(
    'space',
    'slug name status visibility locked publicModlog excludeFromAll deletedAt overrides nsfw'
  );
  if (!post) throw Object.assign(new Error('Post not found'), { status: 404 });

  const membership = await spaceService.membershipFor(post.space, req.user);
  const perms = permissions.resolve(req.user, post.space, membership);
  if (!perms.can.view) throw Object.assign(new Error('Post not found'), { status: 404 });

  const settings = await permissions.spaceSettings(post.space);
  return { post, perms, settings };
};

// The wire shape. `removal.note` — a moderator's private reasoning — is never
// included; `hydrate` already strips it, and this is the second guard.
const serializeComment = (comment) => ({
  id: comment._id,
  post: comment.post,
  parent: comment.parent,
  depth: comment.depth,
  body: comment.body,
  author: comment.author
    ? { id: comment.author._id, username: comment.author.username, avatarUrl: comment.author.avatarUrl }
    : null,
  isOp: comment.isOp,
  isPinned: comment.isPinned,
  score: comment.score,
  upvotes: comment.upvotes,
  downvotes: comment.downvotes,
  replyCount: comment.replyCount,
  directReplyCount: comment.directReplyCount,
  viewerVote: comment.viewerVote || 0,
  editedAt: comment.editedAt,
  editCount: comment.editCount,
  createdAt: comment.createdAt,
  ...(comment.tombstone
    ? { tombstone: comment.tombstone, removedReason: comment.removedReason }
    : {}),
});

const listComments = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { post, perms, settings } = await loadContext(req.params.id, req);

  const result = await commentService.tree({
    post,
    sort: req.query.sort,
    cursor: req.query.cursor,
    settings,
    viewer: req.user,
  });

  res.json({
    ...result,
    comments: result.comments.map(serializeComment),
    viewer: { canComment: perms.can.comment, canModerate: perms.can.managePosts },
  });
});

const listReplies = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const comment = await PostComment.findById(req.params.id);
  if (!comment) return res.status(404).json({ message: 'Comment not found' });

  const { post, settings } = await loadContext(comment.post, req);
  const result = await commentService.repliesOf({
    comment,
    post,
    settings,
    viewer: req.user,
    limit: req.query.limit ? Number(req.query.limit) : null,
  });

  return res.json({ ...result, comments: result.comments.map(serializeComment) });
});

const createComment = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const { post, perms, settings } = await loadContext(req.params.id, req);

  const comment = await commentService.create({
    user: req.user,
    post,
    space: post.space,
    input: req.body,
    settings,
    perms,
  });

  const [hydrated] = await commentService.hydrate([comment.toObject()], post, req.user, settings);
  res.status(201).json({ comment: serializeComment({ ...hydrated, viewerVote: 1 }) });
});

const updateComment = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const comment = await PostComment.findById(req.params.id);
  if (!comment) return res.status(404).json({ message: 'Comment not found' });

  const { post, perms, settings } = await loadContext(comment.post, req);
  const updated = await commentService.update({ comment, user: req.user, input: req.body, settings, perms });
  const [hydrated] = await commentService.hydrate([updated.toObject()], post, req.user, settings);

  return res.json({ comment: serializeComment(hydrated) });
});

const deleteComment = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const comment = await PostComment.findById(req.params.id);
  if (!comment) return res.status(404).json({ message: 'Comment not found' });

  const { perms } = await loadContext(comment.post, req);
  return res.json(await commentService.remove({ comment, user: req.user, perms }));
});

const voteComment = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const comment = await PostComment.findById(req.params.id).read('primary');
  if (!comment) return res.status(404).json({ message: 'Comment not found' });
  if (comment.status !== POST_STATUS.PUBLISHED) {
    return res.status(409).json({ message: 'This comment is no longer available' });
  }

  const { post, perms, settings } = await loadContext(comment.post, req);
  void post;
  if (!perms.can.vote) {
    return res.status(403).json({
      message: perms.reason === 'banned' ? 'You are banned from this space' : 'You cannot vote here',
    });
  }

  const result = await voteService.cast({
    user: req.user,
    targetType: VOTE_TARGET_TYPES.COMMENT,
    targetId: comment._id,
    spaceId: comment.space,
    authorId: comment.author,
    value: Number(req.body.value),
    settings,
    req,
  });

  return res.json(result);
});

const moderateComment = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const comment = await PostComment.findById(req.params.id);
  if (!comment) return res.status(404).json({ message: 'Comment not found' });

  const { perms, settings } = await loadContext(comment.post, req);
  if (!perms.can.managePosts) {
    return res.status(403).json({ message: 'You do not have permission to do that' });
  }

  const { action, reason = '' } = req.body;

  if (settings.get('spaces.moderation.removalReasonRequired')
      && (action === 'remove' || action === 'removeSubtree')
      && !String(reason).trim()) {
    return res.status(400).json({ message: 'A reason is required' });
  }

  if (action === 'remove') {
    return res.json(
      await commentService.remove({ comment, user: req.user, perms, asModerator: true, reason })
    );
  }

  if (action === 'removeSubtree') {
    return res.json(await commentService.removeSubtree({ comment, user: req.user, perms, reason }));
  }

  if (action === 'restore') {
    comment.status = POST_STATUS.PUBLISHED;
    comment.removal = { by: null, byRole: '', reason: '', at: null };
    await comment.save();
    return res.json({ restored: true });
  }

  if (action === 'pin' || action === 'unpin') {
    comment.isPinned = action === 'pin';
    await comment.save();
    return res.json({ isPinned: comment.isPinned });
  }

  return res.status(400).json({ message: 'Unknown action' });
});

/**
 * Edit history.
 *
 * Public. A visible diff is the strongest deterrent to the bait-and-switch
 * edit — hiding it would remove most of the value of recording it.
 */
const commentHistory = asyncHandler(async (req, res) => {
  await requireCommunityEnabled();
  const comment = await PostComment.findById(req.params.id);
  if (!comment) return res.status(404).json({ message: 'Comment not found' });
  await loadContext(comment.post, req);

  const revisions = await PostRevision.find({ targetType: 'comment', target: comment._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  return res.json({
    revisions: revisions.map((r) => ({
      revision: r.revision,
      body: r.body,
      editorRole: r.editorRole,
      createdAt: r.createdAt,
    })),
    current: { body: comment.body, editedAt: comment.editedAt },
  });
});

module.exports = {
  listComments,
  listReplies,
  createComment,
  updateComment,
  deleteComment,
  voteComment,
  moderateComment,
  commentHistory,
  serializeComment,
};
