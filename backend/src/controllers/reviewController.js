const Review = require('../models/Review');
const Novel = require('../models/Novel');
const Chapter = require('../models/Chapter');
const { asyncHandler } = require('../middlewares/errorHandler');
const { RATING, PUBLIC_USER_FIELDS } = require('../config/constants');
const moduleAccess = require('../services/moduleAccessService');

// Admin authority to moderate comments and reviews, which is what the
// `moderation` portal module grants. Checked here as well as on the portal
// routes because these endpoints are public: an admin whose module is hidden
// must not keep the power simply by calling the API the reader UI uses.
const canModerate = (user) => moduleAccess.hasCapability(user, 'moderation');
const { parsePagination } = require('./novelController');
const { REACTIONS, toggleReaction } = require('../utils/reactions');
const { notifyCommentActivity } = require('../utils/notifications');

const averageOf = (stats) => {
  const { avg = 0, count = 0 } = stats[0] || {};
  return { ratingAvg: Math.round(avg * 10) / 10, ratingCount: count };
};

// Only novel-level reviews (chapter: null) feed the novel's rating; chapter reviews
// roll up into their own chapter.
const recalcNovelRating = async (novelId) => {
  const stats = await Review.aggregate([
    { $match: { novel: novelId, chapter: null, deletedAt: null, rating: { $gt: 0 } } },
    { $group: { _id: '$novel', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  await Novel.updateOne({ _id: novelId }, averageOf(stats));
};

const recalcChapterRating = async (chapterId) => {
  const stats = await Review.aggregate([
    { $match: { chapter: chapterId, deletedAt: null, rating: { $gt: 0 } } },
    { $group: { _id: '$chapter', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  await Chapter.updateOne({ _id: chapterId }, averageOf(stats));
};

const recalcForReview = (review) =>
  review.chapter ? recalcChapterRating(review.chapter) : recalcNovelRating(review.novel);

// Replies are subdocuments, so the soft-delete plugin cannot filter them; strip
// deleted ones before a review leaves the public API.
const publicReview = (review) => {
  const json = review.toJSON();
  json.replies = (json.replies || []).filter((reply) => !reply.deletedAt);
  return json;
};

const populateReview = async (review) => {
  await review.populate('user', PUBLIC_USER_FIELDS);
  await review.populate('replies.user', PUBLIC_USER_FIELDS);
  return review;
};

const sendReviewList = async (req, res, filter) => {
  const { page, limit, skip } = parsePagination(req.query);
  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .populate('user', PUBLIC_USER_FIELDS)
      .populate('replies.user', PUBLIC_USER_FIELDS)
      .sort({ isPinned: -1, pinnedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Review.countDocuments(filter),
  ]);
  res.json({ reviews: reviews.map(publicReview), total, page, pages: Math.ceil(total / limit) });
};

const listReviews = asyncHandler((req, res) =>
  sendReviewList(req, res, { novel: req.params.novelId, chapter: null })
);

const listChapterReviews = asyncHandler((req, res) =>
  sendReviewList(req, res, { chapter: req.params.chapterId })
);

const parseRating = (rating) => {
  const numericRating = Number(rating);
  return numericRating >= RATING.MIN && numericRating <= RATING.MAX ? numericRating : 0;
};

const saveReview = async (res, { novelId, chapterId, reqUser, rating, content }) => {
  const review = await Review.create({
    novel: novelId,
    chapter: chapterId,
    user: reqUser._id,
    rating,
    content: (content || '').trim(),
  });
  await recalcForReview(review);
  await populateReview(review);
  const novel = await Novel.findById(novelId).select('slug');
  const link = novel ? `/novel/${novel.slug}#review-${review._id}` : '';
  await notifyCommentActivity({
    parentAuthor: null,
    actor: reqUser,
    content: (content || '').trim(),
    link,
    commentContext: 'review',
  });
  res.status(201).json({ review: publicReview(review) });
};

const upsertReview = asyncHandler(async (req, res) => {
  const rating = parseRating(req.body.rating);
  const content = (req.body.content || '').trim();
  if (!rating && !content) {
    return res.status(400).json({ message: 'Content or rating is required' });
  }
  const novel = await Novel.findById(req.params.novelId);
  if (!novel) {
    return res.status(404).json({ message: 'Novel not found' });
  }
  return saveReview(res, {
    novelId: novel._id,
    chapterId: null,
    reqUser: req.user,
    rating,
    content,
  });
});

const upsertChapterReview = asyncHandler(async (req, res) => {
  const rating = parseRating(req.body.rating);
  const content = (req.body.content || '').trim();
  if (!rating && !content) {
    return res.status(400).json({ message: 'Content or rating is required' });
  }
  const chapter = await Chapter.findById(req.params.chapterId);
  if (!chapter) {
    return res.status(404).json({ message: 'Chapter not found' });
  }
  return saveReview(res, {
    novelId: chapter.novel,
    chapterId: chapter._id,
    reqUser: req.user,
    rating,
    content,
  });
});

const updateReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) {
    return res.status(404).json({ message: 'Review not found' });
  }
  const isOwner = review.user.toString() === req.user._id.toString();
  if (!isOwner && !canModerate(req.user)) {
    return res.status(403).json({ message: 'Not allowed' });
  }
  const newContent = req.body.content !== undefined ? String(req.body.content || '').trim() : review.content;
  const newRating = req.body.rating !== undefined ? parseRating(req.body.rating) : review.rating;
  if (!newContent && !newRating) {
    return res.status(400).json({ message: 'Content or rating is required' });
  }
  review.content = newContent;
  review.rating = newRating;
  review.editedAt = new Date();
  review.editedBy = req.user._id;
  await review.save();
  await recalcForReview(review);
  await populateReview(review);
  res.json({ review: publicReview(review) });
});

const deleteReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) {
    return res.status(404).json({ message: 'Review not found' });
  }
  const isOwner = review.user.toString() === req.user._id.toString();
  if (!isOwner && !canModerate(req.user)) {
    return res.status(403).json({ message: 'Not allowed' });
  }
  await review.softDelete();
  await recalcForReview(review);
  res.json({ message: 'Review deleted' });
});

const reactToReview = (field) =>
  asyncHandler(async (req, res) => {
    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }
    const counts = toggleReaction(review, field, req.user._id);
    await review.save();
    res.json(counts);
  });

const toggleReviewLike = reactToReview(REACTIONS.LIKE);

const toggleReviewDislike = reactToReview(REACTIONS.DISLIKE);

const addReviewReply = asyncHandler(async (req, res) => {
  const { content } = req.body;
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ message: 'content is required' });
  }
  const review = await Review.findById(req.params.id);
  if (!review) {
    return res.status(404).json({ message: 'Review not found' });
  }
  review.replies.push({ user: req.user._id, content: content.trim() });
  await review.save();
  const createdReply = review.replies[review.replies.length - 1];
  let link = '';
  if (createdReply) {
    if (review.chapter) {
      const [novel, chapter] = await Promise.all([
        Novel.findById(review.novel).select('slug'),
        Chapter.findById(review.chapter).select('number'),
      ]);
      if (novel && chapter) {
        link = `/novel/${novel.slug}/chapter/${chapter.number}#review-${createdReply._id}`;
      }
    } else {
      const novel = await Novel.findById(review.novel).select('slug');
      if (novel) {
        link = `/novel/${novel.slug}#review-${createdReply._id}`;
      }
    }
  }
  await notifyCommentActivity({
    parentAuthor: review.user,
    actor: req.user,
    content: content.trim(),
    link,
    commentContext: 'review',
  });
  await populateReview(review);
  res.status(201).json({ review: publicReview(review) });
});

const findVisibleReply = (review, replyId) => {
  const reply = review.replies.id(replyId);
  return reply && !reply.deletedAt ? reply : null;
};

const deleteReviewReply = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) {
    return res.status(404).json({ message: 'Review not found' });
  }
  const reply = findVisibleReply(review, req.params.replyId);
  if (!reply) {
    return res.status(404).json({ message: 'Reply not found' });
  }
  const isOwner = reply.user.toString() === req.user._id.toString();
  if (!isOwner && !canModerate(req.user)) {
    return res.status(403).json({ message: 'Not allowed' });
  }
  reply.deletedAt = new Date();
  await review.save();
  await populateReview(review);
  res.json({ message: 'Reply deleted', review: publicReview(review) });
});

const updateReviewReply = asyncHandler(async (req, res) => {
  const { content } = req.body;
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ message: 'content is required' });
  }
  const review = await Review.findById(req.params.id);
  if (!review) {
    return res.status(404).json({ message: 'Review not found' });
  }
  const reply = findVisibleReply(review, req.params.replyId);
  if (!reply) {
    return res.status(404).json({ message: 'Reply not found' });
  }
  const isOwner = reply.user.toString() === req.user._id.toString();
  if (!isOwner && !canModerate(req.user)) {
    return res.status(403).json({ message: 'Not allowed' });
  }
  reply.content = content.trim();
  reply.editedAt = new Date();
  reply.editedBy = req.user._id;
  await review.save();
  await populateReview(review);
  res.json({ review: publicReview(review) });
});

const reactToReviewReply = (field) =>
  asyncHandler(async (req, res) => {
    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }
    const reply = findVisibleReply(review, req.params.replyId);
    if (!reply) {
      return res.status(404).json({ message: 'Reply not found' });
    }
    const counts = toggleReaction(reply, field, req.user._id);
    await review.save();
    await populateReview(review);
    res.json({ ...counts, review: publicReview(review) });
  });

const toggleReviewReplyLike = reactToReviewReply(REACTIONS.LIKE);

const toggleReviewReplyDislike = reactToReviewReply(REACTIONS.DISLIKE);

const toggleReviewPin = asyncHandler(async (req, res) => {
  if (!canModerate(req.user)) {
    return res.status(403).json({ message: 'Not allowed' });
  }
  const review = await Review.findById(req.params.id);
  if (!review) {
    return res.status(404).json({ message: 'Review not found' });
  }
  review.isPinned = !review.isPinned;
  review.pinnedAt = review.isPinned ? new Date() : null;
  review.pinnedBy = review.isPinned ? req.user._id : null;
  await review.save();
  await populateReview(review);
  res.json({ review: publicReview(review) });
});

module.exports = {
  listReviews,
  listChapterReviews,
  upsertReview,
  upsertChapterReview,
  updateReview,
  deleteReview,
  toggleReviewLike,
  toggleReviewDislike,
  toggleReviewPin,
  addReviewReply,
  updateReviewReply,
  deleteReviewReply,
  toggleReviewReplyLike,
  toggleReviewReplyDislike,
  recalcNovelRating,
  recalcChapterRating,
  recalcForReview,
};
