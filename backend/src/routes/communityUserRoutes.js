const express = require('express');
const {
  getProfile,
  getUserPosts,
  getUserComments,
} = require('../controllers/communityUserController');

const router = express.Router();

// Public community profiles. `optionalAuth` has already run in app.js, so the
// viewer is known where a token was sent but is never required.
router.get('/:username', getProfile);
router.get('/:username/posts', getUserPosts);
router.get('/:username/comments', getUserComments);

module.exports = router;
