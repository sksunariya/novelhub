const Comment = require('../models/Comment');
const Chapter = require('../models/Chapter');
const Novel = require('../models/Novel');
const { asyncHandler } = require('../middlewares/errorHandler');
const { ROLES, PUBLIC_USER_FIELDS } = require('../config/constants');
const { parsePagination } = require('./novelController');
const { REACTIONS, toggleReaction } = require('../utils/reactions');
const { notifyCommentActivity } = require('../utils/notifications');

// Pagination applies to top-level comments only; every reply of a returned
// comment ships with it so a thread is never split across pages.
const listComments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { chapter: req.params.chapterId, parentComment: null };
  const [comments, total] = await Promise.all([
    Comment.find(filter).populate('user', PUBLIC_USER_FIELDS).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Comment.countDocuments(filter),
  ]);
  const replies = await Comment.find({ parentComment: { $in: comments.map((comment) => comment._id) } })
    .populate('user', PUBLIC_USER_FIELDS)
    .sort({ createdAt: 1 });
  const repliesByParent = replies.reduce((grouped, reply) => {
    const key = reply.parentComment.toString();
    grouped[key] = grouped[key] || [];
    grouped[key].push(reply);
    return grouped;
  }, {});
  res.json({
    comments: comments.map((comment) => ({
      ...comment.toJSON(),
      replies: repliesByParent[comment._id.toString()] || [],
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});

const createComment = asyncHandler(async (req, res) => {
  const { content, parentComment } = req.body;
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ message: 'content is required' });
  }
  const chapter = await Chapter.findById(req.params.chapterId);
  if (!chapter) {
    return res.status(404).json({ message: 'Chapter not found' });
  }
  // A parent from another chapter would graft this reply into a thread the reader
  // is not looking at, so it is rejected outright.
  const belongsToChapter = (candidate) => candidate && candidate.chapter.toString() === chapter._id.toString();
  let parent = null;
  let directParent = null;
  if (parentComment) {
    directParent = await Comment.findById(parentComment);
    if (!belongsToChapter(directParent)) {
      return res.status(404).json({ message: 'Parent comment not found' });
    }
    parent = directParent;
    // Threads are two levels deep: replying to a reply attaches to its parent.
    if (parent.parentComment) {
      parent = await Comment.findById(parent.parentComment);
      if (!belongsToChapter(parent)) {
        return res.status(404).json({ message: 'Parent comment not found' });
      }
    }
  }
  const comment = await Comment.create({
    chapter: chapter._id,
    novel: chapter.novel,
    user: req.user._id,
    parentComment: parent ? parent._id : null,
    content: content.trim(),
  });
  await comment.populate('user', PUBLIC_USER_FIELDS);
  const novel = await Novel.findById(chapter.novel).select('slug');
  const link = novel ? `/novel/${novel.slug}/chapter/${chapter.number}#comment-${comment._id}` : '';
  await notifyCommentActivity({
    parentAuthor: directParent ? directParent.user : null,
    actor: req.user,
    content: content.trim(),
    link,
    commentContext: 'comment',
  });
  res.status(201).json({ comment });
});

const updateComment = asyncHandler(async (req, res) => {
  const { content } = req.body;
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ message: 'content is required' });
  }
  const comment = await Comment.findById(req.params.id);
  if (!comment) {
    return res.status(404).json({ message: 'Comment not found' });
  }
  const isOwner = comment.user.toString() === req.user._id.toString();
  if (!isOwner && req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({ message: 'Not allowed' });
  }
  comment.content = content.trim();
  comment.editedAt = new Date();
  comment.editedBy = req.user._id;
  await comment.save();
  await comment.populate('user', PUBLIC_USER_FIELDS);
  res.json({ comment });
});

const deleteComment = asyncHandler(async (req, res) => {
  const comment = await Comment.findById(req.params.id);
  if (!comment) {
    return res.status(404).json({ message: 'Comment not found' });
  }
  const isOwner = comment.user.toString() === req.user._id.toString();
  if (!isOwner && req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({ message: 'Not allowed' });
  }
  await comment.softDelete();
  await Comment.softDeleteMany({ parentComment: comment._id, deletedAt: null });
  res.json({ message: 'Comment deleted' });
});

const reactToComment = (field) =>
  asyncHandler(async (req, res) => {
    const comment = await Comment.findById(req.params.id);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }
    const counts = toggleReaction(comment, field, req.user._id);
    await comment.save();
    res.json(counts);
  });

const toggleCommentLike = reactToComment(REACTIONS.LIKE);

const toggleCommentDislike = reactToComment(REACTIONS.DISLIKE);

module.exports = { listComments, createComment, updateComment, deleteComment, toggleCommentLike, toggleCommentDislike };
