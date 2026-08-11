const AdmZip = require('adm-zip');
const path = require('path');
const Novel = require('../models/Novel');
const Chapter = require('../models/Chapter');
const ChapterAccess = require('../models/ChapterAccess');
const User = require('../models/User');
const Comment = require('../models/Comment');
const Review = require('../models/Review');
const Notification = require('../models/Notification');
const SiteSettings = require('../models/SiteSettings');
const Campaign = require('../models/Campaign');
const { dispatchCampaign, dispatchNotification } = require('../services/notificationService');
const {
  guardChapterDeletion,
  guardNovelDeletion,
  guardUserDeletion,
} = require('../services/contentGuardService');
const { asyncHandler } = require('../middlewares/errorHandler');
const { uniqueSlug } = require('../utils/slugify');
const { parseChapterBuffer, titleFromFilename } = require('../utils/parseChapterFile');
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  ROLES,
  RATING,
  ADMIN_USER_FIELDS,
  MODERATION_STATUS,
  GATE_DEFAULTS,
  CHAPTER_ACCESS_TYPES,
} = require('../config/constants');
const { parsePagination } = require('./novelController');
const { recalcForReview, recalcNovelRating, recalcChapterRating } = require('./reviewController');
const storage = require('../services/storage');
const accessService = require('../services/accessService');
const { readChapterPricing } = require('../utils/chapterPricing');

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
/**
 * Per-novel monetization override.
 *
 * Only takes effect when `override` is true — that switch is what separates
 * "this novel is priced differently" from "this novel happens to have default
 * values saved", and without it every novel ever opened in the editor would
 * silently pin itself to whatever the global defaults were that day.
 *
 * `revenueShare` is deliberately not accepted here: it is commercially
 * sensitive, `select: false` on the model, and belongs to a different screen.
 */
const parseNovelMonetization = (raw) => {
  const input = parseJsonField(raw);
  if (!input || typeof input !== 'object') return { error: 'monetization must be valid JSON' };

  const value = {};
  if (input.override !== undefined) value.override = input.override === true || input.override === 'true';
  if (input.monetized !== undefined) value.monetized = input.monetized === true || input.monetized === 'true';

  for (const field of ['freeChapterCount', 'defaultChapterPriceCredits', 'freeAfterDays', 'rentalHours']) {
    if (input[field] === undefined) continue;
    const number = Number(input[field]);
    if (!Number.isInteger(number) || number < 0) {
      return { error: `${field} must be a whole number of 0 or more` };
    }
    value[field] = number;
  }

  if (input.accessMode !== undefined) {
    if (!['inherit', 'permanent', 'rental'].includes(input.accessMode)) {
      return { error: 'accessMode must be inherit, permanent or rental' };
    }
    value.accessMode = input.accessMode;
  }

  if (value.accessMode === 'rental' && !(value.rentalHours > 0)) {
    return { error: 'A rental needs a rental length in hours' };
  }

  return { value };
};

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

/**
 * Tell readers who have this novel in their library about new chapters.
 *
 * Routed through dispatchNotification rather than writing Notification rows
 * directly. The old insertMany bypassed the global enableChapterNotifications
 * toggle, every per-user preference, the banned check and email entirely —
 * which made the notification users receive most often the only one no setting
 * could control.
 */
const notifyLibraryUsers = async (novel, chapters) => {
  const users = await User.find({ library: novel._id, banned: false })
    .select('_id email username notificationPreferences banned');
  if (!users.length) {
    return;
  }
  const title = `New chapter${chapters.length === 1 ? '' : 's'} of ${novel.title}`;
  const message =
    chapters.length === 1
      ? `New chapter of ${novel.title}: Chapter ${chapters[0].number} - ${chapters[0].title}`
      : `${chapters.length} new chapters of ${novel.title}`;
  const link = `/novel/${novel.slug}`;

  // Batched so a novel with a large library does not fan out all at once;
  // email delivery is throttled further by the queue behind dispatchNotification.
  const BATCH = 250;
  for (let i = 0; i < users.length; i += BATCH) {
    await Promise.all(
      users.slice(i, i + BATCH).map((user) =>
        dispatchNotification({
          recipient: user,
          type: NOTIFICATION_TYPES.NEW_CHAPTER,
          title,
          message,
          link,
          channels: [NOTIFICATION_CHANNELS.IN_APP, NOTIFICATION_CHANNELS.EMAIL],
          metadata: { novelId: novel._id, chapterCount: chapters.length },
        }).catch((error) => console.error('[notifyLibraryUsers]', error.message))
      )
    );
  }
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
    User.find().sort({ createdAt: -1 }).limit(5).select('username email createdAt fullName'),
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
  if (req.body.monetization) {
    const parsed = parseNovelMonetization(req.body.monetization);
    if (parsed.error) return res.status(400).json({ message: parsed.error });
    novel.monetization = { ...plainSubdoc(novel.monetization), ...parsed.value };
  }
  await novel.save();
  res.json({ novel });
});

const deleteNovel = asyncHandler(async (req, res) => {
  const novel = await Novel.findById(req.params.id);
  if (!novel) {
    return res.status(404).json({ message: 'Novel not found' });
  }
  const guard = await guardNovelDeletion(novel._id, { force: req.query.force === 'true' });
  // Soft delete: mark the novel and its chapters/comments/reviews as deleted.
  // Nothing is removed — stored files, reading progress and library references
  // are all preserved; soft-deleted records are just hidden from reads.
  await Promise.all([
    Chapter.softDeleteMany({ novel: novel._id }),
    Comment.softDeleteMany({ novel: novel._id }),
    Review.softDeleteMany({ novel: novel._id }),
    novel.softDelete(),
  ]);
  res.json({ message: 'Novel deleted', purchaseGuard: guard });
});

const listNovelChapters = asyncHandler(async (req, res) => {
  const chapters = await Chapter.find({ novel: req.params.id })
    // Pricing is included so the admin list can show what each chapter costs
    // without a request per row. `freeAfterDays`, `originalNumber`, `wordCount`
    // and `publishedAt` are all read by the price resolver below — omitting
    // them would make the effective price shown here quietly wrong for timed
    // releases and renumbered chapters.
    .select(
      'number title views published createdAt updatedAt accessType priceCredits ' +
        'earlyAccessUntil freeAfterDays originalNumber wordCount publishedAt'
    )
    .sort({ number: 1 });

  // What the reader would actually be charged, which is not the same as the
  // stored value: a chapter with no override still has an effective price from
  // the novel or global defaults. Showing only the override would make a
  // fully-priced novel look free.
  const novel = await Novel.findById(req.params.id);
  let effective = new Map();
  if (novel) {
    const resolved = await accessService.resolveNovelChapters({ novel, chapters, user: null });
    effective = new Map(
      resolved.map((row) => [
        String(row.chapter._id),
        { priceCredits: row.priceCredits, free: Boolean(row.free), reason: row.reason },
      ])
    );
  }

  res.json({
    chapters: chapters.map((chapter) => ({
      ...chapter.toObject(),
      effective: effective.get(String(chapter._id)) || null,
    })),
  });
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

const applyChapterPricing = (chapter, body) => {
  const { updates, errors } = readChapterPricing(body);
  if (errors.length) return errors;

  // The parser only sees the payload, so it cannot catch a price of 0 sent
  // without an accessType against a chapter already marked paid — which would
  // silently give away a chapter that is supposed to cost something. Checking
  // the merged result closes that.
  const merged = { accessType: chapter.accessType, priceCredits: chapter.priceCredits, ...updates };
  if (merged.accessType === CHAPTER_ACCESS_TYPES.PAID && merged.priceCredits === 0) {
    return ['A paid chapter cannot cost 0 credits — set access to Free instead'];
  }

  Object.assign(chapter, updates);
  return null;
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
  const { updates: pricing, errors } = readChapterPricing(req.body);
  if (errors.length) return res.status(400).json({ message: errors[0], errors });

  const chapter = await Chapter.create({
    novel: novel._id,
    number: number ? Number(number) : await nextChapterNumber(novel._id),
    title,
    content,
    published: published !== undefined ? published === 'true' || published === true : true,
    ...pricing,
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
  const { updates: pricing, errors } = readChapterPricing(req.body);
  if (errors.length) return res.status(400).json({ message: errors[0], errors });

  // Archive the original upload privately so it can be re-downloaded later.
  const sourceFile = await storage.uploadPrivate(req.file, 'chapter-sources');
  const chapter = await Chapter.create({
    novel: novel._id,
    number: req.body.number ? Number(req.body.number) : await nextChapterNumber(novel._id),
    title: req.body.title || titleFromFilename(req.file.originalname),
    content,
    sourceFile: sourceFile || undefined,
    ...pricing,
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
  const { updates: bulkPricing, errors } = readChapterPricing(req.body);
  if (errors.length) return res.status(400).json({ message: errors[0], errors });
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
        // Uploading 200 chapters and then pricing them one by one is not a
        // workflow, so the whole batch takes the pricing sent with the zip.
        ...bulkPricing,
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

  const pricingErrors = applyChapterPricing(chapter, req.body);
  if (pricingErrors) return res.status(400).json({ message: pricingErrors[0], errors: pricingErrors });

  await chapter.save();
  await syncNovelChapterMeta(chapter.novel);
  res.json({ chapter });
});

/**
 * PUT /api/admin/novels/:id/chapters/pricing
 *
 * Re-price many chapters at once. Pricing a long novel one chapter at a time
 * is not a workflow anyone will actually follow, and the alternative — a
 * global default — cannot express "first 20 free, the rest 10 credits".
 *
 * Accepts either an explicit list of chapter ids or a `from`/`to` number range,
 * because both are natural ways to think about it.
 */
const bulkPriceChapters = asyncHandler(async (req, res) => {
  const novel = await Novel.findById(req.params.id);
  if (!novel) return res.status(404).json({ message: 'Novel not found' });

  const { updates, errors } = readChapterPricing(req.body);
  if (errors.length) return res.status(400).json({ message: errors[0], errors });
  if (!Object.keys(updates).length) {
    return res.status(400).json({ message: 'Nothing to change — send accessType and/or priceCredits' });
  }

  const filter = { novel: novel._id };
  const { chapterIds, from, to } = req.body;

  if (Array.isArray(chapterIds) && chapterIds.length) {
    filter._id = { $in: chapterIds };
  } else if (from !== undefined || to !== undefined) {
    filter.number = {};
    if (from !== undefined) filter.number.$gte = Number(from);
    if (to !== undefined) filter.number.$lte = Number(to);
  }

  // Chapters people already bought are not re-priced retroactively in any way
  // that matters — they keep their access — but the admin should know the
  // change affects a novel with sales.
  const [result, sold] = await Promise.all([
    Chapter.updateMany(filter, { $set: updates }),
    ChapterAccess.countDocuments({ novel: novel._id, creditsSpent: { $gt: 0 } }),
  ]);

  res.json({
    matched: result.matchedCount ?? result.n ?? 0,
    updated: result.modifiedCount ?? result.nModified ?? 0,
    applied: updates,
    existingPurchases: sold,
  });
});

const deleteChapter = asyncHandler(async (req, res) => {
  const chapter = await Chapter.findById(req.params.id);
  if (!chapter) {
    return res.status(404).json({ message: 'Chapter not found' });
  }
  // Refuse or refund before destroying access people paid for. `force=true`
  // is the admin confirming the impact preview.
  const guard = await guardChapterDeletion([chapter._id], { force: req.query.force === 'true' });
  // Soft delete the chapter with its comments and chapter reviews; the stored
  // source file is kept.
  const novelId = chapter.novel;
  await Promise.all([
    Comment.softDeleteMany({ chapter: chapter._id }),
    Review.softDeleteMany({ chapter: chapter._id }),
    chapter.softDelete(),
  ]);
  await Promise.all([syncNovelChapterMeta(novelId), recalcChapterRating(chapter._id)]);
  res.json({ message: 'Chapter deleted', purchaseGuard: guard });
});

const listUsers = asyncHandler(async (req, res) => {
  const { search } = req.query;
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (search) {
    filter.$or = [
      { username: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { fullName: { $regex: search, $options: 'i' } },
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
  // Financial records must survive an erasure request, so a user who has
  // transacted is anonymized rather than removed. The guard decides.
  const guard = await guardUserDeletion(user, { force: req.query.force === 'true' });

  // Soft delete the user and hide their comments/reviews. Reading progress and
  // notifications are left intact so nothing is lost from the database.
  const reviews = await Review.find({ user: user._id }).select('novel chapter');
  await Promise.all([
    Comment.softDeleteMany({ user: user._id }),
    Review.softDeleteMany({ user: user._id }),
    // anonymizeUser already set deletedAt; do not re-save a stale document over it.
    guard.action === 'anonymized' ? Promise.resolve() : user.softDelete(),
  ]);
  await recalcRatingsFor(reviews);
  res.json({
    message: guard.action === 'anonymized' ? 'User anonymized, financial records retained' : 'User deleted',
    transactionGuard: guard,
  });
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
    $or: [
      { username: searchRegex(search) },
      { email: searchRegex(search) },
      { fullName: searchRegex(search) },
    ],
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
  const stringFields = ['siteName', 'tagline', 'announcement', 'footerText', 'carouselMode'];
  stringFields.forEach((field) => {
    if (body[field] !== undefined) {
      settings[field] = body[field];
    }
  });
  if (body.carouselAutoPlayInterval !== undefined) {
    settings.carouselAutoPlayInterval = Number(body.carouselAutoPlayInterval) || 6;
  }
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
  const boolFields = [
    'enableInAppNotifications',
    'enableEmailNotifications',
    'enableMentionNotifications',
    'enableReplyNotifications',
    'enableChapterNotifications',
    'enableCarouselAutoPlay',
  ];
  boolFields.forEach((field) => {
    if (body[field] !== undefined) {
      settings[field] = body[field] === 'true' || body[field] === true;
    }
  });
  await settings.save();
  res.json({ settings });
});

const broadcastAnnouncement = asyncHandler(async (req, res) => {
  const { message, link } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ message: 'message is required' });
  }
  const campaign = await dispatchCampaign({
    title: 'Announcement',
    message: message.trim(),
    link: link || '',
    targetAudience: 'all',
    channels: ['in_app'],
    adminUser: req.user,
    type: 'announcement',
  });
  res.status(201).json({ notifiedCount: campaign ? campaign.recipientCount : 0 });
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

const dispatchAdminNotification = asyncHandler(async (req, res) => {
  const { title, message, link, targetAudience, targetUserId, channels } = req.body;
  if (!title || !message) {
    return res.status(400).json({ message: 'Title and message are required' });
  }
  const campaign = await dispatchCampaign({
    title: title.trim(),
    message: message.trim(),
    link: (link || '').trim(),
    targetAudience: targetAudience || 'all',
    targetUserId: targetUserId || null,
    channels: Array.isArray(channels) && channels.length > 0 ? channels : ['in_app'],
    adminUser: req.user,
  });
  if (!campaign) {
    return res.status(400).json({ message: 'No eligible recipients found' });
  }
  res.status(201).json({ campaign, message: 'Notification dispatch initiated successfully' });
});

const listCampaigns = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const [campaigns, total] = await Promise.all([
    Campaign.find()
      .populate('createdBy', 'username email fullName')
      .populate('targetUser', 'username email fullName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Campaign.countDocuments(),
  ]);
  res.json({ campaigns, total, page, pages: Math.ceil(total / limit) });
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
  bulkPriceChapters,
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
  dispatchAdminNotification,
  listCampaigns,
};
