const express = require('express');
const {
  getLibrary,
  toggleLibrary,
  getHistory,
  getNotifications,
  markNotificationsRead,
} = require('../controllers/libraryController');
const { protect } = require('../middlewares/auth');

const router = express.Router();

router.use(protect);
router.get('/', getLibrary);
router.post('/:novelId', toggleLibrary);
router.get('/history/list', getHistory);
router.get('/notifications/list', getNotifications);
router.put('/notifications/read', markNotificationsRead);

module.exports = router;
