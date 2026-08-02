const Comment = require('../models/Comment');
const Chapter = require('../models/Chapter');
const { asyncHandler } = require('../middlewares/errorHandler');
const { ROLES } = require('../config/constants');
const { parsePagination } = require('./novelController');

const listComments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { chapter: req.params.chapterId };
  const [comments, total] = await Promise.all([
    Comment.find(filter).populate('user', 'username avatarUrl').sort({ createdAt: -1 }).skip(skip).limit(limit),
    Comment.countDocuments(filter),
  ]);
  res.json({ comments, total, page, pages: Math.ceil(total / limit) });
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
  let parentId = null;
  if (parentComment) {
    const parent = await Comment.findById(parentComment);
    if (!parent) {
      return res.status(404).json({ message: 'Parent comment not found' });
    }
    parentId = parent._id;
  }
  const comment = await Comment.create({
    chapter: chapter._id,
    novel: chapter.novel,
    user: req.user._id,
    parentComment: parentId,
    content: content.trim(),
  });
  await comment.populate('user', 'username avatarUrl');
  res.status(201).json({ comment });
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
  await Comment.updateMany({ parentComment: comment._id, deletedAt: null }, { deletedAt: new Date() });
  res.json({ message: 'Comment deleted' });
});

const toggleCommentLike = asyncHandler(async (req, res) => {
  const comment = await Comment.findById(req.params.id);
  if (!comment) {
    return res.status(404).json({ message: 'Comment not found' });
  }
  const userId = req.user._id.toString();
  const liked = comment.likes.some((id) => id.toString() === userId);
  if (liked) {
    comment.likes = comment.likes.filter((id) => id.toString() !== userId);
  } else {
    comment.likes.push(req.user._id);
  }
  await comment.save();
  res.json({ liked: !liked, likeCount: comment.likes.length });
});

module.exports = { listComments, createComment, deleteComment, toggleCommentLike };
