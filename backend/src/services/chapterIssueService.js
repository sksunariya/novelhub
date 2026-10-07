// Reader-reported chapter problems. See models/ChapterIssue.js for why this is
// separate from the community report system.
//
// The normalise* functions are pure so the rules can be unit tested without a
// database; everything that touches Mongo is below them.

const mongoose = require('mongoose');
const {
  CHAPTER_ISSUE_CATEGORIES,
  CHAPTER_ISSUE_CATEGORY_KEYS,
  CHAPTER_ISSUE_STATUS,
  CHAPTER_ISSUE_LIMITS,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
} = require('../config/constants');

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

const CATEGORY_LABELS = Object.fromEntries(CHAPTER_ISSUE_CATEGORIES.map((c) => [c.key, c.label]));

// Categories where a bare click tells the admin nothing: "something else" with
// no description could mean anything.
const DETAILS_REQUIRED = new Set(['other']);

const cleanText = (value, max) =>
  String(value == null ? '' : value)
    // Control characters other than newline and tab have no business in a
    // report and make the admin view render oddly.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);

const finiteOrNull = (value, min, max) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
};

/** Validate and trim what the reader sent. Throws a 400 on anything unusable. */
const normaliseSubmission = (body = {}) => {
  const category = String(body.category || '');
  if (!CHAPTER_ISSUE_CATEGORY_KEYS.includes(category)) {
    throw badRequest('Choose what kind of problem this is');
  }

  const details = cleanText(body.details, CHAPTER_ISSUE_LIMITS.DETAILS_MAX);
  if (DETAILS_REQUIRED.has(category) && details.length < 5) {
    throw badRequest('Please describe the problem');
  }

  const raw = body.context && typeof body.context === 'object' ? body.context : {};
  const progress = finiteOrNull(raw.progress, 0, 100);

  return {
    category,
    details,
    quote: cleanText(body.quote, CHAPTER_ISSUE_LIMITS.QUOTE_MAX),
    context: {
      progress: progress === null ? null : Math.round(progress),
      theme: cleanText(raw.theme, 20),
      font: cleanText(raw.font, 20),
      fontSize: finiteOrNull(raw.fontSize, 8, 64),
      viewport: /^\d{2,5}x\d{2,5}$/.test(String(raw.viewport || '')) ? String(raw.viewport) : '',
    },
  };
};

const STATUS_VALUES = Object.values(CHAPTER_ISSUE_STATUS);
const CLOSED = new Set([CHAPTER_ISSUE_STATUS.RESOLVED, CHAPTER_ISSUE_STATUS.DISMISSED]);

/** Validate an admin status change. */
const normaliseStatusChange = (body = {}) => {
  const status = String(body.status || '');
  if (!STATUS_VALUES.includes(status)) throw badRequest('Unknown status');
  return {
    status,
    note: cleanText(body.note, CHAPTER_ISSUE_LIMITS.NOTE_MAX),
    // Only a close is worth telling the reader about, and only when asked.
    notify: CLOSED.has(status) && body.notify !== false && body.notify !== 'false',
  };
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

/** The Mongo filter for the admin queue's query string. */
const buildQueueFilter = (query = {}) => {
  const filter = {};
  if (query.status && query.status !== 'all') {
    if (!STATUS_VALUES.includes(query.status)) throw badRequest('Unknown status');
    filter.status = query.status;
  }
  if (query.category) {
    if (!CHAPTER_ISSUE_CATEGORY_KEYS.includes(query.category)) throw badRequest('Unknown category');
    filter.category = query.category;
  }
  if (query.novel) {
    if (!isId(query.novel)) throw badRequest('Invalid novel');
    filter.novel = query.novel;
  }
  if (query.chapter) {
    if (!isId(query.chapter)) throw badRequest('Invalid chapter');
    filter.chapter = query.chapter;
  }
  const search = cleanText(query.search, 100);
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [
      { details: rx },
      { quote: rx },
      { 'snapshot.novelTitle': rx },
      { 'snapshot.chapterTitle': rx },
      { 'snapshot.reporterName': rx },
    ];
  }
  return filter;
};

// ------------------------------------------------------------------ database

const lazyModels = () => ({
  ChapterIssue: require('../models/ChapterIssue'),
  Chapter: require('../models/Chapter'),
  Novel: require('../models/Novel'),
});

/**
 * File a report, or fold it into the reader's existing open report on the same
 * chapter and category. Returns { issue, updated }.
 */
const file = async ({ reporter, chapterId, body, userAgent = '' }) => {
  const { ChapterIssue, Chapter, Novel } = lazyModels();
  if (!isId(chapterId)) throw badRequest('Invalid chapter');

  const input = normaliseSubmission(body);

  const chapter = await Chapter.findById(chapterId).select('novel number title published');
  if (!chapter || !chapter.published) {
    throw Object.assign(new Error('Chapter not found'), { status: 404 });
  }
  const novel = await Novel.findById(chapter.novel).select('title slug');
  if (!novel) throw Object.assign(new Error('Chapter not found'), { status: 404 });

  const context = {
    ...input.context,
    userAgent: cleanText(userAgent, CHAPTER_ISSUE_LIMITS.USER_AGENT_MAX),
  };

  const existing = await ChapterIssue.findOne({
    reporter: reporter._id,
    chapter: chapter._id,
    category: input.category,
    status: { $in: [CHAPTER_ISSUE_STATUS.OPEN, CHAPTER_ISSUE_STATUS.IN_PROGRESS] },
  });

  if (existing) {
    // Keep what they said before if the new submission says nothing.
    if (input.details) existing.details = input.details;
    if (input.quote) existing.quote = input.quote;
    existing.context = context;
    existing.submissions += 1;
    existing.lastSubmittedAt = new Date();
    await existing.save();
    return { issue: existing, updated: true };
  }

  const issue = await ChapterIssue.create({
    chapter: chapter._id,
    novel: novel._id,
    reporter: reporter._id,
    snapshot: {
      novelTitle: novel.title,
      novelSlug: novel.slug,
      chapterNumber: chapter.number,
      chapterTitle: chapter.title,
      reporterName: reporter.username || '',
    },
    category: input.category,
    details: input.details,
    quote: input.quote,
    context,
  });
  return { issue, updated: false };
};

const POPULATE = [
  { path: 'reporter', select: 'username fullName email avatarUrl banned' },
  { path: 'handledBy', select: 'username' },
  { path: 'chapter', select: 'number title published deletedAt' },
  { path: 'novel', select: 'title slug' },
];

/** One page of the admin queue plus the counts the tabs show. */
const list = async ({ query = {}, page = 1, limit = 20 }) => {
  const { ChapterIssue } = lazyModels();
  const filter = buildQueueFilter(query);
  const skip = (page - 1) * limit;

  // Tab counts ignore the status filter but honour every other one, so
  // switching tabs never lands on a number that disagrees with the list.
  const { status: _ignored, ...countFilter } = filter;

  const [issues, total, statusCounts] = await Promise.all([
    ChapterIssue.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate(POPULATE).lean(),
    ChapterIssue.countDocuments(filter),
    ChapterIssue.aggregate([
      { $match: countFilter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  // How many open reports each listed chapter has in total, so a row can say
  // "3 other readers reported this chapter".
  const chapterIds = [...new Set(issues.map((i) => String(i.chapter?._id || i.chapter)))];
  const perChapter = chapterIds.length
    ? await ChapterIssue.aggregate([
      {
        $match: {
          chapter: { $in: chapterIds.map((id) => new mongoose.Types.ObjectId(id)) },
          status: { $in: [CHAPTER_ISSUE_STATUS.OPEN, CHAPTER_ISSUE_STATUS.IN_PROGRESS] },
        },
      },
      { $group: { _id: '$chapter', count: { $sum: 1 } } },
    ])
    : [];
  const openByChapter = new Map(perChapter.map((r) => [String(r._id), r.count]));

  const counts = Object.fromEntries(STATUS_VALUES.map((s) => [s, 0]));
  for (const row of statusCounts) counts[row._id] = row.count;

  return {
    issues: issues.map((issue) => ({
      ...issue,
      categoryLabel: CATEGORY_LABELS[issue.category] || issue.category,
      openOnChapter: openByChapter.get(String(issue.chapter?._id || issue.chapter)) || 0,
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    counts,
  };
};

/** The chapters with the most unresolved reports. */
const hotspots = async ({ limit = 5 } = {}) => {
  const { ChapterIssue } = lazyModels();
  const rows = await ChapterIssue.aggregate([
    { $match: { status: { $in: [CHAPTER_ISSUE_STATUS.OPEN, CHAPTER_ISSUE_STATUS.IN_PROGRESS] } } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$chapter',
        count: { $sum: 1 },
        categories: { $addToSet: '$category' },
        latestAt: { $first: '$createdAt' },
        snapshot: { $first: '$snapshot' },
        novel: { $first: '$novel' },
      },
    },
    { $sort: { count: -1, latestAt: -1 } },
    { $limit: limit },
  ]);
  return rows.map((row) => ({
    chapter: row._id,
    novel: row.novel,
    count: row.count,
    latestAt: row.latestAt,
    novelTitle: row.snapshot?.novelTitle || '',
    novelSlug: row.snapshot?.novelSlug || '',
    chapterNumber: row.snapshot?.chapterNumber,
    chapterTitle: row.snapshot?.chapterTitle || '',
    categories: row.categories.map((key) => CATEGORY_LABELS[key] || key),
  }));
};

const notifyReporter = async (issue, actor) => {
  const { dispatchNotification } = require('./notificationService');
  const where = `Chapter ${issue.snapshot?.chapterNumber ?? ''} of ${issue.snapshot?.novelTitle || 'a novel'}`.trim();
  const outcome = issue.status === CHAPTER_ISSUE_STATUS.RESOLVED ? 'has been fixed' : 'was reviewed and closed';
  const note = issue.resolutionNote ? ` Note from the team: ${issue.resolutionNote}` : '';
  const link =
    issue.snapshot?.novelSlug && issue.snapshot?.chapterNumber != null
      ? `/novel/${issue.snapshot.novelSlug}/chapter/${issue.snapshot.chapterNumber}`
      : '';
  await dispatchNotification({
    recipient: issue.reporter,
    actor,
    type: NOTIFICATION_TYPES.CUSTOM,
    title: 'Your chapter report',
    message: `Your report about ${where} ${outcome}. Thanks for letting us know.${note}`,
    link,
    channels: [NOTIFICATION_CHANNELS.IN_APP],
    metadata: { chapterIssue: String(issue._id) },
  });
};

/** Change status on one or more reports. Returns the number changed. */
const setStatus = async ({ ids, body, actor }) => {
  const { ChapterIssue } = lazyModels();
  const list = (Array.isArray(ids) ? ids : [ids]).map(String).filter(isId);
  if (!list.length) throw badRequest('Nothing selected');
  if (list.length > 200) throw badRequest('Too many reports at once');

  const change = normaliseStatusChange(body);
  const issues = await ChapterIssue.find({ _id: { $in: list } });
  if (!issues.length) throw Object.assign(new Error('Report not found'), { status: 404 });

  const reopening = !CLOSED.has(change.status);
  const changed = [];
  for (const issue of issues) {
    const before = issue.status;
    if (before === change.status && !change.note) continue;
    issue.status = change.status;
    if (change.note || reopening) issue.resolutionNote = change.note;
    issue.handledBy = actor._id;
    issue.handledAt = new Date();
    if (reopening) issue.reporterNotified = false;
    await issue.save();
    changed.push({ issue, before });
  }

  // After the saves, and never fatal: a failed notification must not undo or
  // fail the status change the admin just made.
  if (change.notify) {
    await Promise.all(
      changed
        .filter(({ issue }) => !issue.reporterNotified)
        .map(async ({ issue }) => {
          try {
            await notifyReporter(issue, actor);
            issue.reporterNotified = true;
            await issue.save();
          } catch (error) {
            console.error('[chapterIssues] notify failed:', error.message);
          }
        })
    );
  }

  return { changed: changed.length, transitions: changed.map(({ issue, before }) => ({ id: String(issue._id), before, after: issue.status })) };
};

module.exports = {
  CATEGORY_LABELS,
  normaliseSubmission,
  normaliseStatusChange,
  buildQueueFilter,
  file,
  list,
  hotspots,
  setStatus,
};
