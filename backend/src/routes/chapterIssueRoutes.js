const express = require('express');
const { getCategories, submitIssue } = require('../controllers/chapterIssueController');
const { protect } = require('../middlewares/auth');
const { chapterIssueLimiter } = require('../middlewares/rateLimit');

// Reader side of chapter problem reports. The admin queue lives under
// /api/admin/chapter-issues, behind the `chapter_reports` module.
const router = express.Router();

router.get('/categories', getCategories);

// Signed-in readers only: the admin needs someone to follow up with, and the
// daily limit needs an account to count against.
router.post('/chapters/:chapterId', protect, chapterIssueLimiter, submitIssue);

module.exports = router;
