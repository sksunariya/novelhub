const express = require('express');
const { getPublicSlides } = require('../controllers/carouselController');

const router = express.Router();

router.get('/', getPublicSlides);

module.exports = router;
