const express = require('express');
const {
  getReasons,
  submitReport,
  getQueue,
  reviewReport,
  claimReport,
  myStatements,
  submitAppeal,
  resolveAppeal,
} = require('../controllers/reportController');
const { protect } = require('../middlewares/auth');
const { reportLimiter } = require('../middlewares/rateLimit');

const router = express.Router();

// The reason list the report dialog renders from.
router.get('/reasons', getReasons);

// ORDER MATTERS, AND IT BIT US ONCE.
//
// `/:type/:id` matches ANY two-segment POST, so when it was registered first it
// swallowed `/:id/claim` — claiming a report from the mod queue ran
// submitReport with id="claim" and died on a cast error. Express matches in
// registration order, so every literal-prefixed route has to come first, and
// the catch-all pattern has to come last.
//
// Keep the wildcard at the bottom of this file. Anything added below it is
// unreachable.

// Review.
router.get('/queue', protect, getQueue);
router.get('/queue/:slug', protect, getQueue);
router.post('/review', protect, reviewReport);
router.post('/:id/claim', protect, claimReport);

// Statements of reasons and appeals — the DSA Article 17 mechanism. A user can
// see every decision taken against them and contest it; a person reviews.
router.get('/statements/mine', protect, myStatements);
router.post('/appeals', protect, submitAppeal);
router.post('/appeals/:id/resolve', protect, resolveAppeal);

// Filing. Rate limited from spaces.moderation.maxReportsPerUserPerDay — without
// it, one person can bury a lot of content by working through a list.
//
// LAST, because the pattern is greedy. See the note above.
router.post('/:type/:id', protect, reportLimiter, submitReport);

module.exports = router;
