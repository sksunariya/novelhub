const express = require('express');
const c = require('../controllers/adminCommunityController');
const { requireElevated, requireModule } = require('../middlewares/auth');
const { ELEVATED_PERMISSIONS } = require('../config/constants');

// Mounted under /api/admin, which already applies `protect, adminOnly`.
// Module visibility is per-section: the community surface is several portal
// modules sharing one router, and a superadmin hiding Reports should not also
// hide Spaces.

const router = express.Router();

// --- spaces ---------------------------------------------------------------
router.use('/spaces', requireModule('spaces'));
router.get('/spaces', c.listSpaces);
router.get('/spaces/:id', c.getSpace);
router.patch('/spaces/:id', c.updateSpace);
router.patch('/spaces/:id/overrides', c.forceOverrides);
router.post('/spaces/:id/transfer', c.transferSpace);
router.post('/spaces/:id/moderators', c.setModerator);
router.post('/spaces/:id/recount', c.recountSpace);

// approve | reject | quarantine | archive | ban | restore
//
// Approve and reject are the request queue: they decide whether a space comes
// into existence at all, which is a heavier call than moderating one that
// already has members. They carry their own module so an admin can be given
// oversight of spaces without the power to admit new ones. The rest of the
// lifecycle stays under `spaces`.
const REQUEST_ACTIONS = ['approve', 'reject'];
const requestQueueGuard = requireModule('space_requests');

router.post(
  '/spaces/:id/:action',
  (req, res, next) =>
    REQUEST_ACTIONS.includes(req.params.action) ? requestQueueGuard(req, res, next) : next(),
  c.setLifecycle
);

// --- posts ----------------------------------------------------------------
router.use('/posts', requireModule('community_posts'));
router.get('/posts', c.listPosts);
router.post('/posts/bulk', c.bulkPosts);

// --- moderation -----------------------------------------------------------
// Reports, appeals and the transparency figures are one queue in practice, so
// they share a module. The mod log is separate: it is the read-only history an
// admin may be given without also being given the power to action anything.
router.use('/reports', requireModule('community_reports'));
router.use('/appeals', requireModule('community_reports'));
router.use('/transparency', requireModule('community_reports'));
router.get('/reports', c.listReports);
router.get('/reports/detail', c.reportDetail);
router.get('/modlog', requireModule('community_modlog'), c.listModActions);
router.get('/appeals', c.listAppeals);
router.get('/transparency', c.transparencyReport);

// --- users ----------------------------------------------------------------
router.use('/users', requireModule('users'));
router.get('/users/:id', c.userDetail);
router.post('/users/:id/community-ban', c.setCommunityBan);
router.post('/users/:id/space-creation', c.setSpaceCreationPolicy);
router.post('/users/:id/karma', c.adjustKarma);

// --- insights and maintenance --------------------------------------------
router.get('/insights', requireModule('spaces'), c.insights);
router.post('/rebuild', requireModule('spaces'), c.rebuild);

// --- child safety (RESTRICTED) -------------------------------------------
// Being an admin is deliberately NOT sufficient. The permission is granted
// explicitly per account, which keeps the set of people who can see this
// material small, intentional and auditable.
//
// Module visibility is checked as well as, never instead of, the permission.
// A superadmin turning the module on for an admin does not hand them the
// queue — the explicit grant is still required, and both must hold.
router.use('/safety', requireModule('community_safety'));
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
