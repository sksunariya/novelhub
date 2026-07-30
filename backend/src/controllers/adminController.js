const AdmZip = require('adm-zip');
const path = require('path');
const Novel = require('../models/Novel');
const Chapter = require('../models/Chapter');
const User = require('../models/User');
const Comment = require('../models/Comment');
const Review = require('../models/Review');
const Notification = require('../models/Notification');
const SiteSettings = require('../models/SiteSettings');
const { asyncHandler } = require('../middlewares/errorHandler');
const { uniqueSlug } = require('../utils/slugify');
const { parseChapterBuffer, titleFromFilename } = require('../utils/parseChapterFile');
const { NOTIFICATION_TYPES, ROLES } = require('../config/constants');
const { parsePagination } = require('./novelController');
const storage = require('../services/storage');

const CHAPTER_FILE_EXTENSIONS = ['.txt', '.docx'];

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
  const url = await storage.uploadPublic(req.file, 'editor');
  res.status(201).json({ url });
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
    coverUrl: req.file ? await storage.uploadPublic(req.file, 'covers') : coverUrl || '',
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
    const previousCover = novel.coverUrl;
    novel.coverUrl = await storage.uploadPublic(req.file, 'covers');
    await storage.remove(previousCover);
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
  // Soft delete: mark the novel and its chapters/comments/reviews as deleted.
  // Nothing is removed — stored files, reading progress and library references
  // are all preserved; soft-deleted records are just hidden from reads.
  await Promise.all([
    Chapter.softDeleteMany({ novel: novel._id }),
    Comment.softDeleteMany({ novel: novel._id }),
    Review.softDeleteMany({ novel: novel._id }),
    novel.softDelete(),
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
    return res.status(404).json({ message: 'Novel not found' });
  }
  if (!req.file) {
    return res.status(400).json({ message: 'file is required' });
  }
  const content = await parseChapterBuffer(req.file.buffer, req.file.originalname);
  if (!content) {
    return res.status(400).json({ message: 'File is empty or could not be parsed' });
  }
  // Archive the original upload privately so it can be re-downloaded later.
  const sourceFile = await storage.uploadPrivate(req.file, 'chapter-sources');
  const chapter = await Chapter.create({
    novel: novel._id,
    number: req.body.number ? Number(req.body.number) : await nextChapterNumber(novel._id),
    title: req.body.title || titleFromFilename(req.file.originalname),
    content,
    sourceFile: sourceFile || undefined,
  });
  await syncNovelChapterMeta(novel._id);
  await notifyLibraryUsers(novel, [chapter]);
  res.status(201).json({ chapter });
});

const bulkUploadChapters = asyncHandler(async (req, res) => {
  const novel = await Novel.findById(req.params.id);
  if (!novel) {
    return res.status(404).json({ message: 'Novel not found' });
  }
  if (!req.file) {
    return res.status(400).json({ message: 'zip file is required' });
  }
  const zip = new AdmZip(req.file.buffer);
  const entries = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory && CHAPTER_FILE_EXTENSIONS.includes(path.extname(entry.entryName).toLowerCase()))
    .filter((entry) => !path.basename(entry.entryName).startsWith('.'))
    .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));
  if (!entries.length) {
    return res.status(400).json({ message: 'No .txt or .docx files found in zip' });
  }
  // Archive the uploaded zip privately once; each chapter records the archive key.
  const archive = await storage.uploadPrivate(req.file, 'chapter-sources');
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
        sourceFile: archive ? { ...archive, name: entry.entryName } : undefined,
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
  // Soft delete the chapter and its comments; the stored source file is kept.
  const novelId = chapter.novel;
  await Promise.all([
    Comment.softDeleteMany({ chapter: chapter._id }),
    chapter.softDelete(),
  ]);
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
  // Soft delete the user and hide their comments/reviews. Reading progress and
  // notifications are left intact so nothing is lost from the database.
  await Promise.all([
    Comment.softDeleteMany({ user: user._id }),
    Review.softDeleteMany({ user: user._id }),
    user.softDelete(),
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
    const previousLogo = settings.logoUrl;
    settings.logoUrl = await storage.uploadPublic(files.logo[0], 'logos');
    await storage.remove(previousLogo);
  } else if (body.logoUrl !== undefined) {
    settings.logoUrl = body.logoUrl;
  }
  if (files.favicon && files.favicon[0]) {
    const previousFavicon = settings.faviconUrl;
    settings.faviconUrl = await storage.uploadPublic(files.favicon[0], 'favicons');
    await storage.remove(previousFavicon);
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
  if (body.requireEmailVerification !== undefined) {
    settings.requireEmailVerification = body.requireEmailVerification === 'true' || body.requireEmailVerification === true;
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

const getChapterSource = asyncHandler(async (req, res) => {
  const chapter = await Chapter.findById(req.params.id).select('sourceFile');
  if (!chapter) {
    return res.status(404).json({ message: 'Chapter not found' });
  }
  if (!chapter.sourceFile?.key) {
    return res.status(404).json({ message: 'No source file stored for this chapter' });
  }
  const url = await storage.getSignedDownloadUrl(chapter.sourceFile.key);
  if (!url) {
    return res.status(501).json({ message: 'File storage is not configured' });
  }
  res.json({ url, name: chapter.sourceFile.name });
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
  getChapterSource,
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
