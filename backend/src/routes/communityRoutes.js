const express = require('express');
const {
  listComments,
  createComment,
  deleteComment,
  toggleCommentLike,
} = require('../controllers/commentController');
const {
  deleteReview,
  toggleReviewLike,
  addReviewReply,
  deleteReviewReply,
  toggleReviewReplyLike,
} = require('../controllers/reviewController');
const { protect } = require('../middlewares/auth');

const router = express.Router();

router.get('/chapters/:chapterId/comments', listComments);
router.post('/chapters/:chapterId/comments', protect, createComment);
router.delete('/comments/:id', protect, deleteComment);
router.post('/comments/:id/like', protect, toggleCommentLike);
router.delete('/reviews/:id', protect, deleteReview);
router.post('/reviews/:id/like', protect, toggleReviewLike);

router.post('/reviews/:id/replies', protect, addReviewReply);
router.delete('/reviews/:id/replies/:replyId', protect, deleteReviewReply);
router.post('/reviews/:id/replies/:replyId/like', protect, toggleReviewReplyLike);

module.exports = router;
