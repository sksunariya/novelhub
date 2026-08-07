const Novel = require('../models/Novel');
const Chapter = require('../models/Chapter');
const Review = require('../models/Review');
const { asyncHandler } = require('../middlewares/errorHandler');
const { PAGINATION, RANKING_TYPES, VIEW_TARGET_TYPES } = require('../config/constants');
const { getViewerKey, registerView } = require('../utils/viewTracking');

const parsePagination = (query) => {
  const page = Math.max(parseInt(query.page, 10) || PAGINATION.DEFAULT_PAGE, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || PAGINATION.DEFAULT_LIMIT, 1), PAGINATION.MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
};

const SORT_OPTIONS = {
  latest: { lastChapterAt: -1, createdAt: -1 },
  newest: { createdAt: -1 },
  popular: { views: -1 },
  trending: { weeklyViews: -1 },
  rating: { ratingAvg: -1, ratingCount: -1 },
  title: { title: 1 },
};

const listNovels = asyncHandler(async (req, res) => {
  const { search, genre, tag, status, sort } = req.query;
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { published: true };
  if (search) {
    filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { author: { $regex: search, $options: 'i' } },
    ];
  }
  if (genre) {
    filter.genres = genre;
  }
  if (tag) {
    filter.tags = tag;
  }
  if (status) {
    filter.status = status;
  }
  const sortBy = SORT_OPTIONS[sort] || SORT_OPTIONS.latest;
  const [novels, total] = await Promise.all([
    Novel.find(filter).sort(sortBy).skip(skip).limit(limit),
    Novel.countDocuments(filter),
  ]);
  res.json({ novels, total, page, pages: Math.ceil(total / limit) });
});

const getRankings = asyncHandler(async (req, res) => {
  const type = req.query.type || RANKING_TYPES.TRENDING;
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, PAGINATION.MAX_LIMIT);
  const sortMap = {
    [RANKING_TYPES.TRENDING]: { weeklyViews: -1 },
    [RANKING_TYPES.POPULAR]: { views: -1 },
    [RANKING_TYPES.RATING]: { ratingAvg: -1, ratingCount: -1 },
    [RANKING_TYPES.NEW]: { createdAt: -1 },
  };
  const sortBy = sortMap[type];
  if (!sortBy) {
    return res.status(400).json({ message: 'Invalid ranking type' });
  }
  const novels = await Novel.find({ published: true }).sort(sortBy).limit(limit);
  res.json({ novels });
});

const getFeatured = asyncHandler(async (req, res) => {
  const novels = await Novel.find({ published: true, featured: true }).sort({ updatedAt: -1 }).limit(10);
  res.json({ novels });
});

const getGenres = asyncHandler(async (req, res) => {
  const genres = await Novel.distinct('genres', { published: true });
  res.json({ genres: genres.sort() });
});

const getNovel = asyncHandler(async (req, res) => {
  const novel = await Novel.findOne({ slug: req.params.slug, published: true });
  if (!novel) {
    return res.status(404).json({ message: 'Novel not found' });
  }
  const isNewView = await registerView(VIEW_TARGET_TYPES.NOVEL, novel._id, getViewerKey(req));
  if (isNewView) {
    await Novel.updateOne({ _id: novel._id }, { $inc: { views: 1, weeklyViews: 1 } });
  }
  const userReview = req.user
    ? await Review.findOne({ novel: novel._id, chapter: null, user: req.user._id })
    : null;
  res.json({ novel, userReview });
});

const listChapters = asyncHandler(async (req, res) => {
  const novel = await Novel.findOne({ slug: req.params.slug, published: true });
  if (!novel) {
    return res.status(404).json({ message: 'Novel not found' });
  }
  const chapters = await Chapter.find({ novel: novel._id, published: true })
    .select('number title views createdAt')
    .sort({ number: 1 });
  res.json({ chapters });
});

module.exports = { listNovels, getRankings, getFeatured, getGenres, getNovel, listChapters, parsePagination };
