const Review = require('../models/Review');
const Novel = require('../models/Novel');
const { asyncHandler } = require('../middlewares/errorHandler');
const { ROLES, RATING } = require('../config/constants');
const { parsePagination } = require('./novelController');

const recalcNovelRating = async (novelId) => {
  const stats = await Review.aggregate([
    { $match: { novel: novelId } },
    { $group: { _id: '$novel', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const { avg = 0, count = 0 } = stats[0] || {};
  await Novel.updateOne({ _id: novelId }, { ratingAvg: Math.round(avg * 10) / 10, ratingCount: count });
};

const listReviews = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { novel: req.params.novelId };
  const [reviews, total] = await Promise.all([
    Review.find(filter).populate('user', 'username avatarUrl').sort({ createdAt: -1 }).skip(skip).limit(limit),
    Review.countDocuments(filter),
  ]);
  res.json({ reviews, total, page, pages: Math.ceil(total / limit) });
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
  await review.populate('user', 'username avatarUrl');
  res.status(201).json({ review });
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

const toggleReviewLike = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) {
    return res.status(404).json({ message: 'Review not found' });
  }
  const userId = req.user._id.toString();
  const liked = review.likes.some((id) => id.toString() === userId);
  if (liked) {
    review.likes = review.likes.filter((id) => id.toString() !== userId);
  } else {
    review.likes.push(req.user._id);
  }
  await review.save();
  res.json({ liked: !liked, likeCount: review.likes.length });
});

module.exports = { listReviews, upsertReview, deleteReview, toggleReviewLike };
