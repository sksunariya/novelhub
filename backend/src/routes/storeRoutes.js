const express = require('express');
const {
  getStoreConfig,
  getPacks,
  createOrder,
  captureOrder,
  listOrders,
} = require('../controllers/storeController');
const { protect, optionalAuth } = require('../middlewares/auth');
const { orderLimiter, captureLimiter } = require('../middlewares/rateLimit');

const router = express.Router();

// Browsing the store does not require an account; buying does.
router.get('/config', optionalAuth, getStoreConfig);
router.get('/packs', optionalAuth, getPacks);

router.post('/orders', protect, orderLimiter, createOrder);
router.post('/orders/:id/capture', protect, captureLimiter, captureOrder);
router.get('/orders', protect, listOrders);

module.exports = router;
