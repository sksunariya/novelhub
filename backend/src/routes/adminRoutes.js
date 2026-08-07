const express = require('express');
const {
  uploadEditorImage,
  getStats,
  listAllNovels,
  createNovel,
  updateNovel,
  deleteNovel,
  listNovelChapters,
  getChapter,
  getChapterSource,
  createChapter,
  uploadChapterFile,
  bulkUploadChapters,
  updateChapter,
  deleteChapter,
  listUsers,
  updateUser,
  deleteUser,
  listAllComments,
  listAllReviews,
  updateComment,
  restoreComment,
  updateReview,
  restoreReview,
  updateReviewReply,
  restoreReviewReply,
  getAdminSettings,
  updateSettings,
  broadcastAnnouncement,
  dispatchAdminNotification,
  listCampaigns,
} = require('../controllers/adminController');
const { protect, adminOnly } = require('../middlewares/auth');
const { imageUpload, docUpload } = require('../middlewares/upload');

const {
  getAdminSlides,
  createSlide,
  updateSlide,
  deleteSlide,
  reorderSlides,
} = require('../controllers/carouselController');

const router = express.Router();

router.use(protect, adminOnly);

router.get('/stats', getStats);

router.post('/uploads/image', imageUpload.single('image'), uploadEditorImage);

// Carousel Admin Routes
router.get('/carousel', getAdminSlides);
router.post('/carousel', imageUpload.single('image'), createSlide);
router.put('/carousel/reorder', reorderSlides);
router.put('/carousel/:id', imageUpload.single('image'), updateSlide);
router.delete('/carousel/:id', deleteSlide);

router.get('/novels', listAllNovels);
router.post('/novels', imageUpload.single('cover'), createNovel);
router.put('/novels/:id', imageUpload.single('cover'), updateNovel);
router.delete('/novels/:id', deleteNovel);

router.get('/novels/:id/chapters', listNovelChapters);
router.post('/novels/:id/chapters', createChapter);
router.post('/novels/:id/chapters/upload', docUpload.single('file'), uploadChapterFile);
router.post('/novels/:id/chapters/bulk', docUpload.single('file'), bulkUploadChapters);
router.get('/chapters/:id', getChapter);
router.get('/chapters/:id/source', getChapterSource);
router.put('/chapters/:id', updateChapter);
router.delete('/chapters/:id', deleteChapter);

router.get('/users', listUsers);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

router.get('/comments', listAllComments);
router.put('/comments/:id', updateComment);
router.post('/comments/:id/restore', restoreComment);

router.get('/reviews', listAllReviews);
router.put('/reviews/:id', updateReview);
router.post('/reviews/:id/restore', restoreReview);
router.put('/reviews/:id/replies/:replyId', updateReviewReply);
router.post('/reviews/:id/replies/:replyId/restore', restoreReviewReply);

router.get('/settings', getAdminSettings);
router.put(
  '/settings',
  imageUpload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'favicon', maxCount: 1 },
  ]),
  updateSettings
);
router.post('/announcements', broadcastAnnouncement);

router.post('/notifications/dispatch', dispatchAdminNotification);
router.get('/notifications/campaigns', listCampaigns);

module.exports = router;
