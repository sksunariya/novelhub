const AdmZip = require('adm-zip');
const fs = require('fs/promises');
const path = require('path');
const Novel = require('../models/Novel');
const Chapter = require('../models/Chapter');
const User = require('../models/User');
const Comment = require('../models/Comment');
const Review = require('../models/Review');
const Notification = require('../models/Notification');
const ReadingProgress = require('../models/ReadingProgress');
const SiteSettings = require('../models/SiteSettings');
const { asyncHandler } = require('../middlewares/errorHandler');
const { uniqueSlug } = require('../utils/slugify');
const { parseChapterFile, parseChapterBuffer, titleFromFilename } = require('../utils/parseChapterFile');
const { NOTIFICATION_TYPES, ROLES } = require('../config/constants');
const { parsePagination } = require('./novelController');

const CHAPTER_FILE_EXTENSIONS = ['.txt', '.docx'];

const fileUrl = (file) => `/uploads/${file.filename}`;

const cleanupFile = async (file) => {
  if (file) {
    await fs.unlink(file.path).catch(() => {});
  }
};

const syncNovelChapterMeta = async (novelId) => {
  const [count, latest] = await Promise.all([
    Chapter.countDocuments({ novel: novelId, published: true }),
    Chapter.findOne({ novel: novelId, published: true }).sort({ createdAt: -1 }).select('createdAt'),
  ]);
  await Novel.updateOne({ _id: novelId }, { chapterCount: count, lastChapterAt: latest ? latest.createdAt : null });
};

const notifyLibraryUsers = async (novel, chapters) => {
  const users = await User.find({ library: novel._id }).select('_id');
  if (!users.length) {
    return;
  }
  const message =
    chapters.length === 1
      ? `New chapter of ${novel.title}: Chapter ${chapters[0].number} - ${chapters[0].title}`
      : `${chapters.length} new chapters of ${novel.title}`;
  const link = `/novel/${novel.slug}`;
  await Notification.insertMany(
    users.map((user) => ({ user: user._id, type: NOTIFICATION_TYPES.NEW_CHAPTER, message, link }))
  );
};

const uploadEditorImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'image is required' });
  }
  res.status(201).json({ url: fileUrl(req.file) });
});

const getStats = asyncHandler(async (req, res) => {
  const [users, novels, chapters, comments, reviews, viewsAgg, recentUsers, topNovels] = await Promise.all([
    User.countDocuments(),
    Novel.countDocuments(),
    Chapter.countDocuments(),
    Comment.countDocuments(),
    Review.countDocuments(),
    Novel.aggregate([{ $group: { _id: null, total: { $sum: '$views' } } }]),
    User.find().sort({ createdAt: -1 }).limit(5).select('username email createdAt'),
    Novel.find().sort({ views: -1 }).limit(5).select('title slug views ratingAvg chapterCount'),
  ]);
  res.json({
    stats: {
      users,
      novels,
      chapters,
      comments,
      reviews,
      totalViews: viewsAgg[0] ? viewsAgg[0].total : 0,
    },
    recentUsers,
    topNovels,
  });
});

const listAllNovels = asyncHandler(async (req, res) => {
  const { search } = req.query;
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (search) {
    filter.title = { $regex: search, $options: 'i' };
  }
  const [novels, total] = await Promise.all([
    Novel.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit),
    Novel.countDocuments(filter),
  ]);
  res.json({ novels, total, page, pages: Math.ceil(total / limit) });
});

const createNovel = asyncHandler(async (req, res) => {
  const { title, author, synopsis, genres, tags, status, published, featured, coverUrl } = req.body;
  if (!title || !author) {
    return res.status(400).json({ message: 'title and author are required' });
  }
  const novel = await Novel.create({
    title,
    author,
    synopsis: synopsis || '',
    slug: await uniqueSlug(Novel, title),
    genres: genres ? String(genres).split(',').map((g) => g.trim()).filter(Boolean) : [],
    tags: tags ? String(tags).split(',').map((t) => t.trim()).filter(Boolean) : [],
    status,
    published: published !== undefined ? published === 'true' || published === true : true,
    featured: featured === 'true' || featured === true,
    coverUrl: req.file ? fileUrl(req.file) : coverUrl || '',
    createdBy: req.user._id,
  });
  res.status(201).json({ novel });
});

const updateNovel = asyncHandler(async (req, res) => {
  const novel = await Novel.findById(req.params.id);
  if (!novel) {
    return res.status(404).json({ message: 'Novel not found' });
  }
  const { title, author, synopsis, genres, tags, status, published, featured, coverUrl } = req.body;
  if (title && title !== novel.title) {
    novel.title = title;
    novel.slug = await uniqueSlug(Novel, title);
  }
  if (author) novel.author = author;
  if (synopsis !== undefined) novel.synopsis = synopsis;
  if (genres !== undefined) novel.genres = String(genres).split(',').map((g) => g.trim()).filter(Boolean);
  if (tags !== undefined) novel.tags = String(tags).split(',').map((t) => t.trim()).filter(Boolean);
  if (status) novel.status = status;
  if (published !== undefined) novel.published = published === 'true' || published === true;
  if (featured !== undefined) novel.featured = featured === 'true' || featured === true;
  if (req.file) {
    novel.coverUrl = fileUrl(req.file);
  } else if (coverUrl !== undefined) {
    novel.coverUrl = coverUrl;
  }
  await novel.save();
  res.json({ novel });
});

const deleteNovel = asyncHandler(async (req, res) => {
  const novel = await Novel.findById(req.params.id);
  if (!novel) {
    return res.status(404).json({ message: 'Novel not found' });
  }
  await Promise.all([
    Chapter.deleteMany({ novel: novel._id }),
    Comment.deleteMany({ novel: novel._id }),
    Review.deleteMany({ novel: novel._id }),
    ReadingProgress.deleteMany({ novel: novel._id }),
    User.updateMany({ library: novel._id }, { $pull: { library: novel._id } }),
    novel.deleteOne(),
  ]);
  res.json({ message: 'Novel deleted' });
});

const listNovelChapters = asyncHandler(async (req, res) => {
  const chapters = await Chapter.find({ novel: req.params.id })
    .select('number title views published createdAt updatedAt')
    .sort({ number: 1 });
  res.json({ chapters });
});

const getChapter = asyncHandler(async (req, res) => {
  const chapter = await Chapter.findById(req.params.id);
  if (!chapter) {
    return res.status(404).json({ message: 'Chapter not found' });
  }
  res.json({ chapter });
});

const nextChapterNumber = async (novelId) => {
  const last = await Chapter.findOne({ novel: novelId }).sort({ number: -1 }).select('number');
  return last ? last.number + 1 : 1;
};

const createChapter = asyncHandler(async (req, res) => {
  const novel = await Novel.findById(req.params.id);
  if (!novel) {
    return res.status(404).json({ message: 'Novel not found' });
  }
  const { title, content, number, published } = req.body;
  if (!title || !content) {
    return res.status(400).json({ message: 'title and content are required' });
  }
  const chapter = await Chapter.create({
    novel: novel._id,
    number: number ? Number(number) : await nextChapterNumber(novel._id),
    title,
    content,
    published: published !== undefined ? published === 'true' || published === true : true,
  });
  await syncNovelChapterMeta(novel._id);
  if (chapter.published) {
    await notifyLibraryUsers(novel, [chapter]);
  }
  res.status(201).json({ chapter });
});

const uploadChapterFile = asyncHandler(async (req, res) => {
  const novel = await Novel.findById(req.params.id);
  if (!novel) {
    await cleanupFile(req.file);
    return res.status(404).json({ message: 'Novel not found' });
  }
  if (!req.file) {
    return res.status(400).json({ message: 'file is required' });
  }
  try {
    const content = await parseChapterFile(req.file.path);
    if (!content) {
      return res.status(400).json({ message: 'File is empty or could not be parsed' });
    }
    const chapter = await Chapter.create({
      novel: novel._id,
      number: req.body.number ? Number(req.body.number) : await nextChapterNumber(novel._id),
      title: req.body.title || titleFromFilename(req.file.originalname),
      content,
    });
    await syncNovelChapterMeta(novel._id);
    await notifyLibraryUsers(novel, [chapter]);
    res.status(201).json({ chapter });
  } finally {
    await cleanupFile(req.file);
  }
});

const bulkUploadChapters = asyncHandler(async (req, res) => {
  const novel = await Novel.findById(req.params.id);
  if (!novel) {
    await cleanupFile(req.file);
    return res.status(404).json({ message: 'Novel not found' });
  }
  if (!req.file) {
    return res.status(400).json({ message: 'zip file is required' });
  }
  try {
    const zip = new AdmZip(req.file.path);
    const entries = zip
      .getEntries()
      .filter((entry) => !entry.isDirectory && CHAPTER_FILE_EXTENSIONS.includes(path.extname(entry.entryName).toLowerCase()))
      .filter((entry) => !path.basename(entry.entryName).startsWith('.'))
      .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));
    if (!entries.length) {
      return res.status(400).json({ message: 'No .txt or .docx files found in zip' });
    }
    let number = await nextChapterNumber(novel._id);
    const created = [];
    const failed = [];
    for (const entry of entries) {
      try {
        const content = await parseChapterBuffer(entry.getData(), entry.entryName);
        if (!content) {
          failed.push({ file: entry.entryName, reason: 'empty content' });
          continue;
        }
        const chapter = await Chapter.create({
          novel: novel._id,
          number,
          title: titleFromFilename(entry.entryName),
          content,
        });
        created.push(chapter);
        number += 1;
      } catch (error) {
        failed.push({ file: entry.entryName, reason: error.message });
      }
    }
    await syncNovelChapterMeta(novel._id);
    if (created.length) {
      await notifyLibraryUsers(novel, created);
    }
    res.status(201).json({ createdCount: created.length, failed });
  } finally {
    await cleanupFile(req.file);
  }
});

const updateChapter = asyncHandler(async (req, res) => {
  const chapter = await Chapter.findById(req.params.id);
  if (!chapter) {
    return res.status(404).json({ message: 'Chapter not found' });
  }
  const { title, content, number, published } = req.body;
  if (title) chapter.title = title;
  if (content) chapter.content = content;
  if (number !== undefined) chapter.number = Number(number);
  if (published !== undefined) chapter.published = published === 'true' || published === true;
  await chapter.save();
  await syncNovelChapterMeta(chapter.novel);
  res.json({ chapter });
});

const deleteChapter = asyncHandler(async (req, res) => {
  const chapter = await Chapter.findById(req.params.id);
  if (!chapter) {
    return res.status(404).json({ message: 'Chapter not found' });
  }
  await Comment.deleteMany({ chapter: chapter._id });
  const novelId = chapter.novel;
  await chapter.deleteOne();
  await syncNovelChapterMeta(novelId);
  res.json({ message: 'Chapter deleted' });
});

const listUsers = asyncHandler(async (req, res) => {
  const { search } = req.query;
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (search) {
    filter.$or = [
      { username: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  res.json({ users, total, page, pages: Math.ceil(total / limit) });
});

const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }
  if (user._id.toString() === req.user._id.toString()) {
    return res.status(400).json({ message: 'Cannot modify your own account here' });
  }
  const { role, banned } = req.body;
  if (role) {
    if (!Object.values(ROLES).includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }
    user.role = role;
  }
  if (banned !== undefined) {
    user.banned = banned === 'true' || banned === true;
  }
  await user.save();
  res.json({ user });
});

const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }
  if (user._id.toString() === req.user._id.toString()) {
    return res.status(400).json({ message: 'Cannot delete your own account' });
  }
  await Promise.all([
    Comment.deleteMany({ user: user._id }),
    Review.deleteMany({ user: user._id }),
    ReadingProgress.deleteMany({ user: user._id }),
    Notification.deleteMany({ user: user._id }),
    user.deleteOne(),
  ]);
  res.json({ message: 'User deleted' });
});

const listAllComments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const [comments, total] = await Promise.all([
    Comment.find()
      .populate('user', 'username email')
      .populate('novel', 'title slug')
      .populate('chapter', 'number title')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Comment.countDocuments(),
  ]);
  res.json({ comments, total, page, pages: Math.ceil(total / limit) });
});

const listAllReviews = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const [reviews, total] = await Promise.all([
    Review.find()
      .populate('user', 'username email')
      .populate('novel', 'title slug')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Review.countDocuments(),
  ]);
  res.json({ reviews, total, page, pages: Math.ceil(total / limit) });
});

const getAdminSettings = asyncHandler(async (req, res) => {
  const settings = await SiteSettings.getSettings();
  res.json({ settings });
});

const updateSettings = asyncHandler(async (req, res) => {
  const settings = await SiteSettings.getSettings();
  const body = req.body;
  const stringFields = ['siteName', 'tagline', 'announcement', 'footerText'];
  stringFields.forEach((field) => {
    if (body[field] !== undefined) {
      settings[field] = body[field];
    }
  });
  const files = req.files || {};
  if (files.logo && files.logo[0]) {
    settings.logoUrl = fileUrl(files.logo[0]);
  } else if (body.logoUrl !== undefined) {
    settings.logoUrl = body.logoUrl;
  }
  if (files.favicon && files.favicon[0]) {
    settings.faviconUrl = fileUrl(files.favicon[0]);
  } else if (body.faviconUrl !== undefined) {
    settings.faviconUrl = body.faviconUrl;
  }
  if (body.themeColors) {
    const colors = typeof body.themeColors === 'string' ? JSON.parse(body.themeColors) : body.themeColors;
    settings.themeColors = { ...settings.themeColors.toObject(), ...colors };
  }
  if (body.socialLinks) {
    const links = typeof body.socialLinks === 'string' ? JSON.parse(body.socialLinks) : body.socialLinks;
    settings.socialLinks = { ...settings.socialLinks.toObject(), ...links };
  }
  if (body.homeSections) {
    const sections = typeof body.homeSections === 'string' ? JSON.parse(body.homeSections) : body.homeSections;
    settings.homeSections = { ...settings.homeSections.toObject(), ...sections };
  }
  if (body.allowSignups !== undefined) {
    settings.allowSignups = body.allowSignups === 'true' || body.allowSignups === true;
  }
  if (body.maintenanceMode !== undefined) {
    settings.maintenanceMode = body.maintenanceMode === 'true' || body.maintenanceMode === true;
  }
  await settings.save();
  res.json({ settings });
});

const broadcastAnnouncement = asyncHandler(async (req, res) => {
  const { message, link } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ message: 'message is required' });
  }
  const users = await User.find({ banned: false }).select('_id');
  await Notification.insertMany(
    users.map((user) => ({
      user: user._id,
      type: NOTIFICATION_TYPES.ANNOUNCEMENT,
      message: message.trim(),
      link: link || '',
    }))
  );
  res.status(201).json({ notifiedCount: users.length });
});

module.exports = {
  uploadEditorImage,
  getStats,
  listAllNovels,
  createNovel,
  updateNovel,
  deleteNovel,
  listNovelChapters,
  getChapter,
  createChapter,
  uploadChapterFile,
  bulkUploadChapters,
  updateChapter,
  deleteChapter,
  listUsers,
  updateUser,
  deleteUser,
  listAllComments,
  listAllReviews,
  getAdminSettings,
  updateSettings,
  broadcastAnnouncement,
};
