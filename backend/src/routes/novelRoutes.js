const express = require('express');
const {
  listNovels,
  getRankings,
  getFeatured,
  getGenres,
  getNovel,
  listChapters,
} = require('../controllers/novelController');
const {
  readChapter,
  getChapterAccess,
  unlockChapter,
  unlockBulk,
} = require('../controllers/chapterController');
const { listReviews, upsertReview } = require('../controllers/reviewController');
const { protect, optionalAuth } = require('../middlewares/auth');
const { unlockLimiter } = require('../middlewares/rateLimit');

const router = express.Router();

router.get('/', listNovels);
router.get('/rankings', getRankings);
router.get('/featured', getFeatured);
router.get('/genres', getGenres);
router.get('/:slug', optionalAuth, getNovel);
// optionalAuth so the list can show owned/locked/price per chapter.
router.get('/:slug/chapters', optionalAuth, listChapters);
router.get('/:slug/chapters/:number', optionalAuth, readChapter);
router.get('/:slug/chapters/:number/access', optionalAuth, getChapterAccess);
router.post('/:slug/chapters/:number/unlock', protect, unlockLimiter, unlockChapter);
router.post('/:slug/unlock-bulk', protect, unlockLimiter, unlockBulk);
router.get('/id/:novelId/reviews', listReviews);
router.post('/id/:novelId/reviews', protect, upsertReview);

module.exports = router;
