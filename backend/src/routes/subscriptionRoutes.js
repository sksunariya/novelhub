const express = require('express');
const s = require('../controllers/subscriptionController');
const { protect, optionalAuth } = require('../middlewares/auth');
const { orderLimiter } = require('../middlewares/rateLimit');

const router = express.Router();

// Browsing tiers is public; the current subscription is folded in when signed in.
router.get('/plans', optionalAuth, s.listPlans);

router.get('/me', protect, s.mySubscription);
router.post('/', protect, orderLimiter, s.subscribe);
router.post('/:id/confirm', protect, s.confirm);
router.delete('/', protect, s.cancelMine);

module.exports = router;
