const express = require('express');
const { getPublicSettings } = require('../controllers/settingsController');

const router = express.Router();

router.get('/', getPublicSettings);

module.exports = router;
