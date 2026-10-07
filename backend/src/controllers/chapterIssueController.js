const AdminAuditLog = require('../models/AdminAuditLog');
const chapterIssueService = require('../services/chapterIssueService');
const { asyncHandler } = require('../middlewares/errorHandler');
const { CHAPTER_ISSUE_CATEGORIES, CHAPTER_ISSUE_STATUS, PAGINATION } = require('../config/constants');

// Chapter problem reports: readers file them from the reader toolbar, admins
// holding the `chapter_reports` module work through them in the portal.

const audit = (req, { entityId, changes = [], note = '' }) =>
  AdminAuditLog.create({
    actor: req.user._id,
    actorLabel: req.user.username || req.user.email || '',
    action: 'chapter_issue.status',
    entity: 'chapter_issue',
    entityId: String(entityId),
    changes,
    note,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || '',
  }).catch((error) => {
    // A failed audit write must not fail the action it describes.
    console.error('chapterIssues: audit write failed:', error.message);
  });

const parsePagination = (query) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || PAGINATION.DEFAULT_LIMIT, 1), 50);
  return { page, limit };
};

// ------------------------------------------------------------------ reader

/** GET /api/chapter-issues/categories — what the report dialog offers. */
const getCategories = (req, res) => {
  res.json({ categories: CHAPTER_ISSUE_CATEGORIES });
};

/** POST /api/chapter-issues/chapters/:chapterId */
const submitIssue = asyncHandler(async (req, res) => {
  const { updated } = await chapterIssueService.file({
    reporter: req.user,
    chapterId: req.params.chapterId,
    body: req.body || {},
    userAgent: req.headers['user-agent'] || '',
  });
  res.status(updated ? 200 : 201).json({
    reported: true,
    updated,
    message: updated
      ? 'You had already reported this — we added your new details to it.'
      : 'Thanks for the report. Our team will take a look.',
  });
});

// ------------------------------------------------------------------ admin

/** GET /api/admin/chapter-issues */
const listIssues = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const query = { ...req.query };
  // Open is the useful default; "all" is asked for explicitly.
  if (!query.status) query.status = CHAPTER_ISSUE_STATUS.OPEN;
  res.json(await chapterIssueService.list({ query, page, limit }));
});

/** GET /api/admin/chapter-issues/hotspots */
const getHotspots = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 20);
  res.json({ chapters: await chapterIssueService.hotspots({ limit }) });
});

const applyStatus = async (req, res, ids) => {
  const result = await chapterIssueService.setStatus({ ids, body: req.body || {}, actor: req.user });
  await Promise.all(
    result.transitions.map((t) =>
      audit(req, {
        entityId: t.id,
        changes: [{ key: 'status', before: t.before, after: t.after }],
        note: String(req.body?.note || '').slice(0, 1000),
      })
    )
  );
  res.json({ changed: result.changed });
};

/** PATCH /api/admin/chapter-issues/:id  { status, note?, notify? } */
const updateIssue = asyncHandler(async (req, res) => applyStatus(req, res, [req.params.id]));

/** POST /api/admin/chapter-issues/bulk  { ids: [], status, note?, notify? } */
const bulkUpdate = asyncHandler(async (req, res) => applyStatus(req, res, req.body?.ids));

module.exports = {
  getCategories,
  submitIssue,
  listIssues,
  getHotspots,
  updateIssue,
  bulkUpdate,
};
