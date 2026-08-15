const express = require('express');
const {
  createPost,
  getPost,
  updatePost,
  deletePost,
  votePost,
  moderatePost,
} = require('../controllers/postController');
const {
  listComments,
  createComment,
} = require('../controllers/postCommentController');
const { protect } = require('../middlewares/auth');
const { postLimiter, voteLimiter, commentLimiter } = require('../middlewares/rateLimit');

const router = express.Router();

// `optionalAuth` already ran in app.js, so read routes see req.user when a
// token was sent without requiring one.

router.post('/', protect, postLimiter, createPost);
router.get('/:id', getPost);
router.patch('/:id', protect, updatePost);
router.delete('/:id', protect, deletePost);

// The highest-frequency write on the site. Rate limited per user per minute
// from spaces.voting.perMinuteLimit.
router.post('/:id/vote', protect, voteLimiter, votePost);

router.post('/:id/moderate', protect, moderatePost);

// Comments live under their post: the tree is always fetched for one post, and
// creating a reply always needs the post's space to resolve permissions.
router.get('/:id/comments', listComments);
router.post('/:id/comments', protect, commentLimiter, createComment);

module.exports = router;
