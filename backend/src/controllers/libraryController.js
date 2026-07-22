const User = require('../models/User');
const Novel = require('../models/Novel');
const ReadingProgress = require('../models/ReadingProgress');
const Notification = require('../models/Notification');
const { asyncHandler } = require('../middlewares/errorHandler');

const getLibrary = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate({
    path: 'library',
    match: { published: true },
  });
  const progress = await ReadingProgress.find({ user: req.user._id, novel: { $in: user.library.map((n) => n._id) } });
  const progressMap = {};
  progress.forEach((p) => {
    progressMap[p.novel.toString()] = { chapterNumber: p.chapterNumber, updatedAt: p.updatedAt };
  });
  res.json({
    novels: user.library.map((novel) => ({
      novel,
      progress: progressMap[novel._id.toString()] || null,
    })),
  });
});

const toggleLibrary = asyncHandler(async (req, res) => {
  const novel = await Novel.findById(req.params.novelId);
  if (!novel) {
    return res.status(404).json({ message: 'Novel not found' });
  }
  const user = await User.findById(req.user._id);
  const novelId = novel._id.toString();
  const inLibrary = user.library.some((id) => id.toString() === novelId);
  if (inLibrary) {
    user.library = user.library.filter((id) => id.toString() !== novelId);
  } else {
    user.library.push(novel._id);
  }
  await user.save();
  res.json({ inLibrary: !inLibrary, library: user.library });
});

const getHistory = asyncHandler(async (req, res) => {
  const history = await ReadingProgress.find({ user: req.user._id })
    .populate('novel', 'title slug coverUrl chapterCount status')
    .populate('chapter', 'number title')
    .sort({ updatedAt: -1 })
    .limit(50);
  res.json({ history: history.filter((h) => h.novel) });
});

const getNotifications = asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
  const unreadCount = await Notification.countDocuments({ user: req.user._id, read: false });
  res.json({ notifications, unreadCount });
});

const markNotificationsRead = asyncHandler(async (req, res) => {
  const { id } = req.body;
  const filter = { user: req.user._id, read: false };
  if (id) {
    filter._id = id;
  }
  await Notification.updateMany(filter, { read: true });
  res.json({ message: 'Notifications marked read' });
});

module.exports = { getLibrary, toggleLibrary, getHistory, getNotifications, markNotificationsRead };
