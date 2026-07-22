const express = require('express');
const {
  listNovels,
  getRankings,
  getFeatured,
  getGenres,
  getNovel,
  listChapters,
} = require('../controllers/novelController');
const { readChapter } = require('../controllers/chapterController');
const { listReviews, upsertReview } = require('../controllers/reviewController');
const { protect, optionalAuth } = require('../middlewares/auth');

const router = express.Router();

router.get('/', listNovels);
router.get('/rankings', getRankings);
router.get('/featured', getFeatured);
router.get('/genres', getGenres);
router.get('/:slug', optionalAuth, getNovel);
router.get('/:slug/chapters', listChapters);
router.get('/:slug/chapters/:number', optionalAuth, readChapter);
router.get('/id/:novelId/reviews', listReviews);
router.post('/id/:novelId/reviews', protect, upsertReview);

module.exports = router;
