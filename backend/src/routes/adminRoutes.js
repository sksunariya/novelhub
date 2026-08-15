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
const accessControl = require('../controllers/accessControlController');
const monetizationAdminRoutes = require('./monetizationAdminRoutes');
const adminCommunityRoutes = require('./adminCommunityRoutes');
const { protect, adminOnly, superAdminOnly, requireModule, requireAnyModule } = require('../middlewares/auth');
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

// Every group below carries the same module id as its nav entry. Hiding a link
// without closing the route would leave the data one guessed URL away, so the
// guard lives here and the nav merely reflects it. See middlewares/auth.js.

// What the caller may see. Read by the portal shell on load, so it is open to
// any admin — it reports their own access and nobody else's.
router.get('/access-control/me', accessControl.getMyAccess);

// The governance surface itself. Superadmin only: an admin who could edit the
// matrix constraining them would make the matrix decorative.
router.get('/access-control/modules', superAdminOnly, accessControl.getModules);
router.put('/access-control/global', superAdminOnly, accessControl.updateGlobal);
router.get('/access-control/admins', superAdminOnly, accessControl.listAdmins);
router.put('/access-control/admins/:id', superAdminOnly, accessControl.updateAdmin);
router.post('/access-control/admins/:id/role', superAdminOnly, accessControl.setRole);

// The community admin surface. Everything a moderator can do, without the
// membership requirement, plus lifecycle and oversight nobody else has.
// Module guards are per-section inside that router.
router.use('/community', adminCommunityRoutes);

// Dashboard stats. `dashboard` is alwaysOn — an admin with no landing page has
// no portal — so this is deliberately ungated.
router.get('/stats', getStats);

router.post('/uploads/image', requireModule('novels'), imageUpload.single('image'), uploadEditorImage);

// Carousel Admin Routes
router.use('/carousel', requireModule('carousel'));
router.get('/carousel', getAdminSlides);
router.post('/carousel', imageUpload.single('image'), createSlide);
router.put('/carousel/reorder', reorderSlides);
router.put('/carousel/:id', imageUpload.single('image'), updateSlide);
router.delete('/carousel/:id', deleteSlide);

router.use('/novels', requireModule('novels'));
router.use('/chapters', requireModule('novels'));
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

router.use('/users', requireModule('users'));
router.get('/users', listUsers);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

router.use('/comments', requireModule('moderation'));
router.use('/reviews', requireModule('moderation'));
router.get('/comments', listAllComments);
router.put('/comments/:id', updateComment);
router.post('/comments/:id/restore', restoreComment);

router.get('/reviews', listAllReviews);
router.put('/reviews/:id', updateReview);
router.post('/reviews/:id/restore', restoreReview);
router.put('/reviews/:id/replies/:replyId', updateReviewReply);
router.post('/reviews/:id/replies/:replyId/restore', restoreReviewReply);

router.use('/settings', requireModule('site_settings'));
router.get('/settings', getAdminSettings);
router.put(
  '/settings',
  imageUpload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'favicon', maxCount: 1 },
  ]),
  updateSettings
);

// Announcements reach every user, so they belong to Notifications rather than
// to site branding, whatever the URL suggests.
router.post('/announcements', requireModule('notifications'), broadcastAnnouncement);

router.use('/notifications', requireModule('notifications'));
router.post('/notifications/dispatch', dispatchAdminNotification);
router.get('/notifications/campaigns', listCampaigns);

// Registry-backed configuration. Static paths precede the collection route so
// "registry"/"search" are never read as a section name.
//
// The screen spans three domains, so the gate here is "has at least one of the
// three config modules" and the controller filters each response down to the
// sections the caller actually holds. A single module guard would have made
// hiding monetization settings also hide auth, ranking and community rules.
router.use('/config', requireAnyModule(['monetization_config', 'platform_config', 'community_config']));
router.get('/config/registry', getRegistry);
router.get('/config/search', searchConfig);
router.get('/config/audit', getAuditLog);
router.post('/config/reset', resetConfig);
router.post('/config/preview-impact', previewImpact);
router.get('/config', getConfig);
router.patch('/config', updateConfig);

// System → Jobs
router.use('/jobs', requireModule('jobs'));
router.get('/jobs/runs', getJobRuns);
router.get('/jobs', getJobs);
router.post('/jobs/:name/run', triggerJob);

// System → Webhooks. Replay is a job-shaped operation and shares its module.
router.post('/webhooks/:id/replay', requireModule('jobs'), replayWebhook);

// Monetization catalogue: packs, currencies, pricing rules, wallets, orders,
// templates and grant campaigns. Module guards are per-section inside.
router.use('/monetization', monetizationAdminRoutes);

// Analytics
router.use('/analytics', requireModule('analytics'));
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
