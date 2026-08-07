const express = require('express');
const {
  listComments,
  createComment,
  updateComment,
  deleteComment,
  toggleCommentLike,
  toggleCommentDislike,
} = require('../controllers/commentController');
const {
  listChapterReviews,
  upsertChapterReview,
  updateReview,
  deleteReview,
  toggleReviewLike,
  toggleReviewDislike,
  addReviewReply,
  deleteReviewReply,
  toggleReviewReplyLike,
  toggleReviewReplyDislike,
} = require('../controllers/reviewController');
const { protect } = require('../middlewares/auth');

const router = express.Router();

router.get('/chapters/:chapterId/comments', listComments);
router.post('/chapters/:chapterId/comments', protect, createComment);
router.put('/comments/:id', protect, updateComment);
router.delete('/comments/:id', protect, deleteComment);
router.post('/comments/:id/like', protect, toggleCommentLike);
router.post('/comments/:id/dislike', protect, toggleCommentDislike);
router.get('/chapters/:chapterId/reviews', listChapterReviews);
router.post('/chapters/:chapterId/reviews', protect, upsertChapterReview);
router.put('/reviews/:id', protect, updateReview);
router.delete('/reviews/:id', protect, deleteReview);
router.post('/reviews/:id/like', protect, toggleReviewLike);
router.post('/reviews/:id/dislike', protect, toggleReviewDislike);

router.post('/reviews/:id/replies', protect, addReviewReply);
router.delete('/reviews/:id/replies/:replyId', protect, deleteReviewReply);
router.post('/reviews/:id/replies/:replyId/like', protect, toggleReviewReplyLike);
router.post('/reviews/:id/replies/:replyId/dislike', protect, toggleReviewReplyDislike);

module.exports = router;
