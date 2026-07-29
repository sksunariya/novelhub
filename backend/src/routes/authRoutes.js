const express = require('express');
const {
  signup, login, googleAuth, me, updateProfile,
  verifySignup, resendSignupOtp, forgotPassword, resetPassword,
} = require('../controllers/authController');
const { protect } = require('../middlewares/auth');

const router = express.Router();

router.post('/signup', signup);
router.post('/signup/verify', verifySignup);
router.post('/signup/resend', resendSignupOtp);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/login', login);
router.post('/google', googleAuth);
router.get('/me', protect, me);
router.put('/profile', protect, updateProfile);

module.exports = router;
