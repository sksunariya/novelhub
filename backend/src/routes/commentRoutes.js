const express = require('express');
const {
  listReplies,
  updateComment,
  deleteComment,
  voteComment,
  moderateComment,
  commentHistory,
} = require('../controllers/postCommentController');
const { protect } = require('../middlewares/auth');
const { voteLimiter } = require('../middlewares/rateLimit');

const router = express.Router();

// Operations on a single comment. Listing and creating live under the post
// (see postRoutes) because both need the post to resolve permissions.

// Lazy expansion below the initial depth the tree ships with.
router.get('/:id/replies', listReplies);
router.get('/:id/history', commentHistory);

router.patch('/:id', protect, updateComment);
router.delete('/:id', protect, deleteComment);
router.post('/:id/vote', protect, voteLimiter, voteComment);
router.post('/:id/moderate', protect, moderateComment);

module.exports = router;
