const express = require('express');
const c = require('../controllers/adminCommunityController');
const { requireElevated } = require('../middlewares/auth');
const { ELEVATED_PERMISSIONS } = require('../config/constants');

// Mounted under /api/admin, which already applies `protect, adminOnly`.

const router = express.Router();

// --- spaces ---------------------------------------------------------------
router.get('/spaces', c.listSpaces);
router.get('/spaces/:id', c.getSpace);
router.patch('/spaces/:id', c.updateSpace);
router.patch('/spaces/:id/overrides', c.forceOverrides);
router.post('/spaces/:id/transfer', c.transferSpace);
router.post('/spaces/:id/moderators', c.setModerator);
router.post('/spaces/:id/recount', c.recountSpace);
// approve | reject | quarantine | archive | ban | restore
router.post('/spaces/:id/:action', c.setLifecycle);

// --- posts ----------------------------------------------------------------
router.get('/posts', c.listPosts);
router.post('/posts/bulk', c.bulkPosts);

// --- moderation -----------------------------------------------------------
router.get('/reports', c.listReports);
router.get('/reports/detail', c.reportDetail);
router.get('/modlog', c.listModActions);
router.get('/appeals', c.listAppeals);
router.get('/transparency', c.transparencyReport);

// --- users ----------------------------------------------------------------
router.get('/users/:id', c.userDetail);
router.post('/users/:id/community-ban', c.setCommunityBan);
router.post('/users/:id/space-creation', c.setSpaceCreationPolicy);
router.post('/users/:id/karma', c.adjustKarma);

// --- insights and maintenance --------------------------------------------
router.get('/insights', c.insights);
router.post('/rebuild', c.rebuild);

// --- child safety (RESTRICTED) -------------------------------------------
// Being an admin is deliberately NOT sufficient. The permission is granted
// explicitly per account, which keeps the set of people who can see this
// material small, intentional and auditable.
router.get(
  '/safety/incidents',
  requireElevated(ELEVATED_PERMISSIONS.CHILD_SAFETY),
  c.listIncidents
);
router.post(
  '/safety/incidents/:id/review',
  requireElevated(ELEVATED_PERMISSIONS.CHILD_SAFETY),
  c.reviewIncident
);

module.exports = router;
