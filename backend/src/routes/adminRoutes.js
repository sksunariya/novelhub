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
  bulkPriceChapters,
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
const {
  getRegistry,
  getConfig,
  updateConfig,
  resetConfig,
  searchConfig,
  getAuditLog,
  previewImpact,
} = require('../controllers/configController');
const { getJobs, triggerJob, getJobRuns } = require('../controllers/jobsController');
const {
  getNovelLeaderboard,
  getNovelPerformance,
  getFunnel,
  getEconomy,
  getAuthorEarnings,
  getAuthorBreakdown,
  exportAuthorEarnings,
  rebuildRollups,
} = require('../controllers/analyticsController');
const { replayWebhook } = require('../controllers/webhookController');
const monetizationAdminRoutes = require('./monetizationAdminRoutes');
const adminCommunityRoutes = require('./adminCommunityRoutes');
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

// The community admin surface. Everything a moderator can do, without the
// membership requirement, plus lifecycle and oversight nobody else has.
router.use('/community', adminCommunityRoutes);

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
// Static segment, so it must precede nothing here but is kept adjacent to the
// other chapter collection routes for readability.
router.put('/novels/:id/chapters/pricing', bulkPriceChapters);
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

// Registry-backed configuration. Static paths precede the collection route so
// "registry"/"search" are never read as a section name.
router.get('/config/registry', getRegistry);
router.get('/config/search', searchConfig);
router.get('/config/audit', getAuditLog);
router.post('/config/reset', resetConfig);
router.post('/config/preview-impact', previewImpact);
router.get('/config', getConfig);
router.patch('/config', updateConfig);

// System → Jobs
router.get('/jobs/runs', getJobRuns);
router.get('/jobs', getJobs);
router.post('/jobs/:name/run', triggerJob);

// System → Webhooks
router.post('/webhooks/:id/replay', replayWebhook);

// Monetization catalogue: packs, currencies, pricing rules, wallets, orders,
// templates and grant campaigns.
router.use('/monetization', monetizationAdminRoutes);

// Analytics
router.get('/analytics/novels/:id', getNovelPerformance);
router.get('/analytics/novels', getNovelLeaderboard);
router.get('/analytics/funnel', getFunnel);
router.get('/analytics/economy', getEconomy);
// Static path before :id so "authors.csv" is not read as an author id.
router.get('/analytics/authors.csv', exportAuthorEarnings);
router.get('/analytics/authors/:id', getAuthorBreakdown);
router.get('/analytics/authors', getAuthorEarnings);
router.post('/analytics/rebuild', rebuildRollups);

module.exports = router;
