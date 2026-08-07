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
const {
  NOTIFICATION_TYPES,
  ROLES,
  RATING,
  ADMIN_USER_FIELDS,
  MODERATION_STATUS,
  GATE_DEFAULTS,
} = require('../config/constants');
const { parsePagination } = require('./novelController');
const { recalcForReview, recalcNovelRating, recalcChapterRating } = require('./reviewController');
const storage = require('../services/storage');

const CHAPTER_FILE_EXTENSIONS = ['.txt', '.docx'];

// A nested path missing from an older document has no subdocument to spread.
const plainSubdoc = (gate) => (gate && typeof gate.toObject === 'function' ? gate.toObject() : gate || {});

const toNumberList = (value) =>
  String(value)
    .split(',')
    .map((entry) => parseInt(entry.trim(), 10))
    .filter((entry) => Number.isInteger(entry) && entry > 0);

// Malformed JSON from a client is a bad request, not a server fault.
const parseJsonField = (raw) => {
  if (typeof raw !== 'string') {
    return raw;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
};

// Reading-gate config arrives as JSON in a multipart body, so the numeric and
// list fields need coercing before they reach the schema.
const parseReadingGate = (raw) => {
  const gate = parseJsonField(raw);
  if (!gate || typeof gate !== 'object') {
    return null;
  }
  const parsed = { ...gate };
  ['loginAfterChapter', 'engagementAfterChapter', 'escalateAfterChapter'].forEach((field) => {
    if (parsed[field] !== undefined) {
      parsed[field] = Math.max(parseInt(parsed[field], 10) || 0, 0);
    }
  });
  // The schema floors this at 1, so an empty or junk value falls back to the default.
  if (parsed.everyChapters !== undefined) {
    parsed.everyChapters = Math.max(parseInt(parsed.everyChapters, 10) || GATE_DEFAULTS.EVERY_CHAPTERS, 1);
  }
  if (parsed.chapterNumbers !== undefined) {
    parsed.chapterNumbers = Array.isArray(parsed.chapterNumbers)
      ? parsed.chapterNumbers.map(Number).filter((entry) => Number.isInteger(entry) && entry > 0)
      : toNumberList(parsed.chapterNumbers);
  }
  ['loginEnabled', 'engagementEnabled', 'override'].forEach((field) => {
    if (parsed[field] !== undefined) {
      parsed[field] = parsed[field] === 'true' || parsed[field] === true;
    }
  });
  return parsed;
};

// Cascade soft-deletes hide reviews without going through recalcForReview, so the
// affected novel and chapter averages have to be rebuilt explicitly.
const recalcRatingsFor = async (reviews) => {
  const novels = new Map();
  const chapters = new Map();
  reviews.forEach((review) => {
    if (review.chapter) {
      chapters.set(review.chapter.toString(), review.chapter);
    } else {
      novels.set(review.novel.toString(), review.novel);
    }
  });
  await Promise.all([
    ...[...novels.values()].map(recalcNovelRating),
    ...[...chapters.values()].map(recalcChapterRating),
  ]);
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
  const gate = req.body.readingGate ? parseReadingGate(req.body.readingGate) : undefined;
  if (req.body.readingGate && !gate) {
    return res.status(400).json({ message: 'readingGate must be valid JSON' });
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
    readingGate: gate,
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
  if (req.body.readingGate) {
    const gate = parseReadingGate(req.body.readingGate);
    if (!gate) {
      return res.status(400).json({ message: 'readingGate must be valid JSON' });
    }
    novel.readingGate = { ...plainSubdoc(novel.readingGate), ...gate };
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
  // Soft delete the chapter with its comments and chapter reviews; the stored
  // source file is kept.
  const novelId = chapter.novel;
  await Promise.all([
    Comment.softDeleteMany({ chapter: chapter._id }),
    Review.softDeleteMany({ chapter: chapter._id }),
    chapter.softDelete(),
  ]);
  await Promise.all([syncNovelChapterMeta(novelId), recalcChapterRating(chapter._id)]);
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
  const reviews = await Review.find({ user: user._id }).select('novel chapter');
  await Promise.all([
    Comment.softDeleteMany({ user: user._id }),
    Review.softDeleteMany({ user: user._id }),
    user.softDelete(),
  ]);
  await recalcRatingsFor(reviews);
  res.json({ message: 'User deleted' });
});

const searchRegex = (search) => ({ $regex: search, $options: 'i' });

// Trashed records usually reference trashed novels/chapters/users, and populate is
// subject to the soft-delete filter, so the moderation views opt out of it to keep
// their attribution.
const MODERATION_POPULATE = {
  user: { path: 'user', select: ADMIN_USER_FIELDS, options: { withDeleted: true } },
  replyUser: { path: 'replies.user', select: ADMIN_USER_FIELDS, options: { withDeleted: true } },
  novel: { path: 'novel', select: 'title slug', options: { withDeleted: true } },
  chapter: { path: 'chapter', select: 'number title', options: { withDeleted: true } },
};

// An explicit deletedAt condition opts out of the soft-delete read filter, so the
// same handler can serve the active list and the trash view.
const moderationFilter = ({ novel, user, status }) => {
  const filter = { deletedAt: status === MODERATION_STATUS.DELETED ? { $ne: null } : null };
  if (novel) {
    filter.novel = novel;
  }
  if (user) {
    filter.user = user;
  }
  return filter;
};

const findAuthorIds = async (search) => {
  const users = await User.find({
    $or: [{ username: searchRegex(search) }, { email: searchRegex(search) }],
  }).select('_id');
  return users.map((user) => user._id);
};

const listAllComments = asyncHandler(async (req, res) => {
  const { search, novel, chapter, user, status } = req.query;
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { ...moderationFilter({ novel, user, status }), parentComment: null };
  if (chapter) {
    filter.chapter = chapter;
  }
  if (search) {
    const [authorIds, matchingReplies] = await Promise.all([
      findAuthorIds(search),
      Comment.find({ content: searchRegex(search), parentComment: { $ne: null } }, 'parentComment', {
        withDeleted: true,
      }),
    ]);
    filter.$or = [
      { content: searchRegex(search) },
      { user: { $in: authorIds } },
      { _id: { $in: matchingReplies.map((reply) => reply.parentComment) } },
    ];
  }
  const [comments, total] = await Promise.all([
    Comment.find(filter)
      .populate(MODERATION_POPULATE.user)
      .populate(MODERATION_POPULATE.novel)
      .populate(MODERATION_POPULATE.chapter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Comment.countDocuments(filter),
  ]);
  // Replies always travel with their parent — including deleted ones, so they can
  // be reviewed and restored from the thread they belong to.
  const replies = await Comment.find({ parentComment: { $in: comments.map((comment) => comment._id) } }, null, {
    withDeleted: true,
  })
    .populate(MODERATION_POPULATE.user)
    .sort({ createdAt: 1 });
  const repliesByParent = replies.reduce((grouped, reply) => {
    const key = reply.parentComment.toString();
    grouped[key] = grouped[key] || [];
    grouped[key].push(reply);
    return grouped;
  }, {});
  res.json({
    comments: comments.map((comment) => ({
      ...comment.toJSON(),
      replies: repliesByParent[comment._id.toString()] || [],
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});

const listAllReviews = asyncHandler(async (req, res) => {
  const { search, novel, user, status } = req.query;
  const { page, limit, skip } = parsePagination(req.query);
  const filter = moderationFilter({ novel, user, status });
  if (search) {
    const authorIds = await findAuthorIds(search);
    filter.$or = [
      { content: searchRegex(search) },
      { user: { $in: authorIds } },
      { 'replies.content': searchRegex(search) },
    ];
  }
  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .populate(MODERATION_POPULATE.user)
      .populate(MODERATION_POPULATE.replyUser)
      .populate(MODERATION_POPULATE.novel)
      .populate(MODERATION_POPULATE.chapter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Review.countDocuments(filter),
  ]);
  res.json({ reviews, total, page, pages: Math.ceil(total / limit) });
});

const readContent = (req, res) => {
  const { content } = req.body;
  if (!content || typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ message: 'content is required' });
    return null;
  }
  return content.trim();
};

const findModeratedComment = (id) => Comment.findOne({ _id: id }, null, { withDeleted: true });

const findModeratedReview = (id) => Review.findOne({ _id: id }, null, { withDeleted: true });

const updateComment = asyncHandler(async (req, res) => {
  const content = readContent(req, res);
  if (!content) {
    return undefined;
  }
  const comment = await findModeratedComment(req.params.id);
  if (!comment) {
    return res.status(404).json({ message: 'Comment not found' });
  }
  comment.content = content;
  comment.editedAt = new Date();
  comment.editedBy = req.user._id;
  await comment.save();
  await comment.populate('user', ADMIN_USER_FIELDS);
  res.json({ comment });
});

const restoreComment = asyncHandler(async (req, res) => {
  const comment = await findModeratedComment(req.params.id);
  if (!comment) {
    return res.status(404).json({ message: 'Comment not found' });
  }
  if (comment.parentComment) {
    const parent = await findModeratedComment(comment.parentComment);
    if (parent && parent.deletedAt) {
      return res.status(400).json({ message: 'Restore the parent comment first' });
    }
  }
  comment.deletedAt = null;
  await comment.save();
  await comment.populate('user', ADMIN_USER_FIELDS);
  res.json({ comment });
});

const updateReview = asyncHandler(async (req, res) => {
  const { content, rating } = req.body;
  if (content === undefined && rating === undefined) {
    return res.status(400).json({ message: 'content or rating is required' });
  }
  const review = await findModeratedReview(req.params.id);
  if (!review) {
    return res.status(404).json({ message: 'Review not found' });
  }
  if (rating !== undefined) {
    const numericRating = Number(rating);
    if (!numericRating || numericRating < RATING.MIN || numericRating > RATING.MAX) {
      return res.status(400).json({ message: `rating must be between ${RATING.MIN} and ${RATING.MAX}` });
    }
    review.rating = numericRating;
  }
  if (content !== undefined) {
    review.content = String(content).trim();
  }
  review.editedAt = new Date();
  review.editedBy = req.user._id;
  await review.save();
  if (rating !== undefined) {
    await recalcForReview(review);
  }
  await review.populate('user', ADMIN_USER_FIELDS);
  res.json({ review });
});

const restoreReview = asyncHandler(async (req, res) => {
  const review = await findModeratedReview(req.params.id);
  if (!review) {
    return res.status(404).json({ message: 'Review not found' });
  }
  // Only one active review per user per target, so a replacement review blocks the restore.
  const activeReview = await Review.findOne({ novel: review.novel, chapter: review.chapter, user: review.user });
  if (activeReview && activeReview._id.toString() !== review._id.toString()) {
    return res.status(409).json({ message: 'This user already has an active review for that target' });
  }
  review.deletedAt = null;
  await review.save();
  await recalcForReview(review);
  await review.populate('user', ADMIN_USER_FIELDS);
  res.json({ review });
});

const findReviewReply = async (reviewId, replyId, res) => {
  const review = await findModeratedReview(reviewId);
  if (!review) {
    res.status(404).json({ message: 'Review not found' });
    return {};
  }
  const reply = review.replies.id(replyId);
  if (!reply) {
    res.status(404).json({ message: 'Reply not found' });
    return {};
  }
  return { review, reply };
};

const respondWithReview = async (res, review) => {
  await review.populate('user', ADMIN_USER_FIELDS);
  await review.populate('replies.user', ADMIN_USER_FIELDS);
  res.json({ review });
};

const updateReviewReply = asyncHandler(async (req, res) => {
  const content = readContent(req, res);
  if (!content) {
    return undefined;
  }
  const { review, reply } = await findReviewReply(req.params.id, req.params.replyId, res);
  if (!reply) {
    return undefined;
  }
  reply.content = content;
  reply.editedAt = new Date();
  reply.editedBy = req.user._id;
  await review.save();
  return respondWithReview(res, review);
});

const restoreReviewReply = asyncHandler(async (req, res) => {
  const { review, reply } = await findReviewReply(req.params.id, req.params.replyId, res);
  if (!reply) {
    return undefined;
  }
  reply.deletedAt = null;
  await review.save();
  return respondWithReview(res, review);
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
  const nestedFields = ['themeColors', 'socialLinks', 'homeSections'];
  for (const field of nestedFields) {
    if (body[field]) {
      const value = parseJsonField(body[field]);
      if (!value || typeof value !== 'object') {
        return res.status(400).json({ message: `${field} must be valid JSON` });
      }
      settings[field] = { ...plainSubdoc(settings[field]), ...value };
    }
  }
  if (body.readingGate) {
    const gate = parseReadingGate(body.readingGate);
    if (!gate) {
      return res.status(400).json({ message: 'readingGate must be valid JSON' });
    }
    settings.readingGate = { ...plainSubdoc(settings.readingGate), ...gate };
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
  updateComment,
  restoreComment,
  updateReview,
  restoreReview,
  updateReviewReply,
  restoreReviewReply,
  getAdminSettings,
  updateSettings,
  broadcastAnnouncement,
};
