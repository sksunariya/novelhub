const express = require('express');
const {
  listSpaces,
  getSpace,
  getCreationEligibility,
  createSpace,
  updateSpace,
  getSpaceSettings,
  updateSpaceSettings,
  joinSpace,
  leaveSpace,
  listMembers,
  updateMember,
  transferOwnership,
  listRules,
  createRule,
  updateRule,
  deleteRule,
  reorderRules,
  listPublicModlog,
  listFlairs,
  createFlair,
} = require('../controllers/spaceController');
const { protect } = require('../middlewares/auth');
const { createLimiter } = require('../middlewares/rateLimit');

const router = express.Router();

// Creating a space is the most abusable write in Phase 1 — cheap to attempt,
// permanent if it succeeds, and squatting a good name is worth real effort.
// The service enforces a cooldown too; this stops the burst before it reaches
// the database.
const HOUR = 60 * 60 * 1000;
const createSpaceLimiter = createLimiter('spaces.creation.maxPerUser', HOUR, 'space.create');

// `optionalAuth` already ran in app.js, so req.user is populated where a token
// was sent. Read endpoints use it to resolve viewer permissions; they do not
// require it.

router.get('/', listSpaces);
router.get('/eligibility', protect, getCreationEligibility);
router.post('/', protect, createSpaceLimiter, createSpace);

router.get('/:slug', getSpace);
router.patch('/:slug', protect, updateSpace);

router.get('/:slug/settings', protect, getSpaceSettings);
router.patch('/:slug/settings', protect, updateSpaceSettings);

router.post('/:slug/join', protect, joinSpace);
router.post('/:slug/leave', protect, leaveSpace);

router.get('/:slug/members', listMembers);
router.patch('/:slug/members/:userId', protect, updateMember);
router.post('/:slug/transfer', protect, transferOwnership);

router.get('/:slug/rules', listRules);
router.post('/:slug/rules', protect, createRule);
router.put('/:slug/rules/reorder', protect, reorderRules);
router.patch('/:slug/rules/:ruleId', protect, updateRule);
router.delete('/:slug/rules/:ruleId', protect, deleteRule);

// Opt-in per space; 404s when the space has not published one.
router.get('/:slug/modlog', listPublicModlog);

router.get('/:slug/flairs', listFlairs);
router.post('/:slug/flairs', protect, createFlair);

module.exports = router;
