const express = require('express');
const { getSpotlight } = require('../controllers/spotlightController');

const router = express.Router();

// `optionalAuth` already ran in app.js, so the payload knows who is looking
// without requiring anyone to be.
router.get('/', getSpotlight);

module.exports = router;
