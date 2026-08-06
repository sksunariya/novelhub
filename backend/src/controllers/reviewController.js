const Review = require('../models/Review');
const Novel = require('../models/Novel');
const { asyncHandler } = require('../middlewares/errorHandler');
const { ROLES, RATING, PUBLIC_USER_FIELDS } = require('../config/constants');
const { parsePagination } = require('./novelController');
const { REACTIONS, toggleReaction } = require('../utils/reactions');
const { notifyReply } = require('../utils/notifications');

const recalcNovelRating = async (novelId) => {
  const stats = await Review.aggregate([
    { $match: { novel: novelId, deletedAt: null } },
    { $group: { _id: '$novel', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const { avg = 0, count = 0 } = stats[0] || {};
  await Novel.updateOne({ _id: novelId }, { ratingAvg: Math.round(avg * 10) / 10, ratingCount: count });
};

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

const listReviews = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { novel: req.params.novelId };
  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .populate('user', PUBLIC_USER_FIELDS)
      .populate('replies.user', PUBLIC_USER_FIELDS)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Review.countDocuments(filter),
  ]);
  res.json({ reviews: reviews.map(publicReview), total, page, pages: Math.ceil(total / limit) });
});

const upsertReview = asyncHandler(async (req, res) => {
  const { rating, content } = req.body;
  const numericRating = Number(rating);
  if (!numericRating || numericRating < RATING.MIN || numericRating > RATING.MAX) {
    return res.status(400).json({ message: `rating must be between ${RATING.MIN} and ${RATING.MAX}` });
  }
  const novel = await Novel.findById(req.params.novelId);
  if (!novel) {
    return res.status(404).json({ message: 'Novel not found' });
  }
  const review = await Review.findOneAndUpdate(
    { novel: novel._id, user: req.user._id },
    { rating: numericRating, content: (content || '').trim() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await recalcNovelRating(novel._id);
  await populateReview(review);
  res.status(201).json({ review: publicReview(review) });
});

const deleteReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) {
    return res.status(404).json({ message: 'Review not found' });
  }
  const isOwner = review.user.toString() === req.user._id.toString();
  if (!isOwner && req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({ message: 'Not allowed' });
  }
  const novelId = review.novel;
  await review.softDelete();
  await recalcNovelRating(novelId);
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
  const novel = await Novel.findById(review.novel).select('slug');
  await notifyReply({
    recipient: review.user,
    actor: req.user._id,
    message: `${req.user.username} replied to your review`,
    link: novel ? `/novel/${novel.slug}` : '',
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
  if (!isOwner && req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({ message: 'Not allowed' });
  }
  reply.deletedAt = new Date();
  await review.save();
  await populateReview(review);
  res.json({ message: 'Reply deleted', review: publicReview(review) });
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

module.exports = {
  listReviews,
  upsertReview,
  deleteReview,
  toggleReviewLike,
  toggleReviewDislike,
  addReviewReply,
  deleteReviewReply,
  toggleReviewReplyLike,
  toggleReviewReplyDislike,
  recalcNovelRating,
};
