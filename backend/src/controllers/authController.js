const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const SiteSettings = require('../models/SiteSettings');
const generateToken = require('../utils/generateToken');
const { asyncHandler } = require('../middlewares/errorHandler');

const googleClient = new OAuth2Client();

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
  const user = await User.create({ username, email, password });
  res.status(201).json({ token: generateToken(user._id), user: serializeUser(user) });
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

module.exports = { signup, login, googleAuth, me, updateProfile, serializeUser };
