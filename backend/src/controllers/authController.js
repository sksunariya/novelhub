const { OAuth2Client } = require('google-auth-library');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const SiteSettings = require('../models/SiteSettings');
const PendingSignup = require('../models/PendingSignup');
const PasswordResetCode = require('../models/PasswordResetCode');
const generateToken = require('../utils/generateToken');
const { generateOtp, hashOtp, compareOtp, otpExpiry } = require('../utils/otp');
const { isMailerConfigured, sendOtpEmail } = require('../utils/mailer');
const { asyncHandler } = require('../middlewares/errorHandler');

const googleClient = new OAuth2Client();

const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

const serializeUser = (user) => ({
  id: user._id,
  username: user.username,
  email: user.email,
  role: user.role,
  avatarUrl: user.avatarUrl,
  library: user.library,
});

const signup = asyncHandler(async (req, res) => {
  const settings = await SiteSettings.getSettings();
  if (!settings.allowSignups) {
    return res.status(403).json({ message: 'Signups are currently disabled' });
  }
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ message: 'username, email and password are required' });
  }

  if (!settings.requireEmailVerification) {
    const user = await User.create({ username, email, password });
    return res.status(201).json({ token: generateToken(user._id), user: serializeUser(user) });
  }

  if (!isMailerConfigured()) {
    return res.status(503).json({ message: 'Email verification is enabled but email delivery is not configured.' });
  }
  if (username.length < 3 || username.length > 30) {
    return res.status(400).json({ message: 'username must be between 3 and 30 characters' });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }

  const normalizedEmail = email.toLowerCase();
  const existing = await User.findOne({ $or: [{ email: normalizedEmail }, { username }] });
  if (existing) {
    return res.status(409).json({ message: 'email or username already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const code = generateOtp();
  const codeHash = await hashOtp(code);
  await PendingSignup.findOneAndUpdate(
    { email: normalizedEmail },
    { email: normalizedEmail, username, passwordHash, codeHash, expiresAt: otpExpiry(), attempts: 0, lastSentAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await sendOtpEmail({ to: normalizedEmail, code, purpose: 'signup' });
  return res.status(202).json({ pendingVerification: true, email: normalizedEmail });
});

const verifySignup = asyncHandler(async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ message: 'email and code are required' });
  }
  const normalizedEmail = email.toLowerCase();
  const pending = await PendingSignup.findOne({ email: normalizedEmail });
  if (!pending || pending.expiresAt < new Date()) {
    return res.status(400).json({ message: 'Invalid or expired code' });
  }
  if (pending.attempts >= MAX_OTP_ATTEMPTS) {
    return res.status(400).json({ message: 'Too many attempts. Please request a new code.' });
  }
  const match = await compareOtp(String(code), pending.codeHash);
  if (!match) {
    pending.attempts += 1;
    await pending.save();
    return res.status(400).json({ message: 'Invalid or expired code' });
  }
  const conflict = await User.findOne({ $or: [{ email: normalizedEmail }, { username: pending.username }] });
  if (conflict) {
    await PendingSignup.deleteOne({ _id: pending._id });
    return res.status(409).json({ message: 'email or username already exists' });
  }
  const user = new User({ username: pending.username, email: pending.email });
  user.password = pending.passwordHash;
  user.$locals.passwordAlreadyHashed = true;
  await user.save();
  await PendingSignup.deleteOne({ _id: pending._id });
  return res.status(201).json({ token: generateToken(user._id), user: serializeUser(user) });
});

const resendSignupOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: 'email is required' });
  }
  const normalizedEmail = email.toLowerCase();
  const generic = { message: 'If a pending signup exists, a new code has been sent.' };
  const pending = await PendingSignup.findOne({ email: normalizedEmail });
  if (!pending) {
    return res.status(200).json(generic);
  }
  if (Date.now() - new Date(pending.lastSentAt).getTime() < RESEND_COOLDOWN_MS) {
    return res.status(429).json({ message: 'Please wait before requesting another code.' });
  }
  const code = generateOtp();
  pending.codeHash = await hashOtp(code);
  pending.expiresAt = otpExpiry();
  pending.attempts = 0;
  pending.lastSentAt = new Date();
  await pending.save();
  await sendOtpEmail({ to: normalizedEmail, code, purpose: 'signup' });
  return res.status(200).json(generic);
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'email and password are required' });
  }
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }
  if (user.banned) {
    return res.status(403).json({ message: 'Account is banned' });
  }
  res.json({ token: generateToken(user._id), user: serializeUser(user) });
});

const uniqueUsername = async (base) => {
  const clean = (base || 'reader').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24) || 'reader';
  let username = clean.length >= 3 ? clean : `${clean}${Math.floor(Math.random() * 1000)}`;
  let counter = 1;
  while (await User.exists({ username })) {
    username = `${clean}${counter}`;
    counter += 1;
  }
  return username;
};

const googleAuth = asyncHandler(async (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ message: 'credential is required' });
  }
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(503).json({ message: 'Google sign-in is not configured' });
  }
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid Google credential' });
  }
  if (!payload?.email || !payload.email_verified) {
    return res.status(401).json({ message: 'Google account email is not verified' });
  }
  const email = payload.email.toLowerCase();
  let user = await User.findOne({ $or: [{ googleId: payload.sub }, { email }] });
  if (user) {
    if (user.banned) {
      return res.status(403).json({ message: 'Account is banned' });
    }
    if (!user.googleId) {
      user.googleId = payload.sub;
      if (!user.avatarUrl && payload.picture) {
        user.avatarUrl = payload.picture;
      }
      await user.save();
    }
  } else {
    const settings = await SiteSettings.getSettings();
    if (!settings.allowSignups) {
      return res.status(403).json({ message: 'Signups are currently disabled' });
    }
    user = await User.create({
      username: await uniqueUsername(payload.name || email.split('@')[0]),
      email,
      googleId: payload.sub,
      avatarUrl: payload.picture || '',
    });
  }
  res.json({ token: generateToken(user._id), user: serializeUser(user) });
});

const me = asyncHandler(async (req, res) => {
  res.json({ user: serializeUser(req.user) });
});

const updateProfile = asyncHandler(async (req, res) => {
  const { username, avatarUrl, currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password');
  if (username) {
    user.username = username;
  }
  if (avatarUrl !== undefined) {
    user.avatarUrl = avatarUrl;
  }
  if (newPassword) {
    if (user.password && (!currentPassword || !(await user.comparePassword(currentPassword)))) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }
    user.password = newPassword;
  }
  await user.save();
  res.json({ user: serializeUser(user) });
});

module.exports = { signup, login, googleAuth, me, updateProfile, serializeUser, verifySignup, resendSignupOtp };
