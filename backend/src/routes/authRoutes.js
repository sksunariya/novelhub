const express = require('express');
const { signup, login, googleAuth, me, updateProfile } = require('../controllers/authController');
const { protect } = require('../middlewares/auth');

const router = express.Router();

router.post('/signup', signup);
router.post('/login', login);
router.post('/google', googleAuth);
router.get('/me', protect, me);
router.put('/profile', protect, updateProfile);

module.exports = router;
