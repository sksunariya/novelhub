const express = require('express');
const { handlePaypalWebhook } = require('../controllers/webhookController');

// Mounted at /webhooks, deliberately outside /api so the maintenance guard
// cannot 503 PayPal. See app.js.
const router = express.Router();

router.post('/paypal', handlePaypalWebhook);

module.exports = router;
