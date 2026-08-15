const express = require('express');
const { getFeed, getSpaceFeed, getLinkedFeed } = require('../controllers/postController');

const router = express.Router();

// home | popular | all. Every one is cursor-paginated: ?sort=&t=&cursor=&limit=
router.get('/linked/:type/:id', getLinkedFeed);
router.get('/space/:slug', getSpaceFeed);
router.get('/:type', getFeed);
router.get('/', getFeed);

module.exports = router;
